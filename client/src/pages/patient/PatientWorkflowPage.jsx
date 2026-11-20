import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api, { getApiErrorMessage } from '../../services/api.js';
import { downloadScreeningReport } from '../../services/reportDownloads.js';
import { useAuth } from '../../store/useAuth.js';
import CareBookingPanel from './CareBookingPanel.jsx';
import OralCameraCapture from './OralCameraCapture.jsx';
import PatientQrCard from './PatientQrCard.jsx';
import { demoModeEnabled } from '../../config/demoMode.js';
import { hasEmergencyRedFlag } from './emergencyRedFlags.js';
import {
  checkOralPhoto,
  compressOralPhoto,
  ORAL_CAPTURE_ANGLES as captureAngles,
} from './oralPhotoUtils.js';

const urgentSymptoms = new Set(['difficulty_breathing', 'difficulty_swallowing', 'bleeding']);
const SyntheticPatientDemoPanel = demoModeEnabled
  ? lazy(() => import('./SyntheticPatientDemoPanel.jsx'))
  : null;

function answerFor(value) {
  return value ?? { answer: '', skipped: false };
}

function inconclusiveMessageKey(report) {
  const reasons = Array.isArray(report.analysisReasons) ? report.analysisReasons : [];
  if (reasons.includes('low_confidence')) return 'screening.analysisLowConfidence';
  if (
    report.imageQuality !== 'adequate' ||
    reasons.some((reason) => ['blur', 'too_dark', 'resolution', 'glare', 'not_oral'].includes(reason))
  ) {
    return 'screening.analysisPoorQuality';
  }
  return 'screening.analysisInconclusive';
}

function inconclusiveRetakeTips(report, t) {
  if (inconclusiveMessageKey(report) !== 'screening.analysisPoorQuality') return '';
  const reasons = Array.isArray(report.analysisReasons) ? report.analysisReasons : [];
  return reasons
    .filter((reason) => ['resolution', 'blur', 'too_dark', 'glare', 'not_oral'].includes(reason))
    .map((reason) => t(`screening.retakeTips.${reason}`))
    .join(' ');
}

