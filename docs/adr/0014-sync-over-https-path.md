# 0014: Facility to central sync over HTTPS on 443, through a path on the central gateway

**Status:** Accepted (7 October 2026), proven on the dev pair: with 61617 closed in central's firewall, a record registered at the facility reached central through `/sync/broker/` in 31 seconds (Enable sync on dev, run 37602331126)
**Ticket:** LE-372 (amends the transport in [ADR 0008](0008-adopt-openmrs-dbsync.md); the
broker, its mutual TLS and the per-facility permissions are unchanged)

## Context

A facility's sync sender connects straight to the Artemis broker at central,
`ssl://<central>:61617`: OpenWire over mutual TLS. Government networks often allow nothing
outbound but HTTPS on 443, sometimes only through a forward proxy, sometimes through a firewall
that inspects TLS. Each site then has to ask its network owner to open 61617, which is slow,
often refused, and out of our hands. The dev pair showed it: sync was configured on
30 September 2026 and nothing moved until 61617 was opened in central's Linode firewall, while
443 to the same host worked throughout.

The goal is that sync works wherever the facility can already reach central's EMR over HTTPS:
the same host name, port 443, routed by URL path at the central gateway.

Two things are fixed:

- **Identity stays at the broker.** The broker authenticates each facility by its client
  certificate, checks the revocation list, and lets it publish only to its own address
  (`sync.facility.<code>`). Whatever carries the connection must not weaken that.
- **The sender is upstream code.** It is openmrs-dbsync on openmrs-eip 4.2.0, which builds its
  JMS connection from Spring Boot's ActiveMQ (Classic, OpenWire) client. We configure it; we do
  not patch it or add extension jars to it.

## Options considered

| Option | Path on 443 | Sender change | Facility identity | Forward proxy | TLS inspection |
| --- | --- | --- | --- | --- | --- |
| AMQP over WebSocket (Qpid JMS, `amqpwss://`) | yes | new JMS client and connection factory in the sender | end to end inside the WebSocket | client support varies | inner TLS survives only if the client nests it |
| Artemis CORE over HTTP or WebSocket | yes | the sender would need the Artemis CORE client instead of OpenWire | as above | as above | as above |
| WebSocket tunnel at each end (chosen) | yes | none: the sender's URL form is unchanged | end to end: the sender's own TLS session travels inside, unopened | yes, HTTP CONNECT | yes: the inspector sees only the outer HTTPS |
| SNI passthrough (`ssl_preread`) on 443 | no, a second host name | none | end to end | no | no: the inspector replaces the certificate and mutual TLS fails |

- **AMQP or CORE over WebSocket** both mean replacing the client the sender is built around.
  The ActiveMQ Classic client has no WebSocket transport, and its HTTP transport speaks a
  protocol only ActiveMQ Classic brokers serve. Either is a change to openmrs-eip, which we
  would raise upstream rather than carry; it can replace this decision later without changing
  the broker.
- **SNI passthrough** was prototyped first, as an opt-in stream router on the gateway. It
  keeps mutual TLS end to end and needs no new component, but it is not path based: it needs a second DNS
  name and certificate name, it cannot cross a forward proxy, and a firewall that inspects TLS
  presents its own certificate to the sender, so the broker never sees the facility's.
  Those are exactly the networks this ticket is for.

## Decision

Carry the sender's existing connection inside a WebSocket on
`https://<central>/sync/broker/`, with [wstunnel](https://github.com/erebe/wstunnel)
(BSD-3-Clause) at each end. It ships as our own image, `liberia-emr-sync-tunnel`
(`distribution/sync-tunnel/Dockerfile`): upstream's v10.7.1 release image pinned by digest,
built, released and promoted with the other images, so each release fixes the binary and an
upstream change or outage cannot stop a facility from deploying or syncing.

- **Central:** the gateway routes `/sync/broker/` to a `sync-tunnel` service
  (`wstunnel server`), which forwards to `artemis:61617` and nowhere else (`--restrict-to`).
  The route's settings live in `distribution/gateway/snippets/sync-broker-path.conf`:
  upgrade headers, no buffering, one-hour timeouts with pings every 30 seconds.
- **Facility:** a `sync-tunnel` service (`wstunnel client`, `sync` profile) listens as
  `artemis:61617` on the facility network and carries each connection to
  `wss://<SYNC_CENTRAL_URL host>/sync/broker/`. `artemis` is a name the broker certificate
  must already hold (the receiver uses it), so the sender's `ARTEMIS_URL=ssl://artemis:61617`
  passes its host name check against the real broker. `sync-security.sh` accepts that URL
  as it is and still refuses plain `tcp://` and URL options.

**Identity and revocation.** The gateway ends only the outer HTTPS. Inside is the sender's TLS
session with the broker, opened at the facility, so the broker checks the facility's
certificate, the revocation list and its permissions exactly as on 61617. The tunnel itself
authenticates nobody: reaching `/sync/broker/` gives what an open 61617 gives today, a TLS
handshake with a broker that refuses anyone without an enrolled certificate.

**Forward proxies.** `SYNC_HTTP_PROXY` (`host:port` or `user:pass@host:port`) sends the tunnel
through an HTTP CONNECT proxy. It is passed in the environment, not on the command line.

**TLS inspection.** The tunnel checks central's web certificate against the system CAs.
A network that inspects TLS re-signs it with its own CA; `SYNC_TUNNEL_CA_FILE` adds that CA for
the tunnel only. The inner session is not affected: the inspector cannot open it, and the
broker's certificate is still checked by the sender against the sync CA alone.

**Backward compatibility.** Nothing changes for a facility until it sets `SYNC_CENTRAL_URL`
and points `ARTEMIS_URL` at `ssl://artemis:61617`. Facilities move one at a time; 61617 stays
published at central until the last has moved, then `ARTEMIS_BIND_ADDR=127.0.0.1` closes it
(distribution/broker/README.md).

## Consequences

- A facility's network requirement becomes "HTTPS to central".
- One more container on each side to keep patched. Its image is ours, pinned to an upstream
  digest and scanned by Trivy in CI; the tag and digest are bumped together, deliberately.
- The broker sees every tunnelled facility arrive from the central tunnel's address. The
  gateway's access log records the facility's address for each `/sync/broker/` request, and
  the certificate already names the facility.
- `qa/sync/verify-broker-path.sh` proves the route, every refusal through it, and a facility
  behind a CONNECT proxy, and runs in CI. The dev pair check is running sync with 61617
  closed again in central's firewall.
- If openmrs-eip later gains a WebSocket-capable client, the facility tunnel can go without
  any change at the broker.
