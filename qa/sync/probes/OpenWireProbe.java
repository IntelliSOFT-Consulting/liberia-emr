import jakarta.jms.Connection;
import jakarta.jms.Destination;
import jakarta.jms.JMSException;
import jakarta.jms.Message;
import jakarta.jms.Session;
import jakarta.jms.Topic;
import jakarta.jms.TextMessage;
import java.security.Security;
import java.util.Arrays;
import java.util.Collections;
import org.apache.activemq.ActiveMQConnectionFactory;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.openmrs.eip.dbsync.config.SenderEncryptionProperties;
import org.openmrs.eip.dbsync.service.security.PGPEncryptService;

/**
 * OpenWire client for qa/sync/verify-hardening.sh, using the ActiveMQ client bundled in the
 * dbsync sender so every refusal is one the real apps would meet. TLS comes from the
 * javax.net.ssl system properties, as in the sync entrypoints. Prints one RESULT line.
 *
 *   <url> send        <address> [name=value ...]
 *   <url> send-signed <address> <keysDir> <pgpPass> <signerId> <receiverId> <sourceId> [name=value ...]
 *   <url> send-signed-malformed  (same arguments)
 *   <url> consume     <address>
 *   <url> subscribe   <topic> <clientId> <subscription> <timeoutSeconds>
 *   <url> abandon     <topic> <clientId> <subscription> <attempts>
 *
 * send-signed sends what a dbsync sender would: a payload naming sourceId, signed with the
 * key for signerId and encrypted to the receiver. The payload is the daemon user, which the
 * receiver skips, so an accepted message changes nothing at central; send-signed-malformed
 * leaves out the dbsync version, which the receiver cannot process. name=value pairs are set
 * as message properties (JMSReplyTo=<address> sets the reply destination), and a queue://
 * address is sent to as a queue. abandon receives and
 * disconnects without acknowledging, as a crashing receiver does.
 */
public class OpenWireProbe {

	public static void main(String[] args) {
		String url = args[0];
		String mode = args[1];
		String topicName = args[2];
		try {
			ActiveMQConnectionFactory factory = new ActiveMQConnectionFactory(url);
			switch (mode) {
				case "send":
					send(factory, topicName, "hardening-probe", Arrays.copyOfRange(args, 3, args.length));
					break;
				case "send-signed":
				case "send-signed-malformed":
					Security.addProvider(new BouncyCastleProvider());
					SenderEncryptionProperties keys = new SenderEncryptionProperties();
					keys.setKeysFolderPath(args[3]);
					keys.setPassword(args[4]);
					keys.setUserId(args[5]);
					keys.setReceiverUserId(args[6]);
					String payload = "{\"tableToSyncModelClass\":\"org.openmrs.eip.dbsync.model.UserModel\","
					        + "\"model\":{\"uuid\":\"a4f30a1b-5eb9-11df-a648-37a07f9c90fb\"},"
					        + "\"metadata\":{\"sourceIdentifier\":\"" + args[7] + "\",\"operation\":\"u\""
					        + ("send-signed".equals(mode) ? ",\"dbSyncVersion\":\"4.0.0\"" : "") + "}}";
					String body = "sender:" + args[5] + "\n" + new PGPEncryptService(keys).encryptAndSign(payload);
					send(factory, topicName, body, Arrays.copyOfRange(args, 8, args.length));
					break;
				case "consume":
					try (Connection connection = factory.createConnection()) {
						connection.start();
						Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
						session.createConsumer(destination(session, topicName)).close();
						System.out.println("RESULT CONSUMER_CREATED");
					}
					break;
				case "subscribe":
					try (Connection connection = factory.createConnection()) {
						connection.setClientID(args[3]);
						connection.start();
						Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
						Topic topic = session.createTopic(topicName);
						Message message = session.createDurableSubscriber(topic, args[4]).receive(Long.parseLong(args[5]) * 1000L);
						if (message == null) {
							System.out.println("RESULT NO_MESSAGE");
						} else {
							StringBuilder properties = new StringBuilder();
							for (Object name : Collections.list(message.getPropertyNames())) {
								properties.append(' ').append(name).append('=').append(message.getObjectProperty((String) name));
							}
							System.out.println("RESULT RECEIVED" + properties);
						}
					}
					break;
				case "abandon":
					int attempts = Integer.parseInt(args[5]);
					for (int i = 1; i <= attempts; i++) {
						Connection connection = factory.createConnection();
						connection.setClientID(args[3]);
						connection.start();
						Session session = connection.createSession(false, Session.CLIENT_ACKNOWLEDGE);
						Message message = session.createDurableSubscriber(session.createTopic(topicName), args[4]).receive(5000L);
						connection.close();
						if (message == null) {
							System.out.println("RESULT WITHDRAWN_AFTER " + (i - 1));
							return;
						}
					}
					System.out.println("RESULT STILL_DELIVERED_AFTER " + attempts);
					break;
				default:
					System.out.println("RESULT FAILED unknown mode " + mode);
					System.exit(2);
			}
		}
		catch (JMSException e) {
			Throwable root = e;
			while (root.getCause() != null && root.getCause() != root) {
				root = root.getCause();
			}
			String detail = e.getMessage() + " | " + root.getClass().getSimpleName() + ": " + root.getMessage();
			boolean refused = e instanceof jakarta.jms.JMSSecurityException
			        || detail.matches("(?s).*(AMQ22903[12]|permission|not authori[sz]ed|Unable to validate).*");
			System.out.println((refused ? "RESULT REFUSED " : "RESULT FAILED ") + detail);
			System.exit(3);
		}
	}

	private static Destination destination(Session session, String address) throws JMSException {
		return address.startsWith("queue://") ? session.createQueue(address.substring("queue://".length()))
		        : session.createTopic(address);
	}

	private static void send(ActiveMQConnectionFactory factory, String address, String body, String[] properties)
	        throws JMSException {
		try (Connection connection = factory.createConnection()) {
			Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
			TextMessage message = session.createTextMessage(body);
			for (String property : properties) {
				String name = property.substring(0, property.indexOf('='));
				String value = property.substring(property.indexOf('=') + 1);
				if ("JMSReplyTo".equals(name)) {
					message.setJMSReplyTo(destination(session, value));
				} else {
					message.setStringProperty(name, value);
				}
			}
			session.createProducer(destination(session, address)).send(message);
			System.out.println("RESULT SENT");
		}
	}
}
