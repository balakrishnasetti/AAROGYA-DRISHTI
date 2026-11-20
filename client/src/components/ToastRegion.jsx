import { useEffect, useState } from 'react';

export default function ToastRegion() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    function showToast(event) {
      setToast(event.detail);
      window.setTimeout(() => setToast(null), 6000);
    }

    window.addEventListener('aarogya:toast', showToast);
    return () => window.removeEventListener('aarogya:toast', showToast);
  }, []);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:max-w-sm"
    >
      {toast ? (
        <div
          className="rounded-xl border border-amber-700/20 bg-white p-4 text-ink shadow-lg"
          role="alert"
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
