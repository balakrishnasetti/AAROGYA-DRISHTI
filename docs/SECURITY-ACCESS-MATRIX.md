# Security design and role access matrix

This is a repository-level design summary, not a penetration-test certification. The policy is deny by default: authenticated role checks are necessary but not sufficient for patient data; patient ownership, catchment, hospital scope, consent, or active care relationship must also be verified by the route.

## Role names and stored keys

The database retains the existing stable `User.role` enum values to avoid invalidating accounts and session records. The UI presents these role names:

| UI role | Stored role key |
| --- | --- |
| Patient | `patient` |
| Doctor | `doctor` |
| Health Worker (ASHA / field worker) | `health_worker` |
| Health Assistant | `navigator` |
| Hospital Administrator | `hospital_manager` |
| District Administrator | `district_officer` |
| Super Admin | `admin` |

Permissions are a source-controlled, deny-by-default catalogue in `server/src/security/rolePermissions.js`, not database-editable grants. Successful authentication returns the current role's permission keys for frontend navigation/route checks; the API independently enforces role, ownership, assignment, consent, and geographic scope. This avoids trusting client-provided permissions or granting privilege by editing a user profile.

## Permission matrix

`R` = read, `W` = create/update, `X` = export. Blank = denied.

| Feature | Patient | Doctor | Health Worker | Health Assistant | Hospital Admin | District Admin | Super Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Own profile, consent, screening, reports | R/W (self) | — | — | — | — | — | — |
| Patient clinical record and images | R/W (self, consent-gated) | R/W (assigned care only) | R/W (own field registration, consent-gated) | minimum coordination fields only | — | — | — |
| Appointments and calls | R/W (self) | R/W (assigned) | — | referral coordination only | R/W (own hospital) | — | platform metadata only |
| Clinical notes, screening review, referrals | — | R/W (assigned) | — | — | — | — | — |
| Field registration and offline sync | — | — | R/W (assigned catchment) | — | — | aggregate only | — |
| Referral and follow-up coordination | own status | R/W (assigned) | — | R/W (catchment; no clinical classification) | operational only | aggregate only | — |
| Hospital roster, slots, bookings | public discovery only | own schedule | — | — | R/W (assigned hospital) | — | facility administration |
| District screening/referral aggregates | — | — | — | — | — | R/X (assigned district; small cells suppressed) | aggregate platform view |
| User/role management, audit, system/model settings | — | — | — | — | own staff operations only | — | R/W (administrative metadata) |
| Emergency break-glass patient access | — | read-only with reason, time-limited | — | — | — | — | — |

The matrix summarizes intended/current boundaries, not a substitute for route middleware. The API permission catalogue includes dashboard, patient-self, assigned-clinical, field, coordination, hospital, district, and platform permissions. A negative case must be tested for every new patient-data route.

## Data model and scoping

| Collection/schema | Role/access fields and constraints |
| --- | --- |
| `users` (`User`) | `role` enum, status, account identifiers, district/mandal/PHC and administrator-assigned village list; never accept role or permission grants from public signup. |
| `hospitals` (`Hospital`) | Facility identity, district/mandal/village, active status, specialties and contact details. |
| `doctor_profiles` / `hospital_managers` | Verified doctor-to-hospital and active hospital-manager-to-hospital relationships. |
| `care_assignments` (`CareAssignment`) | Patient, hospital, assigned clinician, active/completed status; required for routine clinician access. |
| `field_registrations` (`FieldRegistration`) | Registering worker, patient, encrypted health data, village/mandal/PHC/district, consent references; worker reads own records and staff coordination queries require assigned villages. |
| `roles` and `permissions` | Defined as immutable role keys and permission keys in the application policy catalogue; not user-editable or stored as grant rows. |
| `sessions` / `audit_logs` / `break_glass_accesses` | Refresh-session lifecycle, append-only access audit, and reasoned, time-limited emergency grants. |

Hospital and field scopes are derived server-side from verified profile/assignment data; a client-supplied hospital or district ID cannot broaden access. Patient access, exports, denied access, and break-glass grants are audited.

Super Admins manage field-worker and health-assistant village assignments in user management. Catchment coordination queries fail closed when no village is assigned, so existing staff accounts must be assigned their villages before field workflows are used.

## Controls present in code

- Staff sign-in uses the assigned staff ID, email, or phone with a bcrypt-verified password. Patient registration and other explicitly separate verification flows retain their OTP checks. Staff accounts are created through administrator workflows; there is no public staff signup.
- JWT/session validation, refresh-token rotation, role checks and session revocation on role changes.
- Express Helmet headers, HSTS configuration, request rate limiting, Mongo operator sanitization, body limits, and production HTTPS enforcement.
- Patient access auditing and append-only audit model; request logger redacts credentials and excludes query values and request bodies.
- Application encryption for sensitive fields, private storage adapters, consent gates, and audited break-glass/governance flows.
- Catchment-limited field registration, HMAC duplicate matching, idempotent offline operation IDs, and district small-cell suppression.

These controls require production configuration and operational monitoring. The local Compose stack does not provide production TLS, managed encryption keys, multi-zone database availability, or backups.

## Remaining verification

The repository's automated tests are not a substitute for an independent security assessment. Before real-patient use, run and retain evidence for IDOR/role checks across every route, NoSQL injection, malicious upload/polyglot handling, signed-link expiry/replay where signed URLs are enabled, retention/deletion requests, encryption-key rotation, log review, backup restore, rate limits, and dependency/container scanning. See [privacy and governance](PRIVACY-AND-GOVERNANCE.md).
