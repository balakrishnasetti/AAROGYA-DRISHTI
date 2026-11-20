# Privacy and governance

This document describes the current application controls and the operational decisions that must be completed before production use. It is not a legal compliance certification.

## Data inventory and purpose

| Data | Examples | Purpose | Storage and controls |
|---|---|---|---|
| Account and session data | Name, email/phone, role, refresh-session hash, role snapshot | Authentication and account management | Passwords and tokens are hashed; sessions expire and are revoked on role change. Avoid placing identifiers in application logs. |
| Patient credential enrollment | Hashed registration OTP/password challenge or hashed staff-issued setup token | Verify a mobile number before self-registration, or support in-person account activation | Registration OTPs expire after five minutes and use existing send/attempt limits. Staff-issued tokens are single-use, expire after 30 minutes, are scoped to the issuing worker's registration, and are audited. OTP is not used for patient sign-in. |
| Patient profile | Date of birth, sex at birth, district, language | Patient profile and care workflow | Selected profile fields are encrypted with AES-256-GCM at the application layer. Production requires `DATA_ENCRYPTION_KEY`. |
| Consent records | Consent kind, text version, language, grant/withdrawal timestamps | Record patient choices and enforce feature gates | Historical consent records are retained; withdrawal does not rewrite a prior grant. |
| Clinical records | Questionnaire answers, screening session, image metadata, AI reports, appointments, consultation notes, uploaded-report metadata | Screening and care access | Sensitive questionnaire answers are encrypted at the application layer. Uploaded objects use private object storage with server-side encryption where configured. Access is role/care-assignment gated and audited. |
| Operational data | Notifications, sync operations, provider status | Deliver platform functions | Messages should use generic templates and must not contain condition names or clinical details. |
| Security and audit data | Actor, action, resource ID, time, request ID, severity | Investigate access, denial, exports, emergency access, and anomalies | Append-only audit records; logs omit request bodies and redact record IDs from route paths. |
| Governance requests | Patient correction/deletion request and review | Review patient rights requests | Request reasons and requested field values are encrypted at the application layer; review is administrator-approved. |
| Field-work registrations | Catchment, tobacco/areca history, symptoms, five photo-view keys, consent references | Community registration and follow-up | Health answers and profile locations are encrypted; duplicate detection uses a keyed HMAC; images go to private object storage only after imaging consent. |
| Investigation and navigation records | Investigation state, clinician classification, contact/transport/missed-visit events | Track referral follow-through and clinical review | Classification changes require an assigned clinician; activity details are encrypted; overdue escalations are claimed once. |

## Purposes and access matrix

| Role | Own account/profile | Own clinical records | Assigned patient records | Operational administration | Audit/governance |
|---|---:|---:|---:|---:|---:|
| Patient | Yes | Yes | No | No | Own access history and requests |
| Doctor | Yes | No | Active care assignment only; otherwise a time-limited, read-only break-glass grant | No | Access is audited; emergency grants alert admins and the primary doctor |
| Hospital manager | Yes | No clinical history | Only scoped hospital operational records allowed by the route | Assigned hospital only | No platform audit export |
| Administrator | Yes | No clinical history by default | No routine clinical access | Platform configuration | Audit viewer/export and governance approval |
| Health worker | Yes | No general clinical history | Own registrations only | Assigned catchment registration | No |
| Navigator | Yes | No general clinical history | Scoped referral coordination | Catchment queue capped at 50 per resource | Actions are audited |
| District officer | Yes | No clinical records | No identifiable records | District aggregate only | Aggregate CSV audited; values below five suppressed |

Patient routes deny by default. Failed care-relationship checks are audited. Break-glass access requires a reason of at least 20 characters, lasts at most 30 minutes, is read-only, and creates a high-severity audit event.

## Retention schedule

The following is the current technical state plus a proposed operational baseline. Clinical retention durations must be approved by the relevant health authority, privacy counsel, and the deploying institution before any deletion schedule is enabled.

| Record | Current technical expiry | Proposed policy / action |
|---|---|---|
| Patient registration and activation challenges | Registration OTP validity is five minutes; staff activation validity is 30 minutes; both have TTL indexes | OTPs and activation codes are single-use hashes; verify TTL cleanup in production. |
| Authentication sessions | TTL index on `expiresAt`; refresh lifetime is seven days; 30-minute idle timeout | Revoke on logout, role change, disablement, or idle expiry. |
| Break-glass records | No automatic deletion | Preserve for the approved audit period; mark expired/revoked after access ends. |
| Security anomaly alerts | 90-day TTL index | Review operationally and adjust only with an approved retention policy. |
| Audit logs | No automatic deletion | Proposed seven-year minimum pending local legal approval; protect backups and exports equally. |
| Patient clinical data, images, reports, consent history | No automatic deletion | Institution-specific period is **TBD**; do not enable automatic purge until approved and documented. |
| Governance requests | No automatic deletion | Retain with the corresponding patient-rights audit history for an approved period. |
| Private object storage | No automatic deletion policy in application code | Configure a private-bucket lifecycle only after the clinical retention schedule is approved. |

Deletion requests are queued and require administrator approval. Approval disables the patient account and revokes sessions; it does not purge clinical data. Any eventual erasure must account for legal holds, audit requirements, encrypted backups, and restoration behavior.

## Encryption, transport, and logging

- Production startup requires a dedicated `DATA_ENCRYPTION_KEY` of at least 32 characters. Keep it in a secrets manager, never in source control or backups stored beside the database.
- AES-256-GCM protects selected patient-profile fields, sensitive questionnaire answers, governance reasons/values, and break-glass reasons. Existing plaintext values are read as legacy values; plan a controlled migration before treating all historical data as encrypted.
- Production requests require HTTPS; HSTS is sent with a one-year max-age, subdomains, and preload. The deployment must terminate TLS at a trusted reverse proxy and configure that single trusted hop correctly.
- Private object storage uses server-side AES256 encryption and authenticated server-side reads. Application responses set `Cache-Control: private, no-store` for private document streams. Do not make the bucket public. The application currently does not issue presigned object URLs; if introduced, cap expiry at five minutes and bind access to authorization.
- Request logs omit bodies and query strings; route IDs are redacted. Do not add names, phone numbers, clinical answers, consent text, or emergency reasons to log metadata.

## Additional controls and known gaps

- Identifiable list responses are capped at 50 records. Audit CSV export is capped at 50 and is itself audited.
- Route-group rate limits supplement the API-wide limit. Monitor `security_alerts` and admin notifications for unusual patient-record access.
- The client must not cache authentication responses or patient-specific API data. Only public hospital/doctor discovery responses are eligible for stale-while-revalidate caching.
- Field-worker offline registration payloads are encrypted in IndexedDB and replayed to the field-registration endpoint with a stable operation ID. The server enforces idempotency and keyed duplicate detection. Device-local encryption keys are not hardware-bound and do not replace device security.
- District analytics group registration, screening, referral, and investigation counts. Output and CSV omit patient names/IDs; groups and funnel cells below five are suppressed. Navigator queues are geographically scoped and capped at 50.
- Investigation classifications are accepted only from clinicians with an active care assignment, after a report is received. A 15-minute job uses an atomic escalation timestamp to prevent repeat notifications.
- Production object-storage privacy, provider-side backup encryption, key rotation, backup verification, and independent penetration testing require deployment-level configuration and evidence; they cannot be inferred from a passing application build.
- Real-patient use requires health-authority approval, ethics review, and an independent security review. This simulation is not certified for clinical use.
