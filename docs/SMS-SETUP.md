# MSG91 SMS setup

The API supports MSG91's OTP API. The application generates and stores a hash of the OTP; MSG91 delivers that same code using the approved template. Provider credentials and codes stay on the server and are never sent to the browser. Consult [MSG91's SMS API documentation](https://docs.msg91.com/sms/send-sms) and follow the current provider instructions for your account.

## Provider dashboard prerequisites

1. Obtain the MSG91 auth key in your account.
2. Create and activate an OTP/SMS template in MSG91. For Indian delivery, register the message content and sender/header with the applicable DLT entity, then ensure the template is approved and mapped in MSG91.
3. Configure the approved sender ID/header on the template in the provider console. The sender ID is tied to that template; the app does not override it in the API request.
4. Ensure the template uses MSG91's supported OTP substitution expected by its OTP API, and test the DLT/template mapping in the MSG91 dashboard.

Account verification, DLT registration, template approval, and provider billing are managed by MSG91 and must be completed by the account owner. Approval and delivery requirements can change; confirm them directly with MSG91 and your telecom/DLT administrator.

## Server configuration

Set these values in the ignored `server/.env` file for local testing, or in your deployment's secret manager:

```dotenv
SMS_PROVIDER=msg91
SMS_API_KEY=your-msg91-auth-key
SMS_TEMPLATE_ID=your-active-msg91-template-id
SMS_SENDER_ID=your-approved-sender-id
```

`SMS_PROVIDER`, `SMS_API_KEY`, and `SMS_TEMPLATE_ID` are required for delivery. `SMS_SENDER_ID` is retained as deployment reference; the approved sender/header is selected on the MSG91 template and is not sent as an override in the API request.

Keep the API key out of chat, source control, client/Vite variables, screenshots, and logs. Restart the API after changing configuration. When `SMS_PROVIDER=msg91`, the real provider path is used even in development; it does not print OTP codes in the server console. Production without a configured provider fails closed.

## Local patient-account testing without SMS

For local development only, set this in `server/.env`:

```dotenv
DEV_PATIENT_REGISTRATION_OTP=true
```

Restart the API and submit the patient registration form. The one-time code is shown in the browser and prefilled in the code field; no SMS is sent. This option is rejected unless `NODE_ENV=development`. Do not enable it in a shared, staging, or production environment, or use it for real patient accounts. Leave it `false` and configure MSG91 to test actual SMS delivery.

## Verification

1. Start MongoDB and the API; check `GET /api/v1/health`.
2. Test with your own number or another recipient who explicitly authorized the test. Provider charges and carrier delivery rules may apply.
3. Request one code from the patient sign-in page and check the MSG91 delivery logs and handset.
4. Enter the code before the five-minute expiry. Resend is limited by the app's 30-second cooldown; incorrect codes are limited to five attempts.
5. Test provider rejection, invalid numbers, rate limits, delayed delivery, and outage behavior without repeatedly sending messages.

The API accepts the MSG91 request only when its response is successful. Provider errors are converted to the app's generic `SMS_UNAVAILABLE` response; response bodies and credentials are not exposed to the user. Message delivery is not guaranteed to be instantaneous.

The platform remains a simulation and is not approved for real-patient use. Do not send patient data or launch clinical OTP access before the required independent security, privacy, ethics, and health-authority reviews.
