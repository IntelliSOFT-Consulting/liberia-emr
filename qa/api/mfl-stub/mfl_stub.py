#!/usr/bin/env python3
"""A stand-in for the MOH Master Facility List (DHIS2 2.40) that the MFL sync tests run against.

It serves the LE-318 fixture (integration/dhis2/mfl/fixtures) over HTTPS with basic auth, and
answers the queries the sync makes the way DHIS2 2.40 does: `filter=`, `fields=` (with nested
selectors), paging with a `pager`, and `paging=false`. CI never calls the real MFL; the backend
under test is pointed here instead (qa/api/mfl-stub/docker-compose.mfl-stub.yml).

Scenarios change what the MFL "holds" without restarting the stub. They are switched through
an unauthenticated control API under /__stub/, which exists only in this stub:

  POST /__stub/scenario   {"name": "<scenario>", "delayMs": 0}
  GET  /__stub/scenario
  GET  /__stub/requests   the requests the stub has served (no credentials are recorded)
  DELETE /__stub/requests
  GET  /__stub/health

Scenarios (see SCENARIOS below): normal, remove-one, remove-site-root, shrink, failed-page,
rename-reparent, with-extra, redirect-cross-host, unauthorized, down.

Standard library only, so it runs in a bare python:3-alpine container.
"""
import argparse
import base64
import copy
import hmac
import json
import re
import ssl
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

DHIS2_VERSION = "2.40.4.1"
DHIS2_REVISION = "a1aa81b"

# The facility the remove-one scenario drops. Its absence is 1 of 22 active locations (95%),
# which is above the completeness guard, so the sync must retire it.
REMOVED_FACILITY = "bP0PeqBGKgB"  # Come & See Clinic, Careysburg District
# rename-reparent: a rename, and a facility moved between districts in place (same UID). The
# real MFL records a move as close + new (ADR 0009 §5), but a reparent must still apply.
RENAMED_FACILITY = ("VxgfT09KRV4", "Kesselee Memorial Health Centre")
REPARENTED_FACILITY = ("LDoJbUPbnU4", "E57DkQD0HC4")  # City Lab Clinic: Bushrod -> Somalia Drive
# The adopted site root's unit is renamed and moved too: content owns an adopted row's name and
# parent (ADR 0009 decisions 1 and 3), so neither may change, while its address follows the MFL.
ADOPTED_FACILITY = ("jbGSiLCEFKJ", "Careysburg Community Clinic", "E57DkQD0HC4")
# with-extra: one facility that exists only in this scenario. The own-root test gives this
# instance's facility root this MFL UID, so the unit's later absence tests that the sync never
# retires the instance's own root.
EXTRA_FACILITY = {
    "id": "QaStubRoot1",
    "code": "LBR-30-3002-99",
    "name": "QA Stub Root Facility",
    "shortName": "QA Stub Root Facility",
    "level": 4,
    "parent": {"id": "rQkEaYe4NCq"},
    "path": "/LHNiyIWuLdc/pqX9sGzFbDV/rQkEaYe4NCq/QaStubRoot1",
    "openingDate": "2000-01-01T00:00:00.000",
    "created": "2026-09-27T00:00:00.000",
    "lastUpdated": "2026-09-27T00:00:00.000",
    "geometry": {"type": "Point", "coordinates": [-10.53, 6.47]},
    "organisationUnitGroups": [{"id": "cLPxlR1Brv9"}, {"id": "xSUk0MvIAUh"}],
}
# remove-site-root drops Careysburg's candidate match, for when the Careysburg site package
# declares it as its root's MFL UID once MOH confirms it (ADR 0009 §1; none does by default).
# The sync must never retire an instance's own root.
SITE_ROOT_FACILITY = "jbGSiLCEFKJ"  # Careysburg Clinic
# shrink keeps this many facilities: 2 counties + 5 districts + 4 facilities is 11 of the 22
# active locations a first sync holds, far under 90%.
SHRINK_KEEP = 4
# failed-page serves organisation units in pages of this size and fails page 2.
FAILED_PAGE_SIZE = 4

