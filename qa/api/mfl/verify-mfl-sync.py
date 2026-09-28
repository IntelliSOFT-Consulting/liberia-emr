#!/usr/bin/env python3
"""API contract tests for the MFL sync (LE-325).

The spec is docs/architecture/mfl-sync-api.md and ADR 0009. The backend syncs from the stub in
qa/api/mfl-stub/, never from the live MOH MFL.

  qa/api/mfl/verify-mfl-sync.py --material-dir DIR [--base-url https://localhost]
      [--user admin] [--password Admin123] [--stub-url https://localhost:18443]
      [--stub-internal-url https://mfl-stub:8443/mfl] [--timeout 300]
      [--own-root-uuid UUID] [--backend-logs-cmd "docker compose ... logs --no-color backend"]
      [--allow-host HOST]

  qa/api/mfl/verify-mfl-sync.py --unavailable [--base-url ...] [--user ...] [--password ...]

The first form needs a disposable stack started with the overlay in qa/api/mfl-stub/, whose
backend has the stub's credentials. It creates users, a role and locations, and runs syncs, so
it refuses any host but localhost unless you pass --allow-host.

The second form (--unavailable) runs against a backend WITHOUT MFL credentials. It checks that
the sync reports itself unavailable, that the endpoints that need credentials answer 503, and
that the ones that don't still work.

Every check prints PASS or FAIL, and the script carries on after a failure so one run shows the
whole picture. It exits non-zero if any check failed. There is no skip: a check that cannot run
is a failure.
"""
import argparse
import base64
import json
import secrets
import ssl
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FIXTURES = REPO / "integration/dhis2/mfl/fixtures"
CAREYSBURG_VARS = REPO / "content-packages/content-site-careysburg/configuration/variables.properties"

# ADR 0009 §1: rows the sync creates get UUIDv5(namespace, MFL UID).
NAMESPACE = uuid.UUID("e0b0fbf7-045c-437a-8e7c-4504984c5e1a")
# ADR 0009 §4: the canonical attribute types.
ATTR = {
    "MFL UID": "06568ddd-cc3b-4957-ad92-17e7249106c1",
    "MFL Code": "3118cabe-9a5d-420c-8a55-86234deb9b1b",
    "Facility Type": "98dd0863-47bd-4038-9759-16ebe6c9d51b",
    "Facility Ownership": "a75cb46c-dd20-42eb-abe5-94fed07bc059",
    "EmONC Level": "827bd8d1-053e-4441-88aa-fb9cac44a60a",
    "Facility Setting": "4880dd80-2b53-4dcf-aba9-5be5bd79c981",
    "MFL Closed Date": "7d15cde2-fa20-4b98-acd0-be2dbd3597aa",
    "MFL Last Updated": "a7c23ee9-dabd-4605-b039-325b2303850f",
}
ATTR_NAME_BY_UUID = {v: k for k, v in ATTR.items()}
# ADR 0009 §3: groups are mapped by UID, with these tie-breaks.
TYPE_GROUPS = [("oj9yiq3uMLI", "Hospital"), ("EltS2EPR5gR", "Health Center"), ("cLPxlR1Brv9", "Clinic")]
OWNERSHIP_GROUPS = {"xSUk0MvIAUh": "Public", "lIYtHp5tvaG": "Private", "h4oGe3jDqml": "Faith Based",
                    "r4GnS2GDzJO": "Concession"}
EMONC_GROUPS = [("M8CdHRhgkwW", "CEmONC"), ("lAnbydCDQwW", "BEmONC")]
SETTING_GROUPS = {"W1RG9PaTxzr": "Rural", "L7IimdCGSjT": "Urban"}

# Fixture units the tests single out (see integration/dhis2/mfl/README.md, "Fixture").
ADOPTED = "jbGSiLCEFKJ"          # Careysburg Clinic: adopted by an existing row's MFL UID
DUPLICATE_TARGET = "kueVlXwUXiI"  # Barnersville HC: given a second row to provoke an item error
CLOSED = "ucTzZhF5okn"           # Jamaica Rd Clinic, Bushrod, closed 2026-04-01
REMOVED = "bP0PeqBGKgB"          # Come & See Clinic: absent in the stub's remove-one scenario
RENAMED = ("VxgfT09KRV4", "Kesselee Memorial Health Centre")
REPARENTED = ("LDoJbUPbnU4", "E57DkQD0HC4")
HUMAN_RETIRED = "FNSAES9Meck"    # Degei Clinic
EXTRA = ("QaStubRoot1", "QA Stub Root Facility")
COUNTRY = "LHNiyIWuLdc"
NOT_A_DISTRICT = "UkXuMDgeakb"   # CHT - Bong: level 3 with no facilities, never created

API = "/openmrs/ws/rest/v1"
MFL = API + "/liberiaemr/mfl"


# --------------------------------------------------------------------------------------------
# Results
# --------------------------------------------------------------------------------------------

class Results:
    def __init__(self):
        self.passed, self.failed = [], []

    def check(self, name, ok, *detail):
        if ok:
            self.passed.append(name)
            print(f"PASS [{name}]", flush=True)
        else:
            self.failed.append(name)
            print(f"FAIL [{name}]", file=sys.stderr, flush=True)
            for d in detail:
                print(f"    {str(d)[:600]}", file=sys.stderr, flush=True)
        return ok

    def section(self, title, fn, *args):
        print(f"\n== {title} ==", flush=True)
        try:
            fn(*args)
        except Exception as e:  # a broken section is a failure, never a skip
            self.check(f"{title}: completed without an exception", False, repr(e),
                       traceback.format_exc().splitlines()[-3:])

    def summary(self):
        print(f"\n{len(self.passed)} passed, {len(self.failed)} failed")
        for name in self.failed:
            print(f"  failed: {name}")
        return 0 if not self.failed else 1


R = Results()


# --------------------------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------------------------

class Response:
    def __init__(self, status, headers, text):
        self.status, self.headers, self.text = status, headers, text
        try:
            self.json = json.loads(text) if text else None
        except json.JSONDecodeError:
            self.json = None

    def __repr__(self):
        return f"<{self.status} {self.text[:300]}>"


