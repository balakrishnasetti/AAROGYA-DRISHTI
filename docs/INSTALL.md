# Install and configuration

## Local development

Requirements: Node.js 22+, npm, and MongoDB 7+ (or Docker Desktop for the Compose option).

```powershell
npm ci
Copy-Item server\.env.example server\.env
```

Set distinct, randomly generated `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values of at least 32 characters. Keep `.env` files out of source control. Configure the Mongo URI, CORS client URL, encryption keys, and provider credentials only as needed. Do not use real patient information or production credentials in a development environment.

Start a local MongoDB instance, then run `npm run dev`. Development uses a private directory at `server/private-storage` by default; the API creates it on startup and does not serve it as static content. The web client uses `http://localhost:5173`; the API listens on `http://localhost:4000`. Run `npm test` and `npm run lint` before opening a change.

## Local container stack

The root `docker-compose.yml` runs MongoDB, MinIO, the API, and Nginx client. Create `server\.env` first, then run `docker compose --env-file server\.env up --build`; Compose initializes a private MinIO bucket, and the app is available at `http://localhost:8080`. Compose persists local Mongo and MinIO data in named volumes. This is for development/demo only: the published endpoint uses HTTP, the database is a single local container, and it has no managed backup, HA, TLS certificate automation, or production secrets management.

## Environment and optional integrations

`server/.env.example` is the canonical list of server variables. Provider integrations remain optional and should be disabled until their server-side credentials, privacy terms, failure behavior, and test coverage have been reviewed. Gemini requires `GEMINI_API_KEY`. The voice/chat assistant uses the Anthropic Messages API; set `ANTHROPIC_API_KEY` in `server/.env` and optionally set `ANTHROPIC_MODEL` (defaults to `claude-haiku-5-5`). The key is only read by the server.

