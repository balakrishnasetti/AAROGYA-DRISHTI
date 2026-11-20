import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../../services/api.js';
import { useAuth } from '../../store/useAuth.js';
import QrPatientScanner from './QrPatientScanner.jsx';
import DoctorCallInbox from './DoctorCallInbox.jsx';
import ClinicianReviewQueue from './ClinicianReviewQueue.jsx';

function localDateTime(value, language) {
  return value ? new Date(value).toLocaleString(language) : '';
}

export default function DoctorWorkflowPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [cases, setCases] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [history, setHistory] = useState([]);
  const [reports, setReports] = useState([]);
  const [careJourney, setCareJourney] = useState(null);
  const [journeyReason, setJourneyReason] = useState('');
  const [imageUrls, setImageUrls] = useState({});
  const [feedbackFindings, setFeedbackFindings] = useState({});
  const [feedbackReasons, setFeedbackReasons] = useState({});
  const [note, setNote] = useState('');
  const [releaseNote, setReleaseNote] = useState(false);
  const [referralReason, setReferralReason] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [urgency, setUrgency] = useState('routine');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpInstructions, setFollowUpInstructions] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedId),
    [cases, selectedId],
  );

  const loadCases = useCallback(async () => {
    setError('');
    try {
      const response = await api.get('/doctor/cases');
      const records = response.data.details || [];
      setCases(records);
      return records;
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, t('doctorWorkflow.loadError')));
      return [];
    }
  }, [t]);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  const loadCase = useCallback(
    async (caseItem) => {
      setSelectedId(caseItem.id);
      setHistory([]);
      setReports([]);
      setCareJourney(null);
      setError('');
      setMessage('');
      if (caseItem.status !== 'confirmed') return;
      try {
        const [historyResponse, reportResponse, journeyResponse] = await Promise.all([
          api.get(`/patients/${caseItem.patientId}/history`),
          api.get(`/doctor/cases/${caseItem.patientId}/reports`),
          api.get(`/doctor/cases/${caseItem.patientId}/care-journey`),
        ]);
        setHistory(historyResponse.data.details.items || []);
        setReports(reportResponse.data.details || []);
        setCareJourney(journeyResponse.data.details);
      } catch (loadError) {
        setError(getApiErrorMessage(loadError, t('doctorWorkflow.recordLoadError')));
      }
    },
    [t],
  );

  useEffect(() => {
    let active = true;
    const urls = {};
    Promise.all(
      reports.map(async (report) => {
        if (!report.mediaAssetId || !selectedCase) return;
        try {
          const response = await api.get(
            `/doctor/cases/${selectedCase.patientId}/media/${report.mediaAssetId}`,
            { responseType: 'blob' },
          );
          urls[report.mediaAssetId] = URL.createObjectURL(response.data);
        } catch {
          if (active) setError(t('doctorWorkflow.imageLoadError'));
        }
      }),
    ).then(() => {
      if (active) setImageUrls(urls);
      else Object.values(urls).forEach(URL.revokeObjectURL);
    });
    return () => {
      active = false;
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
  }, [reports, selectedCase, t]);

  async function updateAppointment(appointmentId, status) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/appointments/${appointmentId}/status`, { status });
      const updatedCases = await loadCases();
      const updated = updatedCases.find((item) => item.id === appointmentId);
      if (updated && status === 'confirmed') {
        await loadCase({ ...updated, status: 'confirmed' });
      }
      setMessage(t('doctorWorkflow.appointmentUpdated'));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('doctorWorkflow.actionError')));
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(event) {
    event.preventDefault();
    if (!selectedCase?.consultationId) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.post(
        `/doctor/consultations/${selectedCase.consultationId}/notes`,
        {
          body: note,
          releasedToPatient: releaseNote,
        },
      );
      setMessage(t('doctorWorkflow.noteSigned', { version: response.data.details.version }));
      setNote('');
      await loadCase(selectedCase);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('doctorWorkflow.actionError')));
    } finally {
      setBusy(false);
    }
  }

  async function createReferral(event) {
    event.preventDefault();
    if (!selectedCase) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/doctor/cases/${selectedCase.patientId}/referrals`, {
        reason: referralReason,
        urgency,
        specialty,
        destinationName,
        ...(selectedCase.screeningSessionId
          ? { screeningSessionId: selectedCase.screeningSessionId }
          : {}),
      });
      setReferralReason('');
      setSpecialty('');
      setDestinationName('');
      setMessage(t('doctorWorkflow.referralCreated'));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('doctorWorkflow.actionError')));
    } finally {
      setBusy(false);
    }
  }

  async function createFollowUp(event) {
    event.preventDefault();
    if (!selectedCase || !followUpDate) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/doctor/cases/${selectedCase.patientId}/follow-ups`, {
        followUpDate: new Date(followUpDate).toISOString(),
        instructions: followUpInstructions,
        ...(selectedCase.consultationId ? { consultationId: selectedCase.consultationId } : {}),
      });
      setFollowUpInstructions('');
      setMessage(t('doctorWorkflow.followUpCreated'));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('doctorWorkflow.actionError')));
    } finally {
      setBusy(false);
    }
  }

  async function submitReportFeedback(event, report) {
    event.preventDefault();
    const correctedFinding = feedbackFindings[report._id] || report.finding;
    const note = feedbackReasons[report._id]?.trim() || '';
    if (!selectedCase || !correctedFinding) return;
    if (!note) {
      setError(t('doctorWorkflow.reviewReasonRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/doctor/cases/${selectedCase.patientId}/reports/${report._id}/feedback`, {
        agreesWithFinding: correctedFinding === report.finding,
        correctedFinding,
        note,
      });
      setFeedbackReasons((current) => ({ ...current, [report._id]: '' }));
      setMessage(t('doctorWorkflow.feedbackSaved'));
    } catch (feedbackError) {
      setError(getApiErrorMessage(feedbackError, t('doctorWorkflow.actionError')));
    } finally {
      setBusy(false);
    }
  }

  async function advanceCareJourney(toStage) {
    if (!selectedCase || !journeyReason.trim()) {
      setError(t('management.careJourney.reason'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await api.patch(
        `/doctor/cases/${selectedCase.patientId}/care-journey`,
        { toStage, reason: journeyReason.trim() },
      );
      setCareJourney(response.data.details);
      setJourneyReason('');
      setMessage(t('management.careJourney.updated'));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('doctorWorkflow.actionError')));
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'min-h-touch w-full rounded-xl border border-slate-300 bg-white px-4 py-3';
  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header className="rounded-3xl border border-teal-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-bold uppercase tracking-wider text-teal-700">
          {t('doctorWorkflow.eyebrow')}
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">{t('doctorWorkflow.title')}</h1>
        <p className="mt-2 text-slate-700">{t('doctorWorkflow.description')}</p>
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-950">
          {t('app.healthDisclaimer')}
        </p>
      </header>
      {error ? (
        <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-xl bg-teal-50 p-4 text-teal-950">
          {message}
        </p>
      ) : null}

      <QrPatientScanner />
      <DoctorCallInbox />
      <ClinicianReviewQueue />

      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
        <section className="space-y-3" aria-labelledby="doctor-queue-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="doctor-queue-title" className="text-xl font-bold">
              {t('doctorWorkflow.queue')}
            </h2>
            <button
              type="button"
              onClick={loadCases}
              className="min-h-touch rounded-lg border border-slate-300 px-3 font-semibold"
            >
              {t('doctorWorkflow.refresh')}
            </button>
          </div>
          {cases.length ? (
            cases.map((item) => (
              <article
                key={item.id}
                className={`rounded-2xl border bg-white p-4 ${item.id === selectedId ? 'border-teal-700 ring-2 ring-teal-100' : 'border-slate-200'}`}
              >
                <button type="button" onClick={() => loadCase(item)} className="w-full text-left">
                  <span className="block text-lg font-bold">{item.patientName}</span>
                  <span className="block text-sm text-slate-600">
                    {localDateTime(item.slotStart, i18n.language)}
                  </span>
                  <span className="block text-sm text-slate-600">
                    {t(item.consultationMode === 'video' ? 'booking.video' : 'booking.inPerson')} ·
                    ₹{Number(item.feeAmount ?? 0).toFixed(2)}
                  </span>
                  <span className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">
                    {t(`doctorWorkflow.status.${item.status}`, { defaultValue: item.status })}
                  </span>
                </button>
                {item.reason ? <p className="mt-2 text-sm text-slate-700">{item.reason}</p> : null}
                {['requested', 'accepted'].includes(item.status) ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => updateAppointment(item.id, 'confirmed')}
                      className="min-h-touch rounded-lg bg-teal-800 px-3 font-semibold text-white"
                    >
                      {t('doctorWorkflow.confirm')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => updateAppointment(item.id, 'declined')}
                      className="min-h-touch rounded-lg border border-rose-300 px-3 font-semibold text-rose-800"
                    >
                      {t('doctorWorkflow.decline')}
                    </button>
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <p className="rounded-2xl bg-white p-4 text-slate-600">{t('doctorWorkflow.empty')}</p>
          )}
        </section>

        <section className="space-y-5">
          {!selectedCase ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-700">
              {t('doctorWorkflow.chooseCase')}
            </p>
          ) : selectedCase.status !== 'confirmed' ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-700">
              {t('doctorWorkflow.confirmForRecords')}
            </p>
          ) : (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-xl font-bold">
                  {t('doctorWorkflow.caseTitle', { name: selectedCase.patientName })}
                </h2>
                <p className="mt-2 text-sm text-slate-600">{t('doctorWorkflow.dataConsent')}</p>
                {careJourney ? (
                  <section
                    className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-4"
                    aria-labelledby="doctor-care-journey-title"
                  >
                    <h3 id="doctor-care-journey-title" className="font-bold text-teal-950">
                      {t('management.careJourneyTitle')}
                    </h3>
                    <p className="mt-2 text-sm font-semibold text-teal-900">
                      {t(`management.careJourney.${careJourney.stage}`)}
                    </p>
                    <label className="mt-3 block text-sm font-medium text-slate-800">
                      {t('management.careJourney.reason')}
                      <input
                        className={`${inputClass} mt-1`}
                        maxLength={500}
                        onChange={(event) => setJourneyReason(event.target.value)}
                        value={journeyReason}
                      />
                    </label>
                    {careJourney.allowedNextStages?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {careJourney.allowedNextStages.map((stage) => (
                          <button
                            className="min-h-touch rounded-lg bg-teal-800 px-3 font-semibold text-white disabled:opacity-50"
                            disabled={busy || !journeyReason.trim()}
                            key={stage}
                            onClick={() => advanceCareJourney(stage)}
                            type="button"
                          >
                            {t('management.careJourney.advance', {
                              stage: t(`management.careJourney.${stage}`),
                            })}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <h4 className="mt-4 text-sm font-bold">
                      {t('management.careJourney.history')}
                    </h4>
                    {careJourney.history?.length ? (
                      <ol className="mt-2 space-y-2 text-sm">
                        {careJourney.history.map((entry, index) => (
                          <li
                            className="rounded-lg border border-teal-100 bg-white p-3"
                            key={`${entry.toStage}-${entry.changedAt}-${index}`}
                          >
                            <span className="font-semibold">
                              {t(`management.careJourney.${entry.fromStage}`)} →{' '}
                              {t(`management.careJourney.${entry.toStage}`)}
                            </span>
                            <span className="ml-2 text-xs text-slate-500">
                              {localDateTime(entry.changedAt, i18n.language)}
                            </span>
                            <p className="mt-1 text-slate-700">{entry.reason}</p>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-1 text-sm text-slate-600">
                        {t('management.careJourney.noHistory')}
                      </p>
                    )}
                  </section>
                ) : null}
                {history.length ? (
                  <ol className="mt-4 space-y-3">
                    {history.map((entry, index) => (
                      <li
                        key={`${entry.type}-${entry.item?._id || index}`}
                        className="rounded-xl border border-slate-200 p-4"
                      >
                        <h3 className="font-bold">
                          {t(`doctorWorkflow.history.${entry.type}`, { defaultValue: entry.type })}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {localDateTime(entry.createdAt, i18n.language)}
                        </p>
                        {entry.type === 'questionnaire' ? (
                          <ul className="mt-2 space-y-1 text-sm">
                            {(entry.item.answers || []).map((answer) => (
                              <li key={answer.questionKey}>
                                <span className="font-semibold">
                                  {t(`screening.questions.${answer.questionKey}`, {
                                    defaultValue: answer.questionKey,
                                  })}
                                  :
                                </span>{' '}
                                {answer.skipped
                                  ? t('screening.skip')
                                  : Array.isArray(answer.answer)
                                    ? answer.answer
                                        .map((value) =>
                                          t(`screening.options.${value}`, { defaultValue: value }),
                                        )
                                        .join(', ')
                                    : String(answer.answer ?? '')}
                              </li>
                            ))}
                          </ul>
                        ) : entry.type === 'ai_report' ? (
                          <div className="mt-2 space-y-2">
                            <p className="font-bold text-rose-800">
                              {t('doctorWorkflow.aiDisclaimer')}
                            </p>
                            <p>
                              {t('screening.risk.' + entry.item.riskCategory)} ·{' '}
                              {entry.item.imageQuality}
                            </p>
                            <p>{entry.item.explanation}</p>
                            <ul className="list-disc pl-5 text-sm">
                              {(entry.item.observedFeatures || []).map((feature, i) => (
                                <li key={i}>{feature}</li>
                              ))}
                            </ul>
                          </div>
                        ) : entry.type === 'released_note' ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm">{entry.item.body}</p>
                        ) : (
                          <p className="mt-2 text-sm text-slate-700">
                            {entry.item.status ||
                              entry.item.state ||
                              entry.item.region ||
                              entry.item.reason ||
                              ''}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-slate-600">{t('doctorWorkflow.noRecords')}</p>
                )}
              </section>

              {reports.length ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                  <h2 className="text-xl font-bold">{t('doctorWorkflow.images')}</h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {reports.map((report) => (
                      <figure key={report._id} className="rounded-xl border border-slate-200 p-3">
                        {imageUrls[report.mediaAssetId] ? (
                          <div className="relative">
                            <img
                              src={imageUrls[report.mediaAssetId]}
                              alt={t('doctorWorkflow.imageAlt', {
                                region: t(`screening.regions.${report.region}`, {
                                  defaultValue: report.region,
                                }),
                              })}
                              className="max-h-72 w-full rounded-lg object-contain"
                            />
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute right-3 top-3 rounded bg-black/60 px-2 py-1 text-xs font-semibold text-white"
                            >
                              {t('doctorWorkflow.viewerWatermark', {
                                id: user?.id || user?._id || '',
                              })}
                            </span>
                          </div>
                        ) : (
                          <p className="p-8 text-center text-slate-600">
                            {t('doctorWorkflow.imageLoading')}
                          </p>
                        )}
                        <figcaption className="mt-2 text-sm">
                          {t(`screening.regions.${report.region}`, { defaultValue: report.region })}{' '}
                          · {localDateTime(report.generatedAt, i18n.language)}
                        </figcaption>
                        {report.finding ? (
                          <form
                            className="mt-3 space-y-2 border-t border-slate-200 pt-3"
                            onSubmit={(event) => submitReportFeedback(event, report)}
                          >
                            <p className="text-sm font-semibold">
                              {t('screening.resultNotDiagnosis')}:{' '}
                              {t(`screening.findings.${report.finding}`)}
                            </p>
                            <label className="grid gap-1 text-sm font-semibold">
                              {t('doctorWorkflow.correctFinding')}
                              <select
                                className={inputClass}
                                value={feedbackFindings[report._id] || report.finding}
                                onChange={(event) =>
                                  setFeedbackFindings((current) => ({
                                    ...current,
                                    [report._id]: event.target.value,
                                  }))
                                }
                              >
                                {[
                                  'white_patch',
                                  'red_patch',
                                  'ulcer_like_area',
                                  'raised_area',
                                  'no_visible_finding',
                                  'uncertain',
                                ].map((finding) => (
                                  <option key={finding} value={finding}>
                                    {finding === 'uncertain'
                                      ? t('doctorWorkflow.uncertain')
                                      : t(`screening.findings.${finding}`)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="grid gap-1 text-sm font-semibold">
                              {t('doctorWorkflow.reviewReason')}
                              <textarea
                                className={inputClass}
                                maxLength={1000}
                                minLength={1}
                                onChange={(event) =>
                                  setFeedbackReasons((current) => ({
                                    ...current,
                                    [report._id]: event.target.value,
                                  }))
                                }
                                required
                                rows={3}
                                value={feedbackReasons[report._id] || ''}
                              />
                            </label>
                            <button
                              className="min-h-touch rounded-lg border border-teal-700 px-4 font-semibold text-teal-900 disabled:opacity-50"
                              disabled={busy}
                              type="submit"
                            >
                              {t('doctorWorkflow.submitFeedback')}
                            </button>
                          </form>
                        ) : null}
                      </figure>
                    ))}
                  </div>
                </section>
              ) : null}

              {selectedCase.consultationId ? (
                <form
                  onSubmit={saveNote}
                  className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <h2 className="text-xl font-bold">{t('doctorWorkflow.noteTitle')}</h2>
                  <p className="text-sm text-slate-700">{t('doctorWorkflow.noteHelp')}</p>
                  <textarea
                    className={inputClass}
                    rows={5}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    required
                    maxLength={20000}
                  />
                  <label className="flex min-h-touch items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-teal-700"
                      checked={releaseNote}
                      onChange={(event) => setReleaseNote(event.target.checked)}
                    />
                    {t('doctorWorkflow.releaseNote')}
                  </label>
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white disabled:opacity-50"
                  >
                    {t('doctorWorkflow.signNote')}
                  </button>
                </form>
              ) : null}

              <form
                onSubmit={createReferral}
                className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"
              >
                <h2 className="text-xl font-bold">{t('doctorWorkflow.referralTitle')}</h2>
                <label className="grid gap-2 font-semibold">
                  {t('doctorWorkflow.specialty')}
                  <input
                    className={inputClass}
                    value={specialty}
                    onChange={(event) => setSpecialty(event.target.value)}
                    maxLength={120}
                  />
                </label>
                <label className="grid gap-2 font-semibold">
                  {t('doctorWorkflow.destination')}
                  <input
                    className={inputClass}
                    value={destinationName}
                    onChange={(event) => setDestinationName(event.target.value)}
                    maxLength={160}
                  />
                </label>
                <textarea
                  className={inputClass}
                  rows={3}
                  value={referralReason}
                  onChange={(event) => setReferralReason(event.target.value)}
                  placeholder={t('doctorWorkflow.referralReason')}
                  required
                  maxLength={2000}
                />
                <label className="grid gap-2 font-semibold">
                  {t('doctorWorkflow.priority')}
                  <select
                    className={inputClass}
                    value={urgency}
                    onChange={(event) => setUrgency(event.target.value)}
                  >
                    {['routine', 'soon', 'urgent'].map((value) => (
                      <option key={value} value={value}>
                        {t(`booking.status.${value}`, {
                          defaultValue: t(`doctorWorkflow.urgency.${value}`),
                        })}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-touch rounded-xl border border-teal-700 px-5 font-bold text-teal-900"
                >
                  {t('doctorWorkflow.createReferral')}
                </button>
              </form>

              <form
                onSubmit={createFollowUp}
                className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"
              >
                <h2 className="text-xl font-bold">{t('doctorWorkflow.followUpTitle')}</h2>
                <label className="grid gap-2 font-semibold">
                  {t('doctorWorkflow.followUpDate')}
                  <input
                    className={inputClass}
                    type="datetime-local"
                    value={followUpDate}
                    onChange={(event) => setFollowUpDate(event.target.value)}
                    required
                  />
                </label>
                <textarea
                  className={inputClass}
                  rows={2}
                  value={followUpInstructions}
                  onChange={(event) => setFollowUpInstructions(event.target.value)}
                  placeholder={t('doctorWorkflow.followUpInstructions')}
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-touch rounded-xl border border-teal-700 px-5 font-bold text-teal-900"
                >
                  {t('doctorWorkflow.createFollowUp')}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