class Http:
    """Every response is kept, so the leak check can search all of them at the end."""

    def __init__(self, base, timeout):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.ctx = ssl._create_unverified_context()  # the test stack's gateway is self-signed
        self.seen = []

    def call(self, method, path, body=None, auth=None, headers=None, base=None):
        url = (base or self.base) + path
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if auth:
            token = base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
            req.add_header("Authorization", f"Basic {token}")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=self.timeout) as r:
                resp = Response(r.status, dict(r.headers), r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            resp = Response(e.code, dict(e.headers or {}), e.read().decode("utf-8", "replace"))
        self.seen.append((f"{method} {path}", resp))
        return resp


class Ctx:
    def __init__(self, args):
        self.args = args
        self.http = Http(args.base_url, args.timeout)
        self.admin = (args.user, args.password)
        self.material = Path(args.material_dir) if args.material_dir else None
        self.stub_password = None
        if self.material:
            self.stub_password = (self.material / "password").read_text().rstrip("\n")
            self.stub_user = (self.material / "username").read_text().strip()
        self.users = {}
        self.cleanup = []

    # ---- the MFL endpoints ---------------------------------------------------------------
    def mfl(self, method, path, body=None, auth="admin"):
        creds = self.admin if auth == "admin" else auth
        return self.http.call(method, MFL + path, body, auth=creds)

    def rest(self, method, path, body=None):
        return self.http.call(method, API + path, body, auth=self.admin)

    # ---- the stub's control API ----------------------------------------------------------
    def stub(self, method, what, body=None):
        return self.http.call(method, "/__stub/" + what, body, base=self.args.stub_url)

    def scenario(self, name, delay_ms=0):
        r = self.stub("POST", "scenario", {"name": name, "delayMs": delay_ms})
        if r.status != 200:
            raise RuntimeError(f"the stub refused scenario {name}: {r}")

    def stub_requests(self):
        return self.stub("GET", "requests").json["requests"]

    # ---- runs ----------------------------------------------------------------------------
    def start_run(self, dry_run=None):
        body = {} if dry_run is None else {"dryRun": dry_run}
        return self.mfl("POST", "/runs", body)

    def wait_run(self, run_id):
        deadline = time.time() + self.args.timeout
        while time.time() < deadline:
            r = self.mfl("GET", f"/runs/{run_id}")
            if r.status == 200 and r.json.get("status") != "RUNNING":
                return r.json
            time.sleep(2)
        raise RuntimeError(f"run {run_id} still RUNNING after {self.args.timeout}s")

    def run(self, dry_run=None, label="run"):
        """Start a run, check the 202 contract, and wait for it to finish."""
        r = self.start_run(dry_run)
        R.check(f"{label}: POST /runs answers 202", r.status == 202, r)
        if r.status != 202:
            raise RuntimeError(f"could not start {label}")
        run = r.json
        loc = {k.lower(): v for k, v in r.headers.items()}.get("location", "")
        R.check(f"{label}: 202 body is the new run, RUNNING, with a Location header naming it",
                run.get("status") == "RUNNING" and loc.endswith(f"/runs/{run.get('id')}"),
                run, f"Location: {loc}")
        return self.wait_run(run["id"])

    def items(self, run_id, action=None):
        out, start = [], 0
        while True:
            q = f"?startIndex={start}&limit=200" + (f"&action={action}" if action else "")
            r = self.mfl("GET", f"/runs/{run_id}/items{q}")
            if r.status != 200:
                raise RuntimeError(f"GET /runs/{run_id}/items: {r}")
            out += r.json["results"]
            start += len(r.json["results"])
            if not r.json["results"] or start >= r.json["totalCount"]:
                return out

    def status(self):
        r = self.mfl("GET", "/status")
        if r.status != 200:
            raise RuntimeError(f"GET /status: {r}")
        return r.json

    # ---- locations -----------------------------------------------------------------------
    def location(self, loc_uuid):
        r = self.rest("GET", f"/location/{loc_uuid}?v=full")
        return r.json if r.status == 200 else None

    def create_location(self, name, mfl_uid=None, **extra):
        body = {"name": name, **extra}
        if mfl_uid:
            body["attributes"] = [{"attributeType": ATTR["MFL UID"], "value": mfl_uid}]
        r = self.rest("POST", "/location", body)
        if r.status not in (200, 201):
            raise RuntimeError(f"could not create location {name}: {r}")
        return r.json["uuid"]


def v5(uid):
    return str(uuid.uuid5(NAMESPACE, uid))


def attr(loc, name):
    for a in loc.get("attributes") or []:
        if a.get("voided"):
            continue
        type_uuid = (a.get("attributeType") or {}).get("uuid")
        if type_uuid == ATTR[name]:
            v = a.get("value")
            return v.get("display") if isinstance(v, dict) else v
    return None


def attr_uuid(loc, name):
    for a in loc.get("attributes") or []:
        if not a.get("voided") and (a.get("attributeType") or {}).get("uuid") == ATTR[name]:
            return a["uuid"]
    return None


def tags(loc):
    return {t.get("display") or t.get("name") for t in loc.get("tags") or []}


def parent_uuid(loc):
    return (loc.get("parentLocation") or {}).get("uuid")


def retire_reason(loc):
    return loc.get("retireReason") or (loc.get("auditInfo") or {}).get("retireReason") or ""


def find_items(items, mfl_uid, action=None):
    return [i for i in items if i.get("mflUid") == mfl_uid and (action is None or i.get("action") == action)]


# --------------------------------------------------------------------------------------------
# What the fixture should become, derived independently of the backend from ADR 0009 §3
# --------------------------------------------------------------------------------------------

class Expected:
    def __init__(self):
        units = json.loads((FIXTURES / "organisationUnits.json").read_text())["organisationUnits"]
        self.units = {u["id"]: u for u in units}
        has_children = {u["parent"]["id"] for u in units if u["level"] == 4}
        self.counties = [u for u in units if u["level"] == 2]
        self.districts = [u for u in units if u["level"] == 3 and u["id"] in has_children]
        self.facilities = [u for u in units if u["level"] == 4]
        self.active_facilities = [u for u in self.facilities if not u.get("closedDate")]
        managed = self.counties + self.districts + self.facilities
        active = [u for u in managed if not u.get("closedDate")]
        norm = {u["id"]: " ".join(u["name"].split()) for u in managed}
        counts = {}
        for u in active:
            counts[norm[u["id"]].lower()] = counts.get(norm[u["id"]].lower(), 0) + 1
        self.name = {}
        for u in managed:
            n = norm[u["id"]]
            if u["level"] == 4 and not u.get("closedDate") and counts[n.lower()] > 1:
                n = f"{n} ({' '.join(self.units[u['parent']['id']]['name'].split())})"
            self.name[u["id"]] = n
        self.clashing = [u["id"] for u in active if counts[norm[u["id"]].lower()] > 1]
        self.managed = managed
        self.norm = norm

    def expected_names(self, adopted=None, local_names=()):
        """ADR 0009 §3 name disambiguation, for the rows the sync creates.

        adopted maps an MFL UID to the local name of the row that adopted it: content owns that
        name, so the MFL name of an adopted unit does not count, and the local name does.
        local_names are the instance's other non-MFL location names. An active created row is
        suffixed when another active name matches it; a closed created row is suffixed when any
        other name matches it, open or closed, since OpenMRS refuses a retired location under an
        active one's name. Only level-4 facilities have a district to suffix with.
        """
        adopted = adopted or {}
        key = lambda n: " ".join(n.split()).lower()
        created = [u for u in self.managed if u["id"] not in adopted]
        locals_ = [key(n) for n in list(adopted.values()) + list(local_names)]
        active_counts, all_counts = {}, {}
        for n in locals_:
            active_counts[n] = active_counts.get(n, 0) + 1
            all_counts[n] = all_counts.get(n, 0) + 1
        for u in created:
            k = key(self.norm[u["id"]])
            all_counts[k] = all_counts.get(k, 0) + 1
            if not u.get("closedDate"):
                active_counts[k] = active_counts.get(k, 0) + 1
        names = {}
        for u in created:
            n = self.norm[u["id"]]
            clash = (all_counts if u.get("closedDate") else active_counts)[key(n)] > 1
            if u["level"] == 4 and clash:
                n = f"{n} ({' '.join(self.units[u['parent']['id']]['name'].split())})"
            names[u["id"]] = n
        for uid, local in adopted.items():
            names[uid] = local
        return names

    def attributes(self, u):
        groups = {g["id"] for g in u.get("organisationUnitGroups", [])}
        facility_type = next((label for gid, label in TYPE_GROUPS if gid in groups), None)
        owners = [OWNERSHIP_GROUPS[g] for g in groups if g in OWNERSHIP_GROUPS]
        if len(owners) == 2 and "Private" in owners:
            owners.remove("Private")
        ownership = owners[0] if len(owners) == 1 else None
        emonc = next((label for gid, label in EMONC_GROUPS if gid in groups), None)
        settings = [SETTING_GROUPS[g] for g in groups if g in SETTING_GROUPS]
        setting = settings[0] if len(settings) == 1 else None
        return {"Facility Type": facility_type, "Facility Ownership": ownership,
                "EmONC Level": emonc, "Facility Setting": setting}

    def type_conflicts(self):
        out = []
        for u in self.active_facilities:
            groups = {g["id"] for g in u.get("organisationUnitGroups", [])}
            if sum(1 for gid, _ in TYPE_GROUPS if gid in groups) > 1:
                out.append(u["id"])
        return out


# --------------------------------------------------------------------------------------------
# Sections
# --------------------------------------------------------------------------------------------

def preflight(c):
    r = c.rest("GET", "/session")
    if not (r.status == 200 and r.json.get("authenticated")):
        raise SystemExit(f"cannot authenticate as {c.admin[0]} at {c.args.base_url}: {r}")
    h = c.stub("GET", "health")
    if h.status != 200:
        raise SystemExit(f"the MFL stub does not answer at {c.args.stub_url}: {h}")
    c.scenario("normal")
    c.stub("DELETE", "requests")
    for name, type_uuid in ATTR.items():
        r = c.rest("GET", f"/locationattributetype/{type_uuid}")
        R.check(f"attribute type {name} exists with its ADR 0009 UUID", r.status == 200, r)


def configure(c):
    """Point the sync at the stub before anything can reach out, and prove it stuck."""
    stub_url = c.args.stub_internal_url
    r = c.mfl("PUT", "/config", {"url": stub_url, "enabled": False})
    R.check("PUT /config pointing at the stub answers 200 with the full status", r.status == 200
            and (r.json or {}).get("config", {}).get("url") == stub_url, r)
    status = c.status()
    if "moh.gov.lr" in (status["config"].get("url") or ""):
        raise SystemExit("the sync still points at the live MFL; refusing to go on")
    R.check("GET /status reports the stub as the configured URL", status["config"]["url"] == stub_url, status)


def status_contract(c):
    s = c.status()
    R.check("GET /status: available with the stub's credentials", s.get("available") is True, s)
    R.check("GET /status: config.username is the configured account",
            s["config"].get("username") == c.stub_user, s["config"])
    keys = set()

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                keys.add(k)
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(s)
    R.check("GET /status: no password field of any kind, masked or not",
            not [k for k in keys if "pass" in k.lower() or "secret" in k.lower()], sorted(keys))
    R.check("GET /status: has config, schedule, held counts and the run slots",
            all(k in s for k in ("config", "nextRun", "running", "lastRun", "lastSuccessfulRun", "held"))
            and "time" in (s["config"].get("schedule") or {}), s)

    # PUT /config rejects user info, so write the global property directly, as a DB edit would.
    stub_url = c.args.stub_internal_url
    scheme, rest = stub_url.split("://", 1)
    leaky = f"{scheme}://leak-user:leak-s3cret@{rest}"
    r = c.rest("POST", "/systemsetting/liberiaemr.mfl.url", {"value": leaky})
    try:
        R.check("a URL with user info can be written to the global property directly", r.status == 200, r)
        s = c.status()
        dumped = json.dumps(s)
        R.check("GET /status strips user info from a directly edited URL",
                s["config"].get("url") == stub_url and "leak-s3cret" not in dumped and "leak-user" not in dumped,
                s["config"])
    finally:
        c.rest("POST", "/systemsetting/liberiaemr.mfl.url", {"value": stub_url})


def config_validation(c):
    stub_url = c.args.stub_internal_url
    bad = [
        ("a plain http:// URL", {"url": stub_url.replace("https://", "http://")}),
        ("a URL ending in /api", {"url": stub_url.rstrip("/") + "/api"}),
        ("an https URL on a host not in LIBERIAEMR_MFL_ALLOWED_HOSTS",
         {"url": "https://mfl-stub-elsewhere:8443/mfl"}),
        ("the live MFL, which the CI allowlist leaves out", {"url": "https://dhis2.moh.gov.lr/mfl"}),
        ("a look-alike host that only starts with an allowed name",
         {"url": "https://mfl-stub.attacker.example/mfl"}),
        ("userinfo smuggled into the URL", {"url": stub_url.replace("https://", "https://user@")}),
        ("a root with a query", {"url": stub_url + "?x=1"}),
        ("a root with a fragment", {"url": stub_url + "#frag"}),
        ("schedule.time 24:00", {"schedule": {"time": "24:00"}}),
        ("schedule.time without a leading zero", {"schedule": {"time": "2:00"}}),
        ("schedule.time that is not a time", {"schedule": {"time": "soon"}}),
        ("a username", {"username": "someone"}),
        ("a password", {"password": "x"}),
    ]
    for label, body in bad:
        r = c.mfl("PUT", "/config", body)
        R.check(f"PUT /config refuses {label} with 400 and an error body",
                r.status == 400 and isinstance(r.json, dict) and "error" in r.json, r)
    s = c.status()
    R.check("PUT /config: refused requests changed nothing",
            s["config"]["url"] == stub_url and s["config"]["schedule"]["time"] != "24:00", s["config"])

    r = c.mfl("PUT", "/config", {"enabled": True, "schedule": {"time": "03:30"}})
    R.check("PUT /config: a partial update of enabled and schedule answers 200",
            r.status == 200 and r.json["config"]["enabled"] is True
            and r.json["config"]["schedule"]["time"] == "03:30"
            and r.json["config"]["url"] == stub_url, r)
    R.check("GET /status: nextRun is set when enabled", c.status().get("nextRun") is not None)
    r = c.mfl("PUT", "/config", {"enabled": False})
    R.check("PUT /config: disabling answers 200 and clears nextRun",
            r.status == 200 and r.json["config"]["enabled"] is False and r.json.get("nextRun") is None, r)

    # PUT /config refuses a query, so write one straight to the global property, as a DB edit
    # would. The client must still refuse that root (contract: test-connection answers ok false).
    # Test-connection rather than a run, so no FAILED run lands in the history the later
    # sections count.
    r = c.rest("POST", "/systemsetting/liberiaemr.mfl.url", {"value": stub_url + "?x=1"})
    try:
        R.check("a root with a query can be written to the global property directly", r.status == 200, r)
        r = c.mfl("POST", "/test-connection")
        R.check("test-connection with a DB-edited root carrying a query: 200, ok false, with a message",
                r.status == 200 and (r.json or {}).get("ok") is False and (r.json or {}).get("message"), r)
    finally:
        c.rest("POST", "/systemsetting/liberiaemr.mfl.url", {"value": stub_url})
    R.check("the stub URL is restored after the DB-edited root", c.status()["config"]["url"] == stub_url)


def make_user(c, label, roles):
    suffix = secrets.token_hex(3)
    username = f"qa-mfl-{label}-{suffix}"
    password = f"QaMfl#{secrets.token_hex(6)}Zx7"
    r = c.rest("POST", "/user", {
        "username": username, "password": password, "roles": roles,
        "person": {"names": [{"givenName": "QA", "familyName": f"MFL {label}"}], "gender": "U"},
    })
    if r.status not in (200, 201):
        raise RuntimeError(f"could not create user {username}: {r}")
    return username, password


def find_by_display(c, resource, name):
    start = 0
    while True:
        r = c.rest("GET", f"/{resource}?v=default&limit=100&startIndex={start}")
        results = (r.json or {}).get("results", [])
        for x in results:
            if x.get("display") == name or x.get("name") == name:
                return x["uuid"]
        if len(results) < 100:
            return None
        start += 100


def privileges(c):
    view = find_by_display(c, "privilege", "View MFL Sync")
    manage = find_by_display(c, "privilege", "Manage MFL Sync")
    R.check("privileges View MFL Sync and Manage MFL Sync exist", bool(view and manage), view, manage)
    sync_admin = find_by_display(c, "role", "Sync Administrator")
    R.check("role Sync Administrator exists", bool(sync_admin))
    if sync_admin:
        role = c.rest("GET", f"/role/{sync_admin}?v=full").json or {}
        granted = {p.get("display") or p.get("name") for p in role.get("privileges", [])}
        R.check("Sync Administrator holds View MFL Sync and Manage MFL Sync",
                {"View MFL Sync", "Manage MFL Sync"} <= granted, sorted(granted))

    r = c.rest("POST", "/role", {"name": f"QA MFL Viewer {secrets.token_hex(3)}",
                                 "description": "LE-325 test role: View MFL Sync only",
                                 "privileges": [view]})
    viewer_role = r.json["uuid"] if r.status in (200, 201) else None
    R.check("created a view-only test role", bool(viewer_role), r)

    nobody = make_user(c, "noperm", [])
    viewer = make_user(c, "viewer", [viewer_role]) if viewer_role else None
    admin = make_user(c, "syncadmin", [sync_admin]) if sync_admin else None

    unauth = c.http.call("GET", MFL + "/status")
    R.check("GET /status without credentials answers 403", unauth.status == 403, unauth)
    for method, path, body in [("GET", "/status", None), ("GET", "/runs", None),
                               ("PUT", "/config", {"enabled": False}),
                               ("POST", "/runs", {"dryRun": True}), ("POST", "/test-connection", None)]:
        r = c.mfl(method, path, body, auth=nobody)
        R.check(f"{method} {path} as a user with no MFL privilege answers 403", r.status == 403, r)
    if viewer:
        for method, path in [("GET", "/status"), ("GET", "/runs")]:
            r = c.mfl(method, path, auth=viewer)
            R.check(f"{method} {path} with View MFL Sync answers 200", r.status == 200, r)
        for method, path, body in [("PUT", "/config", {"enabled": False}),
                                   ("POST", "/runs", {"dryRun": True}),
                                   ("POST", "/test-connection", None)]:
            r = c.mfl(method, path, body, auth=viewer)
            R.check(f"{method} {path} with View but not Manage MFL Sync answers 403", r.status == 403, r)
    if admin:
        r = c.mfl("GET", "/status", auth=admin)
        R.check("GET /status as a Sync Administrator answers 200", r.status == 200, r)
        r = c.mfl("POST", "/test-connection", auth=admin)
        R.check("POST /test-connection as a Sync Administrator answers 200", r.status == 200, r)


def test_connection(c, exp):
    c.stub("DELETE", "requests")
    r = c.mfl("POST", "/test-connection")
    R.check("POST /test-connection to the stub: 200, ok, DHIS2 2.40.4.1, facility count",
            r.status == 200 and r.json.get("ok") is True and r.json.get("dhis2Version") == "2.40.4.1"
            and r.json.get("facilities") == len(exp.facilities) and r.json.get("message") is None, r)
    reqs = c.stub_requests()
    R.check("test-connection reached the stub with the configured credentials",
            reqs and all(q["authOk"] and q["host"] == "mfl-stub" for q in reqs),
            [(q["host"], q["path"], q["authOk"]) for q in reqs])

    c.scenario("unauthorized")
    r = c.mfl("POST", "/test-connection")
    R.check("test-connection refused by the MFL: still 200, ok false, a message",
            r.status == 200 and r.json.get("ok") is False and r.json.get("message"), r)
    c.scenario("down")
    r = c.mfl("POST", "/test-connection")
    R.check("test-connection with the MFL down: still 200, ok false",
            r.status == 200 and r.json.get("ok") is False, r)

    c.scenario("redirect-cross-host")
    c.stub("DELETE", "requests")
    r = c.mfl("POST", "/test-connection")
    reqs = c.stub_requests()
    elsewhere = [q for q in reqs if q["host"] == "mfl-stub-elsewhere"]
    R.check("test-connection redirected to another host: 200, ok false",
            r.status == 200 and r.json.get("ok") is False, r)
    R.check("a cross-host redirect is never followed: the other host gets no request at all",
            not elsewhere, [(q["host"], q["path"], q["authPresent"]) for q in reqs])
    c.scenario("normal")


def adoption_target(c):
    """The existing row the first sync must adopt for ADOPTED (Careysburg Clinic).

    By default no site package declares an MFL UID: each match waits for MOH/site confirmation
    (ADR 0009 §1, LE-320). So normally a QA row carrying the UID stands in. Once
    content-site-careysburg declares its root's MFL UID, that root is adopted instead, so
    adoption by attribute is tested either way.
    """
    root_uid = attr(c.root_before, "MFL UID")
    if root_uid == ADOPTED:
        R.check("the site root carries its confirmed MFL UID from content", True)
        return c.args.own_root_uuid, c.root_before["name"]
    R.check("the site root carries no other MFL UID than the fixture's Careysburg Clinic",
            root_uid is None, root_uid)
    return c.create_location("QA MFL Adoption Target", ADOPTED, description="LE-325"), "QA MFL Adoption Target"


def first_sync(c, exp):
    # Adoption: an existing row that already carries an MFL UID is updated in place, and keeps
    # the name and parent content gave it (ADR 0009 decisions 1 and 3).
    adopt_uuid, adopt_name = adoption_target(c)
    c.adopt_uuid, c.adopt_name = adopt_uuid, adopt_name
    c.adopt_parent = parent_uuid(c.location(adopt_uuid))
    held_before = c.status()["held"]

    c.stub("DELETE", "requests")
    dry = c.run(dry_run=True, label="dry run")
    R.check("dry run: SUCCEEDED and flagged dryRun", dry["status"] == "SUCCEEDED" and dry["dryRun"] is True, dry)
    # The closed facility is created too, already retired (ADR 0009 §3/§5).
    n_managed = len(exp.counties) + len(exp.districts) + len(exp.facilities)
    R.check("dry run: would create every county, district and facility (the closed one included) "
            "but the adopted one", dry["counts"]["created"] == n_managed - 1, dry["counts"],
            f"expected {n_managed - 1}")
    dry_items = c.items(dry["id"])
    adopt = find_items(dry_items, ADOPTED)
    R.check("dry run: the adopted facility is an UPDATE of the existing row, not a CREATE",
            len(adopt) == 1 and adopt[0]["action"] == "UPDATE" and adopt[0]["locationUuid"] == adopt_uuid, adopt)
    R.check("dry run: wrote no location", c.status()["held"] == held_before
            and c.location(v5("nY6mPgT0Kc6")) is None
            and c.location(adopt_uuid)["name"] == adopt_name, c.status()["held"], held_before)
    reqs = c.stub_requests()
    R.check("dry run: fetched from the MFL with the configured credentials",
            any("organisationUnits" in q["path"] for q in reqs) and all(q["authOk"] for q in reqs))

    run = c.run(label="first sync")
    c.first_run = run
    R.check("first sync: SUCCEEDED, manual, started by the caller",
            run["status"] == "SUCCEEDED" and run["dryRun"] is False and run["trigger"] == "MANUAL"
            and run["startedBy"] == c.admin[0] and run["finished"] >= run["started"], run)
    R.check("first sync: created what the dry run said it would",
            run["counts"]["created"] == dry["counts"]["created"], run["counts"], dry["counts"])
    items = c.items(run["id"])
    check_first_sync_rows(c, exp, adopt_uuid)
    check_warnings(c, exp, run, items)
    adopted_fields = {ch["field"] for i in find_items(items, ADOPTED) for ch in i.get("changes") or []}
    R.check("first sync: the adopted row's item reports no name or parent change",
            not adopted_fields & {"name", "parent"}, sorted(adopted_fields))

    s = c.status()
    R.check("GET /status after the first sync: held counts match the fixture",
            s["held"]["counties"] == len(exp.counties) and s["held"]["districts"] == len(exp.districts)
            and s["held"]["facilities"] == len(exp.active_facilities)
            and s["held"]["retired"] in (0, 1), s["held"])
    R.check("GET /status after the first sync: lastRun and lastSuccessfulRun are this run",
            s["lastRun"]["id"] == run["id"] and s["lastSuccessfulRun"]["id"] == run["id"] and s["running"] is None, s)


def check_first_sync_rows(c, exp, adopt_uuid):
    rows = {}
    for u in exp.counties + exp.districts + exp.facilities:
        if u["id"] == ADOPTED:
            rows[u["id"]] = c.location(adopt_uuid)
        else:
            rows[u["id"]] = c.location(v5(u["id"]))
    missing = [uid for uid, loc in rows.items() if loc is None]
    R.check("every created row sits at UUIDv5(namespace, MFL UID)", not missing, missing)
    R.check("the adopted row kept its UUID; no second row was created for it",
            rows[ADOPTED] is not None and c.location(v5(ADOPTED)) is None)
    R.check("no Country location and no level-3 unit without facilities (CHT - Bong)",
            c.location(v5(COUNTRY)) is None and c.location(v5(NOT_A_DISTRICT)) is None)

    # Content owns an adopted row's name and parent; the sync owns them on the rows it creates.
    want_names = exp.expected_names(adopted={ADOPTED: c.adopt_name})
    wrong_names, wrong_parents, wrong_tags, wrong_attrs, wrong_address = [], [], [], [], []
    for u in exp.counties + exp.districts + exp.facilities:
        loc = rows.get(u["id"])
        if loc is None:
            continue
        if attr(loc, "MFL UID") != u["id"]:
            wrong_attrs.append((u["id"], "MFL UID", attr(loc, "MFL UID")))
        if loc["name"] != want_names[u["id"]]:
            wrong_names.append((u["id"], loc["name"], want_names[u["id"]]))
        if u["id"] == ADOPTED:
            want_parent = c.adopt_parent
        else:
            want_parent = None if u["level"] == 2 else v5(u["parent"]["id"])
        if parent_uuid(loc) != want_parent:
            wrong_parents.append((u["id"], parent_uuid(loc), want_parent))
        want_tag = {2: "County", 3: "District", 4: "Health Facility"}[u["level"]]
        added_login = "Login Location" in tags(loc) and u["id"] != ADOPTED
        if want_tag not in tags(loc) or added_login:
            wrong_tags.append((u["id"], sorted(tags(loc))))
        if u["level"] == 4:
            code = (u.get("code") or "").strip() or None
            if attr(loc, "MFL Code") != code:
                wrong_attrs.append((u["id"], "MFL Code", attr(loc, "MFL Code"), code))
            for name, want in exp.attributes(u).items():
                if attr(loc, name) != want:
                    wrong_attrs.append((u["id"], name, attr(loc, name), want))
            if not attr(loc, "MFL Last Updated"):
                wrong_attrs.append((u["id"], "MFL Last Updated", None))
            district = exp.units[u["parent"]["id"]]
            county = exp.units[district["parent"]["id"]]
            if (loc.get("stateProvince"), loc.get("countyDistrict"), loc.get("country")) != (
                    county["name"].strip(), " ".join(district["name"].split()), "Liberia"):
                wrong_address.append((u["id"], loc.get("stateProvince"), loc.get("countyDistrict"),
                                      loc.get("country")))
    R.check("names: whitespace collapsed, clashing active names suffixed with the district; "
            "the adopted row keeps its local name", not wrong_names, *wrong_names)
    R.check("parents: counties top-level, districts under counties, facilities under districts; "
            "the adopted row keeps its parent", not wrong_parents, *wrong_parents)
    R.check("tags: County / District / Health Facility; the sync never adds Login Location",
            not wrong_tags, *wrong_tags)
    R.check("attributes: MFL UID, trimmed MFL Code, type/ownership/EmONC/setting by the ADR "
            "tie-breaks, MFL Last Updated", not wrong_attrs, *wrong_attrs)
    R.check("address: stateProvince = county, countyDistrict = district, country = Liberia",
            not wrong_address, *wrong_address)

    jah = rows["nY6mPgT0Kc6"]
    R.check("coordinates: [lon, lat] stored as latitude/longitude",
            jah and abs(float(jah["latitude"]) - 6.814444) < 1e-6
            and abs(float(jah["longitude"]) + 9.186944) < 1e-6, jah and (jah["latitude"], jah["longitude"]))
    no_geo = rows["bP0PeqBGKgB"]
    R.check("coordinates: a facility without geometry has none",
            no_geo and not no_geo.get("latitude") and not no_geo.get("longitude"))
    R.check("the fixture's national duplicate names are both suffixed",
            len(exp.clashing) == 2 and all("(" in rows[i]["name"] for i in exp.clashing), exp.clashing)

    # ADR 0009 §3/§5: the closed facility is created, at its UUIDv5, already retired.
    closed = rows.get(CLOSED) or {}
    R.check("the closed facility exists at UUIDv5(namespace, MFL UID)", bool(closed), v5(CLOSED))
    R.check("the closed facility shares its name with an active one, so it is suffixed: "
            "'Jamaica Rd Clinic (Bushrod District)'",
            closed.get("name") == "Jamaica Rd Clinic (Bushrod District)"
            and want_names[CLOSED] == closed.get("name"), closed.get("name"), want_names[CLOSED])
    R.check("the closed facility is retired with reason 'MFL: closed 2026-04-01' and MFL Closed Date",
            closed.get("retired") is True and retire_reason(closed).startswith("MFL: closed 2026-04-01")
            and str(attr(closed, "MFL Closed Date") or "").startswith("2026-04-01"),
            closed.get("retired"), closed and retire_reason(closed), closed and attr(closed, "MFL Closed Date"))


def check_warnings(c, exp, run, items):
    conflicts = exp.type_conflicts()
    warned = {i["mflUid"] for i in items if any("Facility Type" in w for w in i.get("warnings") or [])}
    R.check("run items warn about every facility in two type groups",
            set(conflicts) <= warned, conflicts, sorted(warned))
    R.check("counts.warnings is the number of items with at least one warning",
            run["counts"]["warnings"] == sum(1 for i in items if i.get("warnings")),
            run["counts"], sum(1 for i in items if i.get("warnings")))
    bad = [i for i in items if i["action"] not in ("CREATE", "UPDATE", "RETIRE", "UNRETIRE", "WARNING", "ERROR")
           or i["level"] not in ("COUNTY", "DISTRICT", "FACILITY")]
    R.check("every item has a contract action and level", not bad, *bad[:3])
    creates = [i for i in items if i["action"] == "CREATE"]
    R.check("CREATE items have changes whose 'from' is null",
            creates and all(ch.get("from") is None for i in creates for ch in i.get("changes") or []),
            creates[:1])


def run_listing(c):
    run = c.first_run
    r = c.mfl("GET", "/runs")
    R.check("GET /runs: newest first, with totalCount",
            r.status == 200 and r.json["results"][0]["id"] == run["id"]
            and r.json["totalCount"] >= 2 and len(r.json["results"]) <= 20, r)
    r = c.mfl("GET", "/runs?startIndex=0&limit=1")
    R.check("GET /runs?limit=1 returns one run", r.status == 200 and len(r.json["results"]) == 1, r)
    r = c.mfl("GET", "/runs?limit=1000")
    R.check("GET /runs caps limit at 100", r.status == 200 and len(r.json["results"]) <= 100, r)
    r = c.mfl("GET", f"/runs/{run['id']}")
    R.check("GET /runs/{id} returns the run", r.status == 200 and r.json["id"] == run["id"], r)
    r = c.mfl("GET", f"/runs/{run['id']}/items?action=CREATE&limit=5")
    R.check("GET /runs/{id}/items?action=CREATE filters and pages",
            r.status == 200 and 0 < len(r.json["results"]) <= 5
            and all(i["action"] == "CREATE" for i in r.json["results"])
            and r.json["totalCount"] >= len(r.json["results"]), r)
    for path in ("/runs/987654321", "/runs/987654321/items"):
        r = c.mfl("GET", path)
        R.check(f"GET {path} for a run that does not exist answers 404 with an error body",
                r.status == 404 and "error" in (r.json or {}), r)


def second_run_is_noop(c):
    run = c.run(label="second sync")
    counts = run["counts"]
    R.check("second sync with nothing changed: SUCCEEDED, nothing created, updated, retired or unretired",
            run["status"] == "SUCCEEDED" and counts["created"] == counts["updated"] == counts["retired"]
            == counts["unretired"] == counts["failed"] == 0 and counts["unchanged"] > 0, counts)
    items = c.items(run["id"])
    R.check("second sync: only WARNING items are recorded",
            all(i["action"] == "WARNING" for i in items), [i["action"] for i in items][:10])


def overlapping_runs(c):
    c.scenario("normal", delay_ms=1500)
    try:
        first = c.start_run()
        R.check("slow run: POST /runs answers 202", first.status == 202, first)
        second = c.start_run()
        R.check("a second POST /runs while one runs answers 409 naming the running run",
                second.status == 409 and second.json.get("runId") == first.json.get("id")
                and second.json.get("error"), second)
        s = c.status()
        R.check("GET /status shows the run in progress", (s.get("running") or {}).get("id") == first.json.get("id"), s)
        c.wait_run(first.json["id"])
    finally:
        c.scenario("normal")


def local_fields_and_updates(c):
    kesselee = v5(RENAMED[0])
    visit_tag = find_by_display(c, "locationtag", "Visit Location")
    loc = c.location(kesselee)
    tag_uuids = [t["uuid"] for t in loc["tags"]] + [visit_tag]
    r = c.rest("POST", f"/location/{kesselee}", {"description": "QA local description",
                                                  "address1": "QA local address", "tags": tag_uuids})
    R.check("set local fields on an MFL row (description, address1, Visit Location tag)", r.status == 200, r)

    c.scenario("rename-reparent")
    run = c.run(label="rename and reparent")
    items = c.items(run["id"])
    R.check("rename/reparent: SUCCEEDED with three updates (two created rows, the adopted one's address)",
            run["status"] == "SUCCEEDED" and run["counts"]["updated"] == 3, run["counts"])
    renamed = c.location(kesselee)
    R.check("rename: same UUID, new name", renamed["name"] == RENAMED[1], renamed["name"])
    R.check("rename: local description, address1 and extra tag untouched",
            renamed.get("description") == "QA local description" and renamed.get("address1") == "QA local address"
            and "Visit Location" in tags(renamed), renamed.get("description"), renamed.get("address1"), tags(renamed))
    moved = c.location(v5(REPARENTED[0]))
    R.check("reparent: same UUID, new parent district and countyDistrict",
            parent_uuid(moved) == v5(REPARENTED[1]) and moved.get("countyDistrict") == "Somalia Drive District",
            parent_uuid(moved), moved.get("countyDistrict"))
    ch = {(i["mflUid"], c2["field"]) for i in find_items(items, RENAMED[0], "UPDATE") + find_items(items, REPARENTED[0], "UPDATE")
          for c2 in i.get("changes") or []}
    R.check("rename/reparent items name the changed fields",
            (RENAMED[0], "name") in ch and (REPARENTED[0], "parent") in ch, sorted(ch))
    adopted = c.location(c.adopt_uuid)
    R.check("an MFL rename and move never rename or reparent the adopted row",
            adopted["name"] == c.adopt_name and parent_uuid(adopted) == c.adopt_parent,
            adopted["name"], parent_uuid(adopted))
    R.check("the adopted row's address still follows the MFL",
            adopted.get("countyDistrict") == "Somalia Drive District", adopted.get("countyDistrict"))
    adopted_fields = {c2["field"] for i in find_items(items, ADOPTED) for c2 in i.get("changes") or []}
    R.check("the adopted row's item reports no name or parent change",
            not adopted_fields & {"name", "parent"} and "countyDistrict" in adopted_fields, sorted(adopted_fields))

    c.scenario("normal")
    run = c.run(label="rename back")
    R.check("back to the recorded MFL: the rename and move are reverted",
            c.location(kesselee)["name"] == "Kesselee Memorial Health Center"
            and parent_uuid(c.location(v5(REPARENTED[0]))) == v5("Aoq6H9sPvlW")
            and c.location(c.adopt_uuid).get("countyDistrict") == "Careysburg District", run["counts"])


def retire_and_unretire(c):
    c.scenario("remove-one")
    run = c.run(label="one facility gone")
    removed = c.location(v5(REMOVED))
    R.check("a facility absent from a complete pull is retired",
            run["status"] == "SUCCEEDED" and run["counts"]["retired"] == 1 and removed["retired"], run["counts"])
    R.check("its retire reason starts 'MFL: not in the MFL since'",
            retire_reason(removed).startswith("MFL: not in the MFL since"), retire_reason(removed))
    R.check("a RETIRE item records it", find_items(c.items(run["id"]), REMOVED, "RETIRE"))

    c.scenario("normal")
    run = c.run(label="facility back")
    R.check("the facility returns: un-retired", run["counts"]["unretired"] == 1
            and not c.location(v5(REMOVED))["retired"], run["counts"])

    degei = v5(HUMAN_RETIRED)
    r = c.rest("DELETE", f"/location/{degei}?reason=QA+manual+retire")
    R.check("retire a facility by hand", r.status in (200, 204), r)
    c.run(label="after a human retirement")
    loc = c.location(degei)
    R.check("the sync never reverses a human's retirement",
            loc["retired"] and retire_reason(loc) == "QA manual retire", loc.get("retired"), retire_reason(loc))


def completeness_guard(c):
    before = c.status()["held"]
    for scenario, label in [("shrink", "a pull under 90% of held locations"),
                            ("failed-page", "a pull with a failed page")]:
        c.scenario(scenario)
        c.stub("DELETE", "requests")
        run = c.run(label=label)
        R.check(f"{label}: PARTIAL, nothing retired, a message says why",
                run["status"] == "PARTIAL" and run["counts"]["retired"] == 0 and run.get("message"), run)
        R.check(f"{label}: held facilities unchanged", c.status()["held"]["facilities"] == before["facilities"],
                c.status()["held"], before)
        if scenario == "failed-page":
            R.check("the failed-page scenario really served a 500",
                    any(q["status"] == 500 for q in c.stub_requests()))
    c.scenario("normal")


def failures(c):
    for scenario, label in [("down", "the MFL unreachable"), ("unauthorized", "the MFL refusing the account"),
                            ("redirect-cross-host", "the MFL redirecting to another host")]:
        c.scenario(scenario)
        c.stub("DELETE", "requests")
        run = c.run(label=label)
        R.check(f"{label}: the run is FAILED with a message", run["status"] == "FAILED" and run.get("message"), run)
        if scenario == "redirect-cross-host":
            elsewhere = [q for q in c.stub_requests() if q["host"] == "mfl-stub-elsewhere"]
            R.check("a run never follows a cross-host redirect: the other host gets no request at all",
                    not elsewhere, [(q["path"], q["authPresent"]) for q in elsewhere])
    c.scenario("normal")
    s = c.status()
    R.check("a failed run is lastRun but not lastSuccessfulRun",
            s["lastRun"]["status"] == "FAILED" and s["lastSuccessfulRun"]["status"] in ("SUCCEEDED", "PARTIAL"), s)


def duplicate_mfl_uid(c):
    dup = c.create_location("QA MFL Duplicate Barnersville", DUPLICATE_TARGET, description="LE-325")
    run = c.run(label="two rows with one MFL UID")
    errors = find_items(c.items(run["id"]), DUPLICATE_TARGET, "ERROR")
    R.check("two rows holding one MFL UID: an ERROR item, and the run is PARTIAL",
            errors and errors[0].get("error") and run["status"] == "PARTIAL" and run["counts"]["failed"] >= 1,
            run["counts"], errors)
    R.check("neither row was retired or re-keyed",
            not c.location(dup)["retired"] and not c.location(v5(DUPLICATE_TARGET))["retired"])
    attr_id = attr_uuid(c.location(dup), "MFL UID")
    c.rest("DELETE", f"/location/{dup}/attribute/{attr_id}")
    run = c.run(label="duplicate removed")
    R.check("with the duplicate's MFL UID voided, the run is clean again",
            run["status"] == "SUCCEEDED" and run["counts"]["failed"] == 0, run["counts"])


ROOT_FIELDS = ("name", "description", "stateProvince", "countyDistrict", "country", "cityVillage",
               "address1", "latitude", "longitude")


def snapshot_root(c):
    """Before any sync: what the site root looks like as its content package seeded it."""
    loc = c.location(c.args.own_root_uuid)
    if loc is None:
        raise SystemExit(f"no facility root {c.args.own_root_uuid}; pass --own-root-uuid")
    c.root_before = loc


def own_root(c):
    root = c.args.own_root_uuid
    uid = attr(c.location(root), "MFL UID")
    if uid is None:
        # The normal case: content declares no MFL UID until MOH confirms the match (ADR 0009
        # §1). Give the root one that exists only in the with-extra scenario, adopt it there,
        # then let the unit disappear.
        r = c.rest("POST", f"/location/{root}/attribute", {"attributeType": ATTR["MFL UID"], "value": EXTRA[0]})
        R.check("give the facility root an MFL UID", r.status in (200, 201), r)
        c.scenario("with-extra")
        run = c.run(label="root adopted")
        R.check("the root is adopted in place: same UUID, its local name and parent kept",
                c.location(root)["name"] == c.root_before["name"]
                and parent_uuid(c.location(root)) == parent_uuid(c.root_before)
                and c.location(v5(EXTRA[0])) is None, run["counts"])
        uid, gone = EXTRA[0], "normal"
    elif uid == ADOPTED:
        gone = "remove-site-root"
    else:
        raise RuntimeError(f"the root carries MFL UID {uid}, which the stub has no scenario to remove")
    try:
        c.scenario(gone)
        run = c.run(label="root missing from the MFL")
        after = c.location(root)
        errors = find_items(c.items(run["id"]), uid, "ERROR")
        R.check("the instance's own root is never retired automatically", not after["retired"], after.get("retired"))
        R.check("its absence is an ERROR item that says so, and the run is PARTIAL",
                errors and "root" in (errors[0].get("error") or "").lower() and run["status"] == "PARTIAL",
                run["status"], errors)
    finally:
        restore_root(c)


def restore_root(c):
    """Put the root back as content seeded it, so the specs after these tests see the site as
    they expect: drop every attribute added since, and restore the fields the sync owns (and
    the parent, in case an older build moved it). An MFL UID the content declared stays."""
    c.scenario("normal")
    root = c.args.own_root_uuid
    before = c.root_before
    kept = {a["uuid"] for a in before.get("attributes") or []}
    loc = c.location(root) or {}
    for a in loc.get("attributes") or []:
        if a["uuid"] not in kept and not a.get("voided"):
            c.rest("DELETE", f"/location/{root}/attribute/{a['uuid']}")
    body = {k: before.get(k) for k in ROOT_FIELDS}
    body["parentLocation"] = parent_uuid(before)
    r = c.rest("POST", f"/location/{root}", body)
    restored = c.location(root) or {}
    R.check("the facility root is restored after the test",
            r.status == 200 and all(restored.get(k) == before.get(k) for k in ROOT_FIELDS)
            and parent_uuid(restored) == parent_uuid(before), r,
            {k: (restored.get(k), before.get(k)) for k in ROOT_FIELDS if restored.get(k) != before.get(k)})


def scheduler_task(c):
    r = c.rest("GET", "/taskdefinition?v=full")
    names = [t.get("name") for t in (r.json or {}).get("results", [])]
    R.check("the scheduler holds one task named 'LiberiaEMR MFL Sync'",
            names.count("LiberiaEMR MFL Sync") == 1, names)


def no_leaks(c):
    secret = c.stub_password
    token = base64.b64encode(f"{c.stub_user}:{secret}".encode()).decode()
    hits = [label for label, resp in c.http.seen
            if secret in resp.text or token in resp.text
            or any(secret in str(v) or token in str(v) for v in resp.headers.values())]
    R.check(f"no response of {len(c.http.seen)} contains the MFL password or its basic-auth token",
            not hits, *hits[:5])
    stub_log = json.dumps(c.stub_requests())
    R.check("the stub's request log holds no credential (sanity check of the stub itself)",
            secret not in stub_log and token not in stub_log)
    if c.args.backend_logs_cmd:
        out = subprocess.run(c.args.backend_logs_cmd, shell=True, capture_output=True, text=True, timeout=120)
        R.check("the backend logs hold neither the MFL password nor its basic-auth token",
                out.returncode == 0 and secret not in out.stdout + out.stderr
                and token not in out.stdout + out.stderr, f"exit {out.returncode}")
    else:
        R.check("backend logs were checked for the password (pass --backend-logs-cmd)", False,
                "no --backend-logs-cmd given; this check cannot be skipped")


def unavailable(c):
    s = c.mfl("GET", "/status")
    R.check("without credentials, GET /status still answers 200 with available false and no username",
            s.status == 200 and s.json.get("available") is False and s.json["config"].get("username") is None, s)
    for method, path, body in [("POST", "/runs", {"dryRun": True}), ("POST", "/test-connection", None)]:
        r = c.mfl(method, path, body)
        R.check(f"without credentials, {method} {path} answers 503 with the contract message",
                r.status == 503 and (r.json or {}).get("error") == "MFL credentials are not configured on this instance", r)
    r = c.mfl("GET", "/runs")
    R.check("without credentials, GET /runs still answers 200", r.status == 200 and "results" in r.json, r)
    r = c.mfl("PUT", "/config", {"schedule": {"time": "02:00"}})
    R.check("without credentials, PUT /config still stages settings (200)", r.status == 200, r)


def main():
    ap = argparse.ArgumentParser(description="MFL sync API contract tests (LE-325)")
    ap.add_argument("--base-url", default="https://localhost")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="Admin123")
    ap.add_argument("--material-dir", help="gen-material.sh output; required unless --unavailable")
    ap.add_argument("--stub-url", default="https://localhost:18443")
    ap.add_argument("--stub-internal-url", default="https://mfl-stub:8443/mfl",
                    help="the MFL URL as the backend reaches the stub")
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--own-root-uuid", help="this instance's facility root; defaults to Careysburg's")
    ap.add_argument("--backend-logs-cmd", help="a shell command that prints the backend's logs")
    ap.add_argument("--allow-host", action="append", default=[])
    ap.add_argument("--unavailable", action="store_true")
    args = ap.parse_args()

    host = urllib.parse.urlsplit(args.base_url).hostname
    if host not in {"localhost", "127.0.0.1", "::1", *args.allow_host}:
        raise SystemExit(f"refusing {host}: these tests create users and locations; pass --allow-host")
    c = Ctx(args)
    if args.unavailable:
        R.section("unavailable without credentials", unavailable, c)
        return R.summary()
    if not args.material_dir:
        raise SystemExit("--material-dir is required")
    if not args.own_root_uuid:
        for line in CAREYSBURG_VARS.read_text().splitlines():
            if line.startswith("var.location.facility-root.uuid="):
                args.own_root_uuid = line.split("=", 1)[1].strip()
    exp = Expected()

    preflight(c)
    snapshot_root(c)
    R.section("point the sync at the stub", configure, c)
    R.section("GET /status", status_contract, c)
    R.section("PUT /config validation and the host allowlist", config_validation, c)
    R.section("privileges", privileges, c)
    R.section("POST /test-connection", test_connection, c, exp)
    R.section("dry run, then the first sync", first_sync, c, exp)
    R.section("listing runs and items", run_listing, c)
    R.section("a second sync changes nothing", second_run_is_noop, c)
    R.section("runs never overlap", overlapping_runs, c)
    R.section("renames, moves, and fields the MFL does not own", local_fields_and_updates, c)
    R.section("retire on absence, un-retire on return", retire_and_unretire, c)
    R.section("the completeness guard", completeness_guard, c)
    R.section("failed runs", failures, c)
    R.section("two rows with one MFL UID", duplicate_mfl_uid, c)
    R.section("this instance's own root", own_root, c)
    R.section("the scheduled task", scheduler_task, c)
    R.section("the password never leaves the backend", no_leaks, c)
    return R.summary()


if __name__ == "__main__":
    sys.exit(main())
