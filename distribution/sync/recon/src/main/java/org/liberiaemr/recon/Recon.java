package org.liberiaemr.recon;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.sun.net.httpserver.HttpServer;

import jakarta.jms.BytesMessage;
import jakarta.jms.JMSException;
import jakarta.jms.Message;
import jakarta.jms.MessageConsumer;
import jakarta.jms.MessageProducer;
import jakarta.jms.Session;

import org.apache.activemq.ActiveMQConnection;
import org.apache.activemq.ActiveMQConnectionFactory;

/**
 * Sync reconciliation (sync-eip.md 5.5).
 *
 * <pre>
 *   java -jar recon.jar facility [--once]   beside the sender: send tonight's digest
 *   java -jar recon.jar central  [--once]   beside the receiver: compare what arrives
 * </pre>
 *
 * Configured from the environment the sync entrypoints already set, plus SYNC_RECON_*. The broker
 * connection uses the container's client certificate, passed in as javax.net.ssl properties.
 */
public final class Recon {

	static final String QUEUE_PREFIX = "recon.facility.";

	private static final Pattern FACILITY = Pattern.compile("^[a-z0-9][a-z0-9-]{1,31}$");

	private Recon() {
	}

	public static void main(String[] args) throws Exception {
		String mode = args.length > 0 ? args[0] : "";
		boolean once = args.length > 1 && "--once".equals(args[1]);
		switch (mode) {
			case "facility":
				facility(once);
				break;
			case "central":
				central(once);
				break;
			default:
				System.err.println("usage: recon.jar facility|central [--once]");
				System.exit(2);
		}
	}

	// ---------------------------------------------------------------- facility

	static void facility(boolean once) throws Exception {
		String code = require("DBSYNC_SENDER_ID");
		if (!FACILITY.matcher(code).matches()) {
			throw new IllegalArgumentException("DBSYNC_SENDER_ID is not a facility code: " + code);
		}
		int hour = intEnv("SYNC_RECON_HOUR", 2);
		Path state = Path.of(env("SYNC_RECON_STATE_FILE", "/opt/eip/.recon-state"));
		long notBefore = 0;
		while (!Thread.currentThread().isInterrupted()) {
			long[] last = readState(state);
			long now = System.currentTimeMillis() / 1000;
			if (once || now >= notBefore && FacilityDigest.due(now, last[0], hour)) {
				try {
					if (sendDigest(code, last[1])) {
						writeState(state, now, last[1] + 1);
					}
				}
				catch (Offline e) {
					// The connection is opened before any table is read, so an hourly try costs the
					// clinic nothing.
					log("broker not reachable, trying again in an hour: " + e.getCause());
					if (once) {
						throw e;
					}
				}
				catch (Exception e) {
					// Anything else happened after reading the database; not again for six hours.
					log("digest not sent, trying again in six hours: " + e);
					notBefore = now + 6 * 3600L;
					if (once) {
						throw e;
					}
				}
				catch (Error e) {
					log("stopping so the entrypoint starts it again: " + e);
					System.exit(1);
				}
			}
			if (once) {
				return;
			}
			// Wakes just after each hour starts, so no hour of the day is skipped.
			long wake = (Math.floorDiv(System.currentTimeMillis() / 1000, 3600L) + 1) * 3600L + 300;
			Thread.sleep(Math.max(60, wake - System.currentTimeMillis() / 1000) * 1000);
		}
	}

	/** @return true when a digest was sent; false when the sender is not ready for one */
	static boolean sendDigest(String code, long digestsSent) throws Exception {
		Properties config = properties("/app/config/application.properties");
		Set<String> tables = Tables.watched(config.getProperty("eip.watchedTables"));
		long now = System.currentTimeMillis() / 1000;
		byte[] offsets = readIfPresent(Path.of(env("SYNC_RECON_OFFSETS_FILE", "/opt/eip/.debezium/offsets.txt")));
		if (FacilityDigest.loading(offsets)) {
			log("the sender's first load is still running; no digest yet");
			return false;
		}
		long cutoff = FacilityDigest.cutoff(now, intEnv("SYNC_RECON_GRACE_MINUTES", 60), FacilityDigest.capturedAt(offsets));
		if (cutoff < 0) {
			log("the sender has not saved a position yet; no digest yet");
			return false;
		}
		Set<String> queued;
		try (Connection mgmt = db(require("MGMT_DB_NAME"), require("MGMT_DB_USER"), env("MGMT_DB_PASSWORD", ""))) {
			queued = FacilityDigest.queued(mgmt, 100_000);
		}
		if (queued == null) {
			log("the sender still holds a backlog; no digest until it has sent it");
			return false;
		}
		int sweepDays = intEnv("SYNC_RECON_SWEEP_DAYS", 28);
		// Connected first: an offline facility finds out before it reads a single table.
		ActiveMQConnection opened;
		try {
			opened = connect();
		}
		catch (JMSException e) {
			throw new Offline(e);
		}
		try (ActiveMQConnection connection = opened) {
			connection.start();
			Digest digest;
			try (Connection openmrs = db(require("OPENMRS_DB_NAME"), require("DEBEZIUM_DB_USER"),
			    env("DEBEZIUM_DB_PASSWORD", ""))) {
				digest = FacilityDigest.build(openmrs, tables, code, now, cutoff, intEnv("SYNC_RECON_RECENT_DAYS", 35),
				    sweepDays, FacilityDigest.sweepSlice(digestsSent, sweepDays), queued,
				    since(env("SYNC_RECON_SINCE", "")));
			}
			byte[] body = digest.toBytes();
			Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
			MessageProducer producer = session.createProducer(session.createQueue(QUEUE_PREFIX + code));
			BytesMessage message = session.createBytesMessage();
			message.writeBytes(body);
			producer.send(message);
			log("sent a digest of " + digest.entries.size() + " records created before " + cutoff + " (" + body.length
			        + " bytes)");
		}
		return true;
	}

