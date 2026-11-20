import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../../services/api.js';
import PushNotificationsButton from '../../components/PushNotificationsButton.jsx';
import useConsultationSocket from '../../hooks/useConsultationSocket.js';
import ConsultationCallRoom from '../shared/ConsultationCallRoom.jsx';

const urgentPattern =
  /\b(bleed(?:ing)?|heavy blood|trouble breathing|difficulty breathing|cannot breathe|can't breathe|breathlessness|trouble swallowing|difficulty swallowing|unable to swallow)\b|రక్తస్రావం|శ్వాస తీసుకోవడంలో ఇబ్బంది|మింగడంలో ఇబ్బంది/i;

function requestReasonLabel(t, reason) {
  return t(`consultation.reason.${reason}`, { defaultValue: reason });
}

export default function CallRequestPanel({ canShareRecords }) {
  const { t, i18n } = useTranslation();
  const socket = useConsultationSocket();
  const [doctors, setDoctors] = useState([]);
  const [doctorsLoaded, setDoctorsLoaded] = useState(false);
  const [reports, setReports] = useState([]);
  const [requests, setRequests] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [reason, setReason] = useState('follow_up');
  const [details, setDetails] = useState('');
  const [reportId, setReportId] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [callRequest, setCallRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const emergency = useMemo(() => urgentPattern.test(details), [details]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setDoctorsLoaded(false);
    setError('');
    try {
      const [doctorResult, requestResult] = await Promise.allSettled([
        api.get('/calls/doctors'),
        api.get('/calls/mine'),
      ]);
      const failures = [];
      if (doctorResult.status === 'fulfilled') {
        setDoctors(doctorResult.value.data.details || []);
        setDoctorsLoaded(true);
      } else {
        failures.push(doctorResult.reason);
      }
      if (requestResult.status === 'fulfilled') {
        setRequests(requestResult.value.data.details || []);
      } else {
        failures.push(requestResult.reason);
      }
      if (canShareRecords) {
        try {
          const profileResponse = await api.get('/patients/me');
          const historyResponse = await api.get(
            `/patients/${profileResponse.data.details.id}/history`,
          );
          setReports(
            (historyResponse.data.details.items || []).filter(
              (entry) => entry.type === 'ai_report',
            ),
          );
        } catch (historyError) {
          failures.push(historyError);
        }
      } else {
        setReports([]);
        setReportId('');
      }
      if (failures.length) {
        setError(getApiErrorMessage(failures[0], t('consultation.loadError')));
      }
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, t('consultation.loadError')));
    } finally {
      setLoading(false);
    }
  }, [canShareRecords, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => loadData();
    socket.on('connect', refresh);
    socket.on('consultation:request-updated', refresh);
    socket.on('consultation:report-added', refresh);
    return () => {
      socket.off('connect', refresh);
      socket.off('consultation:request-updated', refresh);
      socket.off('consultation:report-added', refresh);
    };
  }, [loadData, socket]);

  async function submitRequest(event) {
    event.preventDefault();
    if (!consentAccepted) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await api.post('/calls/requests', {
        ...(doctorId ? { doctorId } : {}),
        reason,
        details,
        ...(reportId ? { reportId } : {}),
        consentAccepted: true,
        consentVersion: 'video-call-v1',
        language: i18n.language.startsWith('te') ? 'te' : 'en',
      });
      setRequests((current) => [response.data.details, ...current]);
      setDetails('');
      setReportId('');
      setConsentAccepted(false);
      setMessage(t('consultation.requestSent'));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('consultation.requestError')));
    } finally {
      setBusy(false);
    }
  }

  async function respondToSuggestion(requestId) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/calls/requests/${requestId}/accept-suggestion`);
      await loadData();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('consultation.actionError')));
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'min-h-touch w-full rounded-xl border border-slate-300 bg-white px-4 py-3';
  return (
    <section className="space-y-5 rounded-3xl border border-teal-200 bg-white p-5 shadow-sm sm:p-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">{t('consultation.requestTitle')}</h2>
          <p className="mt-1 text-slate-700">{t('consultation.requestDescription')}</p>
        </div>
        <PushNotificationsButton />
      </header>
      {emergency ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-950"
          role="alert"
        >
          <p className="font-semibold">{t('consultation.emergencyWarning')}</p>
          <a
            className="inline-flex min-h-touch items-center rounded-lg bg-rose-700 px-4 font-bold text-white"
            href="tel:112"
          >
            {t('consultation.call112')}
          </a>
        </div>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-rose-50 p-3 text-rose-900" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl bg-teal-50 p-3 text-teal-900" role="status">
          {message}
        </p>
      ) : null}
      {!loading && doctorsLoaded && doctors.length === 0 ? (
        <p
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950"
          role="status"
        >
          {t('consultation.noDoctorsAvailable')}
        </p>
      ) : null}
      <form className="grid gap-4 md:grid-cols-2" onSubmit={submitRequest}>
        <label className="grid gap-2 font-semibold">
          {t('consultation.chooseDoctor')}
          <select
            className={inputClass}
            onChange={(event) => setDoctorId(event.target.value)}
            value={doctorId}
          >
            <option value="">{t('consultation.anyDoctor')}</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.fullName} · {doctor.specialty} · {doctor.hospitalName}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 font-semibold">
          {t('consultation.reasonLabel')}
          <select
            className={inputClass}
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          >
            {['follow_up', 'new_symptom', 'report_question'].map((item) => (
              <option key={item} value={item}>
                {requestReasonLabel(t, item)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 font-semibold md:col-span-2">
          {t('consultation.detailsLabel')}
          <textarea
            className={inputClass}
            maxLength={1200}
            onChange={(event) => setDetails(event.target.value)}
            rows={3}
            value={details}
          />
        </label>
        <label className="grid gap-2 font-semibold md:col-span-2">
          {t('consultation.attachReport')}
          <select
            className={inputClass}
            disabled={!canShareRecords || !reports.length}
            onChange={(event) => setReportId(event.target.value)}
            value={reportId}
          >
            <option value="">{t('consultation.noReport')}</option>
            {reports.map((entry) => (
              <option key={entry.item._id} value={entry.item._id}>
                {new Date(entry.createdAt).toLocaleDateString(i18n.language)} ·{' '}
                {t(`screening.risk.${entry.item.riskCategory}`, {
                  defaultValue: entry.item.riskCategory,
                })}
              </option>
            ))}
          </select>
          {!canShareRecords ? (
            <span className="text-sm font-normal text-amber-900">
              {t('consultation.reportConsentRequired')}
            </span>
          ) : null}
        </label>
        <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm md:col-span-2">
          <input
            checked={consentAccepted}
            className="mt-1 size-5"
            onChange={(event) => setConsentAccepted(event.target.checked)}
            required
            type="checkbox"
          />
          <span>{t('consultation.consentText')}</span>
        </label>
        <p className="text-sm text-slate-600 md:col-span-2">{t('consultation.recordingOff')}</p>
        <button
          className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white disabled:opacity-50 md:col-span-2"
          disabled={busy || !consentAccepted || !doctors.length}
          type="submit"
        >
          {busy ? t('consultation.pleaseWait') : t('consultation.sendRequest')}
        </button>
      </form>

      <section className="border-t border-slate-200 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-bold">{t('consultation.myRequests')}</h3>
          <button
            className="min-h-touch rounded-lg border px-3 font-semibold"
            disabled={loading}
            onClick={loadData}
            type="button"
          >
            {t('consultation.refresh')}
          </button>
        </div>
        {requests.length ? (
          <ul className="mt-3 space-y-3">
            {requests.map((item) => (
              <li className="rounded-2xl border border-slate-200 p-4" key={item._id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {item.doctorName} · {requestReasonLabel(t, item.reason)}
                  </p>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">
                    {t(`consultation.status.${item.status}`, { defaultValue: item.status })}
                  </span>
                </div>
                {item.details ? (
                  <p className="mt-2 text-sm text-slate-700">{item.details}</p>
                ) : null}
                {item.report ? (
                  <p className="mt-2 rounded-lg bg-teal-50 p-2 text-sm text-teal-950">
                    {t('consultation.reportAttached')}:{' '}
                    {item.report.finding || item.report.riskCategory} · {item.report.region}
                    <span className="ml-1">{t('consultation.notDiagnosis')}</span>
                  </p>
                ) : null}
                {item.urgent ? (
                  <a
                    className="mt-2 inline-flex min-h-touch items-center rounded-lg bg-rose-700 px-4 font-bold text-white"
                    href="tel:112"
                  >
                    {t('consultation.call112')}
                  </a>
                ) : null}
                {item.suggestedAt && item.status === 'pending' ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <p className="text-sm">
                      {t('consultation.suggestedTime')}:{' '}
                      {new Date(item.suggestedAt).toLocaleString(i18n.language)}
                    </p>
                    <button
                      className="min-h-touch rounded-lg bg-teal-800 px-3 font-semibold text-white"
                      disabled={busy}
                      onClick={() => respondToSuggestion(item._id)}
                      type="button"
                    >
                      {t('consultation.acceptSuggestion')}
                    </button>
                  </div>
                ) : null}
                {item.status === 'accepted' ? (
                  <button
                    className="mt-3 min-h-touch rounded-lg bg-teal-800 px-4 font-bold text-white"
                    onClick={() => setCallRequest(item)}
                    type="button"
                  >
                    {t('consultation.joinCall')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-600">{t('consultation.empty')}</p>
        )}
      </section>

      <section className="border-t border-slate-200 pt-4">
        <h3 className="text-xl font-bold">{t('consultation.reportsTitle')}</h3>
        {requests.length ? (
          <ul className="mt-3 space-y-2">
            {requests
              .filter((item) => item.status === 'completed' && item.consultationId)
              .map((item) => (
                <li className="rounded-xl border border-slate-200 p-3" key={item._id}>
                  <p className="font-semibold">
                    {item.doctorName} ·{' '}
                    {new Date(item.callEndedAt || item.requestedAt).toLocaleDateString(
                      i18n.language,
                    )}
                  </p>
                  <p className="text-sm text-slate-600">{t('consultation.reportsInDashboard')}</p>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-600">{t('consultation.noReports')}</p>
        )}
      </section>
      {callRequest ? (
        <ConsultationCallRoom
          request={callRequest}
          role="patient"
          onClose={() => {
            setCallRequest(null);
            loadData();
          }}
        />
      ) : null}
    </section>
  );
}
