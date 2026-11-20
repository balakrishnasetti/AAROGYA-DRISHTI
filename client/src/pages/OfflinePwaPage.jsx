import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listOutboxOperations, wipeSensitiveData } from '../lib/offlineStore.js';
import { syncPendingOperations } from '../services/offlineSync.js';

const sourceCards = [
  {
    label: 'Online AI',
    detail: 'Connected to the cloud model and may not be available offline.',
    accent: 'bg-sky-100 text-sky-800',
  },
  {
    label: 'Offline AI',
    detail: 'Optional local assistant on this device after explicit opt-in.',
    accent: 'bg-emerald-100 text-emerald-800',
  },
  {
    label: 'Preloaded health information',
    detail: 'Reviewed FAQ in Telugu and English, kept on-device for reference only.',
    accent: 'bg-amber-100 text-amber-800',
  },
];

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export default function OfflinePwaPage() {
  const { t, i18n } = useTranslation();
  const [installPrompt, setInstallPrompt] = useState(null);
  const [outbox, setOutbox] = useState([]);
  const [cacheSize, setCacheSize] = useState('0 KB');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [highContrast, setHighContrast] = useState(() => localStorage.getItem('aarogya-contrast') === 'high');
  const [fontScale, setFontScale] = useState(() => Number(localStorage.getItem('aarogya-font-scale')) || 1);
  const [syncMessage, setSyncMessage] = useState('');

  useEffect(() => {
    document.body.classList.toggle('high-contrast', highContrast);
    document.body.dataset.fontScale = String(fontScale);
    localStorage.setItem('aarogya-contrast', highContrast ? 'high' : 'normal');
    localStorage.setItem('aarogya-font-scale', String(fontScale));
  }, [highContrast, fontScale]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    async function load() {
      setOutbox(await listOutboxOperations());
      const estimate = await navigator.storage?.estimate?.();
      setCacheSize(formatBytes(estimate?.usage || 0));
    }
    load();
  }, []);

  useEffect(() => {
    const handler = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const installText = useMemo(
    () => (i18n.language === 'te' ? 'ఆప్‌ను ఇన్‌స్టాల్ చేయండి' : 'Install app'),
    [i18n.language],
  );

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const handleSync = async () => {
    try {
      const result = await syncPendingOperations();
      setSyncMessage(result.sent ? 'Sync queued changes sent.' : 'No pending changes.');
      setOutbox(await listOutboxOperations());
    } catch (error) {
      setSyncMessage(error.message || 'Sync failed');
    }
  };

  const handleClearCache = async () => {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    const detail = await navigator.storage?.estimate?.();
    setCacheSize(formatBytes(detail?.usage || 0));
  };

  const handleLogout = async () => {
    await wipeSensitiveData();
    window.location.href = '/';
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="rounded-3xl border border-teal-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">
              {t('offline.pwaEyebrow', 'PWA & offline')}
            </p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">{t('offline.title', 'Offline-first care access')}</h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium ${isOffline ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${isOffline ? 'bg-amber-600' : 'bg-emerald-600'}`} />
              {isOffline ? t('offline.offlineBadge', 'Offline') : t('offline.onlineBadge', 'Online')}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">{t('offline.install', 'Install')}</div>
          <div className="mt-3 text-lg font-semibold text-slate-900">{installPrompt ? 'Ready to install' : 'Installable progress'}</div>
          <button
            type="button"
            className="mt-4 inline-flex min-h-touch items-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            disabled={!installPrompt}
            onClick={handleInstall}
          >
            {installText}
          </button>
        </div>

        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">{t('offline.cache', 'Cache')}</div>
          <div className="mt-3 text-lg font-semibold text-slate-900">{cacheSize}</div>
          <button type="button" className="mt-4 inline-flex min-h-touch items-center rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700" onClick={handleClearCache}>
            {t('offline.clearCache', 'Clear cache')}
          </button>
        </div>

        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-700">{t('offline.sync', 'Sync')}</div>
          <div className="mt-3 text-lg font-semibold text-slate-900">{outbox.length} {t('offline.pending', 'pending')}</div>
          <button type="button" className="mt-4 inline-flex min-h-touch items-center rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white" onClick={handleSync}>
            {t('offline.syncNow', 'Sync now')}
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">{t('offline.syncStatus', 'Sync status')}</h2>
          <div className="mt-4 space-y-3">
            {outbox.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                {t('offline.noPending', 'No queued writes.')}
              </div>
            ) : (
              outbox.map((item) => (
                <div key={item.clientOpId} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div>
                    <div className="font-semibold text-slate-900">{item.route}</div>
                    <div className="text-slate-600">{item.kind}</div>
                  </div>
                  <div className="text-right text-slate-700">
                    <div className="font-medium">{item.status}</div>
                    <div>{item.clientOpId.slice(0, 8)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
          {syncMessage ? <p className="mt-4 text-sm text-slate-600">{syncMessage}</p> : null}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">{t('offline.accessibility', 'Accessibility')}</h2>
          <div className="mt-4 space-y-3">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm">
              <span>{t('offline.highContrast', 'High-contrast mode')}</span>
              <input type="checkbox" checked={highContrast} onChange={(event) => setHighContrast(event.target.checked)} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm">
              <span>{t('offline.fontScale', 'Font size')}</span>
              <select value={fontScale} onChange={(event) => setFontScale(Number(event.target.value))} className="rounded-lg border border-slate-300 px-2 py-1">
                <option value={1}>Normal</option>
                <option value={1.15}>Large</option>
                <option value={1.3}>Extra large</option>
              </select>
            </label>
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">{t('offline.aiSourceLabel', 'AI source labels')}</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {sourceCards.map((card) => (
            <div key={card.label} className={`rounded-2xl border border-slate-200 p-4 ${card.accent}`}>
              <div className="text-sm font-semibold">{card.label}</div>
              <p className="mt-2 text-sm leading-6">{card.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-rose-900">{t('offline.emergency', 'Emergency')}</h2>
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-white p-4 text-slate-800 shadow-sm">
          <span aria-hidden="true" className="text-3xl">🚨</span>
          <div>
            <div className="text-lg font-bold text-rose-700">{t('offline.call112', 'Call 112')}</div>
            <p className="mt-1 text-sm leading-6">
              {t('offline.emergencyText', 'Severe symptoms need urgent care. Use the emergency icon, label, and colour to act quickly; do not wait for AI output.')}
            </p>
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700" onClick={handleLogout}>
          {t('offline.logout', 'Clear local offline data and log out')}
        </button>
      </div>
    </div>
  );
}