	/** The broker could not be reached, before anything was read. */
	static final class Offline extends Exception {

		Offline(JMSException cause) {
			super(cause);
		}
	}

	/**
	 * SYNC_RECON_SINCE, for a facility enrolled with SYNC_SNAPSHOT_MODE=schema_only, which never
	 * sent what it held before: a date, or a date and time (UTC) to be exact about enrolment day.
	 */
	static Long since(String value) {
		if (value.isEmpty()) {
			return null;
		}
		value = value.endsWith("Z") ? value.substring(0, value.length() - 1) : value;
		return value.contains("T") ? LocalDateTime.parse(value).toEpochSecond(ZoneOffset.UTC)
		        : LocalDate.parse(value).atStartOfDay().toEpochSecond(ZoneOffset.UTC);
	}

	/** When the last digest was sent and how many have been, kept beside the sender's state. */
	static long[] readState(Path file) {
		try {
			String[] f = new String(Files.readAllBytes(file), StandardCharsets.US_ASCII).trim().split(" ");
			return new long[] { Long.parseLong(f[0]), Long.parseLong(f[1]) };
		}
		catch (Exception e) {
			return new long[] { 0, 0 };
		}
	}

	static void writeState(Path file, long sentAt, long sent) throws IOException {
		Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
		Files.write(tmp, (sentAt + " " + sent + "\n").getBytes(StandardCharsets.US_ASCII));
		Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
	}

	// ---------------------------------------------------------------- central

	static void central(boolean once) throws Exception {
		Properties config = properties("/app/config/application.properties");
		Set<String> skipped = CentralCheck.skipped(config.getProperty("db-sync.excludedEntities"));
		int confirmHours = intEnv("SYNC_RECON_CONFIRM_HOURS", 6);
		long every = intEnv("SYNC_RECON_CHECK_SECONDS", 600);
		String[] metrics = { "" };
		if (!once) {
			HttpServer server = HttpServer.create(new InetSocketAddress(intEnv("SYNC_RECON_METRICS_PORT", 9103)), 0);
			server.createContext("/metrics", exchange -> {
				byte[] out = metrics[0].getBytes(StandardCharsets.UTF_8);
				exchange.getResponseHeaders().set("Content-Type", "text/plain; version=0.0.4");
				exchange.sendResponseHeaders(200, out.length);
				try (OutputStream os = exchange.getResponseBody()) {
					os.write(out);
				}
			});
			server.start();
		}
		while (!Thread.currentThread().isInterrupted()) {
			try (Connection openmrs = db(require("OPENMRS_DB_NAME"), require("OPENMRS_DB_USER"),
			    env("OPENMRS_DB_PASSWORD", ""));
			        Connection mgmt = db(require("MGMT_DB_NAME"), require("MGMT_DB_USER"), env("MGMT_DB_PASSWORD", ""))) {
				CentralCheck.createTables(mgmt);
				long now = System.currentTimeMillis() / 1000;
				receive(facilities(), digest -> {
					int gaps = CentralCheck.record(openmrs, mgmt, digest, skipped, now);
					log("facility " + digest.facility + ": " + digest.entries.size() + " records, " + gaps
					        + " not at central yet");
				});
				CentralCheck.recheck(openmrs, mgmt, now, confirmHours, backlogEmpty());
				metrics[0] = CentralCheck.metrics(mgmt, CentralCheck.placeholders(openmrs), now);
			}
			catch (Exception e) {
				log("check failed, trying again at the next pass: " + e);
				if (once) {
					throw e;
				}
			}
			catch (Error e) {
				log("stopping so the entrypoint starts it again: " + e);
				System.exit(1);
			}
			if (once) {
				return;
			}
			Thread.sleep(every * 1000);
		}
	}

	/**
	 * The enrolled facilities: each has its own recon.facility.<code> address on the broker, which
	 * central's Prometheus reports whether or not a digest has arrived. dbsync keeps no list of
	 * the sites it hears from. Empty when monitoring cannot be reached; the next pass tries again.
	 */
	static List<String> facilities() {
		List<String> out = new ArrayList<>();
		String body = prometheus("artemis_routed_message_count{address=~\"recon\\\\.facility\\\\..+\"}");
		if (body == null) {
			return out;
		}
		Matcher m = Pattern.compile("\"address\":\"recon\\.facility\\.([a-z0-9-]+)\"").matcher(body);
		while (m.find()) {
			if (FACILITY.matcher(m.group(1)).matches() && !out.contains(m.group(1))) {
				out.add(m.group(1));
			}
		}
		return out;
	}

