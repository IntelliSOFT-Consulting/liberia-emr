import jakarta.jms.Connection;
import jakarta.jms.JMSException;
import jakarta.jms.Message;
import jakarta.jms.Session;
import jakarta.jms.Topic;
import java.util.Collections;
import org.apache.activemq.ActiveMQConnectionFactory;

/**
 * OpenWire client for qa/sync/verify-hardening.sh, using the ActiveMQ client bundled in the
 * dbsync sender so every refusal is one the real apps would meet. TLS comes from the
 * javax.net.ssl system properties, as in the sync entrypoints. Prints one RESULT line.
 *
 *   send      <url> <topic>
 *   consume   <url> <topic>
 *   subscribe <url> <topic> <clientId> <subscription> <timeoutSeconds>
 *   abandon   <url> <topic> <clientId> <subscription> <attempts>
 *
 * abandon receives and disconnects without acknowledging, as a crashing receiver does.
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
					try (Connection connection = factory.createConnection()) {
						Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
						session.createProducer(session.createTopic(topicName)).send(session.createTextMessage("hardening-probe"));
						System.out.println("RESULT SENT");
					}
					break;
				case "consume":
					try (Connection connection = factory.createConnection()) {
						connection.start();
						Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
						session.createConsumer(session.createTopic(topicName)).close();
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
}
