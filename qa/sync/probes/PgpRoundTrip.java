import java.security.Security;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.openmrs.eip.dbsync.config.ReceiverEncryptionProperties;
import org.openmrs.eip.dbsync.config.SenderEncryptionProperties;
import org.openmrs.eip.dbsync.service.security.PGPDecryptService;
import org.openmrs.eip.dbsync.service.security.PGPEncryptService;

/**
 * Runs a payload through dbsync's own PGP services, exactly as the sender and receiver
 * routes do: sign and encrypt with the facility's key folder, prefix the sender header,
 * then verify and decrypt with the receiver's key folder. Used by
 * qa/sync/verify-hardening.sh to prove the generated keys and user ids work, and that a
 * message is only accepted when signed by the key its header names.
 *
 *   java PgpRoundTrip <facilityKeysDir> <facilityPass> <facilityUserId>
 *                     <receiverKeysDir> <receiverPass> <receiverUserId> [claimedSenderUserId]
 *
 * Prints RESULT VERIFIED, RESULT MISMATCH or RESULT REJECTED <reason>.
 */
public class PgpRoundTrip {

	public static void main(String[] args) {
		Security.addProvider(new BouncyCastleProvider());
		String payload = "{\"model\":{\"uuid\":\"pgp-round-trip\"}}";
		try {
			SenderEncryptionProperties sender = new SenderEncryptionProperties();
			sender.setKeysFolderPath(args[0]);
			sender.setPassword(args[1]);
			sender.setUserId(args[2]);
			sender.setReceiverUserId(args[5]);

			ReceiverEncryptionProperties receiver = new ReceiverEncryptionProperties();
			receiver.setKeysFolderPath(args[3]);
			receiver.setPassword(args[4]);

			String claimed = args.length > 6 ? args[6] : args[2];
			String message = "sender:" + claimed + "\n" + new PGPEncryptService(sender).encryptAndSign(payload);
			String decrypted = new PGPDecryptService(receiver).verifyAndDecrypt(message);
			System.out.println(payload.equals(decrypted) ? "RESULT VERIFIED" : "RESULT MISMATCH");
		}
		catch (RuntimeException e) {
			Throwable root = e;
			while (root.getCause() != null && root.getCause() != root) {
				root = root.getCause();
			}
			System.out.println("RESULT REJECTED " + e.getMessage() + " | " + root.getClass().getSimpleName() + ": " + root.getMessage());
			System.exit(3);
		}
	}
}
