/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.identity;

import java.security.SecureRandom;

/**
 * The readable form of a Central Person Identifier, LR-XXXXX-XXXXX-C (sync-eip.md 2.5.1): ten
 * Crockford base32 characters from 50 random bits, then a check character. It carries no meaning;
 * the alphabet has no I, L, O or U, so it survives handwriting and dictation.
 */
public final class CpiCode {
	
	static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	
	/** Crockford's check symbols: the alphabet plus five more, for a modulus of 37. */
	static final String CHECK_ALPHABET = ALPHABET + "*~$=U";
	
	private static final SecureRandom RANDOM = new SecureRandom();
	
	private CpiCode() {
	}
	
	public static String generate() {
		return format(RANDOM.nextLong() & ((1L << 50) - 1));
	}
	
	static String format(long value) {
		char[] digits = new char[10];
		long rest = value;
		for (int i = 9; i >= 0; i--) {
			digits[i] = ALPHABET.charAt((int) (rest & 31));
			rest >>>= 5;
		}
		String body = new String(digits);
		return "LR-" + body.substring(0, 5) + "-" + body.substring(5) + "-" + CHECK_ALPHABET.charAt((int) (value % 37));
	}
	
	/**
	 * @return true when the text is a well-formed code whose check character matches; case and the
	 *         confusable letters are normalised first, as a human would have typed them
	 */
	public static boolean isValid(String text) {
		if (text == null) {
			return false;
		}
		String upper = text.trim().toUpperCase();
		if (!upper.startsWith("LR-")) {
			return false;
		}
		String normalised = "LR-" + upper.substring(3).replace('I', '1').replace('L', '1').replace('O', '0');
		if (!normalised.matches("LR-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z*~$=U]")) {
			return false;
		}
		String body = normalised.substring(3, 8) + normalised.substring(9, 14);
		long value = 0;
		for (char c : body.toCharArray()) {
			value = (value << 5) | ALPHABET.indexOf(c);
		}
		return normalised.charAt(15) == CHECK_ALPHABET.charAt((int) (value % 37));
	}
}
