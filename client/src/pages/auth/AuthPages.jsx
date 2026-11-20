import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../services/api.js';
import { useAuth } from '../../store/useAuth.js';
import { dashboardPathForRole, getLoginPathAfterPasswordChange } from '../../routes/routeAccess.js';

const roleTranslationKeys = {
  hospital_manager: 'hospitalManager',
  doctor: 'doctor',
  specialist: 'specialist',
  patient: 'patient',
  health_worker: 'health_worker',
  navigator: 'navigator',
  district_officer: 'district_officer',
};

const roleColors = {
  hospital_manager: 'border-l-blue-500 bg-blue-50 hover:bg-blue-100 aria-pressed:border-blue-700 aria-pressed:bg-blue-100',
  doctor: 'border-l-teal-500 bg-teal-50 hover:bg-teal-100 aria-pressed:border-teal-700 aria-pressed:bg-teal-100',
  specialist: 'border-l-cyan-500 bg-cyan-50 hover:bg-cyan-100 aria-pressed:border-cyan-700 aria-pressed:bg-cyan-100',
  patient: 'border-l-emerald-500 bg-emerald-50 hover:bg-emerald-100 aria-pressed:border-emerald-700 aria-pressed:bg-emerald-100',
  health_worker: 'border-l-amber-500 bg-amber-50 hover:bg-amber-100 aria-pressed:border-amber-700 aria-pressed:bg-amber-100',
  navigator: 'border-l-violet-500 bg-violet-50 hover:bg-violet-100 aria-pressed:border-violet-700 aria-pressed:bg-violet-100',
  district_officer: 'border-l-rose-500 bg-rose-50 hover:bg-rose-100 aria-pressed:border-rose-700 aria-pressed:bg-rose-100',
};

function useFormStatus() {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const showError = useCallback(
    (reason) => {
      const code = reason?.response?.data?.code;
      const apiUnavailable =
        !reason?.response || (reason.response.status >= 500 && !reason.response.data?.code);
      setError(
        t(
          apiUnavailable
            ? 'errors.API_UNAVAILABLE'
            : code
              ? `errors.${code}`
              : 'errors.requestFailed',
        ),
      );
      setSuccess('');
    },
    [t],
  );

  return { error, success, setError, setSuccess, showError };
}

function FormFeedback({ error, success }) {
  return (
    <>
      {error ? (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-4 rounded-lg bg-teal-50 p-3 text-sm text-teal-700" role="status">
          {success}
        </p>
      ) : null}
    </>
  );
}

function AuthFrame({ title, children }) {
  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-teal-200 bg-gradient-to-br from-white via-surface to-teal-50 p-6 shadow-[0_18px_48px_rgba(16,54,64,0.12)] sm:p-8">
      <h1 className="text-3xl font-bold text-ink">{title}</h1>
      {children}
    </section>
  );
}

