# Phase 15 delivery checklist

Status reflects repository evidence at the time of this document. "Done" means present in code or documentation, not clinically approved or production deployed.

## Done

- [x] Existing Node built-in test runner and Supertest-free HTTP tests remain in use; CI runs the existing API/client tests.
- [x] CI runs lint, tests, client build, and npm dependency audit at high severity.
- [x] CI builds the server and client Docker images for pull requests and publishes SHA-tagged images to GHCR on pushes to `main`.
- [x] Dockerfiles, local Compose stack, API health endpoint, privacy/governance document, and recovery runbook are present.
- [x] Added architecture/schema overview, install instructions, a partial OpenAPI snapshot, Gemini limitations, security/access matrix, synthetic reset/demo guidance, third-party/license disclosure, and clinical pilot roadmap.
- [x] Synthetic demo seeding includes test accounts for all seven roles, with a forced first password change for staff.

## Partly done

- [ ] Security and AI tests exist, but full RBAC/care-relationship/consent coverage across every route and the requested slot concurrency, sync, audit immutability, and safety cases are not all established as a complete certification suite.
- [ ] Existing client tests cover localization catalog parity, but React component tests for forms, language switching interactions, and an avatar state machine are not in place.
- [ ] No Playwright browser suite exists; the complete OTP-to-screening-to-AI-to-booking-to-video-to-released-notes journey and offline/failure scenarios have not been automated.
- [ ] OpenAPI is a manually maintained partial reference, not a generated or validated exhaustive API contract.
- [ ] Health checks and structured request logging exist, but production monitoring, alerting, anomaly detection operations, and deployment smoke tests are not configured.
- [ ] Image publishing is automated, but deployment/rollout to a production environment is not automated.
- [ ] Docker images exist, but production-ready Atlas, encrypted object storage, TLS termination, key management, backup, and restore configuration are operator responsibilities and unverified.
- [ ] Accessibility work and bilingual strings exist, but Lighthouse on a throttled mobile profile has not been run; the score target of 90 is unverified.
- [ ] Dependency audit is in CI and currently reports six low/moderate advisories in the client PWA build-tool dependency chain (no high-or-critical advisories); complete license/SBOM review and container vulnerability scanning remain outstanding.

## Not done

- [ ] No production deployment, MongoDB Atlas deployment, real provider setup, or backup-and-restore exercise has been performed.
- [ ] No independent security review or clinical/ethics/health-authority approval has been performed.
- [ ] No complete end-to-end browser journey, offline browser test, Lighthouse run, or SBOM/license audit result is available.
- [ ] No production-ready clinical pilot or claim of diagnostic performance is supported.

Do not treat this list as approval for real-patient use. See the [clinical pilot roadmap](CLINICAL-PILOT-ROADMAP.md).
