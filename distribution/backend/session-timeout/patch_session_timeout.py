#!/usr/bin/env python3
"""Set the OpenMRS WAR servlet session timeout to 10 minutes.

Tomcat's default is 30 minutes. OpenMRS 2.8.8 ships WEB-INF/web.xml with
session-config/cookie-config/http-only and no session-timeout. This patch
inserts that element and fails the image build if a later OpenMRS release
changes the descriptor so the edit would be a guess.

The timeout is whole minutes of HTTP-session inactivity. It is not the
human-idle watcher and it is not a gateway timeout.
"""

from __future__ import annotations

import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

SESSION_TIMEOUT_MINUTES = "10"
WEB_XML = "WEB-INF/web.xml"

# Upstream 2.8.8, including the Java EE default namespace used by web.xml.
UPSTREAM_FIXTURE = """<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="3.0">
	<session-config>
	    <cookie-config>
	        <http-only>true</http-only>
	    </cookie-config>
	</session-config>
</web-app>
"""


class SessionTimeoutPatchError(Exception):
    """The WAR descriptor is not the structure this security control knows how to patch."""


def local_name(tag: str) -> str:
    if not isinstance(tag, str) or not tag:
        raise SessionTimeoutPatchError("web.xml has an unexpected element name")
    return tag.rsplit("}", 1)[-1]


def element_children(element: ET.Element) -> list[ET.Element]:
    return [child for child in list(element) if isinstance(child.tag, str)]


def find_elements(root: ET.Element, name: str) -> list[ET.Element]:
    return [element for element in root.iter() if isinstance(element.tag, str) and local_name(element.tag) == name]


def assert_upstream_shape(root: ET.Element) -> None:
    """Fail closed unless web.xml is still the OpenMRS 2.8.8 session-config."""
    sessions = find_elements(root, "session-config")
    if len(sessions) != 1:
        raise SessionTimeoutPatchError(
            f"expected exactly one session-config, found {len(sessions)}; "
            "refusing to guess a session timeout"
        )
    if find_elements(root, "session-timeout"):
        raise SessionTimeoutPatchError(
            "web.xml already contains session-timeout; refusing to overwrite an upstream timeout"
        )

    session = sessions[0]
    children = element_children(session)
    if [local_name(child.tag) for child in children] != ["cookie-config"]:
        raise SessionTimeoutPatchError(
            "session-config is not the expected single cookie-config block; "
            "refusing to patch an ambiguous descriptor"
        )

    cookie_children = element_children(children[0])
    if [local_name(child.tag) for child in cookie_children] != ["http-only"]:
        raise SessionTimeoutPatchError(
            "cookie-config is not the expected http-only flag; refusing to patch"
        )
    if (cookie_children[0].text or "").strip().lower() != "true":
        raise SessionTimeoutPatchError("http-only is not true; refusing to patch session-config")


def assert_patched_shape(root: ET.Element) -> None:
    sessions = find_elements(root, "session-config")
    timeouts = find_elements(root, "session-timeout")
    if len(sessions) != 1 or len(timeouts) != 1:
        raise SessionTimeoutPatchError(
            f"expected one session-config and one session-timeout, "
            f"found {len(sessions)} and {len(timeouts)}"
        )
    timeout = timeouts[0]
    parent = next(
        element
        for element in root.iter()
        if any(child is timeout for child in list(element))
    )
    if local_name(parent.tag) != "session-config":
        raise SessionTimeoutPatchError("session-timeout is not inside session-config")
    if (timeout.text or "").strip() != SESSION_TIMEOUT_MINUTES or list(timeout):
        raise SessionTimeoutPatchError(
            f"session-timeout must be exactly {SESSION_TIMEOUT_MINUTES} whole minutes"
        )

    http_only = find_elements(root, "http-only")
    if len(http_only) != 1 or (http_only[0].text or "").strip().lower() != "true":
        raise SessionTimeoutPatchError("patched web.xml lost the http-only cookie flag")


def parse_xml(text: str) -> ET.Element:
    try:
        return ET.fromstring(text)
    except ET.ParseError as exc:
        raise SessionTimeoutPatchError(f"web.xml is not well-formed XML: {exc}") from exc


def patch_web_xml(text: str) -> str:
    assert_upstream_shape(parse_xml(text))
    needle = "<session-config>"
    cookie = "<cookie-config>"
    start = text.find(needle)
    if start < 0 or text.find(needle, start + len(needle)) >= 0:
        raise SessionTimeoutPatchError(
            "session-config markup is not a single unambiguous element; refusing to patch"
        )
    cookie_at = text.find(cookie, start)
    if cookie_at < 0:
        raise SessionTimeoutPatchError("cookie-config markup was not found inside session-config")
    whitespace = text[start + len(needle) : cookie_at]
    if whitespace.strip():
        raise SessionTimeoutPatchError(
            "unexpected markup between session-config and cookie-config; refusing to patch"
        )
    insertion = (
        f"{needle}{whitespace}<session-timeout>{SESSION_TIMEOUT_MINUTES}</session-timeout>{whitespace}{cookie}"
    )
    patched = text[:start] + insertion + text[cookie_at + len(cookie) :]
    assert_patched_shape(parse_xml(patched))
    return patched


