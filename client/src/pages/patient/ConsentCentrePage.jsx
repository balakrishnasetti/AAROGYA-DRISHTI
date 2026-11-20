import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api.js';

const consentTypes = ['screening', 'imaging', 'ai_processing', 'teleconsultation', 'data_sharing'];

export default function ConsentCentrePage() {
  const { t, i18n } = useTranslation();
  const [patientId, setPatientId] = useState('');
  const [consents, setConsents] = useState([]);
  const [accessHistory, setAccessHistory] = useState([]);
  const [requests, setRequests] = useState([]);
  const [reason, setReason] = useState('');
  const [requestType, setRequestType] = useState('correction');
  const [correctionChanges, setCorrectionChanges] = useState({
    fullName: '',
    dateOfBirth: '',
    sexAtBirth: '',
    district: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const profile = await api.get('/patients/me');
      const id = profile.data.details.id;
      setPatientId(id);
      const [consentResult, historyResult, requestResult] = await Promise.all([
        api.get(`/patients/${id}/consents`),
        api.get(`/governance/patients/${id}/access-history`),
        api.get('/governance/requests/mine'),
      ]);
      setConsents(consentResult.data.details || []);
      setAccessHistory(historyResult.data.data || []);
      setRequests(requestResult.data.data || []);
    } catch (loadError) {
      setError(loadError.response?.data?.message || t('governance.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const latestConsent = (type) => consents.find((consent) => consent.consentType === type);

  const recordConsent = async (consentType) => {
    try {
      await api.post(`/patients/${patientId}/consents`, {
        consentType,
        textVersion: 'governance-v1',
        language: i18n.language === 'te' ? 'te' : 'en',
        granted: true,
      });
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || t('governance.actionError'));
    }
  };

  const withdrawConsent = async (consentId) => {
    try {
      await api.delete(`/patients/${patientId}/consents/${consentId}`);
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || t('governance.actionError'));
    }
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    try {
      const requestedChanges = Object.fromEntries(
        Object.entries(correctionChanges).filter(([, value]) => value !== ''),
      );
      await api.post('/governance/requests', {
        requestType,
        reason,
        ...(requestType === 'correction' ? { requestedChanges } : {}),
      });
      setReason('');
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || t('governance.actionError'));
    }
  };

  if (loading) {
    return <section className="mx-auto max-w-5xl p-6 text-lg">{t('governance.loading')}</section>;
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="rounded-3xl border border-teal-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold uppercase tracking-wider text-teal-700">
          {t('governance.eyebrow')}
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">{t('governance.title')}</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-700">
          {t('governance.description')}
        </p>
      </header>

      {error ? (
        <div
          className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <section
        className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
        aria-labelledby="consent-title"
      >
        <div>
          <h2 id="consent-title" className="text-2xl font-bold text-slate-900">
            {t('governance.consentsTitle')}
          </h2>
          <p className="mt-1 text-slate-600">{t('governance.consentsDescription')}</p>
        </div>
        <div className="grid gap-3">
          {consentTypes.map((type) => {
            const latest = latestConsent(type);
            const active = latest?.granted === true && !latest?.withdrawnAt;
            return (
              <article key={type} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-3xl" aria-hidden="true">
                      🛡️
                    </span>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">
                        {t(`governance.types.${type}`)}
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {t(`governance.explanations.${type}`)}
                      </p>
                      <p className="mt-2 text-sm font-semibold" role="status">
                        {active ? t('governance.active') : t('governance.withdrawn')}
                        {latest?.recordedAt
                          ? ` · ${new Date(latest.recordedAt).toLocaleString(i18n.language)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {active ? (
                      <button
                        type="button"
                        className="min-h-touch rounded-xl border border-rose-300 px-4 py-2 font-semibold text-rose-800 hover:bg-rose-50"
                        onClick={() => withdrawConsent(latest._id)}
                      >
                        {t('governance.withdraw')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="min-h-touch rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800"
                        onClick={() => recordConsent(type)}
                      >
                        {t('governance.recordAgain')}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-2xl font-bold text-slate-900">{t('governance.accessTitle')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('governance.accessDescription')}</p>
          <ol className="mt-4 space-y-3">
            {accessHistory.length ? (
              accessHistory.map((entry) => (
                <li key={entry._id} className="flex gap-3 rounded-xl border border-slate-200 p-3">
                  <span aria-hidden="true" className="text-2xl">
                    🔎
                  </span>
                  <div className="text-sm">
                    <div className="font-semibold text-slate-900">
                      {entry.actorId?.fullName || t('governance.unknownViewer')} ·{' '}
                      {entry.actorId?.role || t('governance.system')}
                    </div>
                    <div className="text-slate-600">
                      {t(`governance.actions.${entry.action}`, entry.action)}
                    </div>
                    <time className="text-slate-600" dateTime={entry.occurredAt}>
                      {new Date(entry.occurredAt).toLocaleString(i18n.language)}
                    </time>
                  </div>
                </li>
              ))
            ) : (
              <li className="rounded-xl bg-slate-50 p-4 text-slate-600">
                {t('governance.noAccess')}
              </li>
            )}
          </ol>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-2xl font-bold text-slate-900">{t('governance.requestTitle')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('governance.requestDescription')}</p>
          <form className="mt-4 space-y-3" onSubmit={submitRequest}>
            <label className="block text-sm font-semibold text-slate-800">
              {t('governance.requestType')}
              <select
                className="mt-1 min-h-touch w-full rounded-xl border border-slate-300 px-3"
                value={requestType}
                onChange={(event) => {
                  setRequestType(event.target.value);
                  setCorrectionChanges({
                    fullName: '',
                    dateOfBirth: '',
                    sexAtBirth: '',
                    district: '',
                  });
                }}
              >
                <option value="correction">{t('governance.correction')}</option>
                <option value="deletion">{t('governance.deletion')}</option>
              </select>
            </label>
            {requestType === 'correction' ? (
              <>
                <label className="block text-sm font-semibold text-slate-800">
                  {t('governance.correctedName')}
                  <input
                    className="mt-1 min-h-touch w-full rounded-xl border border-slate-300 px-3"
                    maxLength={120}
                    value={correctionChanges.fullName}
                    onChange={(event) =>
                      setCorrectionChanges({ ...correctionChanges, fullName: event.target.value })
                    }
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-800">
                  {t('governance.correctedBirthDate')}
                  <input
                    className="mt-1 min-h-touch w-full rounded-xl border border-slate-300 px-3"
                    type="date"
                    value={correctionChanges.dateOfBirth}
                    onChange={(event) =>
                      setCorrectionChanges({
                        ...correctionChanges,
                        dateOfBirth: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-800">
                  {t('governance.correctedSex')}
                  <select
                    className="mt-1 min-h-touch w-full rounded-xl border border-slate-300 px-3"
                    value={correctionChanges.sexAtBirth}
                    onChange={(event) =>
                      setCorrectionChanges({ ...correctionChanges, sexAtBirth: event.target.value })
                    }
                  >
                    <option value="">{t('governance.keepCurrent')}</option>
                    <option value="female">{t('governance.sexFemale')}</option>
                    <option value="male">{t('governance.sexMale')}</option>
                    <option value="intersex">{t('governance.sexIntersex')}</option>
                    <option value="undisclosed">{t('governance.sexUndisclosed')}</option>
                  </select>
                </label>
                <label className="block text-sm font-semibold text-slate-800">
                  {t('governance.correctedDistrict')}
                  <input
                    className="mt-1 min-h-touch w-full rounded-xl border border-slate-300 px-3"
                    maxLength={100}
                    value={correctionChanges.district}
                    onChange={(event) => setCorrectionChanges({ district: event.target.value })}
                  />
                </label>
              </>
            ) : null}
            <label className="block text-sm font-semibold text-slate-800">
              {t('governance.reason')}
              <textarea
                className="mt-1 min-h-28 w-full rounded-xl border border-slate-300 p-3"
                minLength={10}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="min-h-touch rounded-xl bg-teal-700 px-4 py-2 font-bold text-white"
            >
              {t('governance.submitRequest')}
            </button>
          </form>
          <div className="mt-5 space-y-2">
            {requests.map((request) => (
              <div
                key={request._id}
                className="flex justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm"
              >
                <span className="font-medium">{t(`governance.${request.requestType}`)}</span>
                <span>{t(`governance.status.${request.status}`)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}
