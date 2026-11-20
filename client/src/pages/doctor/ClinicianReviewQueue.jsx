import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../../services/api.js';

const findingOptions = [
  'white_patch',
  'red_patch',
  'ulcer_like_area',
  'raised_area',
  'no_visible_finding',
  'uncertain',
];

export default function ClinicianReviewQueue() {
  const { t, i18n } = useTranslation();
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [correctedFinding, setCorrectedFinding] = useState('uncertain');
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadTasks = useCallback(async () => {
    setError('');
    try {
      const response = await api.get('/doctor/screening-reviews');
      setTasks(response.data.details || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, t('doctorReview.loadError')));
    }
  }, [t]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setImageUrl('');
    if (selected?.report?.mediaAssetId) {
      api
        .get(`/doctor/cases/${selected.patientId}/media/${selected.report.mediaAssetId}`, {
          responseType: 'blob',
        })
        .then((response) => {
          objectUrl = URL.createObjectURL(response.data);
          if (active) setImageUrl(objectUrl);
          else URL.revokeObjectURL(objectUrl);
        })
        .catch((imageError) => {
          if (active) setError(getApiErrorMessage(imageError, t('doctorReview.imageError')));
        });
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected, t]);

  async function openReview(task) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.patch(`/doctor/screening-reviews/${task._id}/start`);
      setSelected(task);
      setCorrectedFinding(task.report.finding || 'uncertain');
      setTasks((current) =>
        current.map((item) =>
          item._id === task._id ? { ...item, status: 'in_review' } : item,
        ),
      );
    } catch (reviewError) {
      setError(getApiErrorMessage(reviewError, t('doctorReview.actionError')));
    } finally {
      setBusy(false);
    }
  }

  async function submitFeedback(event) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.post(
        `/doctor/cases/${selected.patientId}/reports/${selected.reportId}/feedback`,
        {
          agreesWithFinding: correctedFinding === selected.report.finding,
          correctedFinding,
        },
      );
      setSelected(null);
      setMessage(t('doctorReview.saved'));
      await loadTasks();
    } catch (feedbackError) {
      setError(getApiErrorMessage(feedbackError, t('doctorReview.actionError')));
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'min-h-touch w-full rounded-xl border border-slate-300 bg-white px-4 py-3';
  return (
    <section id="doctor-review-queue" className="space-y-4 rounded-3xl border-2 border-rose-200 bg-white p-5 sm:p-7">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">{t('doctorReview.title')}</h2>
          <p className="mt-1 text-slate-700">{t('doctorReview.description')}</p>
        </div>
        <button
          className="min-h-touch rounded-xl border border-slate-300 px-4 font-semibold"
          disabled={busy}
          onClick={loadTasks}
          type="button"
        >
          {t('doctorReview.refresh')}
        </button>
      </header>
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-rose-900" role="alert">{error}</p> : null}
      {message ? <p className="rounded-xl bg-teal-50 p-3 text-teal-950" role="status">{message}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
        <ul className="space-y-2" aria-label={t('doctorReview.title')}>
          {tasks.map((task) => (
            <li key={task._id}>
              <button
                className={`w-full rounded-xl border p-4 text-left ${selected?._id === task._id ? 'border-rose-700 bg-rose-50' : 'border-slate-200'}`}
                disabled={busy}
                onClick={() => openReview(task)}
                type="button"
              >
                <span className="block font-bold">{task.patientName}</span>
                <span className="block text-sm text-slate-700">
                  {t(`doctorReview.priority.${task.priority}`)} ·{' '}
                  {new Date(task.createdAt).toLocaleString(i18n.language)}
                </span>
                <span className="block text-sm text-slate-700">
                  {task.report.finding
                    ? t(`screening.findings.${task.report.finding}`)
                    : t('screening.unclearResult')}
                </span>
              </button>
            </li>
          ))}
          {!tasks.length ? (
            <li className="rounded-xl bg-slate-50 p-4 text-slate-700">{t('doctorReview.empty')}</li>
          ) : null}
        </ul>

        {selected ? (
          <article className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <div>
              <h3 className="text-xl font-bold">{selected.patientName}</h3>
              <p>{t(`screening.risk.${selected.report.riskCategory}`)} · {selected.report.imageQuality}</p>
              {selected.report.confidenceCalibrated &&
              Number.isFinite(selected.report.confidence) ? (
                <p>{t('screening.modelConfidence')}: {Math.round(selected.report.confidence * 100)}%</p>
              ) : null}
              <p className="text-sm text-slate-600">
                {t('screening.modelInfo')}: {selected.report.modelName} · {selected.report.modelVersion}
              </p>
            </div>
            {imageUrl ? (
              <img
                alt={t('screening.sourceImageAlt')}
                className="max-h-96 rounded-xl border border-slate-200 object-contain"
                src={imageUrl}
              />
            ) : null}
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
              {t('doctorReview.disclaimer')}
            </p>
            <form className="space-y-3" onSubmit={submitFeedback}>
              <label className="grid gap-2 font-semibold">
                {t('doctorReview.correctedFinding')}
                <select
                  className={inputClass}
                  onChange={(event) => setCorrectedFinding(event.target.value)}
                  value={correctedFinding}
                >
                  {findingOptions.map((finding) => (
                    <option key={finding} value={finding}>
                      {finding === 'uncertain'
                        ? t('screening.unclearResult')
                        : t(`screening.findings.${finding}`)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white disabled:opacity-50"
                disabled={busy}
                type="submit"
              >
                {t('doctorReview.save')}
              </button>
            </form>
          </article>
        ) : (
          <p className="rounded-2xl bg-slate-50 p-5 text-slate-700">{t('doctorReview.selectTask')}</p>
        )}
      </div>
    </section>
  );
}