SCENARIOS = {
    "normal": "the fixture as recorded",
    "remove-one": f"the fixture without {REMOVED_FACILITY}: retire on absence",
    "shrink": f"only {SHRINK_KEEP} facilities: the completeness guard must skip retirement",
    "failed-page": f"pages of {FAILED_PAGE_SIZE}, page 2 answers 500: the guard must skip retirement",
    "rename-reparent": "one facility renamed, one moved to another district, the adopted one both",
    "with-extra": f"the fixture plus {EXTRA_FACILITY['id']}",
    "remove-site-root": f"the fixture without {SITE_ROOT_FACILITY}, Careysburg's site root",
    "redirect-cross-host": "every API call answers 302 to the same path on another host name "
                           "(--redirect-host); the backend must not follow it with credentials",
    "unauthorized": "every API call answers 401, even with the right credentials",
    "down": "every API call answers 503",
}

POLYGON = {"type": "MultiPolygon", "coordinates": []}


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.scenario = "normal"
        self.delay_ms = 0
        self.requests = []


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000")


def load_fixture(directory):
    with open(f"{directory}/organisationUnits.json", encoding="utf-8") as f:
        units = json.load(f)["organisationUnits"]
    with open(f"{directory}/organisationUnitGroups.json", encoding="utf-8") as f:
        groups = json.load(f)["organisationUnitGroups"]
    with open(f"{directory}/organisationUnitGroupSets.json", encoding="utf-8") as f:
        group_sets = json.load(f)["organisationUnitGroupSets"]
    # The fixture replaces county and district polygons with a placeholder string. DHIS2
    # returns a GeoJSON object there, so serve an (empty) one.
    for unit in units:
        if "geometry" in unit and not isinstance(unit["geometry"], dict):
            unit["geometry"] = copy.deepcopy(POLYGON)
    return units, groups, group_sets


def scenario_units(base_units, scenario):
    units = copy.deepcopy(base_units)
    if scenario == "remove-one":
        units = [u for u in units if u["id"] != REMOVED_FACILITY]
    elif scenario == "remove-site-root":
        units = [u for u in units if u["id"] != SITE_ROOT_FACILITY]
    elif scenario == "shrink":
        kept = sorted(u["id"] for u in units if u["level"] == 4)[:SHRINK_KEEP]
        units = [u for u in units if u["level"] < 4 or u["id"] in kept]
    elif scenario == "rename-reparent":
        stamp = now_iso()
        for u in units:
            if u["id"] == RENAMED_FACILITY[0]:
                u["name"] = u["shortName"] = RENAMED_FACILITY[1]
                u["lastUpdated"] = stamp
            if u["id"] == REPARENTED_FACILITY[0]:
                new_parent = next(p for p in units if p["id"] == REPARENTED_FACILITY[1])
                u["parent"] = {"id": new_parent["id"]}
                u["path"] = f"{new_parent['path']}/{u['id']}"
                u["lastUpdated"] = stamp
            if u["id"] == ADOPTED_FACILITY[0]:
                new_parent = next(p for p in units if p["id"] == ADOPTED_FACILITY[2])
                u["name"] = u["shortName"] = ADOPTED_FACILITY[1]
                u["parent"] = {"id": new_parent["id"]}
                u["path"] = f"{new_parent['path']}/{u['id']}"
                u["lastUpdated"] = stamp
    elif scenario == "with-extra":
        units.append(copy.deepcopy(EXTRA_FACILITY))
    return units


# ---------------------------------------------------------------------------------------------
# DHIS2 field selectors: "id,name,parent[id,name],organisationUnitGroups[id]", ":all", "*"
# ---------------------------------------------------------------------------------------------