def read_web_xml(war: Path) -> str:
    if not war.is_file():
        raise SessionTimeoutPatchError(f"WAR not found: {war}")
    try:
        with zipfile.ZipFile(war) as archive:
            matches = [name for name in archive.namelist() if name == WEB_XML]
            if len(matches) != 1:
                raise SessionTimeoutPatchError(
                    f"expected exactly one {WEB_XML} in the WAR, found {len(matches)}"
                )
            return archive.read(WEB_XML).decode("utf-8")
    except zipfile.BadZipFile as exc:
        raise SessionTimeoutPatchError(f"{war} is not a zip/WAR") from exc


def write_web_xml(war: Path, text: str) -> None:
    payload = text.encode("utf-8")
    temporary = war.with_name(war.name + ".tmp")
    replaced = False
    with zipfile.ZipFile(war) as source, zipfile.ZipFile(
        temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True
    ) as target:
        for info in source.infolist():
            data = payload if info.filename == WEB_XML else source.read(info.filename)
            if info.filename == WEB_XML:
                replaced = True
            # Store by name so a ZipInfo copied out of `source` cannot disagree
            # with the bytes just written.
            target.writestr(info.filename, data)
    if not replaced:
        temporary.unlink(missing_ok=True)
        raise SessionTimeoutPatchError(f"{WEB_XML} was not written")
    temporary.replace(war)


def patch_war(war: Path) -> None:
    patched = patch_web_xml(read_web_xml(war))
    write_web_xml(war, patched)
    verify_war(war)


def verify_war(war: Path) -> None:
    assert_patched_shape(parse_xml(read_web_xml(war)))
    print(f"{war}: session-timeout is {SESSION_TIMEOUT_MINUTES} minutes and http-only remains true")


def self_test() -> None:
    patched = patch_web_xml(UPSTREAM_FIXTURE)
    assert_patched_shape(parse_xml(patched))
    if "<http-only>true</http-only>" not in patched:
        raise SessionTimeoutPatchError("self-test removed http-only")
    if patched.count("<session-timeout>10</session-timeout>") != 1:
        raise SessionTimeoutPatchError("self-test did not insert a single 10-minute timeout")

    failures = [
        (UPSTREAM_FIXTURE.replace("<session-config>", "<session-config><!-- note -->"), "markup"),
        (UPSTREAM_FIXTURE.replace("<session-config>", "").replace("</session-config>", ""), "missing"),
        (
            UPSTREAM_FIXTURE.replace(
                "<cookie-config>",
                "<session-timeout>30</session-timeout><cookie-config>",
            ),
            "already",
        ),
        (
            UPSTREAM_FIXTURE.replace(
                "</cookie-config>",
                "</cookie-config><tracking-mode>COOKIE</tracking-mode>",
            ),
            "ambiguous",
        ),
        (UPSTREAM_FIXTURE.replace(">true<", ">false<"), "http-only"),
        (UPSTREAM_FIXTURE + UPSTREAM_FIXTURE.replace("<web-app", "<extra").replace("</web-app>", "</extra>"), "duplicate"),
    ]
    # The duplicate case above is not well-formed enough. Build an explicit second block.
    two_blocks = UPSTREAM_FIXTURE.replace(
        "</session-config>",
        "</session-config><session-config><cookie-config><http-only>true</http-only></cookie-config></session-config>",
    )
    failures[-1] = (two_blocks, "duplicate")

    for text, label in failures:
        try:
            patch_web_xml(text)
        except SessionTimeoutPatchError:
            continue
        raise SessionTimeoutPatchError(f"self-test expected {label} input to fail closed")

    try:
        patch_web_xml(patched)
    except SessionTimeoutPatchError:
        pass
    else:
        raise SessionTimeoutPatchError("self-test patched an already-patched descriptor")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(WEB_XML, UPSTREAM_FIXTURE)
        archive.writestr("WEB-INF/lib/example.txt", "untouched")
    war = Path("/tmp/liberiaemr-session-timeout-self-test.war")
    war.write_bytes(buffer.getvalue())
    try:
        patch_war(war)
        with zipfile.ZipFile(war) as archive:
            text = archive.read(WEB_XML).decode("utf-8")
            other = archive.read("WEB-INF/lib/example.txt")
        assert_patched_shape(parse_xml(text))
        if other != b"untouched":
            raise SessionTimeoutPatchError("self-test rewrote an unrelated WAR entry")
        verify_war(war)
    finally:
        war.unlink(missing_ok=True)
    print("session-timeout self-test passed")


def main(argv: list[str]) -> int:
    if argv == ["--self-test"]:
        self_test()
        return 0
    if len(argv) == 2 and argv[0] == "--verify":
        verify_war(Path(argv[1]))
        return 0
    if len(argv) == 1 and not argv[0].startswith("-"):
        patch_war(Path(argv[0]))
        return 0
    print(
        "usage: patch_session_timeout.py <openmrs.war> | --verify <openmrs.war> | --self-test",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SessionTimeoutPatchError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
