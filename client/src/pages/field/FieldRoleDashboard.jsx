import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api.js';
import { addOutboxOperation, getPendingOperations, updateOutboxStatus } from '../../lib/offlineStore.js';
import { useAuth } from '../../store/useAuth.js';
import RoleDashboardShell from '../../layouts/RoleDashboardShell.jsx';

const symptomKeys = [
  'white_patch',
  'red_patch',
  'non_healing_ulcer',
  'growth_or_lump',
  'difficulty_opening_mouth',
  'difficulty_breathing',
  'difficulty_swallowing',
  'pain_chewing',
  'bleeding',
  'persistent_pain_or_numbness',
  'voice_change_or_neck_lump',
];
const photoViews = ['front', 'left_cheek', 'right_cheek', 'upper_gums', 'lower_gums'];

function FieldShell({ title, children, message }) {
  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-teal-700">Aarogya Drishti</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">{title}</h1>
      </header>
      {message ? <p className="rounded-xl bg-teal-50 p-4 text-ink" role="status">{message}</p> : null}
      {children}
    </main>
  );
}

function HealthWorkerDashboard() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    dateOfBirth: '',
    village: '',
    mandal: user?.mandal ?? '',
    phc: user?.phc ?? '',
    district: user?.district ?? '',
    tobaccoType: 'unknown',
    tobaccoFrequency: '',
    tobaccoDuration: '',
    arecaUses: false,
    arecaFrequency: '',
    arecaDuration: '',
    symptoms: [],
    screening: false,
    imaging: false,
    dataSharing: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [issuingActivation, setIssuingActivation] = useState(false);
  const hasEmergencySymptoms = form.symptoms.some((symptom) =>
    ['difficulty_breathing', 'difficulty_swallowing', 'bleeding'].includes(symptom),
  );

  const synchronize = useCallback(async () => {
    if (!navigator.onLine) return;
    const pending = await getPendingOperations();
    for (const operation of pending.filter((item) => item.kind === 'field_registration')) {
      if (operation.nextRetryAt > Date.now()) continue;
      try {
        const response = await api.post('/sync/batch', {
          operations: [{
            clientOpId: operation.clientOpId,
            route: operation.route,
            method: operation.method,
            payload: operation.payload,
            kind: operation.kind,
          }],
        });
        const outcome = response.data.data.results.find((item) => item.clientOpId === operation.clientOpId);
        if (!outcome || !['sent', 'duplicate'].includes(outcome.status)) {
          throw new Error('Offline registration was not acknowledged.');
        }
        await updateOutboxStatus(operation.clientOpId, outcome.status, {
          attempts: (operation.attempts || 0) + 1,
          sentAt: new Date().toISOString(),
        });
        if (outcome.registrationId) setRegistrationId(outcome.registrationId);
        setMessage(t('field.syncComplete'));
      } catch (error) {
        if (error.response && error.response.status < 500) {
          await updateOutboxStatus(operation.clientOpId, 'failed', {
            lastError: error.response.data?.code || 'request_failed',
          });
        } else {
          const attempts = (operation.attempts || 0) + 1;
          await updateOutboxStatus(operation.clientOpId, 'pending', {
            attempts,
            nextRetryAt: Date.now() + Math.min(60 * 60 * 1000, 1000 * (2 ** attempts)),
          });
          break;
        }
      }
    }
  }, [t]);

  useEffect(() => {
    window.addEventListener('online', synchronize);
    synchronize();
    return () => window.removeEventListener('online', synchronize);
  }, [synchronize]);

  function update(event) {
    const { name, value, checked, type } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  }

  function toggleSymptom(symptom) {
    setForm((current) => ({
      ...current,
      symptoms: current.symptoms.includes(symptom)
        ? current.symptoms.filter((item) => item !== symptom)
        : [...current.symptoms, symptom],
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setRegistrationId('');
    setActivationCode('');
    const clientOpId = crypto.randomUUID();
    const payload = {
      clientOpId,
      fullName: form.fullName,
      ...(form.phone ? { phone: form.phone } : {}),
      ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}),
      sexAtBirth: 'undisclosed',
      language: i18n.language.startsWith('te') ? 'te' : 'en',
      village: form.village,
      mandal: form.mandal,
      phc: form.phc,
      district: form.district,
      tobacco: {
        type: form.tobaccoType,
        ...(form.tobaccoFrequency ? { frequency: form.tobaccoFrequency } : {}),
        ...(form.tobaccoDuration ? { duration: form.tobaccoDuration } : {}),
      },
      arecaNut: {
        uses: form.arecaUses,
        ...(form.arecaFrequency ? { frequency: form.arecaFrequency } : {}),
        ...(form.arecaDuration ? { duration: form.arecaDuration } : {}),
      },
      symptoms: form.symptoms,
      consents: { screening: form.screening, imaging: form.imaging, data_sharing: form.dataSharing },
    };
    try {
      if (!navigator.onLine) {
        await addOutboxOperation({
          clientOpId,
          route: '/field/registrations',
          payload,
          kind: 'field_registration',
          status: 'pending',
        });
        setMessage(t('field.waitingSync'));
      } else {
        const response = await api.post('/sync/batch', {
          operations: [{
            clientOpId,
            route: '/field/registrations',
            method: 'POST',
            payload,
            kind: 'field_registration',
          }],
        });
        const result = response.data.data.results[0];
        setRegistrationId(result?.registrationId ?? '');
        setMessage(t(result?.status === 'duplicate' ? 'field.registrationAlreadySynced' : 'field.registrationSaved'));
      }
    } catch (error) {
      if (!error.response || error.response.status >= 500) {
        await addOutboxOperation({
          clientOpId,
          route: '/field/registrations',
          payload,
          kind: 'field_registration',
          status: 'pending',
        });
        setMessage(t('field.waitingSync'));
      } else {
        setMessage(t(`errors.${error.response.data?.code}`, { defaultValue: t('field.saveError') }));
      }
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(view, file) {
    if (!file || !registrationId) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setMessage(t('field.photoInvalid'));
      return;
    }
    const body = new FormData();
    body.append('file', file);
    try {
      await api.post(`/field/registrations/${registrationId}/photos/${view}`, body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setMessage(t('field.photoSaved', { view: t(`field.views.${view}`) }));
    } catch {
      setMessage(t('field.photoError'));
    }
  }

  async function issuePatientActivation() {
    if (!registrationId) return;
    setIssuingActivation(true);
    setActivationCode('');
    try {
      const response = await api.post(
        `/field/registrations/${registrationId}/patient-password-activation`,
      );
      setActivationCode(response.data.details.activationCode);
      setMessage(t('field.activationCodeIssued'));
    } catch (error) {
      setMessage(
        t(`errors.${error.response?.data?.code}`, {
          defaultValue: t('field.activationCodeError'),
        }),
      );
    } finally {
      setIssuingActivation(false);
    }
  }

  const inputClass = 'min-h-touch w-full rounded-lg border border-teal-200 bg-white px-3 text-base';
  return (
    <FieldShell title={t('field.healthWorkerTitle')} message={message}>
      <form id="field-registration" className="space-y-6 rounded-2xl border border-teal-100 bg-surface p-5" onSubmit={submit}>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xl font-semibold">{t('field.patientDetails')}</legend>
          <label className="grid gap-1">{t('field.fullName')}<input className={inputClass} name="fullName" onChange={update} required value={form.fullName} /></label>
          <label className="grid gap-1">{t('field.phone')}<input className={inputClass} name="phone" onChange={update} type="tel" value={form.phone} /></label>
          <label className="grid gap-1">{t('field.dateOfBirth')}<input className={inputClass} name="dateOfBirth" onChange={update} type="date" value={form.dateOfBirth} /></label>
          {['village', 'mandal', 'phc', 'district'].map((key) => (
            <label className="grid gap-1" key={key}>{t(`field.${key}`)}<input className={inputClass} name={key} onChange={update} required value={form[key]} /></label>
          ))}
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xl font-semibold">{t('field.lifestyle')}</legend>
          <label className="grid gap-1">{t('field.tobaccoType')}
            <select className={inputClass} name="tobaccoType" onChange={update} value={form.tobaccoType}>
              {['unknown', 'none', 'smoked', 'smokeless', 'both'].map((value) => <option key={value} value={value}>{t(`field.tobacco.${value}`)}</option>)}
            </select>
          </label>
          <label className="grid gap-1">{t('field.frequency')}<input className={inputClass} name="tobaccoFrequency" onChange={update} value={form.tobaccoFrequency} /></label>
          <label className="grid gap-1">{t('field.duration')}<input className={inputClass} name="tobaccoDuration" onChange={update} value={form.tobaccoDuration} /></label>
          <label className="flex min-h-touch items-center gap-3"><input checked={form.arecaUses} name="arecaUses" onChange={update} type="checkbox" />{t('field.arecaUses')}</label>
          <label className="grid gap-1">{t('field.arecaFrequency')}<input className={inputClass} name="arecaFrequency" onChange={update} value={form.arecaFrequency} /></label>
          <label className="grid gap-1">{t('field.arecaDuration')}<input className={inputClass} name="arecaDuration" onChange={update} value={form.arecaDuration} /></label>
        </fieldset>

        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-3 text-xl font-semibold">{t('field.symptoms')}</legend>
          {symptomKeys.map((symptom) => (
            <label className="flex min-h-touch items-center gap-3" key={symptom}>
              <input checked={form.symptoms.includes(symptom)} onChange={() => toggleSymptom(symptom)} type="checkbox" />
              {t(`field.symptomItems.${symptom}`)}
            </label>
          ))}
        </fieldset>

        {hasEmergencySymptoms ? (
          <aside className="rounded-2xl border-2 border-rose-700 bg-rose-50 p-5 text-rose-950" role="alert">
            <h2 className="text-xl font-bold">{t('aiAssistant.emergencyTitle')}</h2>
            <p className="mt-2">{t('aiAssistant.emergencyDescription')}</p>
            <a className="mt-3 inline-flex min-h-touch items-center rounded-xl bg-rose-700 px-5 font-bold text-white" href="tel:112">
              {t('aiAssistant.call112')}
            </a>
          </aside>
        ) : null}

        <fieldset className="space-y-3">
          <legend className="mb-2 text-xl font-semibold">{t('field.consentTitle')}</legend>
          <label className="flex items-start gap-3"><input checked={form.screening} className="mt-1" name="screening" onChange={update} required type="checkbox" />{t('field.screeningConsent')}</label>
          <label className="flex items-start gap-3"><input checked={form.imaging} className="mt-1" name="imaging" onChange={update} type="checkbox" />{t('field.imagingConsent')}</label>
          <label className="flex items-start gap-3"><input checked={form.dataSharing} className="mt-1" name="dataSharing" onChange={update} type="checkbox" />{t('field.dataSharingConsent')}</label>
        </fieldset>
        <button className="min-h-touch rounded-xl bg-teal-800 px-5 font-semibold text-white disabled:opacity-60" disabled={busy} type="submit">
          {busy ? t('field.saving') : t('field.registerPatient')}
        </button>
      </form>

      {registrationId ? (
        <section className="space-y-3 rounded-xl border border-teal-100 bg-surface p-5">
          <h2 className="text-lg font-semibold text-ink">{t('field.patientPasswordAccess')}</h2>
          <p className="text-sm text-muted">{t('field.activationCodeInstruction')}</p>
          <button
            className="min-h-touch rounded-lg bg-teal-800 px-4 font-semibold text-white disabled:opacity-60"
            disabled={issuingActivation}
            onClick={issuePatientActivation}
            type="button"
          >
            {issuingActivation ? t('field.saving') : t('field.issueActivationCode')}
          </button>
          {activationCode ? (
            <p className="rounded-lg bg-teal-50 p-4 text-sm text-ink" role="status">
              {t('field.activationCodeLabel')}{' '}
              <code className="break-all font-mono font-bold">{activationCode}</code>
              <span className="mt-2 block">{t('field.activationCodeExpires')}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {registrationId && form.imaging ? (
        <section id="field-photo-capture" className="rounded-2xl border border-teal-100 bg-surface p-5">
          <h2 className="mb-4 text-xl font-semibold">{t('field.guidedPhotos')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {photoViews.map((view) => (
              <label className="grid gap-2 rounded-xl border border-teal-100 p-3" key={view}>
                <span className="font-semibold">{t(`field.views.${view}`)}</span>
                <input accept="image/jpeg,image/png" capture="environment" onChange={(event) => uploadPhoto(view, event.target.files?.[0])} type="file" />
              </label>
            ))}
          </div>
        </section>
      ) : null}
    </FieldShell>
  );
}

function NavigatorDashboard() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState({ referrals: [], investigations: [] });
  const [message, setMessage] = useState('');
  const [activityDetails, setActivityDetails] = useState({});
  const load = useCallback(async () => {
    const response = await api.get('/field/navigator/queue');
    setQueue(response.data.details);
  }, []);
  useEffect(() => { load().catch(() => setMessage(t('field.loadError'))); }, [load, t]);

  async function logActivity(referralId, type) {
    try {
      await api.post(`/field/navigator/referrals/${referralId}/activities`, {
        type,
        outcome: type === 'contact_attempt' ? 'attempted' : 'recorded',
        ...(activityDetails[referralId] ? { details: activityDetails[referralId] } : {}),
      });
      setMessage(t('field.activitySaved'));
      setActivityDetails((current) => ({ ...current, [referralId]: '' }));
      await load();
    } catch {
      setMessage(t('field.actionError'));
    }
  }

  async function advanceInvestigation(investigation) {
    const nextState = {
      advised: 'scheduled',
      scheduled: 'sample_collected',
      sample_collected: 'report_pending',
      report_pending: 'report_received',
    }[investigation.state];
    if (!nextState) return;
    try {
      await api.patch(`/field/investigations/${investigation._id}/state`, { state: nextState });
      setMessage(t('field.activitySaved'));
      await load();
    } catch {
      setMessage(t('field.actionError'));
    }
  }

  return (
    <FieldShell title={t('field.navigatorTitle')} message={message}>
      <section id="navigator-referrals" className="rounded-2xl border border-teal-100 bg-surface p-5">
        <h2 className="text-xl font-semibold">{t('field.referrals')}</h2>
        <div className="mt-3 space-y-3">
          {queue.referrals.map((referral) => (
            <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-100 p-4" key={referral._id}>
              <p>
                <span className="font-semibold">{referral.patientName ?? t('field.patient')}</span>
                {referral.patientPhone ? ` · ${referral.patientPhone}` : ''}
                <span className="block text-sm text-muted">{t('field.referral')} · {t(`field.urgency.${referral.urgency}`)}</span>
              </p>
              <label className="grid gap-1">
                <span className="sr-only">{t('field.activityDetails')}</span>
                <input className="min-h-touch rounded-lg border border-teal-200 px-3" onChange={(event) => setActivityDetails((current) => ({ ...current, [referral._id]: event.target.value }))} placeholder={t('field.activityDetails')} value={activityDetails[referral._id] ?? ''} />
              </label>
              <div className="flex flex-wrap gap-2">
                {['contact_attempt', 'transport_request', 'missed_visit'].map((type) => (
                  <button className="min-h-touch rounded-lg border border-teal-300 px-3 font-semibold disabled:opacity-50" disabled={type !== 'contact_attempt' && !activityDetails[referral._id]?.trim()} key={type} onClick={() => logActivity(referral._id, type)} type="button">{t(`field.${type}`)}</button>
                ))}
              </div>
            </article>
          ))}
          {!queue.referrals.length ? <p className="text-muted">{t('field.emptyQueue')}</p> : null}
        </div>
      </section>
      <section id="navigator-investigations" className="rounded-2xl border border-teal-100 bg-surface p-5">
        <h2 className="text-xl font-semibold">{t('field.tests')}</h2>
        <div className="mt-3 space-y-2">
          {queue.investigations.map((item) => (
            <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-teal-50 p-3" key={item._id}>
              <p>{t(`field.states.${item.state}`)} · {item.dueAt ? new Date(item.dueAt).toLocaleDateString() : '—'}</p>
              {['advised', 'scheduled', 'sample_collected', 'report_pending'].includes(item.state) ? (
                <button className="min-h-touch rounded-lg border border-teal-300 px-3 font-semibold" onClick={() => advanceInvestigation(item)} type="button">{t('field.advance')}</button>
              ) : null}
            </article>
          ))}
          {!queue.investigations.length ? <p className="text-muted">{t('field.emptyQueue')}</p> : null}
        </div>
      </section>
    </FieldShell>
  );
}

function DistrictDashboard() {
  const { t } = useTranslation();
  const [groupBy, setGroupBy] = useState('village');
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/field/district/dashboard', { params: { groupBy } })
      .then((response) => setRows(response.data.details.rows))
      .catch(() => setMessage(t('field.loadError')));
  }, [groupBy, t]);

  async function exportCsv() {
    try {
      const response = await api.get('/field/district/dashboard/export', { params: { groupBy }, responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'district-aggregates.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage(t('field.actionError'));
    }
  }

  return (
    <FieldShell title={t('field.districtTitle')} message={message}>
      <section id="district-analytics" className="space-y-4 rounded-2xl border border-teal-100 bg-surface p-5">
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1">{t('field.groupBy')}
            <select className="min-h-touch rounded-lg border border-teal-200 px-3" onChange={(event) => setGroupBy(event.target.value)} value={groupBy}>
              {['village', 'phc', 'mandal'].map((value) => <option key={value} value={value}>{t(`field.${value}`)}</option>)}
            </select>
          </label>
          <button className="min-h-touch self-end rounded-xl bg-teal-800 px-4 font-semibold text-white" onClick={exportCsv} type="button">{t('field.exportCsv')}</button>
        </div>
        <p className="text-sm text-muted">{t('field.privacyThreshold')}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="bg-teal-50"><tr>{['area', 'registered', 'screened', 'referred', 'investigation'].map((key) => <th className="p-3" key={key}>{t(`field.${key}`)}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => (
              <tr className="border-t border-teal-50" key={`${row.area ?? 'suppressed'}-${index}`}>
                <td className="p-3">{row.suppressed ? t('field.suppressed') : row.area}</td>
                {['registered', 'screened', 'referred', 'investigation'].map((key) => <td className="p-3" key={key}>{row[key] ?? t('field.suppressed')}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </FieldShell>
  );
}

export default function FieldRoleDashboard({ role }) {
  const dashboard =
    role === 'health_worker' ? (
      <HealthWorkerDashboard />
    ) : role === 'navigator' ? (
      <NavigatorDashboard />
    ) : (
      <DistrictDashboard />
    );
  return <RoleDashboardShell role={role}>{dashboard}</RoleDashboardShell>;
}