def parse_fields(spec):
    """Parse a DHIS2 field selector into {field: sub-selector or None}. None means 'all'."""
    fields, i, depth, start = {}, 0, 0, 0
    spec = spec.strip()
    if not spec:
        return {}
    tokens = []
    for i, ch in enumerate(spec):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        elif ch == "," and depth == 0:
            tokens.append(spec[start:i])
            start = i + 1
    tokens.append(spec[start:])
    for token in tokens:
        token = token.strip()
        if not token:
            continue
        m = re.fullmatch(r"([^\[\]]+)\[(.*)\]", token)
        if m:
            fields[m.group(1).strip()] = parse_fields(m.group(2))
        else:
            fields[token] = None
    return fields


ALL_MARKERS = {":all", "*", ":owner", ":identifiable", ":nameable", ":simple", ":persisted"}


class Catalogue:
    """The objects of one scenario, indexed so nested selectors can resolve references."""

    def __init__(self, units, groups, group_sets):
        self.units = units
        self.unit_by_id = {u["id"]: u for u in units}
        self.groups = copy.deepcopy(groups)
        self.group_by_id = {g["id"]: g for g in self.groups}
        self.group_sets = copy.deepcopy(group_sets)
        self.group_set_by_id = {s["id"]: s for s in self.group_sets}
        # Membership lives on the group in DHIS2; derive it from this scenario's units so that
        # asking a group for its organisationUnits agrees with asking a unit for its groups.
        members = {g["id"]: [] for g in self.groups}
        children = {u["id"]: [] for u in units}
        for u in units:
            for ref in u.get("organisationUnitGroups", []):
                members.setdefault(ref["id"], []).append({"id": u["id"]})
            parent = (u.get("parent") or {}).get("id")
            if parent in children:
                children[parent].append({"id": u["id"]})
        for g in self.groups:
            g["organisationUnits"] = members.get(g["id"], [])
        for u in units:
            u["children"] = children[u["id"]]
            u["displayName"] = u["name"]
            u.setdefault("attributeValues", [])
        for g in self.groups:
            g["displayName"] = g["name"]
        for s in self.group_sets:
            s["displayName"] = s["name"]

    def resolve(self, field, ref):
        """The full object a reference points at, when the stub knows it."""
        if not isinstance(ref, dict) or "id" not in ref:
            return ref
        if field in ("parent", "children", "organisationUnits", "ancestors"):
            return self.unit_by_id.get(ref["id"], ref)
        if field == "organisationUnitGroups":
            return self.group_by_id.get(ref["id"], ref)
        if field == "groupSets":
            return self.group_set_by_id.get(ref["id"], ref)
        return ref

    def select(self, obj, fields):
        if fields is None or any(k in ALL_MARKERS for k in fields):
            base = {k: v for k, v in obj.items()}
            extra = {k: v for k, v in (fields or {}).items() if k not in ALL_MARKERS}
            if not extra:
                return base
            for k, sub in extra.items():
                if k in obj:
                    base[k] = self.select_value(k, obj[k], sub)
            return base
        out = {}
        for k, sub in fields.items():
            if k == "ancestors" and "path" in obj:
                ids = [p for p in obj["path"].split("/") if p][:-1]
                out[k] = [self.select(self.unit_by_id.get(i, {"id": i}), sub or {"id": None})
                          for i in ids]
                continue
            if k not in obj:
                continue
            out[k] = self.select_value(k, obj[k], sub)
        return out

    def select_value(self, field, value, sub):
        if sub is None:
            return value
        if isinstance(value, list):
            return [self.select(self.resolve(field, v), sub) for v in value]
        if isinstance(value, dict):
            return self.select(self.resolve(field, value), sub)
        return value


# ---------------------------------------------------------------------------------------------
# DHIS2 filters: "level:eq:4", "level:le:3", "id:in:[a,b]", "closedDate:!null", ...
# ---------------------------------------------------------------------------------------------

class UnsupportedFilter(Exception):
    pass


ORDERED_OPS = {
    "eq": lambda a, b: a == b, "ne": lambda a, b: a != b, "!eq": lambda a, b: a != b,
    "gt": lambda a, b: a > b, "ge": lambda a, b: a >= b,
    "lt": lambda a, b: a < b, "le": lambda a, b: a <= b,
}


