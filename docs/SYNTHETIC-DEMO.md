# Synthetic data, reset, and demo accounts

Use synthetic data only. Do not enter real names, phone numbers, clinical histories, or photographs into the demo.

## Seed/reset

Demo seeding is opt-in. In `server/.env`, set `SEED_DEMO=true`, `DEPLOYMENT_ENV=development`, and a unique `SEED_STAFF_PASSWORD`; use a disposable local/test MongoDB database. Then run:

```powershell
npm run seed --workspace @aarogya/server
npm run reset --workspace @aarogya/server
```

Seed and reset refuse production configuration and refuse to run unless `SEED_DEMO=true`. Reset deletes and recreates records explicitly marked `isSynthetic: true`; append-only audit records are intentionally retained. The demo uses synthetic storage keys and does not upload photo objects. If testing against any non-local provider, separately clean provider-side test objects according to its retention policy. For staging, use `DEPLOYMENT_ENV=staging` and set `VITE_DEPLOYMENT_ENV=staging` plus `VITE_SEED_DEMO=true` for the client build. Production builds default demo UI and server seed operations off.

`MODEL_VALIDATED=false` is the default. Keep it false until clinical validation and approval are complete; the result UI then displays the demo/research-only warning and never labels model confidence as calibrated. Setting it true requires the server-side model URL, token, and version, but is not itself proof of regulatory or clinical approval. Results remain advisory and not for clinical use.

To add only the fictional oral-care directory, run:

```powershell
npm run seed:providers --workspace @aarogya/server
```

This separate, additive command also requires `SEED_DEMO=true`, is restricted to local MongoDB, and refuses to overwrite records that are not marked synthetic. It adds 5 fictional hospitals, 10 fictional PHCs, 20 pending demo dentist profiles across 8 specialties, and simulated availability for the next 14 days. It does not create patient records, administrator accounts, or send messages. Run it again safely to fill in missing synthetic directory records. The admin interface is at `/admin/providers` and requires an administrator account provisioned through the normal staff-seed process.

To prepare an ASR-only staff walkthrough with demo accounts and eligible synthetic dentists, run:

```powershell
npm run seed:asr-demo --workspace @aarogya/server
```

This idempotent, local-development-only command requires `SEED_DEMO=true` and `SEED_STAFF_PASSWORD`. It seeds the ASR synthetic provider directory, adds a hospital-manager assignment plus ASHA/health-worker, health-assistant (`navigator`), and district-administrator accounts, and activates the 20 synthetic dentist accounts. Accounts with no existing password receive the configured seed password and require a password change on first sign-in. Existing passwords are not reset. Dentist profiles and their placeholder credentials remain marked synthetic and pending; only the app's demo eligibility policy treats synthetic pending profiles as available. This is not professional credential verification, and the demo banner continues to indicate clinical services are unavailable. All ASR locations, names, credentials, and contact details are fictional placeholders, not actual facility or staff information.

If you need only a local demo administrator and do not want the broader synthetic patient seed, set a strong `SEED_STAFF_PASSWORD` in `server/.env` and run:

```powershell
npm run seed:admin --workspace @aarogya/server
```

This local-only command also requires `SEED_DEMO=true`; it creates one synthetic administrator without changing patient or provider records. It will not replace an existing administrator; the first sign-in requires a password change. The account is `admin@aarogya.synthetic.test`. It is not a production bootstrap command.

For a dashboard-only doctor login, set `SEED_DEMO=true` for the command and use the `SEED_STAFF_PASSWORD` configured in `server/.env`:

```powershell
$env:SEED_DEMO = "true"
npm run seed:demo-doctor --workspace @aarogya/server
Remove-Item Env:SEED_DEMO
```

This creates `SYN-DEMO-DOCTOR-001` (`demo.doctor@aarogya.synthetic.test`) only against a local MongoDB in development. It has no doctor profile, hospital or patient assignments, or call eligibility. The first sign-in requires changing the temporary password. It does not activate or verify any of the pending synthetic doctors.

## Synthetic staff accounts

