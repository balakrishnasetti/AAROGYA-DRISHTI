import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../../services/api.js';

const inputClass = 'min-h-touch w-full rounded-xl border border-teal-200 bg-white px-3 text-slate-950';

export default function AppointmentAdminPanel() {
  const { t } = useTranslation();
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [slots, setSlots] = useState([]);
  const [startAt, setStartAt] = useState('');
  const [duration, setDuration] = useState('30');
  const [fee, setFee] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [languages, setLanguages] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedDoctor = doctors.find((doctor) => doctor.doctorId === doctorId);

  const loadSlots = useCallback(async () => {
    if (!doctorId) {
      setSlots([]);
      return;
    }
    try {
      const response = await api.get('/admin/appointments/slots', { params: { doctorId } });
      setSlots(response.data.details || []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('booking.adminLoadError')));
    }
  }, [doctorId, t]);

  useEffect(() => {
    api.get('/admin/appointments/directory')
      .then((response) => setDoctors(response.data.details || []))
      .catch((requestError) => setError(getApiErrorMessage(requestError, t('booking.adminLoadError'))));
  }, [t]);

  useEffect(() => {
    loadSlots();
    if (selectedDoctor) {
      setFee(String(selectedDoctor.consultationFee ?? 0));
      setSpecialty(selectedDoctor.specialty ?? '');
      setLanguages(selectedDoctor.languages ?? []);
    }
  }, [loadSlots, selectedDoctor]);

  async function saveDoctor(event) {
    event.preventDefault();
    if (!selectedDoctor) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api.patch(`/admin/appointments/doctors/${doctorId}`, {
        consultationFee: Number(fee),
        languages,
        ...(specialty.trim() ? { specialty: specialty.trim() } : {}),
      });
      setDoctors((current) => current.map((doctor) => (
        doctor.doctorId === doctorId
          ? {
              ...doctor,
              consultationFee: response.data.details.consultationFee,
              specialty: response.data.details.specialty,
              languages: response.data.details.languages,
            }
          : doctor
      )));
      setNotice(t('booking.adminDoctorSaved'));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('booking.adminSaveError')));
    } finally {
      setBusy(false);
    }
  }

  async function addSlot(event) {
    event.preventDefault();
    if (!selectedDoctor || !startAt) return;
    const start = new Date(startAt);
    const end = new Date(start.getTime() + Number(duration) * 60_000);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.post('/admin/appointments/slots', {
        doctorId,
        hospitalId: selectedDoctor.hospitalId,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
      setNotice(t('booking.adminSlotCreated'));
      setStartAt('');
      await loadSlots();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('booking.adminSaveError')));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSlot(slot) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.patch(`/admin/appointments/slots/${slot._id}`, {
        status: slot.status === 'available' ? 'unavailable' : 'available',
      });
      await loadSlots();
      setNotice(t('booking.adminSlotUpdated'));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('booking.adminSaveError')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-teal-100 bg-surface p-5" aria-labelledby="appointment-admin-title">
      <div>
        <h2 id="appointment-admin-title" className="text-xl font-bold text-ink">
          {t('booking.adminTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('booking.adminDescription')}</p>
      </div>
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-900">{notice}</p> : null}
      <label className="grid gap-2 font-semibold">
        {t('booking.adminDoctor')}
        <select className={inputClass} value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
          <option value="">{t('booking.adminChooseDoctor')}</option>
          {doctors.map((doctor) => (
            <option key={doctor.doctorId} value={doctor.doctorId}>
              {doctor.doctorName} · {doctor.specialty || t('booking.doctor')} · {doctor.hospitalName}
            </option>
          ))}
        </select>
      </label>
      {selectedDoctor ? (
        <>
          <form className="grid gap-3 sm:grid-cols-4" onSubmit={saveDoctor}>
            <label className="grid gap-2 font-semibold">
              {t('booking.specialty')}
              <input className={inputClass} value={specialty} onChange={(event) => setSpecialty(event.target.value)} maxLength={120} required />
            </label>
            <label className="grid gap-2 font-semibold">
              {t('booking.fee')}
              <input className={inputClass} type="number" min="0" max="1000000" step="1" value={fee} onChange={(event) => setFee(event.target.value)} required />
            </label>
            <label className="grid gap-2 font-semibold">
              {t('booking.languages')}
              <select
                className={inputClass}
                multiple
                value={languages}
                onChange={(event) => setLanguages(Array.from(event.target.selectedOptions, (option) => option.value))}
              >
                {['en', 'hi', 'te', 'ta', 'kn', 'ml', 'bn', 'mr'].map((language) => (
                  <option key={language} value={language}>{language.toUpperCase()}</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy} className="min-h-touch self-end rounded-xl bg-teal-800 px-4 font-semibold text-white disabled:opacity-50">
              {t('booking.saveDoctor')}
            </button>
          </form>
          <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto]" onSubmit={addSlot}>
            <label className="grid gap-2 font-semibold">
              {t('booking.adminSlotStart')}
              <input className={inputClass} type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} required />
            </label>
            <label className="grid gap-2 font-semibold">
              {t('booking.adminSlotDuration')}
              <select className={inputClass} value={duration} onChange={(event) => setDuration(event.target.value)}>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </label>
            <button type="submit" disabled={busy || !startAt} className="min-h-touch self-end rounded-xl bg-teal-800 px-4 font-semibold text-white disabled:opacity-50">
              {t('booking.adminAddSlot')}
            </button>
          </form>
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {slots.length ? slots.map((slot) => (
              <li key={slot._id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span>{new Date(slot.startAt).toLocaleString()} · {slot.status}</span>
                {slot.status !== 'booked' ? (
                  <button type="button" disabled={busy} onClick={() => toggleSlot(slot)} className="min-h-touch rounded-lg border border-slate-300 px-3 font-semibold">
                    {slot.status === 'available' ? t('booking.adminMarkUnavailable') : t('booking.adminMarkAvailable')}
                  </button>
                ) : <span className="text-sm text-muted">{t('booking.adminBooked')}</span>}
              </li>
            )) : <li className="p-3 text-muted">{t('booking.adminNoSlots')}</li>}
          </ul>
        </>
      ) : null}
    </section>
  );
}