	interface DigestHandler {

		void handle(Digest digest) throws SQLException;
	}

	/**
	 * Drains each facility's queue, acknowledging a digest only once it is recorded, so one that
	 * fails is delivered again. The queue is the proof of who sent a digest: a facility can only
	 * send to its own, so a digest naming another facility is refused.
	 */
	static void receive(List<String> sites, DigestHandler handler) throws JMSException, IOException, SQLException {
		if (sites.isEmpty()) {
			return;
		}
		try (ActiveMQConnection connection = connect()) {
			connection.start();
			Session session = connection.createSession(false, Session.CLIENT_ACKNOWLEDGE);
			for (String code : sites) {
				try (MessageConsumer consumer = session.createConsumer(session.createQueue(QUEUE_PREFIX + code))) {
					Message m;
					while ((m = consumer.receive(2000)) != null) {
						Digest digest = read(m, code);
						if (digest != null) {
							handler.handle(digest);
						}
						m.acknowledge();
					}
				}
			}
		}
	}

	private static Digest read(Message m, String queueFacility) throws JMSException, IOException {
		if (!(m instanceof BytesMessage)) {
			log("facility " + queueFacility + ": discarded a message that is not a digest");
			return null;
		}
		BytesMessage b = (BytesMessage) m;
		byte[] data = new byte[(int) b.getBodyLength()];
		b.readBytes(data);
		try {
			Digest digest = Digest.fromBytes(data);
			if (!queueFacility.equals(digest.facility)) {
				log("facility " + queueFacility + ": discarded a digest that names " + digest.facility);
				return null;
			}
			return digest;
		}
		catch (IllegalArgumentException | IOException e) {
			log("facility " + queueFacility + ": discarded a malformed digest: " + e.getMessage());
			return null;
		}
	}

	/**
	 * Whether the broker still holds messages for the receiver, from central's Prometheus. Unknown
	 * counts as not empty, so no gap is confirmed while a backlog may be about to fill it.
	 */
	static boolean backlogEmpty() {
		String body = prometheus("sum(artemis_message_count{queue=\"DB-SYNC-REC.DB-SYNC-RECEIVER\"})");
		Matcher m = body == null ? null : Pattern.compile("\"value\":\\[[^,]+,\"([0-9.eE+-]+)\"\\]").matcher(body);
		try {
			return m != null && m.find() && Double.parseDouble(m.group(1)) == 0;
		}
		catch (NumberFormatException e) {
			return false;
		}
	}

	/** One instant query to central's Prometheus; null when it cannot be answered. */
	static String prometheus(String query) {
		String base = env("SYNC_RECON_PROMETHEUS_URL", "http://prometheus:9090");
		try {
			HttpResponse<String> r = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build().send(
			    HttpRequest.newBuilder(URI.create(base + "/api/v1/query?query=" + URLEncoder.encode(query, StandardCharsets.UTF_8)))
			            .timeout(Duration.ofSeconds(10)).build(),
			    HttpResponse.BodyHandlers.ofString());
			if (r.statusCode() == 200) {
				return r.body();
			}
			log("monitoring at " + base + " answered " + r.statusCode());
		}
		catch (Exception e) {
			log("cannot reach monitoring at " + base + ": " + e);
		}
		return null;
	}

	// ---------------------------------------------------------------- plumbing

	static ActiveMQConnection connect() throws JMSException {
		ActiveMQConnection c = (ActiveMQConnection) new ActiveMQConnectionFactory(require("ARTEMIS_URL"))
		        .createConnection();
		return c;
	}

	static Connection db(String name, String user, String password) throws SQLException {
		return DriverManager.getConnection("jdbc:mysql://" + require("OPENMRS_DB_HOST") + ":" + env("OPENMRS_DB_PORT", "3306")
		        + "/" + name,
		    user, password);
	}

	static Properties properties(String file) throws IOException {
		Properties p = new Properties();
		try (InputStream in = new FileInputStream(file)) {
			p.load(in);
		}
		return p;
	}

	static byte[] readIfPresent(Path file) throws IOException {
		try {
			return Files.readAllBytes(file);
		}
		catch (NoSuchFileException e) {
			return null;
		}
	}

	static String require(String name) {
		String v = System.getenv(name);
		if (v == null || v.isEmpty()) {
			throw new IllegalStateException(name + " is not set");
		}
		return v;
	}

	static String env(String name, String fallback) {
		String v = System.getenv(name);
		return v == null || v.isEmpty() ? fallback : v;
	}

	static int intEnv(String name, int fallback) {
		String v = env(name, "");
		try {
			return v.isEmpty() ? fallback : Integer.parseInt(v.trim());
		}
		catch (NumberFormatException e) {
			log(name + " is '" + v + "', not a whole number; using " + fallback);
			return fallback;
		}
	}

	static void log(String message) {
		System.out.println("[recon] " + message);
	}
}