The assistant requires an authenticated patient account and active AI-processing consent. Voice recognition depends on Web Speech support and browser microphone permission; typed chat remains available where voice recognition is unavailable. The “Hey Aarogya” wake phrase is off by default and requires an explicit opt-in. See [the assistant privacy and action boundaries](ARCHITECTURE.md#patient-ai-assistant).

Set `STORAGE_BACKEND=local` and `LOCAL_STORAGE_DIR=./private-storage` for local development without Docker. The API creates the folder at startup, restricts files to the server process, and serves images only through authenticated routes. To use AWS S3 or MinIO, set `STORAGE_BACKEND=s3`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, and `STORAGE_SECRET_KEY`; leave `STORAGE_ENDPOINT` empty for AWS's native endpoint. For S3, create a private bucket with Block Public Access enabled and an IAM identity limited to the required object operations. MinIO Compose creates the configured bucket and disables anonymous access. The app sends server-side encryption on uploads. Never add provider credentials to `VITE_` variables or share them in chat.

Patient camera capture requires an HTTPS origin (localhost is allowed by browsers). Patients must have active screening and imaging consent and affirm the per-photo capture/upload checkbox before camera access or file selection is enabled. AI-processing consent is separately required for automated advisory review. The guided flow checks blur and brightness in the browser, compresses each image to at most 1,000,000 bytes, and asks the patient to confirm the mouth area is visible; that last check is a manual confirmation, not automated mouth-detection software. The API revalidates the image and strips metadata while normalizing it. Files stay in the configured private backend: local development uses a non-static local folder, while S3 uploads use server-side encryption. Without active AI consent or `GEMINI_API_KEY`, photo storage still works but no AI report is generated. Patients can permanently delete their stored image; any associated advisory report text remains in the screening record.

### Patient QR access

No additional secret is needed for patient QR access. A patient explicitly generates a temporary QR from the patient dashboard; it expires in five minutes, is single-use, and can be revoked or replaced. The QR encodes only a random opaque token, never patient data. MongoDB TTL indexes clean up expired grants asynchronously; the API still checks expiry, revocation, and consumption atomically on every scan.

The in-app scanner is in the doctor workspace and requires a secure camera context (HTTPS or localhost). A scan only reveals the read-only summary to a doctor who has an active assignment to that patient and for whom the patient's latest data-sharing consent remains active. All scan outcomes are recorded in the append-only QR audit collection. Keep the QR private and do not print/share it beyond the short visit window.

### Experimental oral-image model service (not clinically validated)

The API's oral model adapter is disabled unless both `ORAL_MODEL_API_URL` and `ORAL_MODEL_API_TOKEN` are set in `server/.env`. The token is only shared server-to-server. The standalone FastAPI service is in `model-service`; it expects:

- `MODEL_API_TOKEN`: same secret configured as the Express `ORAL_MODEL_API_TOKEN`.
- `ORAL_MODEL_VERSION`: immutable release identifier.
- `ORAL_SEGMENTATION_WEIGHTS`: TorchScript model returning one oral-area foreground mask.
- `ORAL_CLASSIFIER_WEIGHTS`: ResNet18 state dictionary trained for the exact five classes in the adapter.

The current service does not ship trained weights. It returns not-ready and the patient app stores photos without a classifier result until valid artifacts are installed. Set `ORAL_MODEL_API_URL` to the private service URL reachable only from the API, such as `http://oral-model:8000`; do not publish the model port or add its token to client variables. `model-service/Dockerfile` is a CPU reference image; production needs private networking, request limits, monitoring, pinned artifact checksums, and a reviewed deployment process.

The classifier, segmentation, Grad-CAM, confidence, and questionnaire risk thresholds are not clinically validated. Do not treat them as clinical decision support. Validate intended-use visible-light photographs with clinician-confirmed reference labels, patient-level and external-site splits, sensitivity/specificity and confidence intervals, calibration/abstention, and performance across skin tones, sites, devices, ages, sex, and oral regions before any clinical use. Cytology-image sets are not substitutes for mouth photographs. Refer to [the model architecture and evaluation notes](ARCHITECTURE.md#experimental-oral-image-model-adapter) before selecting research data.

## Production deployment gate

The `Container images` workflow builds images for PRs and publishes SHA-tagged images to GitHub Container Registry on pushes to `main`. It does not roll out to a cluster or cloud account. Before production, operators must provision a supported MongoDB deployment (including TLS, auth, backups and tested restore), private encrypted object storage, secret/key management, HTTPS termination, monitoring and alerting, and a deployment/rollback process. Configure the trusted HTTPS reverse proxy to provide exactly one forwarded hop and `X-Forwarded-Proto: https`; the API rejects insecure production requests. Complete the [recovery runbook](RECOVERY-RUNBOOK.md) in the target environment.

No Atlas, cloud object store, real SMS/email provider, or production hosting environment was exercised as part of this repository work.

### Appointment booking

The appointment flow uses the existing hospital/doctor directory and stored `TimeSlot` records. An admin can set doctor specialty/fee and add or disable future slots in the admin console. Patients can submit requests, choose in-person consultation and pay at hospital, cancel or request a new time, and download a PDF receipt with a signed check-in QR. Doctor check-in is restricted to that doctor's confirmed/accepted appointment and is recorded in the audit log. An hourly job queues in-app reminders for appointments about 24 hours away.

Before deploying the changed active-appointment uniqueness rule, back up MongoDB and replace the old full index once using `db.appointments.dropIndex("doctorId_1_slotStart_1")`; then restart with Mongoose index creation enabled and verify the partial unique index. Razorpay/UPI, appointment email/SMS/WhatsApp delivery, and browser video calls need separate provider credentials/integrations and are not enabled by this implementation. Do not promise external notifications or video service until those are configured and tested.

### Hospitals map and navigation

The patient Hospitals tab uses Leaflet/OpenStreetMap map tiles; it requires internet access for tiles but no browser map key. Location permission is requested only after the user presses the location button; manual city/district search is available as fallback. For in-app route steps and distance/ETA, enable Google Maps Directions API in a Google Cloud project, configure billing/quotas, and set `MAPS_KEY` in `server/.env`. Restrict this key to the Directions API and your API server's fixed source IPs; never place it in `VITE_` variables or the client bundle. The app asks before forwarding origin/destination coordinates to Google for route preview. Google Maps itself handles turn-by-turn navigation after the patient presses Start Navigation.

Existing hospital records that already contain latitude/longitude should be backfilled into GeoJSON before nearby search is enabled: from the server workspace run `npm run migrate:hospital-geo`. This migration only fills missing `location` points from valid existing coordinates; back up the database and verify the result in your environment.

The `npm run seed:providers` local-only seed includes fictional demonstration hospitals/PHCs in Alluri Sitarama Raju District, Andhra Pradesh. The approximate demo map points and all provider names/contact details are synthetic; ratings are blank and navigation is disabled for those records. Do not use them to direct actual patients. Add facilities only from a verified, authorized directory and validate each address, phone, hours, coordinates, ownership, and rating before enabling real-world use.
