import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../../services/api.js';
import PushNotificationsButton from '../../components/PushNotificationsButton.jsx';
import useConsultationSocket from '../../hooks/useConsultationSocket.js';
import ConsultationCallRoom from '../shared/ConsultationCallRoom.jsx';

function localDateTime(value, language) {
  return value ? new Date(value).toLocaleString(language) : '';
}

export default function DoctorCallInbox() {
  const { t, i18n } = useTranslation();
  const socket = useConsultationSocket();
  const [requests, setRequests] = useState([]);
  const [suggestingId, setSuggestingId] = useState('');
  const [suggestedAt, setSuggestedAt] = useState('');
  const [callRequest, setCallRequest] = useState(null);
  const [notes, setNotes] = useState({});
  const [followUpDate, setFollowUpDate] = useState({});
  const [followUpInstructions, setFollowUpInstructions] = useState({});
  const [referralReason, setReferralReason] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadRequests = useCallback(async () => {
    setError('');
    try {
      const response = await api.get('/calls/mine');
      setRequests(response.data.details || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, t('consultation.loadError')));
    }
  }, [t]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => loadRequests();
    socket.on('connect', refresh);
    socket.on('consultation:request-created', refresh);
    socket.on('consultation:request-updated', refresh);
    socket.on('consultation:report-added', refresh);
    return () => {
      socket.off('connect', refresh);
      socket.off('consultation:request-created', refresh);
      socket.off('consultation:request-updated', refresh);
      socket.off('consultation:report-added', refresh);
    };
  }, [loadRequests, socket]);

  async function respond(item, action) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.post(`/calls/requests/${item._id}/respond`, {
        action,
        ...(action === 'suggest_time' ? { suggestedAt: new Date(suggestedAt).toISOString() } : {}),
      });
      setSuggestingId('');
      setSuggestedAt('');
      await loadRequests();
      setMessage(t('consultation.actionSaved'));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('consultation.actionError')));
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes(event, item) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.post(`/calls/requests/${item._id}/notes`, {
        body: notes[item._id] || '',
        ...(followUpDate[item._id]
          ? {
              followUpDate: new Date(`${followUpDate[item._id]}T12:00:00`).toISOString(),
              followUpInstructions: followUpInstructions[item._id] || '',
            }
          : {}),
        ...(referralReason[item._id]
          ? { referralReason: referralReason[item._id] }
          : {}),
      });
      setNotes((current) => ({ ...current, [item._id]: '' }));
      setMessage(t('consultation.noteSaved'));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('consultation.actionError')));
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'min-h-touch w-full rounded-xl border border-slate-300 bg-white px-4 py-3';
  return (
    <section id="doctor-call-inbox" className="space-y-4 rounded-3xl border border-teal-200 bg-white p-5 shadow-sm sm:p-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">{t('consultation.doctorInbox')}</h2>
          <p className="mt-1 text-slate-700">{t('consultation.doctorInboxDescription')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PushNotificationsButton />
          <button className="min-h-touch rounded-xl border px-4 font-semibold" onClick={loadRequests} type="button">
            {t('consultation.refresh')}
          </button>
        </div>
      </header>
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-rose-900" role="alert">{error}</p> : null}
      {message ? <p className="rounded-xl bg-teal-50 p-3 text-teal-900" role="status">{message}</p> : null}
      {requests.length ? (
        <ul className="space-y-3">
          {requests.map((item) => (
            <li className={`rounded-2xl border p-4 ${item.urgent ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`} key={item._id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-bold">{item.patientName} · {t(`consultation.reason.${item.reason}`, { defaultValue: item.reason })}</h3>
                <span className="rounded-full bg-white px-3 py-1 text-sm font-bold">
                  {t(`consultation.status.${item.status}`, { defaultValue: item.status })}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{localDateTime(item.requestedAt, i18n.language)}</p>
              {item.urgent ? (
                <p className="mt-2 font-bold text-rose-900">{t('consultation.urgentFlag')} · <a className="underline" href="tel:112">{t('consultation.call112')}</a></p>
              ) : null}
              {item.details ? <p className="mt-2 whitespace-pre-wrap text-slate-800">{item.details}</p> : null}
              {item.report ? (
                <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-3">
                  <p className="font-bold">{t('consultation.attachedReport')}</p>
                  <p>{item.report.finding || t(`screening.risk.${item.report.riskCategory}`)} · {item.report.region}</p>
                  <p className="text-sm">{t(`screening.risk.${item.report.riskCategory}`)} · {t('consultation.notDiagnosis')}</p>
                  <p className="text-xs text-slate-600">{localDateTime(item.report.generatedAt, i18n.language)}</p>
                </div>
              ) : null}
              {item.suggestedAt ? (
                <p className="mt-2 text-sm">{t('consultation.suggestedTime')}: {localDateTime(item.suggestedAt, i18n.language)}</p>
              ) : null}
              {item.suggestionAcceptedAt ? (
                <p className="mt-2 text-sm font-semibold text-teal-900">{t('consultation.patientAcceptedSuggestion')}</p>
              ) : null}
              {item.status === 'pending' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="min-h-touch rounded-lg bg-teal-800 px-4 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => respond(item, 'accept')} type="button">
                    {t('consultation.accept')}
                  </button>
                  <button className="min-h-touch rounded-lg border border-rose-300 px-4 font-semibold text-rose-800 disabled:opacity-50" disabled={busy} onClick={() => respond(item, 'decline')} type="button">
                    {t('consultation.decline')}
                  </button>
                  {suggestingId === item._id ? (
                    <>
                      <input aria-label={t('consultation.suggestTime')} className={inputClass} onChange={(event) => setSuggestedAt(event.target.value)} type="datetime-local" value={suggestedAt} />
                      <button className="min-h-touch rounded-lg border px-4 font-semibold disabled:opacity-50" disabled={busy || !suggestedAt} onClick={() => respond(item, 'suggest_time')} type="button">
                        {t('consultation.sendSuggestion')}
                      </button>
                    </>
                  ) : (
                    <button className="min-h-touch rounded-lg border px-4 font-semibold" onClick={() => setSuggestingId(item._id)} type="button">
                      {t('consultation.suggestTime')}
                    </button>
                  )}
                </div>
              ) : null}
              {item.status === 'accepted' ? (
                <button className="mt-3 min-h-touch rounded-lg bg-teal-800 px-4 font-bold text-white" onClick={() => setCallRequest(item)} type="button">
                  {t('consultation.joinCall')}
                </button>
              ) : null}
              {item.status === 'completed' ? (
                <form className="mt-4 grid gap-3 border-t border-slate-200 pt-4" onSubmit={(event) => saveNotes(event, item)}>
                  <label className="grid gap-1 font-semibold">
                    {t('consultation.noteLabel')}
                    <textarea className={inputClass} maxLength={20000} minLength={5} onChange={(event) => setNotes((current) => ({ ...current, [item._id]: event.target.value }))} required rows={4} value={notes[item._id] || ''} />
                  </label>
                  <label className="grid gap-1 font-semibold">
                    {t('consultation.followUpDate')}
                    <input className={inputClass} onChange={(event) => setFollowUpDate((current) => ({ ...current, [item._id]: event.target.value }))} type="date" value={followUpDate[item._id] || ''} />
                  </label>
                  {followUpDate[item._id] ? (
                    <label className="grid gap-1 font-semibold">
                      {t('consultation.followUpInstructions')}
                      <textarea className={inputClass} maxLength={2000} onChange={(event) => setFollowUpInstructions((current) => ({ ...current, [item._id]: event.target.value }))} rows={2} value={followUpInstructions[item._id] || ''} />
                    </label>
                  ) : null}
                  <label className="grid gap-1 font-semibold">
                    {t('consultation.referralReason')}
                    <textarea className={inputClass} maxLength={2000} onChange={(event) => setReferralReason((current) => ({ ...current, [item._id]: event.target.value }))} rows={2} value={referralReason[item._id] || ''} />
                  </label>
                  <p className="text-sm text-slate-600">{t('consultation.noteReleaseNotice')}</p>
                  <button className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white disabled:opacity-50" disabled={busy || (notes[item._id] || '').trim().length < 5} type="submit">
                    {busy ? t('consultation.pleaseWait') : t('consultation.saveNote')}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-slate-50 p-4 text-slate-700">{t('consultation.inboxEmpty')}</p>
      )}
      {callRequest ? (
        <ConsultationCallRoom request={callRequest} role="doctor" onClose={() => { setCallRequest(null); loadRequests(); }} />
      ) : null}
    </section>
  );
}
