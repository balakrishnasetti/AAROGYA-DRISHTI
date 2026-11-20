import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../../services/api.js';

export default function PatientQrCard() {
  const { t } = useTranslation();
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const expired = qr ? new Date(qr.expiresAt).getTime() <= now : false;

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const response = await api.post('/patients/me/qr');
      setQr(response.data.details);
      setNow(Date.now());
    } catch (generateError) {
      setError(getApiErrorMessage(generateError, t('patientQr.generateError')));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError('');
    try {
      await api.delete('/patients/me/qr');
      setQr(null);
    } catch (revokeError) {
      setError(getApiErrorMessage(revokeError, t('patientQr.revokeError')));
    } finally {
      setBusy(false);
    }
  }

  function printQr() {
    if (!qr || expired) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError(t('patientQr.printBlocked'));
      return;
    }
    printWindow.opener = null;
    printWindow.document.write(
      `<!doctype html><html><head><title>${t('patientQr.title')}</title></head><body style="font-family:sans-serif;text-align:center;padding:24px"><h1>${t('patientQr.title')}</h1><p>${t('patientQr.printWarning')}</p><img id="patient-qr" alt="${t('patientQr.alt')}" src="${qr.qrDataUrl}" style="width:320px;max-width:90vw"><p>${t('patientQr.expires', { time: new Date(qr.expiresAt).toLocaleTimeString() })}</p></body></html>`,
    );
    printWindow.document.close();
    const image = printWindow.document.getElementById('patient-qr');
    if (image.complete) printWindow.print();
    else image.addEventListener('load', () => printWindow.print(), { once: true });
  }

  return (
    <section className="space-y-4 rounded-2xl border border-teal-200 bg-white p-5" aria-labelledby="patient-qr-title">
      <div>
        <h2 className="text-xl font-bold text-slate-950" id="patient-qr-title">{t('patientQr.title')}</h2>
        <p className="mt-1 text-slate-700">{t('patientQr.description')}</p>
        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{t('patientQr.accessNote')}</p>
      </div>
      {error ? <p className="rounded-lg bg-rose-50 p-3 text-rose-900" role="alert">{error}</p> : null}
      {qr && !expired ? (
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <img className="h-56 w-56 rounded-xl border border-slate-200 p-2" src={qr.qrDataUrl} alt={t('patientQr.alt')} />
          <div className="space-y-2 text-center sm:text-left">
            <p className="font-semibold" role="timer">
              {t('patientQr.expires', { time: new Date(qr.expiresAt).toLocaleTimeString() })}
            </p>
            <p className="text-sm text-slate-600">{t('patientQr.expiryNote')}</p>
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              <a
                className="inline-flex min-h-touch items-center rounded-lg border border-teal-700 px-4 font-semibold text-teal-900"
                download="aarogya-patient-qr.png"
                href={qr.qrDataUrl}
              >
                {t('patientQr.download')}
              </a>
              <button className="min-h-touch rounded-lg border border-slate-300 px-4 font-semibold" onClick={printQr} type="button">
                {t('patientQr.print')}
              </button>
              <button className="min-h-touch rounded-lg border border-rose-300 px-4 font-semibold text-rose-800" disabled={busy} onClick={revoke} type="button">
                {t('patientQr.revoke')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-lg bg-slate-50 p-3 text-slate-800" role="status">
          {qr ? t('patientQr.expired') : t('patientQr.notCreated')}
        </p>
      )}
      <button className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white disabled:opacity-50" disabled={busy} onClick={generate} type="button">
        {busy ? t('patientQr.working') : qr ? t('patientQr.regenerate') : t('patientQr.generate')}
      </button>
    </section>
  );
}
