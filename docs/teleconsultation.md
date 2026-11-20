# Teleconsultation and call requests

## Architecture

Patient call requests use the `consultation_requests` collection. A request is assigned to one eligible doctor; choosing “Any available doctor” assigns an eligible doctor with the fewest unexpired pending call requests. Requests expire after 24 hours. The lifecycle is `pending` → `accepted`, `declined`, or `expired`; an accepted call becomes `completed` when either participant ends it.

The call uses browser-native WebRTC with Socket.IO as authenticated signaling. Media travels peer-to-peer encrypted by WebRTC/DTLS; the application server does not record or persist audio, video, chat, or photos. The doctor and patient each receive a five-minute, participant-bound room token from the server. TURN credentials are HMAC-derived for a 15-minute window. STUN-only mode is useful for development but cannot connect every carrier-grade NAT or restrictive network; production deployments should configure a TURN service.

Call requests are offered only to active doctors with an eligible profile. A hospital administrator must complete the normal account and credential verification workflow before a doctor can accept requests. The call screen queues ICE candidates that arrive before remote-description negotiation, preserves the original start time across socket reconnects, and indicates when TURN relay configuration is absent. Calls on restrictive carrier or firewall networks still require a reachable TURN service.

Call notes are versioned in `teleconsultation_notes`; signed notes, follow-ups, and referrals are returned by patient history and displayed in the dashboard Reports/Care history section. `recordingEnabled` is always false: this peer-to-peer implementation has no recorder, even if a participant requests one.

## Data schema

- `consultation_requests`: patient, assigned doctor and hospital IDs; reason (`follow_up`, `new_symptom`, `report_question`); encrypted free-text details; urgent flag; optional patient-selected AI screening report/session; call-consent text version/time; lifecycle status and expiry; suggested time and patient acknowledgement; opaque room name; call start/end/duration; recording flag (false).
- `teleconsultation_notes`: call request, patient, doctor, immutable version chain, signed body, patient-release flag/time.
- Existing `follow_ups` and `referrals` store the doctor’s optional plan after the call.
- `push_subscriptions`: authenticated user, allow-listed HTTPS push endpoint, browser encryption keys, and last-use time.
- Existing `audit_logs`: call request creation, call start, call end and note release actor/resource/timestamp metadata. The request narrative is not copied into audit metadata.

## REST API

All routes are under `/api/v1/calls` and require the existing authenticated patient/doctor session.

| Method     | Path                                     | Role            | Purpose                                                                                                          |
| ---------- | ---------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET        | `/doctors`                               | Patient         | List eligible doctors without contact details                                                                    |
| GET        | `/mine`                                  | Patient/doctor  | List only the caller’s own requests; expire stale pending requests                                               |
| POST       | `/requests`                              | Patient         | Create request, record teleconsultation consent, optionally link a report (requires active data-sharing consent) |
| GET        | `/requests/:requestId`                   | Participant     | Read request and report summary while sharing consent remains active                                             |
| POST       | `/requests/:requestId/respond`           | Assigned doctor | Accept, decline, or suggest another time                                                                         |
| POST       | `/requests/:requestId/accept-suggestion` | Request patient | Acknowledge the proposed time                                                                                    |
| POST       | `/requests/:requestId/token`             | Participant     | Issue five-minute room token and STUN/TURN ICE configuration                                                     |
| POST       | `/requests/:requestId/end`               | Participant     | End the call, record duration and audit the end                                                                  |
| POST       | `/requests/:requestId/notes`             | Assigned doctor | Save immutable patient-visible note and optional follow-up/referral                                              |
| GET        | `/push/public-key`                       | Patient/doctor  | Return the VAPID public key (never the private key)                                                              |
| PUT/DELETE | `/push/subscription`                     | Patient/doctor  | Register or remove this user’s browser push subscription                                                         |

`POST /requests` body: `{ doctorId?, reason, details, reportId?, consentAccepted: true, consentVersion, language }`. Server-side keyword checks flag bleeding or breathing/swallowing trouble; the interface directs the patient to call 112 rather than waiting for the request.

## Socket.IO events

Socket connections authenticate with the short-lived application access token and a live session. Room joins additionally require the call token and verify patient/assigned-doctor membership and active teleconsultation consent.

- Server → assigned doctor: `consultation:request-created` (patient name, reason, urgency, report-attached indicator).
- Server → request participants: `consultation:request-updated`, `consultation:participant-joined`, `consultation:call-started`, `consultation:call-ended`, `consultation:report-added`.
- Client → server: `consultation:join` (request ID + room token), `consultation:signal` (`offer`, `answer`, `ice`, or ICE `restart`), `consultation:chat`, `consultation:leave`.
- Server → other room participant: corresponding signaling/chat and join/leave notifications.

Socket events are not the source of truth; clients refresh from REST after reconnect. Browser Push is optional and requires VAPID configuration; Socket.IO continues to work without it.

## Deployment configuration

Set server-only values in the deployment environment (not `VITE_*`):

- `STUN_URLS`: comma-separated STUN URLs; defaults to a public development STUN server.
- `TURN_URLS` and `TURN_SHARED_SECRET`: TURN server URLs and the coturn REST shared secret. Configure TURN with time-limited credential authentication and TLS for restrictive networks.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: optional Web Push keys. Generate with `npx web-push generate-vapid-keys`; retain the private key only on the server. Serve the app over HTTPS for push and camera/microphone permissions.

The client contains only the VAPID public key fetched from the API and short-lived participant ICE credentials. It does not contain JWT, VAPID, TURN shared, or provider API secrets.

## Validation plan

Automated coverage includes request schema/default recording state, urgent-symptom detection (including Telugu), push endpoint allow-listing, and localization catalog parity. Run:

```powershell
npm --workspace=@aarogya/server test
npm --workspace=@aarogya/server run lint
npm --workspace=@aarogya/client test
npm --workspace=@aarogya/client run lint
npm --workspace=@aarogya/client run build
```

Before release, run two authenticated browsers (patient and assigned doctor) over HTTPS and verify:

1. Patient consent is required; report attachment is rejected after data-sharing consent is withdrawn; unrelated users cannot read requests or obtain room tokens.
2. Doctor receives the request through Socket.IO in an open session and Web Push after enabling it; accept, decline, and suggest-time paths update both clients; stale requests expire.
3. Only the assigned doctor and patient can join; room tokens expire after five minutes; call start/end timestamps and duration appear in audit records; recording remains off.
4. Verify microphone/camera controls, front/rear camera switching, screen share, in-call chat, <=1 MB photo transfer, and signed notes/follow-up/referral in patient history.
5. In browser network tools, test 3G/slow 3G, 400+ ms latency, 5–10% packet loss, brief offline periods, and a forced socket reconnect. Verify the waiting room, reconnect notice, ICE restart, audio-only fallback, and that urgent guidance still offers `tel:112`.
6. With TURN enabled, test separate carrier/mobile and Wi-Fi networks. STUN-only success is not sufficient evidence for rural or symmetric-NAT connectivity.