def compare(value, op, arg):
    if op == "null":
        return value is None
    if op == "!null":
        return value is not None
    if op in ("in", "!in"):
        items = [a.strip() for a in arg.strip("[]").split(",") if a.strip()]
        hit = value is not None and str(value) in items
        return hit if op == "in" else not hit
    if op in ("like", "ilike"):
        return value is not None and arg.lower() in str(value).lower()
    if op not in ORDERED_OPS:
        raise UnsupportedFilter(f"operator {op!r}")
    if value is None:
        return False
    if isinstance(value, int):
        try:
            return ORDERED_OPS[op](value, int(arg))
        except ValueError:
            raise UnsupportedFilter(f"{arg!r} is not a number")
    return ORDERED_OPS[op](str(value), arg)


# Properties DHIS2 accepts in a filter although a fixture object may omit them (a null field is
# absent from the JSON), keyed by collection. Anything else is an unknown property: DHIS2 answers
# 400, and so does the stub, so a typo in the backend's filter fails the suite instead of
# silently matching nothing.
OPTIONAL_PROPERTIES = {
    "organisationUnits": {"id", "code", "name", "shortName", "displayName", "level", "path",
                          "parent", "openingDate", "closedDate", "created", "lastUpdated",
                          "geometry", "organisationUnitGroups", "attributeValues"},
    "organisationUnitGroups": {"id", "code", "name", "shortName", "displayName", "groupSets",
                               "organisationUnits", "created", "lastUpdated"},
    "organisationUnitGroupSets": {"id", "code", "name", "shortName", "displayName", "compulsory",
                                  "organisationUnitGroups", "created", "lastUpdated"},
}


def known_properties(collection, objects):
    known = set(OPTIONAL_PROPERTIES.get(collection, ()))
    for obj in objects:
        known.update(obj.keys())
    return known


def apply_filters(objects, filters, junction="AND", known=None):
    if not filters:
        return objects
    parsed = []
    for f in filters:
        parts = f.split(":", 2)
        if len(parts) < 2:
            raise UnsupportedFilter(f)
        prop, op = parts[0], parts[1]
        if known is not None and prop.split(".")[0] not in known:
            raise UnsupportedFilter(f"property {prop!r} in {f!r}")
        arg = parts[2] if len(parts) > 2 else ""
        parsed.append((prop, op, arg))

    def value_of(obj, prop):
        cur = obj
        for p in prop.split("."):
            if isinstance(cur, dict):
                cur = cur.get(p)
            else:
                return None
        return cur

    out = []
    for obj in objects:
        results = [compare(value_of(obj, p), op, a) for p, op, a in parsed]
        if (all(results) if junction.upper() == "AND" else any(results)):
            out.append(obj)
    return out