All staff below use the temporary password configured as `SEED_STAFF_PASSWORD`; every seeded staff account requires a password change at first sign-in. After changing it, staff sign in with their staff ID, email, or phone and password. The development OTP provider is available only when `SEED_DEMO=true`, and only accepts the reserved synthetic patient phone range. These are demo-only records and not pre-provisioned credentials. Never use development OTP delivery for real patient accounts.

Staff sign-in offers a public request form for hospital managers, doctors, health workers, health assistants, and district administrators. Requests do not create an account or grant access. A signed-in platform administrator must review and approve each request; approval creates an account with a one-time password that must be securely delivered to the verified applicant. Users must change it before proceeding. Doctor profiles remain pending professional verification even after account approval. Public requests cannot create platform administrators; those accounts must be provisioned by an existing platform administrator or the local-only seed process.

| Role              | Staff ID                                | Email                                                                     |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| Platform admin    | `SYN-ADMIN-001`                         | `admin@aarogya.synthetic.test`                                            |
| Hospital managers | `SYN-MANAGER-01`, `SYN-MANAGER-02`      | `manager1@aarogya.synthetic.test`, `manager2@aarogya.synthetic.test`      |
| Doctors           | `SYN-DOCTOR-01` through `SYN-DOCTOR-06` | `doctor1@aarogya.synthetic.test` through `doctor6@aarogya.synthetic.test` |
| Health worker     | `SYN-HEALTH-WORKER-01`                  | `health-worker@aarogya.synthetic.test`                                    |
| Navigator         | `SYN-NAVIGATOR-01`                      | `navigator@aarogya.synthetic.test`                                        |
| District officer  | `SYN-DISTRICT-OFFICER-01`               | `district-officer@aarogya.synthetic.test`                                 |

Seeded patient accounts are `patient01@aarogya.synthetic.test` through `patient20@aarogya.synthetic.test` and use the development OTP flow; they have no shared password. Patient OTP flows must be completed interactively.

## Suggested walkthrough

1. Start the server and client; verify the persistent simulation-only banner and switch between English and Telugu.
2. Use the synthetic health worker to register a synthetic patient in its assigned catchment and grant the required screening consent.
3. Use the navigator to inspect operational queues and record a synthetic contact/transport/missed-visit activity.
4. Use the district officer to inspect aggregate counts; confirm that no patient names or groups below five are shown.
5. Use the manager and doctor accounts to demonstrate their distinct dashboards and access limits.
6. Use a patient account to open `/patient`, record screening consent, complete the questionnaire, and inspect the saved screening history. Photo and AI steps require real server-side Gemini configuration and private object storage; synthetic media keys are not downloadable photos.
7. If verified doctor availability and appointment slots are seeded, request a slot from the patient dashboard. Sign in as that doctor to confirm the appointment, review the case only when data-sharing consent is active, then create a signed note, referral, and follow-up. Release a note to make it visible to the patient.

This is a simulation walkthrough, not a production-ready clinical journey. Provider-backed video calling and real clinical care are not available. Never use real patient information or photos.

## Synthetic patient workflow showcase

When demo mode is enabled, the `/demo/patient-cases` page and patient dashboard demo panel contain 20 fictional, read-only case examples. They demonstrate sample profiles, questionnaire responses, image-quality states, non-diagnostic result categories, scripted assistant guidance, and simulated appointment/referral/follow-up/report history in English and Telugu. These fixtures are client-side examples and do not create or modify database patient records, contact anyone, create appointments, or call the AI service. Demo mode is disabled by default.

The public demo page includes a patient lookup for the 20 supplied `AD-DEMO-*` examples. Records are hidden until someone enters an exact demo patient ID, case ID, or full name; only the matching record is shown. They are stored in `client/src/pages/patient/syntheticReferenceDataset.js` as read-only client fixtures; they are not inserted into MongoDB or used to train or run a model. The interface labels them synthetic and not for clinical use. Treat these examples as synthetic only; do not publish personal or real patient information in this static demo.

Each visual is a schematic SVG illustration generated by the UI, not a clinical photograph. The images are not stored, uploaded, or analyzed; their displayed quality state is simulated. All cases and visuals must remain labeled `SYNTHETIC DEMO DATA – NOT FOR CLINICAL USE`. Do not replace these illustrations with real patient or actual oral-cancer photos.
