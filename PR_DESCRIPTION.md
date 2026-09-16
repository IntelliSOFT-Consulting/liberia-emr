## Requirements

- [x] This PR has a title that briefly describes the work done including the ticket number.
- [x] My work is based on designs, which are linked or shown either in the Jira ticket or the description below.
- [x] My work includes tests or is validated by existing tests.

## Summary

This PR introduces the custom **LiberiaEMR Login App** (`@liberiaemr/esm-liberia-login-app`), cloned and heavily extended from the core OpenMRS login application. It lays the frontend foundation for advanced authentication flows, including Multi-Factor Authentication (MFA) and Self-Service Password Reset.

*(Note: `config-core.json` and `distro.properties` have been explicitly excluded from this PR's context).*

---

## Changes Made & Additions (Not in Core OpenMRS)

While this app started as a clone of `@openmrs/esm-login-app`, several major additions and custom screens were built out specifically for LiberiaEMR:

### 1. New Custom Authentication Screens
- **Forgot Password (`forgot-password.component.tsx`)**: A new screen allowing users to request a password reset link by entering their username or email. Includes Carbon Form validation and error state handling.
- **Reset Password (`reset-password.component.tsx`)**: A dedicated screen to consume a UUID token (from an email link) allowing the user to securely set and confirm a new password.
- **MFA Verification (`mfa/mfa-verify.component.tsx`)**: A brand new intermediary login screen that acts as a placeholder for a 6-digit SMS verification code, preparing the UI for the future SMS backend integration.

### 2. UI/UX Consistency & Layout Fixes
- **Global Footer Injection**: Ensured the OpenMRS footer ("Built with... An open-source medical record system") is consistently injected across *all* screens (including the new Forgot Password and Reset Password screens).
- **Change Password Alignment (`change-password.component.tsx`)**: Fixed the `min-height` container alignment issues in the SCSS so the change password screen perfectly mirrors the exact dimensions and layout of the main login card.

### 3. Stability & TypeScript Fixes
- Resolved outstanding TypeScript compilation and type-checking errors across the test suites that were inherited during the clone:
  - Fixed DOM assertions in `change-password.test.tsx`.
  - Mocked the `fhir` namespace correctly in `location-picker.test.tsx`.
  - Safely typed `window.applicationVersion` in `login.component.tsx`.

### 4. Routing Updates
- Configured the custom `react-router-dom` definitions to seamlessly mount the new paths (`/forgot-password`, `/reset-password`, `/change-password`, `/mfa-verify`) alongside the standard login flow.
