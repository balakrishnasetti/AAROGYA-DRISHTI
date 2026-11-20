import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../services/api.js';

function decodeApplicationServerKey(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export default function PushNotificationsButton() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return undefined;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (active) setEnabled(Boolean(subscription));
      })
      .catch(() => {
        if (active) setError(t('consultation.pushError'));
      });
    return () => { active = false; };
  }, [t]);

  async function toggleNotifications() {
    setBusy(true);
    setError('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error(t('consultation.pushUnsupported'));
      }
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        await api.delete('/calls/push/subscription', { data: { endpoint: current.endpoint } });
        await current.unsubscribe();
        setEnabled(false);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error(t('consultation.pushPermissionDenied'));
      const keyResponse = await api.get('/calls/push/public-key');
      const publicKey = keyResponse.data.details.publicKey;
      if (!publicKey) throw new Error(t('consultation.pushNotConfigured'));
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(publicKey),
      });
      await api.put('/calls/push/subscription', subscription.toJSON());
      setEnabled(true);
    } catch (requestError) {
      setError(
        requestError.message?.startsWith('This browser') ||
          requestError.message?.startsWith('Allow notifications') ||
          requestError.message?.startsWith('Browser push')
          ? requestError.message
          : getApiErrorMessage(requestError, t('consultation.pushError')),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        className="min-h-touch rounded-xl border border-teal-700 px-4 font-semibold text-teal-900 disabled:opacity-50"
        disabled={busy}
        onClick={toggleNotifications}
        type="button"
      >
        {busy
          ? t('consultation.pleaseWait')
          : enabled
            ? t('consultation.disableNotifications')
            : t('consultation.enableNotifications')}
      </button>
      {error ? <p className="text-sm text-rose-800" role="alert">{error}</p> : null}
    </div>
  );
}
