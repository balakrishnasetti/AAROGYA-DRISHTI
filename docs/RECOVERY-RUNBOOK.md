# Backup and recovery runbook

This runbook is an operational checklist. The application does not create database or object-storage backups by itself. Before production, the operator must configure encrypted, access-controlled backups for MongoDB, private object storage, and the encryption-key recovery material.

## Required preparation

1. Assign an on-call service owner and a backup custodian. Separate backup access from routine application-admin access.
2. Set and test an approved recovery point objective (RPO) and recovery time objective (RTO) with the deploying institution.
3. Configure automated MongoDB backups and private-object-storage backups/versioning in the hosting provider. Encrypt backups in transit and at rest.
4. Store `DATA_ENCRYPTION_KEY` and database/object-storage credentials in a separate secrets manager with dual-control recovery. Never include the raw key in database backups, code, or this runbook.
5. Keep backup manifests with timestamps, dataset identifiers, encryption-key version identifiers, integrity checksums, and the operator who initiated the job. Do not put patient names or clinical values in manifests.
6. Test restoration in an isolated environment at least quarterly and after any storage or key-rotation change.

## Restore procedure

1. Declare the incident, record its start time, and notify the service owner, privacy/security contact, and affected institution under its incident process.
2. Disable writes or route traffic to a maintenance response. Preserve the affected database, logs, and storage metadata for investigation; do not overwrite evidence.
3. Identify the last known-good, integrity-checked backup for MongoDB and private objects. Confirm the required encryption-key version is available from the secrets manager.
4. Restore the database and objects into an isolated recovery environment. Apply access controls before connecting application services.
5. Verify database indexes, object counts/checksums, session revocation state, audit-log availability, and application decryption of a small approved test fixture. Never use real patient content for an unapproved test.
6. Run the server and client test suites and a privacy/security smoke test. Confirm unauthorized patient access is denied and logged, role-changed sessions cannot refresh, and stored encrypted fields can be read with the approved key.
7. Obtain service-owner and privacy/security approval before switching production traffic to the restored environment.
8. Revoke compromised credentials, rotate keys when exposure is suspected, invalidate sessions, and document the impact and recovery actions.
9. Preserve incident and restore evidence under the institution's approved retention schedule. Record any data gaps and notify affected parties when required.

## Key-loss or key-rotation warning

Encrypted field values cannot be recovered without the matching key. Do not rotate or replace `DATA_ENCRYPTION_KEY` without a tested re-encryption migration and verified key backup. If a key is lost, stop processing affected records and escalate to the security/privacy owner; do not silently return ciphertext as plaintext.
