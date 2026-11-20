import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../../services/api.js';

function useCameraScanner(onPayload, enabled) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let animationFrame = 0;
    let stream;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });

    async function start() {
      let decodeQr;
      try {
        ({ default: decodeQr } = await import('jsqr'));
      } catch {
        setError('scannerUnavailable');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('cameraUnavailable');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (!context) {
          setError('cameraUnavailable');
          return;
        }

        const scanFrame = () => {
          if (
            !active ||
            video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
            !video.videoWidth ||
            !video.videoHeight
          ) {
            animationFrame = requestAnimationFrame(scanFrame);
            return;
          }
          const scale = Math.min(1, 960 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = decodeQr(frame.data, frame.width, frame.height, {
            inversionAttempts: 'dontInvert',
          });
          if (result?.data) {
            active = false;
            onPayload(result.data);
            return;
          }
          animationFrame = requestAnimationFrame(scanFrame);
        };
        animationFrame = requestAnimationFrame(scanFrame);
      } catch {
        if (active) setError('cameraPermissionDenied');
      }
    }

    start();
    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [enabled, onPayload]);

  return { videoRef, canvasRef, error };
}

export default function QrPatientScanner() {
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);
  const [summary, setSummary] = useState(null);
  const [checkin, setCheckin] = useState(null);
  const [error, setError] = useState('');

  const handlePayload = useCallback(async (qrPayload) => {
    setScanning(false);
    setError('');
    try {
      if (qrPayload.startsWith('AAROGYA-CHECKIN:')) {
        const response = await api.post('/appointments/checkin', { token: qrPayload });
        setCheckin(response.data.details);
        setSummary(null);
      } else {
        const response = await api.post('/doctor/qr/scan', { qrPayload });
        setSummary(response.data.details);
        setCheckin(null);
      }
    } catch (scanError) {
      setSummary(null);
      setCheckin(null);
      setError(getApiErrorMessage(scanError, t('doctorQr.scanError')));
    }
  }, [t]);
  const { videoRef, canvasRef, error: cameraError } = useCameraScanner(handlePayload, scanning);

  return (
    <section className="space-y-4 rounded-2xl border border-teal-200 bg-white p-5" aria-labelledby="doctor-qr-title">
      <div>
        <h2 className="text-xl font-bold" id="doctor-qr-title">{t('doctorQr.title')}</h2>
        <p className="mt-1 text-slate-700">{t('doctorQr.description')}</p>
        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{t('doctorQr.accessNote')}</p>
      </div>
      {error || cameraError ? (
        <p className="rounded-lg bg-rose-50 p-3 text-rose-900" role="alert">
          {t(`doctorQr.${error || cameraError}`)}
        </p>
      ) : null}
      {scanning ? (
        <div className="space-y-2">
          <video className="max-h-96 w-full rounded-xl bg-black object-contain" muted playsInline ref={videoRef} />
          <canvas className="hidden" ref={canvasRef} />
          <p className="text-sm text-slate-700" role="status">{t('doctorQr.pointCamera')}</p>
          <button className="min-h-touch rounded-lg border border-slate-300 px-4 font-semibold" onClick={() => setScanning(false)} type="button">
            {t('doctorQr.stop')}
          </button>
        </div>
      ) : (
        <button
          className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white"
          onClick={() => {
            setSummary(null);
            setCheckin(null);
            setError('');
            setScanning(true);
          }}
          type="button"
        >
          {t('doctorQr.start')}
        </button>
      )}
      {summary ? (
        <article className="space-y-4 rounded-xl border border-slate-200 p-4">
          <div className="rounded-lg bg-amber-50 p-3 font-semibold text-amber-950">
            {t('doctorQr.readOnly')} · {summary.disclaimer}
          </div>
          <section>
            <h3 className="font-bold">{t('doctorQr.patient')}</h3>
            <dl className="mt-2 grid gap-2 sm:grid-cols-3">
              <div><dt className="font-semibold">{t('doctorQr.name')}</dt><dd>{summary.patient.name}</dd></div>
              <div><dt className="font-semibold">{t('doctorQr.age')}</dt><dd>{summary.patient.age ?? t('doctorQr.notAvailable')}</dd></div>
              <div><dt className="font-semibold">{t('doctorQr.id')}</dt><dd className="break-all">{summary.patient.id}</dd></div>
            </dl>
          </section>
          <section>
            <h3 className="font-bold">{t('doctorQr.screenings')}</h3>
            {summary.screenings.length ? summary.screenings.map((item) => (
              <p className="mt-1 text-sm" key={item.id}>{new Date(item.startedAt).toLocaleString()} · {item.status}</p>
            )) : <p className="text-sm">{t('doctorQr.none')}</p>}
          </section>
          <section>
            <h3 className="font-bold">{t('doctorQr.results')}</h3>
            {summary.latestScreeningResults.length ? summary.latestScreeningResults.map((item) => (
              <article className="mt-2 rounded-lg bg-slate-50 p-3" key={item._id}>
                <p className="font-semibold">{t('doctorQr.screeningResult')} — {t('doctorQr.notDiagnosis')}</p>
                <p>
                  {t(`screening.regions.${item.region}`, { defaultValue: item.region })} ·{' '}
                  {t(`screening.risk.${item.riskCategory}`, { defaultValue: item.riskCategory })} ·{' '}
                  {item.finding ? t(`screening.findings.${item.finding}`) : t('doctorQr.legacyReport')}
                </p>
                {Number.isFinite(item.confidence) ? <p>{t('doctorQr.confidence')}: {Math.round(item.confidence * 100)}%</p> : null}
                <p className="text-sm text-slate-600">{item.modelName} · {item.modelVersion} · {new Date(item.generatedAt).toLocaleString()}</p>
              </article>
            )) : <p className="text-sm">{t('doctorQr.none')}</p>}
          </section>
          <section>
            <h3 className="font-bold">{t('doctorQr.appointments')}</h3>
            {summary.appointments.length ? summary.appointments.map((item) => (
              <p className="mt-1 text-sm" key={item.id}>{new Date(item.date).toLocaleString()} · {item.status}</p>
            )) : <p className="text-sm">{t('doctorQr.none')}</p>}
          </section>
          <section>
            <h3 className="font-bold">{t('doctorQr.reports')}</h3>
            {summary.reports.length ? summary.reports.map((item) => (
              <p className="mt-1 text-sm" key={item._id}>{item.title} · {item.documentType} · {new Date(item.uploadedAt).toLocaleString()}</p>
            )) : <p className="text-sm">{t('doctorQr.none')}</p>}
          </section>
        </article>
      ) : null}
      {checkin ? (
        <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 font-semibold text-emerald-950">
          {t('doctorQr.checkinSuccess')} · {checkin._id} · {new Date(checkin.slotStart).toLocaleString()}
        </p>
      ) : null}
    </section>
  );
}