def page_of(objects, query, key, forced_page_size=None):
    """Apply DHIS2 paging. Returns (payload, page number served)."""
    paging = query.get("paging", ["true"])[-1].lower() != "false"
    if forced_page_size:
        paging = True
    if not paging:
        return {key: objects}, None
    page = max(1, int(query.get("page", ["1"])[-1]))
    size = forced_page_size or max(1, int(query.get("pageSize", ["50"])[-1]))
    total = len(objects)
    count = max(1, -(-total // size))
    body = {
        "pager": {"page": page, "pageCount": count, "total": total, "pageSize": size},
        key: objects[(page - 1) * size: page * size],
    }
    if page < count:
        body["pager"]["nextPage"] = f"page={page + 1}"
    return body, page


def make_handler(state, fixture, prefix, username, password, redirect_host, port):
    base_units, base_groups, base_group_sets = fixture
    expected_auth = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "Apache-Coyote/1.1"  # what DHIS2 behind Tomcat announces
        sys_version = ""

        def log_message(self, fmt, *args):  # quiet; the request log is the record
            pass

        # ---- plumbing -------------------------------------------------------------------
        def send_json(self, status, body, record=None):
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json;charset=UTF-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            if record is not None:
                record["status"] = status
                with state.lock:
                    state.requests.append(record)

        def read_body(self):
            length = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(length) if length else b""

        def do_GET(self):
            self.route("GET")

        def do_POST(self):
            self.route("POST")

        def do_DELETE(self):
            self.route("DELETE")

        def do_PUT(self):
            self.route("PUT")

        # ---- routing --------------------------------------------------------------------
        def route(self, method):
            url = urlsplit(self.path)
            if url.path.startswith("/__stub/"):
                self.control(method, url.path[len("/__stub/"):])
                return
            query = parse_qs(url.query, keep_blank_values=True)
            with state.lock:
                scenario, delay = state.scenario, state.delay_ms
            header = self.headers.get("Authorization")
            auth_ok = header is not None and hmac.compare_digest(header, expected_auth)
            # The record never holds the header itself: only whether one came and matched.
            host = (self.headers.get("Host") or "").split(":")[0]
            record = {
                "time": now_iso(), "method": method, "host": host, "path": url.path,
                "query": query,
                "scenario": scenario, "authPresent": header is not None, "authOk": auth_ok,
            }
            if delay:
                time.sleep(delay / 1000)
            api = prefix.rstrip("/") + "/api/"
            if not url.path.startswith(api):
                self.send_json(404, {"httpStatus": "Not Found", "httpStatusCode": 404,
                                     "status": "ERROR", "message": "Not found"}, record)
                return
            if scenario == "redirect-cross-host" and host != redirect_host:
                target = f"https://{redirect_host}:{port}{self.path}"
                record["status"] = 302
                with state.lock:
                    state.requests.append(record)
                self.send_response(302)
                self.send_header("Location", target)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if scenario == "down":
                self.send_json(503, {"httpStatus": "Service Unavailable",
                                     "httpStatusCode": 503, "status": "ERROR",
                                     "message": "Service Unavailable"}, record)
                return
            if not auth_ok or scenario == "unauthorized":
                self.send_json(401, {"httpStatus": "Unauthorized", "httpStatusCode": 401,
                                     "status": "ERROR",
                                     "message": "Unauthorized"}, record)
                return
            if method != "GET":
                self.send_json(405, {"httpStatus": "Method Not Allowed",
                                     "httpStatusCode": 405, "status": "ERROR",
                                     "message": "The MFL stub is read-only"}, record)
                return
            resource = url.path[len(api):]
            resource = resource[:-5] if resource.endswith(".json") else resource
            catalogue = Catalogue(scenario_units(base_units, scenario), base_groups,
                                  base_group_sets)
            try:
                status, body = self.api(resource, query, catalogue, scenario, record)
            except UnsupportedFilter as e:
                status, body = 400, {"httpStatus": "Bad Request", "httpStatusCode": 400,
                                     "status": "ERROR",
                                     "message": f"The MFL stub does not support filter {e}. "
                                                "Extend qa/api/mfl-stub/mfl_stub.py if DHIS2 "
                                                "supports it."}
            except ValueError as e:
                status, body = 400, {"httpStatus": "Bad Request", "httpStatusCode": 400,
                                     "status": "ERROR", "message": str(e)}
            self.send_json(status, body, record)
            return

        def api(self, resource, query, catalogue, scenario, record):
            fields_spec = ",".join(query.get("fields", []))
            if resource == "system/info":
                return 200, {"version": DHIS2_VERSION, "revision": DHIS2_REVISION,
                             "serverDate": now_iso(), "calendar": "iso8601",
                             "dateFormat": "yyyy-mm-dd"}
            if resource == "me":
                return 200, {"username": username, "userRoles": [{"name": "Integration API Reader"}]}
            if resource == "deletedObjects":
                # What the live MFL answers this account (LE-318).
                return 403, {"httpStatus": "Forbidden", "httpStatusCode": 403,
                             "status": "ERROR", "message": "Access is denied"}
            collections = {
                "organisationUnits": (catalogue.units, catalogue.unit_by_id),
                "organisationUnitGroups": (catalogue.groups, catalogue.group_by_id),
                "organisationUnitGroupSets": (catalogue.group_sets, catalogue.group_set_by_id),
            }
            name, _, uid = resource.partition("/")
            if name not in collections:
                return 404, {"httpStatus": "Not Found", "httpStatusCode": 404,
                             "status": "ERROR", "message": f"No endpoint {resource}"}
            objects, by_id = collections[name]
            fields = parse_fields(fields_spec) if fields_spec else None
            if uid:
                obj = by_id.get(uid)
                if obj is None:
                    return 404, {"httpStatus": "Not Found", "httpStatusCode": 404,
                                 "status": "ERROR",
                                 "message": f"OrganisationUnit with id {uid} could not be found."}
                return 200, catalogue.select(obj, fields)
            # A list with no fields= answers id and displayName only, as DHIS2 does.
            if fields is None:
                fields = {"id": None, "displayName": None}
            matched = apply_filters(objects, query.get("filter", []),
                                    query.get("rootJunction", ["AND"])[-1],
                                    known=known_properties(name, objects))
            matched = sorted(matched, key=lambda o: (o.get("level", 0), o["id"]))
            forced = FAILED_PAGE_SIZE if scenario == "failed-page" and name == "organisationUnits" else None
            body, page = page_of([catalogue.select(o, fields) for o in matched], query, name, forced)
            record["page"] = page
            if forced and page == 2:
                return 500, {"httpStatus": "Internal Server Error", "httpStatusCode": 500,
                             "status": "ERROR", "message": "The MFL stub failed this page on purpose"}
            return 200, body

        # ---- control API ----------------------------------------------------------------
        def control(self, method, what):
            if what == "health" and method == "GET":
                return self.send_json(200, {"ok": True})
            if what == "scenario":
                if method == "GET":
                    with state.lock:
                        return self.send_json(200, {"name": state.scenario,
                                                    "delayMs": state.delay_ms,
                                                    "available": SCENARIOS})
                if method == "POST":
                    try:
                        body = json.loads(self.read_body() or b"{}")
                    except json.JSONDecodeError:
                        return self.send_json(400, {"error": "body is not JSON"})
                    name = body.get("name", "normal")
                    if name not in SCENARIOS:
                        return self.send_json(400, {"error": f"unknown scenario {name}",
                                                    "available": SCENARIOS})
                    with state.lock:
                        state.scenario = name
                        state.delay_ms = int(body.get("delayMs", 0))
                    return self.send_json(200, {"name": name, "delayMs": state.delay_ms})
            if what == "requests":
                if method == "GET":
                    with state.lock:
                        return self.send_json(200, {"requests": list(state.requests)})
                if method == "DELETE":
                    with state.lock:
                        state.requests.clear()
                    return self.send_json(200, {"cleared": True})
            return self.send_json(404, {"error": f"no control endpoint {method} {what}"})

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8443)
    ap.add_argument("--fixtures", required=True)
    ap.add_argument("--cert", help="PEM certificate chain; omit for plain HTTP (local use only)")
    ap.add_argument("--key")
    ap.add_argument("--prefix", default="/mfl", help="instance root path, without /api")
    ap.add_argument("--username", required=True)
    ap.add_argument("--password-file", required=True)
    ap.add_argument("--redirect-host", default="mfl-stub-elsewhere",
                    help="host name redirect-cross-host sends clients to (a second name for this "
                         "stub that is NOT on the backend's allowlist)")
    args = ap.parse_args()
    with open(args.password_file, encoding="utf-8") as f:
        password = f.read().rstrip("\n")
    state = State()
    handler = make_handler(state, load_fixture(args.fixtures), args.prefix, args.username, password,
                           args.redirect_host, args.port)
    server = ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    if args.cert:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(args.cert, args.key)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
    scheme = "https" if args.cert else "http"
    print(f"MFL stub serving {scheme}://0.0.0.0:{args.port}{args.prefix} (DHIS2 {DHIS2_VERSION})",
          flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
