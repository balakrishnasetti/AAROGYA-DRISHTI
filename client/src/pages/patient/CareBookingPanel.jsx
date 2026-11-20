import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../../services/api.js';
import { useAuth } from '../../store/useAuth.js';

export default function CareBookingPanel({ screeningSessionId, canShareRecords, assistantRequest }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [hospitals, setHospitals] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [slots, setSlots] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [hospitalId, setHospitalId] = useState(() => searchParams.get('hospitalId') ?? '');
  const [doctorId, setDoctorId] = useState('');
  const [slotId, setSlotId] = useState('');
  const [date, setDate] = useState(() => {
    const firstAvailableDate = new Date();
    firstAvailableDate.setDate(firstAvailableDate.getDate() + 1);
    return `${firstAvailableDate.getFullYear()}-${String(firstAvailableDate.getMonth() + 1).padStart(2, '0')}-${String(firstAvailableDate.getDate()).padStart(2, '0')}`;
  });
  const [reason, setReason] = useState('');
  const [consultationMode, setConsultationMode] = useState('in_person');
  const [patientName, setPatientName] = useState(user?.fullName ?? '');
  const [patientPhone, setPatientPhone] = useState(user?.phone ?? '');
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [rescheduleSlots, setRescheduleSlots] = useState([]);
  const [rescheduleSlotId, setRescheduleSlotId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingCancelId, setConfirmingCancelId] = useState('');

  useEffect(() => {
    if (user?.fullName) setPatientName(user.fullName);
    if (user?.phone) setPatientPhone(user.phone);
  }, [user?.fullName, user?.phone]);

  const loadAppointments = useCallback(async () => {
    try {
      const response = await api.get('/appointments/mine');
      setAppointments(response.data.details || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, t('booking.loadError')));
    }
  }, [t]);

  useEffect(() => {
    Promise.all([api.get('/hospitals'), loadAppointments()])
      .then(([response]) => setHospitals(response.data.details || []))
      .catch((loadError) => setError(getApiErrorMessage(loadError, t('booking.loadError'))));
  }, [loadAppointments, t]);

  useEffect(() => {
    const requestedHospital = searchParams.get('hospitalId');
    if (requestedHospital) setHospitalId(requestedHospital);
  }, [searchParams]);

  useEffect(() => {
    setDoctors([]);
    setDoctorId('');
    setSlots([]);
    setSlotId('');
    if (!hospitalId) return;
    api
      .get(`/hospitals/${hospitalId}/doctors`)
      .then((response) => setDoctors(response.data.details || []))
      .catch((loadError) => setError(getApiErrorMessage(loadError, t('booking.loadError'))));
  }, [hospitalId, t]);

  useEffect(() => {
    setSlots([]);
    setSlotId('');
    if (!hospitalId || !doctorId) return;
    api
      .get('/appointments/slots', { params: { hospitalId, doctorId, date } })
      .then((response) => setSlots(response.data.details || []))
      .catch((loadError) => setError(getApiErrorMessage(loadError, t('booking.loadError'))));
  }, [date, doctorId, hospitalId, t]);

  async function submit(event) {
    event.preventDefault();
    const slot = slots.find((item) => item._id === slotId);
    if (!slot) {
      setError(t('booking.chooseSlot'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/appointments', {
        doctorId,
        hospitalId,
        timeSlotId: slot._id,
        slotStart: slot.startAt,
        reason,
        consultationMode,
        patientName,
        patientPhone,
        ...(canShareRecords && screeningSessionId ? { screeningSessionId } : {}),
      });
      setReason('');
      setSlotId('');
      await loadAppointments();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('booking.requestError')));
    } finally {
      setBusy(false);
    }
  }

  async function beginReschedule(appointment) {
    setBusy(true);
    setError('');
    setRescheduleSlots([]);
    setRescheduleSlotId('');
    try {
      const response = await api.get('/appointments/slots', {
        params: { doctorId: appointment.doctorId, hospitalId: appointment.hospitalId, date },
      });
      setRescheduleSlots(response.data.details || []);
      setRescheduleTarget(appointment);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('booking.loadError')));
    } finally {
      setBusy(false);
    }
  }

  async function rescheduleAppointment() {
    if (!rescheduleTarget || !rescheduleSlotId) return;
    const slot = rescheduleSlots.find((item) => item._id === rescheduleSlotId);
    if (!slot) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/appointments/${rescheduleTarget._id}/reschedule`, {
        timeSlotId: slot._id,
        slotStart: slot.startAt,
      });
      setRescheduleTarget(null);
      setRescheduleSlotId('');
      await loadAppointments();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('booking.requestError')));
    } finally {
      setBusy(false);
    }
  }

  async function downloadReceipt(appointmentId) {
    setError('');
    try {
      const response = await api.get(`/appointments/${appointmentId}/receipt`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `appointment-${appointmentId}.pdf`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('booking.receiptError')));
    }
  }

  async function cancelAppointment(appointmentId) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/appointments/${appointmentId}/status`, {
        status: 'cancelled',
        reason: 'Cancelled at the patient confirmed request.',
      });
      setConfirmingCancelId('');
      await loadAppointments();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('booking.cancelError')));
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'min-h-touch w-full rounded-xl border border-slate-300 bg-white px-4 py-3';
  const today = new Date();
  const minimumDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const selectedDoctor = doctors.find((doctor) => doctor.userId === doctorId);
  const showingSyntheticDirectory =
    hospitals.some((hospital) => hospital.isSynthetic) ||
    doctors.some((doctor) => doctor.isSynthetic);
  return (
    <section id="patient-booking" className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">{t('booking.title')}</h2>
        <p className="mt-2 text-slate-700">{t('booking.description')}</p>
        {assistantRequest?.doctor && assistantRequest.date && assistantRequest.time ? (
          <p className="mt-3 rounded-xl border border-teal-300 bg-teal-50 p-3 font-semibold text-teal-950">
            {t('booking.assistantRequest', assistantRequest)}
          </p>
        ) : null}
        {showingSyntheticDirectory ? (
          <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-950">
            {t('booking.syntheticNotice')}
          </p>
        ) : null}
        <details className="mt-3 rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer font-semibold">{t('booking.demoCommunicationTitle')}</summary>
          <p className="mt-2 text-slate-700">{t('booking.demoCommunicationDescription')}</p>
        </details>
        {!canShareRecords ? (
          <p className="mt-2 rounded-xl bg-amber-50 p-3 text-amber-950">
            {t('booking.shareConsent')}
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-900">
          {error}
        </p>
      ) : null}
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <label className="grid gap-2 font-semibold">
          {t('booking.hospital')}
          <select
            className={inputClass}
            value={hospitalId}
            onChange={(event) => setHospitalId(event.target.value)}
            required
          >
            <option value="">{t('booking.chooseHospital')}</option>
            {hospitals.map((hospital) => (
              <option key={hospital.id} value={hospital.id}>
                {hospital.isSynthetic ? `${t('booking.syntheticPrefix')} · ` : ''}
                {hospital.name} · {hospital.city}
              </option>
            ))}
          </select>
        </label>
        {!hospitalId ? (
          <p className="text-sm text-muted sm:col-span-2" role="status">
            {t('booking.selectFacilityFirst')}
          </p>
        ) : null}
        <label className="grid gap-2 font-semibold">
          {t('booking.doctor')}
          <select
            className={inputClass}
            value={doctorId}
            onChange={(event) => setDoctorId(event.target.value)}
            disabled={!hospitalId}
            required
          >
            <option value="">{t('booking.chooseDoctor')}</option>
            {doctors.map((doctor) => (
              <option key={doctor.userId} value={doctor.userId}>
                {doctor.isSynthetic ? `${t('booking.syntheticPrefix')} · ` : ''}
                {doctor.fullName} · {doctor.specialty || doctor.qualification}
              </option>
            ))}
          </select>
        </label>
        {selectedDoctor ? (
          <p className="rounded-xl bg-teal-50 p-3 text-sm text-teal-950 sm:col-span-2">
            {t('booking.specialty')}: {selectedDoctor.specialty || selectedDoctor.qualification} ·
            {' '}{t('booking.fee')}: ₹{Number(selectedDoctor.consultationFee ?? 0).toFixed(2)} ·
            {' '}{t('booking.languages')}: {(selectedDoctor.languages ?? []).join(', ') || '—'}
          </p>
        ) : null}
        <label className="grid gap-2 font-semibold sm:col-span-2">
          {t('booking.time')}
          <input
            className={inputClass}
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setSlotId('');
            }}
            min={minimumDate}
          />
          <select
            className={inputClass}
            value={slotId}
            onChange={(event) => setSlotId(event.target.value)}
            disabled={!doctorId}
            required
          >
            <option value="">
              {slots.length ? t('booking.chooseTime') : t('booking.noSlots')}
            </option>
            {slots.map((slot) => (
              <option key={slot._id} value={slot._id}>
                {new Date(slot.startAt).toLocaleString(i18n.language)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 font-semibold">
          {t('booking.consultationMode')}
          <select className={inputClass} value={consultationMode} onChange={(event) => setConsultationMode(event.target.value)}>
            <option value="in_person">{t('booking.inPerson')}</option>
            <option value="video" disabled>{t('booking.videoUnavailable')}</option>
          </select>
        </label>
        <label className="grid gap-2 font-semibold">
          {t('booking.paymentOption')}
          <input className={inputClass} value={t('booking.payAtHospital')} readOnly />
        </label>
        <label className="grid gap-2 font-semibold">
          {t('booking.patientName')}
          <input className={inputClass} value={patientName} onChange={(event) => setPatientName(event.target.value)} maxLength={120} required />
        </label>
        <label className="grid gap-2 font-semibold">
          {t('booking.patientPhone')}
          <input className={inputClass} type="tel" value={patientPhone} onChange={(event) => setPatientPhone(event.target.value)} maxLength={20} minLength={7} required />
        </label>
        <label className="grid gap-2 font-semibold sm:col-span-2">
          {t('booking.reason')}
          <textarea
            className={inputClass}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={1000}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !slots.length}
          className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white disabled:opacity-50 sm:col-span-2"
        >
          {busy ? t('booking.sending') : t('booking.request')}
        </button>
      </form>
      <div className="border-t border-slate-200 pt-4">
        <h3 className="text-lg font-bold text-slate-900">{t('booking.myAppointments')}</h3>
        {appointments.length ? (
          <ul className="mt-3 space-y-2">
            {appointments.map((appointment) => (
              <li key={appointment._id} className="rounded-xl border border-slate-200 p-3">
                <p className="font-semibold">{appointment.doctorName} · {appointment.hospitalName}</p>
                <span className="font-semibold">
                  {new Date(appointment.slotStart).toLocaleString(i18n.language)}
                </span>
                <p className="mt-1 text-sm text-slate-700">
                  {t(appointment.consultationMode === 'video' ? 'booking.video' : 'booking.inPerson')} · ₹{Number(appointment.feeAmount ?? 0).toFixed(2)} · {t('booking.payAtHospital')}
                </p>
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-sm">
                  {t(`booking.status.${appointment.status}`, { defaultValue: appointment.status })}
                </span>
                {['requested', 'accepted', 'confirmed'].includes(appointment.status) ? (
                  confirmingCancelId === appointment._id ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="min-h-touch rounded-lg bg-rose-700 px-4 font-semibold text-white disabled:opacity-50"
                        disabled={busy}
                        onClick={() => cancelAppointment(appointment._id)}
                        type="button"
                      >
                        {t('booking.confirmCancel')}
                      </button>
                      <button
                        className="min-h-touch rounded-lg border border-slate-300 px-4 font-semibold"
                        disabled={busy}
                        onClick={() => setConfirmingCancelId('')}
                        type="button"
                      >
                        {t('booking.keepAppointment')}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="mt-3 min-h-touch rounded-lg border border-rose-300 px-4 font-semibold text-rose-800"
                      onClick={() => setConfirmingCancelId(appointment._id)}
                      type="button"
                    >
                      {t('booking.cancelRequest')}
                    </button>
                  )
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="min-h-touch rounded-lg border border-teal-700 px-4 font-semibold text-teal-900" onClick={() => downloadReceipt(appointment._id)}>
                    {t('booking.downloadReceipt')}
                  </button>
                  {['requested', 'accepted', 'confirmed'].includes(appointment.status) ? (
                    <button type="button" disabled={busy} className="min-h-touch rounded-lg border border-teal-700 px-4 font-semibold text-teal-900 disabled:opacity-50" onClick={() => beginReschedule(appointment)}>
                      {t('booking.reschedule')}
                    </button>
                  ) : null}
                </div>
                {rescheduleTarget?._id === appointment._id ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <select className={inputClass} value={rescheduleSlotId} onChange={(event) => setRescheduleSlotId(event.target.value)}>
                      <option value="">{t('booking.chooseTime')}</option>
                      {rescheduleSlots.map((slot) => <option key={slot._id} value={slot._id}>{new Date(slot.startAt).toLocaleString(i18n.language)}</option>)}
                    </select>
                    <button type="button" disabled={busy || !rescheduleSlotId} onClick={rescheduleAppointment} className="min-h-touch rounded-lg bg-teal-800 px-4 font-semibold text-white disabled:opacity-50">
                      {t('booking.confirmReschedule')}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-600">{t('booking.empty')}</p>
        )}
      </div>
    </section>
  );
}
