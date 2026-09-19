# Liberia EMR Module

## Description
This module provides backend APIs and services to support custom functionality for the Liberia EMR instance. It is designed to run on top of OpenMRS.

## Key Features

### Password Reset Flow
The module introduces a secure, automated password reset flow for users. It integrates with an external SMTP server (e.g., Gmail) to send time-limited password reset tokens to registered users.

#### Configuration
The password reset feature requires the following Global Properties to be configured in OpenMRS (typically set up via the Initializer module in `globalproperties-email.xml`):

- **`liberiaemr.email.host`**: SMTP server host (e.g., `smtp.gmail.com`)
- **`liberiaemr.email.port`**: SMTP server port (e.g., `587`)
- **`liberiaemr.email.username`**: The email address used to send emails.
- **`liberiaemr.email.password`**: The password or App Password for the email account. *(Note: For Gmail, you must use a generated "App Password" due to modern security policies; standard passwords will result in `535 5.7.8` auth failures).*
- **`liberiaemr.email.from`**: The "From" address displayed to the recipient.
- **`liberiaemr.frontend.url`**: The base URL to the frontend SPA (e.g., `http://localhost:8081/openmrs/spa`), used to construct the reset link.
- **`liberiaemr.passwordReset.tokenExpiryHours`**: (Optional) Number of hours a reset token is valid for. Defaults to `2`.

The system maps users to their email addresses using a `Person Attribute` named exactly `Email` or `email` (UUID: `2161f38e-dae2-4ea5-bbdc-ffea969a57dc` or `ed33ab8a-a9e7-11f1-a9fb-32828c73f1a5`).

#### REST Endpoints
The module exposes the following endpoints (bypassing standard OpenMRS REST authentication, but protecting against enumeration/abuse):

1. **Request Password Reset Link**
   - **URL:** `POST /ws/liberiaemr/passwordReset/request`
   - **Payload:** `{"email": "user@example.com"}`
   - **Response:** `200 OK` (Always returns success to prevent enumeration if payload is valid).
2. **Confirm Password Reset**
   - **URL:** `POST /ws/liberiaemr/passwordReset/confirm`
   - **Payload:** `{"token": "uuid-token", "newPassword": "NewStrongPassword1!"}`
   - **Response:** `200 OK` on success, or `400 Bad Request` if token is invalid/expired or if the password fails complexity rules.

#### Security Considerations
The password reset implementation adheres strictly to security best practices:

1. **User Enumeration Prevention:** 
   If a password reset is requested for an email address that does not exist in the database, the API will silently log the attempt and return a successful `200 OK` response to the frontend. This ensures that malicious actors cannot use the password reset endpoint to enumerate or guess which email addresses are registered in the system. The frontend will uniformly state: *"If an account exists with that email, a reset link has been sent."*
2. **Anonymous Access & Privilege Escalation:**
   The password reset API endpoints (`/ws/liberiaemr/passwordReset/*`) are exposed to anonymous users. To securely query the database and update passwords without a logged-in session, the `LiberiaEMRServiceImpl` briefly elevates privileges using `Context.addProxyPrivilege()`:
   - Requesting a link requires `Get Users` and `Get Global Properties`.
   - Confirming a reset requires `Edit Users`, `Edit User Passwords`, and `Get Global Properties` (needed to validate OpenMRS password complexity regex rules).
   All elevated privileges are strictly removed in `finally` blocks to prevent privilege leaking.
3. **Audit Logging:**
   Password reset attempts (successful, failed, or "email not found") are logged explicitly with an `AUDIT:` prefix in the OpenMRS logs for monitoring and compliance.
4. **Token Invalidation:**
   Reset tokens are stored in the database and are strictly single-use. They are voided immediately upon a successful password change, or if a user requests a new token, voiding all previous pending tokens for that user.

## Building from Source

You will need Java 8 and Maven 3.x. Use the command `mvn clean package` to compile and package the module. The `.omod` file will be in the `omod/target` folder.

## Installation

1. Build the module to produce the `.omod` file.
2. Drop the `.omod` into the `~/.OpenMRS/modules` folder (or deploy it into your Docker container's `/openmrs/data/modules/` directory).
3. Restart OpenMRS. The module and its REST endpoints will be loaded and started automatically.
