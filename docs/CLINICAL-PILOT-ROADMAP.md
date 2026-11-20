# Roadmap to a clinical pilot

This project is not approved for real-patient care. A pilot is a future possibility, not a deployment recommendation.

## Required gates

1. **Governance:** obtain applicable health-authority approval, institutional ethics review, data-protection/legal review, and documented clinical ownership before collecting real patient data.
2. **Clinical safety:** define intended use, contraindications, escalation paths, clinician oversight, adverse-event handling, Telugu/English content review, and independent validation. AI output must never diagnose or delay urgent care.
3. **Security and privacy:** commission an independent security review and penetration test; close findings; verify consent, access logging, data-subject requests, retention/deletion, encryption and key rotation, backups, restore, incident response, and vendor agreements.
4. **Infrastructure:** deploy to a managed, monitored environment with TLS, least-privilege secrets, encrypted database and object storage, availability/recovery targets, tested rollback, and alert ownership.
5. **Product completeness:** complete patient screening, capture quality checks, secure image access, appointment/urgent workflows, video participation controls, doctor case review and released notes, and multilingual accessibility.
6. **Validation:** run role/RBAC and consent regression tests, full Playwright patient and offline journeys, accessibility testing against the agreed target, load/failure testing, and independent model evaluation. Publish evidence and limitations.
7. **Controlled rollout:** begin with synthetic data, then only an approved limited cohort, staff training, informed consent, human oversight, monitoring, and a pre-approved stop/rollback plan.

No stage should be skipped on the basis of a passing unit-test suite. Record gate owners, approvals, evidence, and residual risks before proceeding.