export function StaffLoginPage({ fixedRole = null }) {
  const { t } = useTranslation();
  const { loginStaff, loginPatient, user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRoleSlug = fixedRole ?? searchParams.get('role');
  const selectedRole =
    selectedRoleSlug === 'admin' ? 'admin' : (roleTranslationKeys[selectedRoleSlug] ?? null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useFormStatus();
  const { setError } = status;

  useEffect(() => {
    setIdentifier('');
    setPassword('');
    setError('');
  }, [selectedRoleSlug, setError]);

  if (loading) {
    return (
      <AuthFrame title={t('auth.loading')}>
        <p className="mt-4 text-muted" role="status">
          {t('auth.loading')}
        </p>
      </AuthFrame>
    );
  }
  if (user) return <Navigate replace to={dashboardPathForRole(user.role)} />;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    status.setError('');
    try {
      const result =
        selectedRoleSlug === 'patient'
          ? await loginPatient(identifier, password)
          : await loginStaff(identifier, password, selectedRoleSlug);
      if (result.flow === 'password_change') {
        navigate(`/login/change-password?role=${encodeURIComponent(selectedRoleSlug ?? '')}`);
      } else navigate(dashboardPathForRole(result.user.role), { replace: true });
    } catch (error) {
      status.showError(error);
    } finally {
      setBusy(false);
    }
  }

  if (!fixedRole && selectedRoleSlug === 'admin') {
    return <Navigate replace to="/super-admin/login" />;
  }

  return (
    <AuthFrame
      title={
        selectedRole
          ? t('auth.roleTitle', { role: t(`roles.${selectedRole}`) })
          : t('auth.selectRoleTitle')
      }
    >
      {!fixedRole ? (
        <div
          aria-label={t('auth.selectRoleTitle')}
          className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {Object.entries(roleTranslationKeys).map(([role, translationKey]) => (
            <button
              aria-pressed={selectedRoleSlug === role}
              className={`min-h-touch rounded-lg border border-l-4 border-slate-200 px-4 py-3 text-left font-semibold text-ink transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${roleColors[role]}`}
              key={role}
              onClick={() => {
                setSearchParams({ role });
                setIdentifier('');
                setPassword('');
                status.setError('');
              }}
              type="button"
            >
              <span className="mr-3 inline-block h-2.5 w-2.5 rounded-full bg-current align-middle opacity-70" aria-hidden="true" />
              {t(`roles.${translationKey}`)}
            </button>
          ))}
        </div>
      ) : null}
      {!fixedRole ? (
        <p className="mt-3 text-sm text-muted">{t('auth.roleCredentialHint')}</p>
      ) : null}

      {!fixedRole ? (
        <p className="mt-5 text-sm">
          {t('auth.newPatientPrompt')}{' '}
          <Link className="font-semibold text-teal-700 underline" to="/patient-password-setup">
            {t('auth.createPatientAccount')}
          </Link>
        </p>
      ) : null}

      {selectedRole ? (
        <>
          <p className="mt-5 leading-7 text-muted">
            {selectedRoleSlug === 'patient'
              ? t('auth.patientPasswordDescription')
              : t('auth.staffDescription')}
          </p>
          <form className="mt-5 space-y-4" onSubmit={submit}>
            <label className="block text-sm font-semibold text-ink" htmlFor="identifier">
              {t(
                selectedRoleSlug === 'patient' ? 'auth.patientIdentifier' : 'auth.staffIdentifier',
              )}
            </label>
            <input
              autoComplete="username"
              className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
              id="identifier"
              onChange={(event) => setIdentifier(event.target.value)}
              required
              value={identifier}
            />
            <label className="block text-sm font-semibold text-ink" htmlFor="password">
              {t('auth.password')}
            </label>
            <input
              autoComplete="current-password"
              className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            <button
              className="min-h-touch w-full rounded-xl bg-teal-700 px-5 font-semibold text-white disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              {busy ? t('auth.working') : t('auth.signIn')}
            </button>
          </form>
          <FormFeedback error={status.error} success={status.success} />
          <p className="mt-5 text-sm">
            <Link
              className="font-semibold text-teal-700 underline"
              to={
                selectedRoleSlug === 'patient'
                  ? '/patient-password-setup/activation'
                  : '/forgot-password'
              }
            >
              {t(
                selectedRoleSlug === 'patient'
                  ? 'auth.patientActivationSetupLink'
                  : 'auth.forgotPassword',
              )}
            </Link>
          </p>
          {selectedRoleSlug !== 'patient' && selectedRoleSlug !== 'admin' ? (
            <p className="mt-3 text-sm">
              <Link
                className="font-semibold text-teal-700 underline"
                to={`/staff-access-request?role=${encodeURIComponent(selectedRoleSlug)}`}
              >
                {t('auth.requestStaffAccount')}
              </Link>
            </p>
          ) : null}
        </>
      ) : null}
    </AuthFrame>
  );
}

export function StaffAccessRequestPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    requestedRole: [
      'hospital_manager',
      'doctor',
      'specialist',
      'health_worker',
      'navigator',
      'district_officer',
    ].includes(searchParams.get('role'))
      ? searchParams.get('role')
      : 'health_worker',
    district: '',
    mandal: '',
    phc: '',
    assignedVillages: '',
    hospitalId: '',
    qualification: '',
    registrationNumber: '',
    specialty: '',
  });
  const [hospitals, setHospitals] = useState([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const status = useFormStatus();
  const needsHospital = ['hospital_manager', 'doctor', 'specialist'].includes(form.requestedRole);
  const isDoctor = ['doctor', 'specialist'].includes(form.requestedRole);
  const needsCatchment = ['health_worker', 'navigator'].includes(form.requestedRole);
  const inputClass = 'min-h-touch w-full rounded-lg border border-teal-100 px-4';

  useEffect(() => {
    api
      .get('/hospitals')
      .then((response) => setHospitals(response.data.details))
      .catch(status.showError);
  }, [status.showError]);

  function update(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    status.setError('');
    status.setSuccess('');
    const payload = {
      ...form,
      assignedVillages: form.assignedVillages
        .split(',')
        .map((village) => village.trim())
        .filter(Boolean),
    };
    if (!needsCatchment) {
      delete payload.mandal;
      delete payload.phc;
      delete payload.assignedVillages;
    }
    if (!needsHospital) delete payload.hospitalId;
    if (!isDoctor) {
      delete payload.qualification;
      delete payload.registrationNumber;
      delete payload.specialty;
    }
    try {
      await api.post('/staff-access-requests', payload);
      setSubmitted(true);
      status.setSuccess(t('auth.staffRequestSubmitted'));
    } catch (error) {
      status.showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title={t('auth.staffRequestTitle')}>
      <p className="mt-4 leading-7 text-muted">{t('auth.staffRequestDescription')}</p>
      {submitted ? (
        <div className="mt-5 rounded-xl bg-teal-50 p-4 text-ink" role="status">
          {t('auth.staffRequestSubmitted')}
        </div>
      ) : (
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <label className="grid gap-1 text-sm font-medium sm:col-span-2">
            {t('auth.staffRequestRole')}
            <select
              className={inputClass}
              name="requestedRole"
              onChange={update}
              value={form.requestedRole}
            >
              {[
                ['hospital_manager', 'hospitalManager'],
                ['doctor', 'doctor'],
                ['specialist', 'specialist'],
                ['health_worker', 'health_worker'],
                ['navigator', 'navigator'],
                ['district_officer', 'district_officer'],
              ].map(([value, key]) => (
                <option key={value} value={value}>
                  {t(`roles.${key}`)}
                </option>
              ))}
            </select>
          </label>
          {[
            ['fullName', 'auth.staffRequestName', 'text'],
            ['email', 'auth.staffRequestEmail', 'email'],
            ['phone', 'auth.staffRequestPhone', 'tel'],
            ['district', 'field.district', 'text'],
          ].map(([name, label, type]) => (
            <label className="grid gap-1 text-sm font-medium" key={name}>
              {t(label)}
              <input
                autoComplete={name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'off'}
                className={inputClass}
                name={name}
                onChange={update}
                required
                type={type}
                value={form[name]}
              />
            </label>
          ))}
          {needsHospital ? (
            <label className="grid gap-1 text-sm font-medium sm:col-span-2">
              {t('auth.staffRequestHospital')}
              <select
                className={inputClass}
                name="hospitalId"
                onChange={(event) => {
                  update(event);
                  const selected = hospitals.find((hospital) => hospital.id === event.target.value);
                  if (selected?.district)
                    setForm((current) => ({ ...current, district: selected.district }));
                }}
                required
                value={form.hospitalId}
              >
                <option value="">{t('auth.staffRequestChooseHospital')}</option>
                {hospitals.map((hospital) => (
                  <option key={hospital.id} value={hospital.id}>
                    {hospital.name}
                    {hospital.district ? ` — ${hospital.district}` : ''}
                    {hospital.isSynthetic ? ` (${t('demoProviders.disclaimerShort')})` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {isDoctor ? (
            <>
              {[
                ['qualification', 'auth.staffRequestQualification'],
                ['registrationNumber', 'auth.staffRequestRegistration'],
                ['specialty', 'auth.staffRequestSpecialty'],
              ].map(([name, label]) => (
                <label className="grid gap-1 text-sm font-medium" key={name}>
                  {t(label)}
                  <input
                    className={inputClass}
                    name={name}
                    onChange={update}
                    required
                    value={form[name]}
                  />
                </label>
              ))}
              <p className="text-sm text-muted sm:col-span-2">
                {t('auth.staffRequestDoctorReview')}
              </p>
            </>
          ) : null}
          {needsCatchment ? (
            <>
              {[
                ['mandal', 'field.mandal'],
                ['phc', 'field.phc'],
                ['assignedVillages', 'management.assignedVillages'],
              ].map(([name, label]) => (
                <label className="grid gap-1 text-sm font-medium" key={name}>
                  {t(label)}
                  <input
                    className={inputClass}
                    name={name}
                    onChange={update}
                    required={name !== 'assignedVillages'}
                    value={form[name]}
                  />
                </label>
              ))}
            </>
          ) : null}
          <button
            className="min-h-touch rounded-xl bg-teal-700 px-5 font-semibold text-white disabled:opacity-60 sm:col-span-2"
            disabled={busy}
            type="submit"
          >
            {busy ? t('auth.working') : t('auth.submitStaffRequest')}
          </button>
          <FormFeedback error={status.error} success={status.success} />
        </form>
      )}
      <p className="mt-5 text-sm">
        <Link className="font-semibold text-teal-700 underline" to="/login">
          {t('auth.backToSignIn')}
        </Link>
      </p>
    </AuthFrame>
  );
}

export function SuperAdminLoginPage() {
  return <StaffLoginPage fixedRole="admin" />;
}

export function PatientRegistrationPage() {
  const { t } = useTranslation();
  const { loginPatient, requestPatientRegistrationOtp, verifyPatientRegistrationOtp } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [expiresIn, setExpiresIn] = useState(0);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaSiteKey, setCaptchaSiteKey] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useFormStatus();
  const updateCaptchaToken = useCallback((token) => setCaptchaToken(token), []);

  useEffect(() => {
    if (!challengeId) return undefined;
    const timer = window.setInterval(
      () => setExpiresIn((remaining) => Math.max(0, remaining - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [challengeId]);

  async function sendOtp(event) {
    event?.preventDefault();
    if (password !== confirmation) {
      status.setError(t('auth.passwordsDoNotMatch'));
      return;
    }
    if (
      password.length < 12 ||
      password.length > 128 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password)
    ) {
      status.setError(t('auth.passwordRules'));
      return;
    }
    setBusy(true);
    status.setError('');
    try {
      const result = await requestPatientRegistrationOtp({
        fullName,
        phone,
        ...(email ? { email } : {}),
        password,
      });
      setChallengeId(result.challengeId);
      setExpiresIn(result.expiresInSeconds ?? 300);
      setCode(result.developmentCode ?? '');
      setCaptchaRequired(false);
      setCaptchaSiteKey('');
      setCaptchaToken('');
      status.setSuccess(
        result.developmentCode
          ? t('auth.patientOtpSentWithCode', { code: result.developmentCode })
          : t('auth.patientOtpSent'),
      );
    } catch (error) {
      status.showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event) {
    event.preventDefault();
    setBusy(true);
    status.setError('');
    try {
      await verifyPatientRegistrationOtp({
        phone,
        challengeId,
        code,
        ...(captchaToken ? { captchaToken } : {}),
      });
      await loginPatient(phone, password);
      navigate('/patient', { replace: true });
    } catch (error) {
      if (error.response?.data?.code === 'OTP_CAPTCHA_REQUIRED') {
        const siteKey = error.response.data.details?.siteKey ?? '';
        setCaptchaRequired(true);
        setCaptchaSiteKey(siteKey);
        setCaptchaToken('');
        if (!siteKey) {
          status.setError(t('errors.OTP_CAPTCHA_NOT_CONFIGURED'));
          return;
        }
      }
      status.showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title={t('auth.patientRegistrationTitle')}>
      <p className="mt-3 leading-7 text-muted">{t('auth.patientRegistrationDescription')}</p>
      <form className="mt-6 space-y-4" onSubmit={challengeId ? verifyOtp : sendOtp}>
        <label className="block text-sm font-semibold text-ink" htmlFor="registration-name">
          {t('auth.fullName')}
        </label>
        <input
          autoComplete="name"
          className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
          disabled={Boolean(challengeId)}
          id="registration-name"
          maxLength={120}
          onChange={(event) => setFullName(event.target.value)}
          required
          value={fullName}
        />
        <label className="block text-sm font-semibold text-ink" htmlFor="registration-phone">
          {t('auth.patientPhone')}
        </label>
        <input
          autoComplete="tel"
          className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
          disabled={Boolean(challengeId)}
          id="registration-phone"
          onChange={(event) => setPhone(event.target.value)}
          placeholder={t('auth.mobilePlaceholder')}
          required
          type="tel"
          value={phone}
        />
        <label className="block text-sm font-semibold text-ink" htmlFor="registration-email">
          {t('auth.patientEmailOptional')}
        </label>
        <input
          autoComplete="email"
          className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
          disabled={Boolean(challengeId)}
          id="registration-email"
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          value={email}
        />
        <label className="block text-sm font-semibold text-ink" htmlFor="registration-password">
          {t('auth.password')}
        </label>
        <input
          autoComplete="new-password"
          className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
          disabled={Boolean(challengeId)}
          id="registration-password"
          minLength={12}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <p className="-mt-2 text-sm text-muted">{t('auth.passwordRules')}</p>
        <label
          className="block text-sm font-semibold text-ink"
          htmlFor="registration-confirm-password"
        >
          {t('auth.confirmPassword')}
        </label>
        <input
          autoComplete="new-password"
          className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
          disabled={Boolean(challengeId)}
          id="registration-confirm-password"
          minLength={12}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          type="password"
          value={confirmation}
        />
        {challengeId ? (
          <p aria-live="polite" className="text-sm text-muted" role="status">
            {expiresIn > 0 ? t('auth.otpExpiresIn', { seconds: expiresIn }) : t('auth.otpExpired')}
          </p>
        ) : null}
        {challengeId ? (
          <>
            <label className="block text-sm font-semibold text-ink" htmlFor="registration-otp">
              {t('auth.otpCode')}
            </label>
            <input
              autoComplete="one-time-code"
              className="min-h-touch w-full rounded-lg border border-teal-100 px-4 text-base tracking-widest"
              disabled={expiresIn === 0}
              id="registration-otp"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              pattern="[0-9]*"
              required
              value={code}
            />
            {captchaRequired && captchaSiteKey ? (
              <TurnstileCaptcha onToken={updateCaptchaToken} siteKey={captchaSiteKey} />
            ) : null}
            <button
              className="min-h-touch text-sm font-semibold text-teal-700 underline disabled:text-muted"
              disabled={busy || expiresIn > 0}
              onClick={() => {
                setChallengeId('');
                setCode('');
                sendOtp();
              }}
              type="button"
            >
              {t('auth.requestNewOtp')}
            </button>
          </>
        ) : null}
        <button
          className="min-h-touch w-full rounded-xl bg-teal-700 px-5 font-semibold text-white disabled:opacity-60"
          disabled={
            busy ||
            (Boolean(challengeId) &&
              (code.length !== 6 || expiresIn === 0 || (captchaRequired && !captchaToken)))
          }
          type="submit"
        >
          {busy
            ? t('auth.working')
            : challengeId
              ? t('auth.patientVerifyAndCreate')
              : t('auth.patientSendOtp')}
        </button>
      </form>
      <FormFeedback error={status.error} success={status.success} />
      <p className="mt-5 text-sm">
        {t('auth.existingPatientPrompt')}{' '}
        <Link className="font-semibold text-teal-700 underline" to="/login?role=patient">
          {t('auth.patientLogin')}
        </Link>
      </p>
      <p className="mt-3 text-sm">
        <Link
          className="font-semibold text-teal-700 underline"
          to="/patient-password-setup/activation"
        >
          {t('auth.patientActivationSetupLink')}
        </Link>
      </p>
    </AuthFrame>
  );
}

function TurnstileCaptcha({ siteKey, onToken }) {
  const container = useRef(null);

  useEffect(() => {
    let active = true;
    let widgetId;
    const render = () => {
      if (!active || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    };
    let script = document.querySelector('script[data-turnstile-script]');
    if (window.turnstile) {
      render();
    } else {
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.turnstileScript = 'true';
        document.head.appendChild(script);
      }
      script.addEventListener('load', render);
    }
    return () => {
      active = false;
      script?.removeEventListener('load', render);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken, siteKey]);

  return <div aria-label="CAPTCHA verification" ref={container} />;
}

export function PatientPasswordSetupPage() {
  const { t } = useTranslation();
  const [activationCode, setActivationCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useFormStatus();

  async function submit(event) {
    event.preventDefault();
    if (password !== confirmation) {
      status.setError(t('auth.passwordsDoNotMatch'));
      return;
    }
    setBusy(true);
    status.setError('');
    try {
      await api.post('/auth/patient/password/activate', {
        activationCode,
        newPassword: password,
      });
      status.setSuccess(t('auth.patientPasswordActivated'));
      setActivationCode('');
      setPassword('');
      setConfirmation('');
    } catch (error) {
      status.showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title={t('auth.patientPasswordSetupTitle')}>
      <p className="mt-3 leading-7 text-muted">{t('auth.patientPasswordSetupDescription')}</p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="block text-sm font-semibold text-ink" htmlFor="activation-code">
          {t('auth.patientActivationCode')}
        </label>
        <input
          autoComplete="one-time-code"
          className="min-h-touch w-full rounded-lg border border-teal-100 px-4 font-mono"
          id="activation-code"
          maxLength={64}
          onChange={(event) => setActivationCode(event.target.value.trim())}
          required
          value={activationCode}
        />
        <label className="block text-sm font-semibold text-ink" htmlFor="patient-new-password">
          {t('auth.newPassword')}
        </label>
        <input
          autoComplete="new-password"
          className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
          id="patient-new-password"
          minLength={12}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <label className="block text-sm font-semibold text-ink" htmlFor="patient-confirm-password">
          {t('auth.confirmPassword')}
        </label>
        <input
          autoComplete="new-password"
          className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
          id="patient-confirm-password"
          minLength={12}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          type="password"
          value={confirmation}
        />
        <button
          className="min-h-touch w-full rounded-xl bg-teal-700 px-5 font-semibold text-white disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? t('auth.working') : t('auth.patientPasswordSave')}
        </button>
      </form>
      <FormFeedback error={status.error} success={status.success} />
      <p className="mt-5 text-sm">
        <Link className="font-semibold text-teal-700 underline" to="/login?role=patient">
          {t('auth.patientLogin')}
        </Link>
      </p>
    </AuthFrame>
  );
}

export function FirstPasswordChangePage() {
  const { t } = useTranslation();
  const { flow, completeFirstPasswordChange } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedRole = searchParams.get('role');
  const role =
    Object.hasOwn(roleTranslationKeys, requestedRole) || requestedRole === 'admin'
      ? requestedRole
      : null;
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useFormStatus();
  if (flow?.flow !== 'password_change') return <Navigate replace to="/login/staff" />;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await completeFirstPasswordChange(password);
      navigate(getLoginPathAfterPasswordChange(role), { replace: true });
    } catch (error) {
      status.showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title={t('auth.changePasswordTitle')}>
      <p className="mt-3 leading-7 text-muted">{t('auth.passwordRules')}</p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="block text-sm font-semibold" htmlFor="new-password">
          {t('auth.newPassword')}
        </label>
        <input
          autoComplete="new-password"
          className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
          id="new-password"
          minLength={12}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <button
          className="min-h-touch w-full rounded-xl bg-teal-700 px-5 font-semibold text-white"
          disabled={busy}
          type="submit"
        >
          {busy ? t('auth.working') : t('auth.changePassword')}
        </button>
      </form>
      <FormFeedback error={status.error} success={status.success} />
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useFormStatus();

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/password/forgot', { identifier }, { skipToast: true });
      status.setSuccess(t('auth.resetLinkSent'));
    } catch (error) {
      status.showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title={t('auth.forgotPasswordTitle')}>
      <p className="mt-3 leading-7 text-muted">{t('auth.forgotPasswordDescription')}</p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="block text-sm font-semibold" htmlFor="identifier">
          {t('auth.staffIdentifier')}
        </label>
        <input
          autoComplete="username"
          className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
          id="identifier"
          onChange={(event) => setIdentifier(event.target.value)}
          required
          value={identifier}
        />
        <button
          className="min-h-touch w-full rounded-xl bg-teal-700 px-5 font-semibold text-white"
          disabled={busy}
          type="submit"
        >
          {busy ? t('auth.working') : t('auth.sendResetLink')}
        </button>
      </form>
      <FormFeedback error={status.error} success={status.success} />
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useFormStatus();

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/password/reset', { token, newPassword: password }, { skipToast: true });
      status.setSuccess(t('auth.passwordReset'));
    } catch (error) {
      status.showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title={t('auth.resetPasswordTitle')}>
      {!token ? <p className="mt-4 text-muted">{t('auth.resetTokenMissing')}</p> : null}
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="block text-sm font-semibold" htmlFor="new-password">
          {t('auth.newPassword')}
        </label>
        <input
          autoComplete="new-password"
          className="min-h-touch w-full rounded-lg border border-teal-100 px-4"
          id="new-password"
          minLength={12}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <button
          className="min-h-touch w-full rounded-xl bg-teal-700 px-5 font-semibold text-white"
          disabled={busy || !token}
          type="submit"
        >
          {busy ? t('auth.working') : t('auth.resetPassword')}
        </button>
      </form>
      <FormFeedback error={status.error} success={status.success} />
    </AuthFrame>
  );
}
