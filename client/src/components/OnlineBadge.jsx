import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function OnlineBadge() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const updateStatus = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);

    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, []);

  return (
    <span
      className={`inline-flex min-h-touch items-center gap-2 rounded-full px-3 text-sm font-medium ${
        online ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-700'
      }`}
      role="status"
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${online ? 'bg-teal-600' : 'bg-amber-700'}`}
      />
      {online ? t('app.online') : t('app.offline')}
    </span>
  );
}