function ProtectedReportImage({ endpoint, alt, label, t }) {
  const [imageUrl, setImageUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setFailed(false);
    api
      .get(endpoint, { responseType: 'blob', timeout: 30000 })
      .then((response) => {
        objectUrl = URL.createObjectURL(response.data);
        if (active) setImageUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint]);

  if (failed) {
    return (
      <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
        {t('screening.evidenceUnavailable', { label })}
      </p>
    );
  }
  if (!imageUrl) {
    return (
      <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700" role="status">
        {t('screening.evidenceLoading', { label })}
      </p>
    );
  }
  return (
    <figure className="space-y-2">
      <figcaption className="font-semibold">{label}</figcaption>
      <img
        className="max-h-80 w-full rounded-xl border border-slate-200 object-contain"
        src={imageUrl}
        alt={alt}
      />
    </figure>
  );
}

export default function PatientWorkflowPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [patientId, setPatientId] = useState('');
  const [profile, setProfile] = useState(null);
  const [consents, setConsents] = useState([]);
  const [questionnaire, setQuestionnaire] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [careHistory, setCareHistory] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [answers, setAnswers] = useState({});
  const [angleIndex, setAngleIndex] = useState(0);
  const [photo, setPhoto] = useState(null);
  const [photoQuality, setPhotoQuality] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [photoConsentAccepted, setPhotoConsentAccepted] = useState(false);
  const [mouthVisible, setMouthVisible] = useState(false);
  const fileInputRef = useRef(null);
  const loadInFlight = useRef(false);
  const photoUploadInFlight = useRef(false);
  const photoUploadFailureAt = useRef(0);
  const [previewUrl, setPreviewUrl] = useState('');
  const [report, setReport] = useState(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const language = i18n.language.startsWith('te') ? 'te' : 'en';
  const latestConsent = useCallback(
    (type) => consents.find((consent) => consent.consentType === type),
    [consents],
  );
  const hasConsent = useCallback(
    (type) => {
      const latest = latestConsent(type);
      return latest?.granted === true && !latest?.withdrawnAt;
    },
    [latestConsent],
  );
  const questions = useMemo(() => questionnaire?.version?.questions ?? [], [questionnaire]);
  const symptoms = answers.symptoms?.skipped ? [] : answers.symptoms?.answer || [];
  const needsEmergencyGuidance =
    symptoms.some((symptom) => urgentSymptoms.has(symptom)) ||
    hasEmergencyRedFlag(answers.free_text?.answer, language);
  const photoQualityWarning =
    photoQuality && photoQuality.imageQuality !== 'adequate'
      ? [
          t('screening.photoQualityWillSave'),
          ...(photoQuality.reasons || []).map((reason) => t(`screening.retakeTips.${reason}`)),
        ].join(' ')
      : '';
  const shouldDisplayPrediction =
    report &&
    !['unavailable', 'consent_not_granted', 'inconclusive'].includes(report.analysisStatus);

  const loadData = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const profileResponse = await api.get('/patients/me');
      const id = profileResponse.data.details.id;
      setPatientId(id);
      setProfile(profileResponse.data.details);
      const [consentResponse, questionnaireResponse, sessionResponse, historyResponse] =
        await Promise.all([
          api.get(`/patients/${id}/consents`),
          api.get(`/patients/${id}/questionnaire`),
          api.get('/patients/me/screenings'),
          api.get(`/patients/${id}/history`),
        ]);
      setConsents(consentResponse.data.details || []);
      setQuestionnaire(questionnaireResponse.data.details);
      setSessions(sessionResponse.data.details || []);
      setCareHistory(historyResponse.data.details.items || []);
      const active = sessionResponse.data.details?.find((item) =>
        ['started', 'in_progress'].includes(item.status),
      );
      const current = active || sessionResponse.data.details?.[0];
      if (current) {
        setSessionId(current._id);
        const photosResponse = await api.get(`/patients/me/screenings/${current._id}/photos`);
        const storedPhotos = photosResponse.data.details || [];
        setPhotos(storedPhotos);
        const firstMissingAngle = captureAngles.findIndex(
          (angle) => !storedPhotos.some((item) => item.region === angle && !item.deletedAt),
        );
        setAngleIndex(firstMissingAngle < 0 ? 0 : firstMissingAngle);
        const detail = await api.get(`/patients/me/screenings/${current._id}`);
        const restoredAnswers = Object.fromEntries(
          (detail.data.details.answers || []).map((answer) => [
            answer.questionKey,
            { answer: answer.answer, skipped: answer.skipped },
          ]),
        );
        setAnswers(restoredAnswers);
        setReport(detail.data.details.reports?.[0] || null);
        setStep(active ? 1 : 3);
      } else {
        setSessionId('');
        setAnswers({});
        setPhotos([]);
        setAngleIndex(0);
        setReport(null);
        setStep(0);
      }
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, t('screening.loadError')));
    } finally {
      loadInFlight.current = false;
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);
  useEffect(() => {
    if (!photo) {
      setPreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function recordConsent(type, granted = true) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/patients/${patientId}/consents`, {
        consentType: type,
        textVersion: 'patient-workflow-v1',
        language,
        granted,
      });
      const result = await api.get(`/patients/${patientId}/consents`);
      setConsents(result.data.details || []);
    } catch (actionError) {
      setError(getApiErrorMessage(actionError, t('screening.actionError')));
    } finally {
      setBusy(false);
    }
  }

  async function beginScreening() {
    if (!hasConsent('screening')) {
      setError(t('screening.screeningConsentRequired'));
      return;
    }
    if (sessionId) {
      setStep(1);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await api.post('/patients/me/screenings');
      setSessionId(response.data.details.id);
      setPhotos([]);
      setAngleIndex(0);
      setPhoto(null);
      setPhotoQuality(null);
      setPhotoConsentAccepted(false);
      setMouthVisible(false);
      setStep(1);
      setStatus(t('screening.sessionStarted'));
    } catch (actionError) {
      setError(getApiErrorMessage(actionError, t('screening.actionError')));
    } finally {
      setBusy(false);
    }
  }

  async function saveAnswers(nextStep = 2) {
    if (!sessionId) {
      setError(t('screening.startFirst'));
      return false;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/patients/${patientId}/questionnaire`, {
        screeningSessionId: sessionId,
        questionnaireVersion: questionnaire.activeVersion,
        answers: questions.map((question) => {
          const value = answerFor(answers[question.key]);
          return {
            questionKey: question.key,
            answer: value.skipped ? null : value.answer,
            skipped: Boolean(value.skipped),
          };
        }),
      });
      if (nextStep === 3) {
        await api.post(`/patients/me/screenings/${sessionId}/complete`);
      }
      setStep(nextStep);
      setStatus(t('screening.answersSaved'));
      if (nextStep === 3) await loadData();
      return true;
    } catch (actionError) {
      setError(getApiErrorMessage(actionError, t('screening.actionError')));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(event) {
    event.preventDefault();
    if (photoUploadInFlight.current) return;
    if (!photo) return;
    const retryDelay = 5000 - (Date.now() - photoUploadFailureAt.current);
    if (photoUploadFailureAt.current && retryDelay > 0) {
      setError(t('screening.uploadRetryWait', { seconds: Math.ceil(retryDelay / 1000) }));
      return;
    }
    if (!photoConsentAccepted || !mouthVisible) {
      setError(t('screening.captureConsentRequired'));
      return;
    }
    if (!hasConsent('imaging')) {
      setError(t('screening.photoConsentRequired'));
      return;
    }
    const existingAnglePhotos = photos.filter(
      (item) => item.region === captureAngles[angleIndex] && !item.deletedAt,
    );
    if (existingAnglePhotos.length && !window.confirm(t('screening.replaceAngleConfirm'))) {
      return;
    }
    photoUploadInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await checkOralPhoto(photo);
      const body = new FormData();
      body.append('file', photo);
      body.append('region', captureAngles[angleIndex]);
      body.append('captureConsent', 'true');
      body.append('mouthVisible', 'true');
      const response = await api.post(`/patients/me/screenings/${sessionId}/photos`, body, {
        timeout: 100000,
        skipToast: true,
      });
      photoUploadFailureAt.current = 0;
      const receivedReport = response.data.details.report;
      const analysisStatus = response.data.details.analysisStatus;
      const quality = response.data.details.quality;
      setReport(receivedReport);
      const newPhoto = {
        _id: response.data.details.photo.id,
        region: response.data.details.photo.region,
        sizeBytes: response.data.details.photo.sizeBytes,
        imageQuality: quality.imageQuality,
        qualityReasons: quality.reasons,
      };
      setPhotos((current) => [...current, newPhoto]);
      for (const existingPhoto of existingAnglePhotos) {
        await api.delete(`/patients/me/screenings/${sessionId}/photos/${existingPhoto._id}`);
      }
      const nextPhotos = [
        ...photos.filter(
          (item) =>
            item.region !== captureAngles[angleIndex] &&
            item._id !== response.data.details.photo.id &&
            !item.deletedAt,
        ),
        newPhoto,
      ];
      setPhotos(nextPhotos);
      setPhoto(null);
      setPhotoQuality(null);
      setMouthVisible(false);
      setPhotoConsentAccepted(false);
      const nextAngle = captureAngles.findIndex(
        (angle) => !nextPhotos.some((item) => item.region === angle && !item.deletedAt),
      );
      if (nextAngle >= 0) {
        setAngleIndex(nextAngle);
        setStatus(
          quality.imageQuality === 'adequate'
            ? t('screening.angleSaved')
            : t('screening.photoSavedQualityWarning'),
        );
      } else {
        await api.post(`/patients/me/screenings/${sessionId}/complete`);
        setStep(3);
        setStatus(
          nextPhotos.some((item) => item.imageQuality && item.imageQuality !== 'adequate')
            ? t('screening.savedPhotosQualityWarning')
            : receivedReport
              ? t('screening.reportReady')
              : analysisStatus === 'not_configured' || analysisStatus === 'unavailable'
                ? t('screening.aiUnavailable')
                : '',
        );
        await loadData();
      }
    } catch (actionError) {
      if (!actionError.response || [429, 503].includes(actionError.response.status)) {
        photoUploadFailureAt.current = Date.now();
      }
      const invalidFields = actionError.response?.data?.details?.invalidFields;
      if (actionError.response?.data?.code === 'VALIDATION_ERROR' && Array.isArray(invalidFields)) {
        const fieldLabels = invalidFields
          .filter((field) => ['region', 'captureConsent', 'mouthVisible', 'file'].includes(field))
          .map((field) => t(`screening.photoFields.${field}`));
        setError(
          fieldLabels.length
            ? t('screening.photoDetailsInvalid', { fields: fieldLabels.join(', ') })
            : t('screening.photoRequirements'),
        );
        return;
      }
      const key = actionError.message?.startsWith('screening.')
        ? actionError.message
        : actionError.response?.data?.code
          ? `errors.${actionError.response.data.code}`
          : '';
      const retakeReasons = actionError.response?.data?.details?.retakeReasons;
      setError(
        (Array.isArray(retakeReasons) && retakeReasons.length
          ? retakeReasons.map((reason) => t(`screening.retakeTips.${reason}`)).join(' ')
          : '') ||
          (key && t(key, { defaultValue: '' })) ||
          getApiErrorMessage(actionError, t('screening.actionError')),
      );
    } finally {
      photoUploadInFlight.current = false;
      setBusy(false);
    }
  }

  async function selectPhoto(file) {
    if (!file) return;
    setError('');
    try {
      const compressed = await compressOralPhoto(file);
      const quality = await checkOralPhoto(compressed);
      setPhoto(compressed);
      setPhotoQuality(quality);
      setMouthVisible(false);
    } catch (photoError) {
      setPhoto(null);
      setPhotoQuality(null);
      setError(
        t(
          photoError.message?.startsWith('screening.')
            ? photoError.message
            : 'screening.photoQualityError',
        ),
      );
    }
  }

  async function deletePhoto(photoAsset) {
    if (!window.confirm(t('screening.confirmDeletePhoto'))) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/patients/me/screenings/${sessionId}/photos/${photoAsset._id}`);
      const nextPhotos = photos.filter((item) => item._id !== photoAsset._id);
      setPhotos(nextPhotos);
      const firstMissingAngle = captureAngles.findIndex(
        (angle) => !nextPhotos.some((item) => item.region === angle && !item.deletedAt),
      );
      if (firstMissingAngle >= 0) setAngleIndex(firstMissingAngle);
      setStatus(t('screening.photoDeleted'));
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError, t('screening.actionError')));
    } finally {
      setBusy(false);
    }
  }

  async function downloadReport(reportItem) {
    setBusy(true);
    setError('');
    try {
      await downloadScreeningReport(reportItem);
    } catch (downloadError) {
      setError(getApiErrorMessage(downloadError, t('screening.reportDownloadError')));
    } finally {
      setBusy(false);
    }
  }

  async function downloadPhotoRecord() {
    setBusy(true);
    setError('');
    try {
      const response = await api.get(`/patients/me/screenings/${sessionId}/photo-record.pdf`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `screening-photo-record-${sessionId}.pdf`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setError(getApiErrorMessage(downloadError, t('screening.photoRecordDownloadError')));
    } finally {
      setBusy(false);
    }
  }

  function setAnswer(question, answer, skipped = false) {
    setAnswers((current) => ({ ...current, [question.key]: { answer, skipped } }));
  }

  async function withdraw(consent) {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/patients/${patientId}/consents/${consent._id}`);
      const result = await api.get(`/patients/${patientId}/consents`);
      setConsents(result.data.details || []);
    } catch (actionError) {
      setError(getApiErrorMessage(actionError, t('screening.actionError')));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="rounded-2xl bg-white p-6 text-slate-700" role="status">
        {t('screening.loading')}
      </p>
    );
  }
  if (!profile || !questionnaire) {
    return (
      <section className="space-y-4 rounded-2xl bg-white p-6" role="alert">
        <p className="text-rose-900">{error || t('screening.loadError')}</p>
        <button
          className="min-h-touch rounded-xl bg-teal-800 px-5 font-semibold text-white"
          onClick={loadData}
          type="button"
        >
          {t('screening.retryLoad')}
        </button>
      </section>
    );
  }

  const inputClass =
    'min-h-touch w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base';
  const consentGrantedCount = consents.filter(
    (consent) => consent.granted === true && !consent.withdrawnAt,
  ).length;
  const completionPercent = Math.min(100, Math.round(((step + 1) / 4) * 100));
  const currentStageLabel =
    step === 0
      ? t('screening.steps.consent')
      : step === 1
        ? t('screening.steps.questionsStep')
        : step === 2
          ? t('screening.steps.photosStep')
          : t('screening.steps.resultsStep');
  const overviewCards = [
    {
      title: 'Patient profile',
      value: profile.fullName || user?.fullName || 'Patient',
      detail: patientId || 'Secure profile',
      tone: 'bg-white/10 text-white',
    },
    {
      title: 'Consent',
      value: `${consentGrantedCount}/4`,
      detail: 'Ready for screening flow',
      tone: 'bg-emerald-400/15 text-white',
    },
    {
      title: 'Progress',
      value: `${completionPercent}%`,
      detail: currentStageLabel,
      tone: 'bg-sky-400/15 text-white',
    },
  ];
  const consultationReports = careHistory.filter(
    (entry) =>
      ['released_note', 'follow_up', 'referral'].includes(entry.type) &&
      (entry.item.callRequestId || entry.item.consultationRequestId),
  );
  const renderQuestion = (question) => {
    const current = answerFor(answers[question.key]);
    const options = question.options || [];
    return (
      <fieldset
        key={question.key}
        className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
      >
        <legend className="px-1 text-lg font-bold text-slate-900">
          {t(`screening.questions.${question.key}`, {
            defaultValue: question.key.replaceAll('_', ' '),
          })}
        </legend>
        {question.sensitive && question.reasonKey ? (
          <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            {t(`screening.reasons.${question.key}`, {
              defaultValue: t('screening.sensitiveReason'),
            })}
          </p>
        ) : null}
        {question.input === 'multi_select' ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((option) => (
              <label
                key={option.value}
                className="flex min-h-touch items-center gap-3 rounded-xl border border-slate-200 p-3"
              >
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-teal-700"
                  checked={!current.skipped && (current.answer || []).includes(option.value)}
                  onChange={(event) => {
                    const selected = new Set(current.skipped ? [] : current.answer || []);
                    if (event.target.checked) selected.add(option.value);
                    else selected.delete(option.value);
                    setAnswer(question, [...selected]);
                  }}
                />
                <span>
                  {t(`screening.options.${option.value}`, {
                    defaultValue: option.value.replaceAll('_', ' '),
                  })}
                </span>
              </label>
            ))}
          </div>
        ) : question.input === 'boolean' ? (
          <div className="flex flex-wrap gap-3">
            {['yes', 'no'].map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={!current.skipped && current.answer === (choice === 'yes')}
                className="min-h-touch rounded-xl border border-slate-300 px-5 font-semibold aria-pressed:border-teal-700 aria-pressed:bg-teal-50"
                onClick={() => setAnswer(question, choice === 'yes')}
              >
                {t(`screening.${choice}`)}
              </button>
            ))}
          </div>
        ) : question.input === 'select' ? (
          <select
            className={inputClass}
            value={current.skipped ? '' : current.answer || ''}
            onChange={(event) => {
              if (event.target.value === '') setAnswer(question, null, true);
              else setAnswer(question, event.target.value);
            }}
          >
            <option value="">{t('screening.chooseOrSkip')}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {t(`screening.options.${option.value}`, {
                  defaultValue: option.value.replaceAll('_', ' '),
                })}
              </option>
            ))}
          </select>
        ) : question.input === 'textarea' ? (
          <textarea
            className={inputClass}
            rows={3}
            value={current.skipped ? '' : current.answer || ''}
            placeholder={t('screening.optionalPlaceholder')}
            onChange={(event) => setAnswer(question, event.target.value)}
          />
        ) : (
          <input
            className={inputClass}
            type={question.input === 'number' ? 'number' : 'text'}
            min={question.min}
            max={question.max}
            value={current.skipped ? '' : current.answer || ''}
            placeholder={t('screening.optionalPlaceholder')}
            onChange={(event) => setAnswer(question, event.target.value)}
          />
        )}
        {question.allowsSkip ? (
          <label className="flex min-h-touch items-center gap-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              className="h-5 w-5 accent-teal-700"
              checked={current.skipped}
              onChange={(event) => setAnswer(question, null, event.target.checked)}
            />
            {t('screening.skip')}
          </label>
        ) : null}
      </fieldset>
    );
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6 bg-transparent px-2 pb-8 pt-2 sm:px-0">
      <header className="relative overflow-hidden rounded-[32px] border border-teal-300 bg-gradient-to-br from-teal-700 via-emerald-600 to-cyan-600 p-6 text-white shadow-[0_24px_80px_rgba(13,148,136,0.25)] sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_30%)]" />
        <div className="relative z-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-teal-100">
                {t('screening.eyebrow')}
              </p>
              <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
                {t('screening.title')}
              </h1>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-teal-100">Current stage</p>
              <p className="mt-1 text-sm font-bold text-white">{currentStageLabel}</p>
            </div>
          </div>

          <p className="mt-5 max-w-2xl text-base text-teal-50">
            {t('screening.welcome', { name: profile.fullName || user?.fullName || '' })}
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {overviewCards.map((card) => (
              <div
                key={card.title}
                className={`rounded-2xl border border-white/20 p-4 shadow-lg ${card.tone}`}
              >
                <p className="text-xs uppercase tracking-[0.18em] text-teal-100">{card.title}</p>
                <p className="mt-2 text-2xl font-bold text-white">{card.value}</p>
                <p className="mt-1 text-sm text-teal-50">{card.detail}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 rounded-2xl border border-amber-200/40 bg-amber-100/15 px-4 py-3 text-sm font-semibold text-amber-50 backdrop-blur-sm">
            {t('screening.disclaimer')}
          </p>
        </div>
      </header>

      <PatientQrCard />
      {demoModeEnabled ? (
        <Suspense fallback={null}>
          <SyntheticPatientDemoPanel />
        </Suspense>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900"
        >
          {error}
        </div>
      ) : null}
      {status ? (
        <p role="status" className="rounded-xl bg-teal-50 p-4 text-teal-950">
          {status}
        </p>
      ) : null}

      <ol aria-label={t('screening.progress')} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {['consent', 'questionsStep', 'photosStep', 'resultsStep'].map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? 'step' : undefined}
            className={`rounded-2xl border p-3 text-center shadow-sm transition-all ${
              step === index
                ? 'border-teal-700 bg-gradient-to-r from-teal-50 to-emerald-50 text-teal-950 shadow-[0_10px_24px_rgba(13,148,136,0.12)]'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-teal-700 shadow-sm">
              {index + 1}
            </span>
            {t(`screening.steps.${label}`)}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section
          id="patient-screening"
          className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7"
        >
          <div>
            <h2 className="text-2xl font-bold text-slate-950">{t('screening.consentTitle')}</h2>
            <p className="mt-2 text-slate-700">{t('screening.consentIntro')}</p>
          </div>
          {[
            ['screening', true],
            ['imaging', false],
            ['ai_processing', false],
            ['data_sharing', false],
          ].map(([type, required]) => {
            const latest = latestConsent(type);
            const active = hasConsent(type);
            return (
              <article
                key={type}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {t(`governance.types.${type}`)}
                    {required ? ` · ${t('screening.required')}` : ` · ${t('screening.optional')}`}
                  </h3>
                  <p className="mt-1 text-slate-700">{t(`governance.explanations.${type}`)}</p>
                  <p className="mt-1 text-sm font-semibold">
                    {active ? t('governance.active') : t('governance.withdrawn')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {active ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => withdraw(latest)}
                      className="min-h-touch rounded-xl border border-rose-300 px-4 font-semibold text-rose-800 disabled:opacity-50"
                    >
                      {t('governance.withdraw')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => recordConsent(type)}
                      className="min-h-touch rounded-xl bg-teal-800 px-4 font-semibold text-white disabled:opacity-50"
                    >
                      {t('screening.giveConsent')}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          <p className="text-sm text-slate-600">{t('screening.optionalPhotoNotice')}</p>
          <button
            type="button"
            disabled={busy || !hasConsent('screening')}
            onClick={beginScreening}
            className="min-h-touch rounded-xl bg-teal-800 px-6 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sessionId ? t('screening.continue') : t('screening.start')}
          </button>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="space-y-4">
          <div className="rounded-2xl bg-white p-5">
            <h2 className="text-2xl font-bold text-slate-950">
              {t('screening.questionnaireTitle')}
            </h2>
            <p className="mt-2 text-slate-700">{t('screening.questionnaireIntro')}</p>
          </div>
          {questions.map(renderQuestion)}
          {needsEmergencyGuidance ? (
            <aside
              role="alert"
              className="rounded-2xl border-2 border-rose-600 bg-rose-50 p-5 text-rose-950"
            >
              <h3 className="text-xl font-bold">{t('screening.emergencyTitle')}</h3>
              <p className="mt-2">{t('screening.emergencyText')}</p>
              <a
                className="mt-3 inline-flex min-h-touch items-center rounded-xl bg-rose-700 px-5 font-bold text-white"
                href="tel:112"
              >
                {t('screening.call112')}
              </a>
            </aside>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="min-h-touch rounded-xl border border-slate-300 px-5 font-semibold"
            >
              {t('screening.back')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => saveAnswers()}
              className="min-h-touch rounded-xl bg-teal-800 px-6 font-bold text-white disabled:opacity-50"
            >
              {busy ? t('screening.saving') : t('screening.saveContinue')}
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section
          id="patient-photo-capture"
          className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7"
        >
          <div>
            <h2 className="text-2xl font-bold text-slate-950">{t('screening.photoTitle')}</h2>
            <p className="mt-2 text-slate-700">{t('screening.photoIntro')}</p>
            <p className="mt-2 rounded-xl bg-blue-50 p-4 text-sm text-blue-950" role="note">
              {t('screening.photoRequirements')}
            </p>
          </div>
          <div className="space-y-3 rounded-2xl border border-teal-200 bg-teal-50 p-4">
            <p className="font-bold text-teal-950">
              {t('screening.angleProgress', {
                current: angleIndex + 1,
                total: captureAngles.length,
              })}
            </p>
            <h3 className="text-xl font-bold text-teal-950">
              {t(`screening.angles.${captureAngles[angleIndex]}`)}
            </h3>
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {captureAngles.map((angle, index) => {
                const captured = photos.some((item) => item.region === angle && !item.deletedAt);
                return (
                  <li key={angle}>
                    <button
                      aria-pressed={index === angleIndex}
                      className={`min-h-touch w-full rounded-lg border p-2 text-left text-sm aria-pressed:border-teal-700 aria-pressed:font-bold ${captured ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-slate-200 bg-white text-slate-700'}`}
                      disabled={busy}
                      onClick={() => {
                        setAngleIndex(index);
                        setPhoto(null);
                        setPhotoQuality(null);
                        setMouthVisible(false);
                        setPhotoConsentAccepted(false);
                      }}
                      type="button"
                    >
                      {captured ? '✓ ' : `${index + 1}. `}
                      {t(`screening.angles.${angle}`)}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <ul className="list-disc space-y-1 rounded-xl bg-blue-50 p-4 pl-9 text-blue-950">
            <li>{t('screening.captureTipLighting')}</li>
            <li>{t('screening.captureTipWide')}</li>
            <li>{t('screening.captureTipSteady')}</li>
          </ul>
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" role="note">
            {t('screening.photoLowQualitySaveNote')}
          </p>
          <label className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 font-semibold text-amber-950">
            <input
              checked={photoConsentAccepted}
              className="mt-1 h-5 w-5 accent-teal-700"
              onChange={(event) => {
                setPhotoConsentAccepted(event.target.checked);
                setMouthVisible(false);
                setPhoto(null);
                setPhotoQuality(null);
              }}
              type="checkbox"
            />
            <span>{t('screening.captureConsent')}</span>
          </label>
          {!hasConsent('imaging') ? (
            <p className="text-sm font-semibold text-rose-800">
              {t('screening.photoConsentRequired')}
            </p>
          ) : !hasConsent('ai_processing') ? (
            <p className="text-sm text-slate-700">{t('screening.aiConsentOptionalNotice')}</p>
          ) : null}
          {photoConsentAccepted && hasConsent('imaging') ? (
            <OralCameraCapture disabled={busy} onCapture={selectPhoto} t={t} />
          ) : null}
          <label className="grid gap-2 font-semibold">
            {t('screening.choosePhoto')}
            <input
              ref={fileInputRef}
              className="min-h-touch rounded-xl border border-slate-300 p-3 disabled:bg-slate-100"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || !photoConsentAccepted || !hasConsent('imaging')}
              onChange={(event) => {
                selectPhoto(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          {previewUrl ? (
            <div className="space-y-2">
              <img
                src={previewUrl}
                alt={t('screening.photoPreview')}
                className="max-h-96 rounded-2xl border border-slate-200 object-contain"
              />
              {photoQualityWarning ? (
                <p
                  className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
                  role="status"
                >
                  {photoQualityWarning}
                </p>
              ) : null}
              <button
                type="button"
                className="min-h-touch rounded-lg border border-rose-300 px-4 font-semibold text-rose-800"
                onClick={() => {
                  setPhoto(null);
                  setPhotoQuality(null);
                  setMouthVisible(false);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                {t('screening.removePhoto')}
              </button>
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 font-semibold">
                <input
                  checked={mouthVisible}
                  className="mt-1 h-5 w-5 accent-teal-700"
                  onChange={(event) => setMouthVisible(event.target.checked)}
                  type="checkbox"
                />
                <span>{t('screening.confirmMouthVisible')}</span>
              </label>
            </div>
          ) : null}
          <p className="rounded-xl bg-blue-50 p-4 text-blue-950">{t('screening.photoTips')}</p>
          <p className="text-sm font-semibold text-slate-700">{t('screening.photoDisclaimer')}</p>
          {photos.filter((item) => !item.deletedAt).length ? (
            <section aria-label={t('screening.savedPhotos')} className="space-y-2">
              <h3 className="font-bold">{t('screening.savedPhotos')}</h3>
              <p className="text-sm text-slate-700">{t('screening.photoDeleteNote')}</p>
              {photos
                .filter((item) => !item.deletedAt)
                .map((photoAsset) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                    key={photoAsset._id}
                  >
                    <span>
                      {t(`screening.angles.${photoAsset.region}`, {
                        defaultValue: photoAsset.region,
                      })}
                      {photoAsset.imageQuality && photoAsset.imageQuality !== 'adequate'
                        ? ` — ${t('screening.qualityNeedsRetake')}`
                        : ''}
                    </span>
                    <button
                      className="min-h-touch rounded-lg border border-rose-300 px-4 font-semibold text-rose-800 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => deletePhoto(photoAsset)}
                      type="button"
                    >
                      {t('screening.deletePhoto')}
                    </button>
                  </div>
                ))}
            </section>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-touch rounded-xl border border-slate-300 px-5 font-semibold"
            >
              {t('screening.back')}
            </button>
            <button
              type="button"
              onClick={() => saveAnswers(3)}
              disabled={busy}
              className="min-h-touch rounded-xl border border-teal-700 px-5 font-bold text-teal-900"
            >
              {t('screening.skipPhoto')}
            </button>
            <button
              type="button"
              onClick={uploadPhoto}
              disabled={
                busy || !photo || !photoConsentAccepted || !mouthVisible || !hasConsent('imaging')
              }
              className="min-h-touch rounded-xl bg-teal-800 px-6 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? hasConsent('ai_processing')
                  ? t('screening.analyzingPhoto')
                  : t('screening.savingPhoto')
                : t('screening.uploadAngle')}
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
          <h2 id="patient-results" className="text-2xl font-bold text-slate-950">
            {t('screening.resultsTitle')}
          </h2>
          {report ? (
            <article className="space-y-4 rounded-2xl border border-teal-200 bg-teal-50 p-5">
              <p className="font-bold text-rose-800">
                {t(
                  report.modelValidated ? 'screening.advisoryOnly' : 'screening.notForClinicalUse',
                )}
              </p>
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-950">
                {t('screening.medicalDisclaimer')}
              </p>
              <p className="text-sm text-slate-700">
                {t('screening.reportDate')}: {new Date(report.generatedAt).toLocaleString(language)}
              </p>
              <p className="font-semibold">
                {t('screening.imageQuality')}: {t(`screening.quality.${report.imageQuality}`)}
              </p>
              <p>
                {t('screening.region')}:{' '}
                {t(`screening.regions.${report.region}`, { defaultValue: report.region })}
              </p>
              {report.analysisStatus === 'unavailable' ? (
                <p
                  className="rounded-lg border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-950"
                  role="status"
                >
                  {t('screening.aiUnavailableReport')}
                </p>
              ) : report.analysisStatus === 'consent_not_granted' ? (
                <p className="rounded-lg border border-slate-300 bg-slate-50 p-3" role="status">
                  {t('screening.analysisConsentNotGranted')}
                </p>
              ) : report.analysisStatus === 'inconclusive' ? (
                <p
                  className="rounded-lg border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-950"
                  role="status"
                >
                  {t(inconclusiveMessageKey(report))}{' '}
                  {inconclusiveRetakeTips(report, t)}
                </p>
              ) : null}
              {['unavailable', 'consent_not_granted'].includes(report.analysisStatus) &&
              report.mediaAssetId ? (
                <ProtectedReportImage
                  endpoint={`/patients/me/screenings/${report.screeningSessionId}/photos/${report.mediaAssetId}/image`}
                  alt={t('screening.sourceImageAlt')}
                  label={t('screening.sourceImage')}
                  t={t}
                />
              ) : null}
              {shouldDisplayPrediction && report.imageQuality === 'adequate' ? (
                <>
                  <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 font-bold text-amber-950">
                    {t('screening.resultNotDiagnosis')}
                  </p>
                  {report.riskCategory ? (
                    <p className="font-bold">
                      {t('screening.riskCategory')}: {t(`screening.risk.${report.riskCategory}`)}
                    </p>
                  ) : null}
                  {report.riskCategory === 'unclear' ? (
                    <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 font-bold text-rose-950">
                      {t('screening.unclearResult')}
                    </p>
                  ) : null}
                  {report.finding ? (
                    <p>
                      <span className="font-semibold">{t('screening.visualFinding')}:</span>{' '}
                      {t(`screening.findings.${report.finding}`)}
                    </p>
                  ) : null}
                  {report.predictedClass ? (
                    <p>
                      <span className="font-semibold">{t('screening.visualFinding')}:</span>{' '}
                      {t(`screening.modelClasses.${report.predictedClass}`)}
                    </p>
                  ) : null}
                  {Number.isFinite(report.confidence) && report.riskCategory !== 'unclear' ? (
                    <p>
                      <span className="font-semibold">{t('screening.modelConfidence')}:</span>{' '}
                      {Math.round(report.confidence * 100)}% ·{' '}
                      {t(
                        report.confidenceCalibrated
                          ? 'screening.confidenceWarning'
                          : 'screening.confidenceNotCalibrated',
                      )}
                    </p>
                  ) : null}
                  {Number.isFinite(report.combinedRiskScore) ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="font-semibold">
                        {t('screening.combinedScore')}: {report.combinedRiskScore}/100
                      </p>
                      <p className="text-sm text-slate-700">
                        {t('screening.questionnairePoints')}: {report.questionnaireRiskPoints} ·{' '}
                        {t('screening.scoreWarning')}
                      </p>
                    </div>
                  ) : null}
                  <p>
                    {language === 'te'
                      ? report.explanationTe || t('screening.patientMeaning')
                      : report.explanation || t('screening.patientMeaning')}
                  </p>
                  {report.riskCategory === 'low' ? (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 font-bold text-amber-950">
                      {t('screening.lowRiskWarning')}
                    </p>
                  ) : null}
                  {['high', 'unclear', 'urgent_evaluation'].includes(report.riskCategory) ? (
                    <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 font-semibold text-rose-950">
                      {t('screening.reviewTaskCreated')}
                    </p>
                  ) : null}
                  {report.mediaAssetId ? (
                    <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
                      <ProtectedReportImage
                        endpoint={`/patients/me/screenings/${report.screeningSessionId}/photos/${report.mediaAssetId}/image`}
                        alt={t('screening.sourceImageAlt')}
                        label={t('screening.sourceImage')}
                        t={t}
                      />
                      {report.hasHeatmap && report.id ? (
                        <>
                          <ProtectedReportImage
                            endpoint={`/patients/me/screenings/${report.screeningSessionId}/reports/${report.id}/heatmap`}
                            alt={t('screening.heatmapAlt')}
                            label={t('screening.heatmap')}
                            t={t}
                          />
                          <p className="text-sm text-slate-700 sm:col-span-2">
                            {t('screening.heatmapWarning')}
                          </p>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {report.riskFactors?.length ? (
                    <p className="text-sm">
                      <span className="font-semibold">{t('screening.riskFactorsTitle')}:</span>{' '}
                      {report.riskFactors
                        .map((factor) => t(`screening.riskFactors.${factor}`))
                        .join(', ')}
                    </p>
                  ) : null}
                  <h3 className="font-bold">{t('screening.observations')}</h3>
                  <ul className="list-disc space-y-1 pl-6">
                    {report.observedFeatures.map((item, index) => (
                      <li key={index}>{t(`screening.findings.${item}`, { defaultValue: item })}</li>
                    ))}
                  </ul>
                  <h3 className="font-bold">{t('screening.nextSteps')}</h3>
                  <p>
                    {['moderate', 'high', 'urgent_evaluation'].includes(report.riskCategory)
                      ? t('screening.doctorSoon')
                      : report.riskCategory === 'low'
                        ? t('screening.lowRiskWarning')
                        : report.riskCategory === 'unclear'
                          ? t('screening.unclearResult')
                          : t('screening.professionalAssessment')}
                  </p>
                  {['moderate', 'high', 'urgent_evaluation'].includes(report.riskCategory) ||
                  report.urgency === 'urgent' ? (
                    <p
                      role="alert"
                      className="rounded-xl border border-rose-400 bg-rose-50 p-4 font-semibold text-rose-950"
                    >
                      {t('screening.professionalAssessment')}
                    </p>
                  ) : null}
                  <button
                    className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white"
                    onClick={() =>
                      document
                        .getElementById('patient-booking')
                        ?.scrollIntoView({ behavior: 'smooth' })
                    }
                    type="button"
                  >
                    {t('screening.referToDoctor')}
                  </button>
                </>
              ) : report.analysisStatus === 'inconclusive' || report.imageQuality !== 'adequate' ? (
                <>
                  {!['unavailable', 'consent_not_granted', 'inconclusive'].includes(
                    report.analysisStatus,
                  ) ? (
                    <p>{t('screening.retakeRequested')}</p>
                  ) : null}
                  {report.mediaAssetId ? (
                    <ProtectedReportImage
                      endpoint={`/patients/me/screenings/${report.screeningSessionId}/photos/${report.mediaAssetId}/image`}
                      alt={t('screening.sourceImageAlt')}
                      label={t('screening.sourceImage')}
                      t={t}
                    />
                  ) : null}
                </>
              ) : null}
              <div>
                <h3 className="font-bold">{t('screening.answersTitle')}</h3>
                <ul className="mt-2 space-y-1">
                  {questions.map((question) => {
                    const answer = answerFor(answers[question.key]);
                    let value = t('screening.skip');
                    if (
                      question.input === 'multi_select' &&
                      !answer.skipped &&
                      (!answer.answer || answer.answer.length === 0)
                    ) {
                      value = t('screening.noneReported');
                    } else if (
                      !answer.skipped &&
                      answer.answer !== undefined &&
                      answer.answer !== null &&
                      answer.answer !== ''
                    ) {
                      if (Array.isArray(answer.answer)) {
                        value = answer.answer
                          .map((item) => t(`screening.options.${item}`, { defaultValue: item }))
                          .join(', ');
                      } else if (question.input === 'boolean') {
                        value = t(answer.answer ? 'screening.yes' : 'screening.no');
                      } else {
                        value = t(`screening.options.${answer.answer}`, {
                          defaultValue: String(answer.answer),
                        });
                      }
                    }
                    return (
                      <li key={question.key}>
                        <span className="font-semibold">
                          {t(`screening.questions.${question.key}`, { defaultValue: question.key })}
                          :
                        </span>{' '}
                        {value}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <p className="text-sm">
                {t('screening.limitations')}: {t('screening.limitationsText')}
              </p>
              <p className="text-xs text-slate-600">
                {t('screening.modelInfo')}: {report.modelName} ·{' '}
                {new Date(report.generatedAt).toLocaleString(language)}
              </p>
            </article>
          ) : (
            <div
              className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
              role="alert"
            >
              <p>{t('screening.noAiReport')}</p>
              {photos.some((item) => !item.deletedAt) ? (
                <button
                  className="min-h-touch rounded-xl border border-amber-800 px-4 font-bold text-amber-950 disabled:opacity-50"
                  disabled={busy}
                  onClick={downloadPhotoRecord}
                  type="button"
                >
                  {t('screening.downloadPhotoRecord')}
                </button>
              ) : null}
            </div>
          )}
          {photos.filter((item) => !item.deletedAt).length ? (
            <section aria-label={t('screening.savedPhotos')} className="space-y-2">
              <h3 className="font-bold">{t('screening.savedPhotos')}</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  className="min-h-touch rounded-xl border border-slate-300 px-4 font-semibold disabled:opacity-50"
                  disabled={busy || !report?.id}
                  onClick={() => downloadReport(report)}
                  type="button"
                >
                  {t('screening.downloadPdf')}
                </button>
                <Link
                  className="inline-flex min-h-touch items-center rounded-xl bg-teal-800 px-4 font-semibold text-white"
                  to="/patient/appointments"
                >
                  {t('screening.bookAppointment')}
                </Link>
                <Link
                  className="inline-flex min-h-touch items-center rounded-xl border border-teal-800 px-4 font-semibold text-teal-900"
                  to="/patient/appointments"
                >
                  {t('screening.requestCall')}
                </Link>
                <Link
                  className="inline-flex min-h-touch items-center rounded-xl border border-slate-300 px-4 font-semibold text-slate-900"
                  to="/patient/diet"
                >
                  {t('screening.dietTips')}
                </Link>
              </div>
              <p className="text-sm text-slate-700">{t('screening.photoDeleteNote')}</p>
              {photos
                .filter((item) => !item.deletedAt)
                .map((photoAsset) => (
                  <div
                    className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                    key={photoAsset._id}
                  >
                    <div className="space-y-2">
                      <span className="font-semibold">
                        {t(`screening.angles.${photoAsset.region}`, {
                          defaultValue: photoAsset.region,
                        })}
                      </span>
                      <p className="text-sm text-slate-600">
                        {t('screening.reportDate')}:{' '}
                        {new Date(photoAsset.createdAt).toLocaleString(language)}
                      </p>
                      <ProtectedReportImage
                        endpoint={`/patients/me/screenings/${sessionId}/photos/${photoAsset._id}/image`}
                        alt={t('screening.sourceImageAlt')}
                        label={t('screening.sourceImage')}
                        t={t}
                      />
                    </div>
                    <button
                      className="min-h-touch self-start rounded-lg border border-rose-300 px-4 font-semibold text-rose-800 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => deletePhoto(photoAsset)}
                      type="button"
                    >
                      {t('screening.deletePhoto')}
                    </button>
                  </div>
                ))}
            </section>
          ) : null}
          {needsEmergencyGuidance ? (
            <aside
              role="alert"
              className="rounded-2xl border-2 border-rose-600 bg-rose-50 p-5 text-rose-950"
            >
              <p className="font-bold">{t('screening.emergencyText')}</p>
              <a
                className="mt-3 inline-flex min-h-touch items-center rounded-xl bg-rose-700 px-5 font-bold text-white"
                href="tel:112"
              >
                {t('screening.call112')}
              </a>
            </aside>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setReport(null);
                setPhoto(null);
                setPhotoQuality(null);
                setStep(2);
              }}
              className="min-h-touch rounded-xl border border-teal-700 px-5 font-semibold text-teal-900"
            >
              {t('screening.newPhoto')}
            </button>
            <button
              type="button"
              onClick={() => {
                setReport(null);
                setSessionId('');
                setAnswers({});
                setPhotos([]);
                setAngleIndex(0);
                setPhoto(null);
                setPhotoQuality(null);
                setPhotoConsentAccepted(false);
                setMouthVisible(false);
                setStep(0);
              }}
              className="min-h-touch rounded-xl bg-teal-800 px-5 font-semibold text-white"
            >
              {t('screening.newScreening')}
            </button>
          </div>
          <div id="patient-reports" className="border-t border-slate-200 pt-4">
            <h3 className="text-lg font-bold">{t('screening.historyTitle')}</h3>
            {sessions.length ? (
              <ul className="mt-2 space-y-2">
                {sessions.map((item) => (
                  <li key={item._id} className="rounded-xl border border-slate-200 p-3">
                    <span className="font-semibold">
                      {new Date(item.startedAt).toLocaleString(language)}
                    </span>
                    <span className="ml-2 text-sm text-slate-600">
                      {t(`screening.status.${item.status}`)}
                    </span>
                    {item.reports?.length
                      ? item.reports.map((historyReport) => (
                          <article
                            key={historyReport.id || historyReport._id}
                            className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3"
                          >
                            <p className="text-sm font-semibold">
                              {t('screening.aiSource')}:{' '}
                              {t(`screening.risk.${historyReport.riskCategory}`)} ·{' '}
                              {t('screening.resultNotDiagnosis')}
                            </p>
                            <p className="text-sm font-bold text-rose-800">
                              {t(
                                historyReport.modelValidated
                                  ? 'screening.advisoryOnly'
                                  : 'screening.notForClinicalUse',
                              )}
                            </p>
                            <p className="text-sm text-slate-600">
                              {t('screening.modelInfo')}: {historyReport.modelName} ·{' '}
                              {historyReport.modelVersion} ·{' '}
                              {new Date(historyReport.generatedAt).toLocaleString(language)}
                            </p>
                            {historyReport.analysisStatus === 'unavailable' ? (
                              <p className="text-sm font-semibold text-amber-900">
                                {t('screening.aiUnavailableReport')}
                              </p>
                            ) : null}
                            {historyReport.predictedClass ? (
                              <p className="text-sm">
                                {t('screening.visualFinding')}:{' '}
                                {t(`screening.modelClasses.${historyReport.predictedClass}`)}
                              </p>
                            ) : null}
                            {Number.isFinite(historyReport.confidence) ? (
                              <p className="text-sm">
                                {t('screening.modelConfidence')}:{' '}
                                {Math.round(historyReport.confidence * 100)}% ·{' '}
                                {t('screening.confidenceNotCalibrated')}
                              </p>
                            ) : null}
                            {historyReport.finding ? (
                              <p className="text-sm">
                                {t('screening.visualFinding')}:{' '}
                                {t(`screening.findings.${historyReport.finding}`)}
                                {historyReport.confidenceCalibrated &&
                                Number.isFinite(historyReport.confidence)
                                  ? ` · ${Math.round(historyReport.confidence * 100)}%`
                                  : ''}
                              </p>
                            ) : null}
                            {historyReport.mediaAssetId ? (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <ProtectedReportImage
                                  endpoint={`/patients/me/screenings/${historyReport.screeningSessionId}/photos/${historyReport.mediaAssetId}/image`}
                                  alt={t('screening.sourceImageAlt')}
                                  label={t('screening.sourceImage')}
                                  t={t}
                                />
                                {historyReport.hasHeatmap && historyReport.id ? (
                                  <ProtectedReportImage
                                    endpoint={`/patients/me/screenings/${historyReport.screeningSessionId}/reports/${historyReport.id}/heatmap`}
                                    alt={t('screening.heatmapAlt')}
                                    label={t('screening.heatmap')}
                                    t={t}
                                  />
                                ) : null}
                              </div>
                            ) : null}
                          </article>
                        ))
                      : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-slate-600">{t('screening.noHistory')}</p>
            )}
            <h3 className="mt-5 text-lg font-bold">{t('consultation.consultationReports')}</h3>
            {consultationReports.length ? (
              <ul className="mt-2 space-y-2">
                {consultationReports.map((entry, index) => (
                  <li
                    className="rounded-xl border border-slate-200 p-3"
                    key={`${entry.type}-${entry.item._id || index}`}
                  >
                    <p className="font-semibold">
                      {t(`doctorWorkflow.history.${entry.type}`, { defaultValue: entry.type })}
                    </p>
                    <p className="text-sm text-slate-600">
                      {new Date(entry.createdAt).toLocaleString(language)}
                    </p>
                    {entry.type === 'released_note' ? (
                      <p className="mt-2 whitespace-pre-wrap">{entry.item.body}</p>
                    ) : null}
                    {entry.type === 'follow_up' ? (
                      <p className="mt-2">
                        {entry.item.instructions || ''} ·{' '}
                        {new Date(entry.item.followUpDate).toLocaleString(language)}
                      </p>
                    ) : null}
                    {entry.type === 'referral' ? (
                      <p className="mt-2">
                        {entry.item.specialty || ''} {entry.item.destinationName || ''} ·{' '}
                        {entry.item.urgency} · {entry.item.reason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-slate-600">{t('consultation.noReports')}</p>
            )}
          </div>
          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-lg font-bold">{t('screening.careHistoryTitle')}</h3>
            {careHistory.length ? (
              <ol className="mt-3 space-y-2">
                {careHistory.map((entry, index) => (
                  <li
                    key={`${entry.type}-${entry.item?._id || index}`}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <p className="font-semibold">
                      {t(`doctorWorkflow.history.${entry.type}`, { defaultValue: entry.type })}
                    </p>
                    <p className="text-sm text-slate-600">
                      {new Date(entry.createdAt).toLocaleString(language)}
                    </p>
                    {entry.type === 'released_note' ? (
                      <p className="mt-2 whitespace-pre-wrap">{entry.item.body}</p>
                    ) : null}
                    {entry.type === 'referral' ? (
                      <p className="mt-2">
                        {entry.item.specialty || ''} {entry.item.destinationName || ''} ·{' '}
                        {entry.item.urgency} · {entry.item.reason}
                      </p>
                    ) : null}
                    {entry.type === 'follow_up' ? (
                      <p className="mt-2">
                        {entry.item.instructions || ''} ·{' '}
                        {new Date(entry.item.followUpDate).toLocaleString(language)}
                      </p>
                    ) : null}
                    {entry.type === 'investigation' ? (
                      <p className="mt-2">{entry.item.state}</p>
                    ) : null}
                    {entry.type === 'appointment' ? (
                      <p className="mt-2">
                        {t(`booking.status.${entry.item.status}`, {
                          defaultValue: entry.item.status,
                        })}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-slate-600">{t('screening.noCareHistory')}</p>
            )}
          </div>
        </section>
      ) : null}
      {step === 3 ? (
        <CareBookingPanel
          screeningSessionId={sessionId}
          canShareRecords={hasConsent('data_sharing')}
        />
      ) : null}
    </section>
  );
}
