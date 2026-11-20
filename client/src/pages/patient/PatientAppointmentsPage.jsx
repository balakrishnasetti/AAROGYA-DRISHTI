import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../../services/api.js';
import CareBookingPanel from './CareBookingPanel.jsx';
import CallRequestPanel from './CallRequestPanel.jsx';

export default function PatientAppointmentsPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [canShareRecords, setCanShareRecords] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const assistantRequest = {
    doctor: searchParams.get('assistantDoctor') || '',
    date: searchParams.get('assistantDate') || '',
    time: searchParams.get('assistantTime') || '',
  };

  useEffect(() => {
    let active = true;
    async function loadConsent() {
      try {
        const profile = await api.get('/patients/me');
        const response = await api.get(`/patients/${profile.data.details.id}/consents`);
        const latest = (response.data.details || [])
          .filter((item) => item.consentType === 'data_sharing')
          .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0];
        if (active) setCanShareRecords(latest?.granted === true && !latest.withdrawnAt);
      } catch (loadError) {
        if (active) setError(getApiErrorMessage(loadError, t('booking.loadError')));
      } finally {
        if (active) setLoading(false);
      }
    }
    loadConsent();
    return () => { active = false; };
  }, [t]);

  if (loading) {
    return <p className="rounded-2xl bg-white p-6 text-slate-700" role="status">{t('booking.loading')}</p>;
  }
  if (error) {
    return <p className="rounded-xl bg-rose-50 p-4 text-rose-900" role="alert">{error}</p>;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-slate-950">{t('booking.title')}</h1>
      <CallRequestPanel canShareRecords={canShareRecords} />
      <CareBookingPanel
        assistantRequest={assistantRequest}
        canShareRecords={canShareRecords}
        screeningSessionId=""
      />
    </div>
  );
}
