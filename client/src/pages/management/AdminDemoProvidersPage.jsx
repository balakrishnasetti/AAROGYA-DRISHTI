import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../services/api.js';
import { dentalSpecialties } from './dentalSpecialties.js';

const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const defaultAvailability = days.flatMap((day) => [
  { day, startsAt: '09:00', endsAt: '12:00' },
  { day, startsAt: '14:00', endsAt: '16:00' },
  { day, startsAt: '17:00', endsAt: '18:30' },
]);

const emptyFacility = {
  name: '',
  facilityType: 'hospital',
  address: '',
  city: '',
  state: 'Andhra Pradesh',
  postalCode: '000000',
  district: 'Alluri Sitarama Raju District',
  mandal: '',
  village: '',
  contactEmail: 'demo@example.invalid',
  contactPhone: '0000000000',
  services: '',
  facilities: '',
};

const emptyDoctor = {
  fullName: '',
  facilityId: '',
  qualification: 'Synthetic demo qualification; not a real credential',
  specialty: dentalSpecialties[0],
  experienceYears: '0',
  consultationFee: '0',
};

const specialtyTranslationKeys = {
  'General Dentistry': 'generalDentistry',
  'Oral Medicine and Radiology': 'oralMedicine',
  'Oral and Maxillofacial Surgery': 'oralSurgery',
  Orthodontics: 'orthodontics',
  Periodontics: 'periodontics',
  Endodontics: 'endodontics',
  'Pediatric Dentistry': 'pediatricDentistry',
  Prosthodontics: 'prosthodontics',
};

function specialtyLabel(specialty, t) {
  const translationKey = specialtyTranslationKeys[specialty];
  return translationKey
    ? t(`demoProviders.specialties.${translationKey}`, specialty)
    : specialty;
}

function listValue(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export default function AdminDemoProvidersPage() {
  const { t, i18n } = useTranslation();
  const [facilities, setFacilities] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [slots, setSlots] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [facilityForm, setFacilityForm] = useState(emptyFacility);
  const [doctorForm, setDoctorForm] = useState(emptyDoctor);
  const [editingFacilityId, setEditingFacilityId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/admin/demo-providers');
      setFacilities(response.data.details.facilities);
      setDoctors(response.data.details.doctors);
      setSlots(response.data.details.slots);
      setAppointments(response.data.details.appointments);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          t('demoProviders.loadError', 'Synthetic provider data could not be loaded.'),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveFacility(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const payload = {
      ...facilityForm,
      contactEmail: facilityForm.contactEmail.toLowerCase(),
      services: listValue(facilityForm.services),
      facilities: listValue(facilityForm.facilities),
      workingHours: days.map((day) => ({
        day,
        opensAt: '09:00',
        closesAt: '18:30',
        closed: false,
      })).concat([{ day: 'sun', closed: true }]),
    };
    try {
      if (editingFacilityId) {
        await api.patch(`/admin/demo-providers/facilities/${editingFacilityId}`, payload);
      } else {
        await api.post('/admin/demo-providers/facilities', payload);
      }
      setFacilityForm(emptyFacility);
      setEditingFacilityId('');
      setNotice(t('demoProviders.saved', 'Synthetic facility saved.'));
      await load();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          t('demoProviders.saveError', 'Synthetic facility could not be saved.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveDoctor(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.post('/admin/demo-providers/doctors', {
        ...doctorForm,
        experienceYears: Number(doctorForm.experienceYears),
        consultationFee: Number(doctorForm.consultationFee),
        languages: ['te', 'en'],
        availability: defaultAvailability,
      });
      setDoctorForm({ ...emptyDoctor, facilityId: doctorForm.facilityId });
      setNotice(t('demoProviders.doctorSaved', 'Synthetic doctor saved as unverified.'));
      await load();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          t('demoProviders.saveError', 'Synthetic doctor could not be saved.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveDoctorEdits(profile, event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const formData = new FormData(event.currentTarget);
    try {
      await api.patch(`/admin/demo-providers/doctors/${profile.userId._id}`, {
        fullName: String(formData.get('fullName')).trim(),
        specialty: String(formData.get('specialty')),
        qualification: String(formData.get('qualification')).trim(),
        experienceYears: Number(formData.get('experienceYears')),
        consultationFee: Number(formData.get('consultationFee')),
        languages: ['te', 'en'],
        availability: defaultAvailability,
      });
      setNotice(t('demoProviders.doctorSaved', 'Synthetic doctor updated; status remains unverified.'));
      await load();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          t('demoProviders.saveError', 'Synthetic doctor could not be updated.'),
      );
    } finally {
      setBusy(false);
    }
  }

  function editFacility(facility) {
    setEditingFacilityId(facility._id);
    setFacilityForm({
      name: facility.name,
      facilityType: facility.facilityType,
      address: facility.address,
      city: facility.city,
      state: facility.state,
      postalCode: facility.postalCode,
      district: facility.district || '',
      mandal: facility.mandal || '',
      village: facility.village || '',
      contactEmail: facility.contactEmail || 'demo@example.invalid',
      contactPhone: facility.contactPhone || '0000000000',
      services: (facility.services || []).join(', '),
      facilities: (facility.facilities || []).join(', '),
    });
    document.getElementById('demo-facility-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  const inputClass = 'min-h-touch w-full rounded-lg border border-teal-200 bg-white px-3 py-2';
  const labelClass = 'grid gap-1 text-sm font-medium';

  if (loading && !facilities.length && !doctors.length) {
    return <p role="status">{t('demoProviders.loading', 'Loading synthetic demo records...')}</p>;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <header className="space-y-3">
        <Link className="font-semibold text-teal-800 underline" to="/admin">
          {t('demoProviders.back', 'Back to administration')}
        </Link>
        <p className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-lg font-bold text-amber-950">
          {t(
            'demoProviders.disclaimer',
            'SYNTHETIC DEMO DATA – NOT A REAL HEALTHCARE PROVIDER. Fictional records are never verified.',
          )}
        </p>
        <h1 className="text-3xl font-bold">{t('demoProviders.title', 'Demo provider directory')}</h1>
        <p className="text-muted">
          {t(
            'demoProviders.geography',
            'Andhra Pradesh → Alluri Sitarama Raju District → Demo Mandal → Demo Village → PHC',
          )}
        </p>
      </header>

      {error ? <p className="rounded-xl bg-red-50 p-4 text-red-900" role="alert">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-teal-50 p-4 text-teal-900" role="status">{notice}</p> : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('demoProviders.counts', 'Demo record counts')}>
        {[
          [t('demoProviders.hospitals', 'Hospitals'), facilities.filter((item) => item.facilityType === 'hospital').length],
          [t('demoProviders.phcs', 'PHCs'), facilities.filter((item) => item.facilityType === 'phc').length],
          [t('demoProviders.doctors', 'Dentists'), doctors.length],
          [t('demoProviders.appointments', 'Demo appointment requests'), appointments.length],
        ].map(([label, count]) => (
          <article className="rounded-xl border border-teal-100 bg-white p-4" key={label}>
            <p className="text-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold">{count}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-teal-100 bg-white p-5" id="demo-facility-form">
        <h2 className="text-xl font-bold">
          {editingFacilityId
            ? t('demoProviders.editFacility', 'Edit synthetic facility')
            : t('demoProviders.addFacility', 'Add synthetic hospital or PHC')}
        </h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={saveFacility}>
          <label className={labelClass}>
            {t('demoProviders.facilityType', 'Facility type')}
            <select className={inputClass} name="facilityType" onChange={(event) => setFacilityForm({ ...facilityForm, facilityType: event.target.value })} value={facilityForm.facilityType}>
              <option value="hospital">{t('demoProviders.hospitals', 'Hospital')}</option>
              <option value="phc">{t('demoProviders.phcs', 'PHC')}</option>
            </select>
          </label>
          {[
            ['name', t('demoProviders.name', 'Fictional facility name')],
            ['address', t('demoProviders.address', 'Demo address')],
            ['city', t('demoProviders.city', 'Demo town / mandal')],
            ['district', t('demoProviders.district', 'District')],
            ['mandal', t('demoProviders.mandal', 'Mandal')],
            ['village', t('demoProviders.village', 'Village')],
            ['postalCode', t('demoProviders.postalCode', 'Demo postal code')],
            ['contactEmail', t('demoProviders.contactEmail', 'Demo email (.invalid)')],
            ['contactPhone', t('demoProviders.contactPhone', 'Demo phone (not callable)')],
            ['services', t('demoProviders.services', 'Demo services (comma separated)')],
            ['facilities', t('demoProviders.facilities', 'Demo facilities (comma separated)')],
          ].map(([name, label]) => (
            <label className={labelClass} key={name}>
              {label}
              <input className={inputClass} maxLength={300} name={name} onChange={(event) => setFacilityForm({ ...facilityForm, [name]: event.target.value })} required={['name', 'address', 'city', 'district', 'postalCode', 'contactEmail', 'contactPhone'].includes(name)} value={facilityForm[name]} />
            </label>
          ))}
          <input type="hidden" name="state" value={facilityForm.state} />
          <button className="min-h-touch rounded-xl bg-teal-800 px-4 font-bold text-white disabled:opacity-60 sm:col-span-2" disabled={busy} type="submit">
            {busy ? t('demoProviders.saving', 'Saving...') : t('demoProviders.save', 'Save synthetic facility')}
          </button>
        </form>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {facilities.map((facility) => (
            <li className="rounded-xl border border-amber-200 bg-amber-50 p-4" key={facility._id}>
              <p className="font-bold">{facility.name}</p>
              <p>{facility.district} · {facility.mandal} · {facility.village}</p>
              <p className="text-sm">{facility.facilityType.toUpperCase()} · {facility.code}</p>
              <p className="text-sm">{(facility.workingHours || []).map((hours) => hours.closed ? `${hours.day}: ${t('demoProviders.closed', 'Closed')}` : `${hours.day}: ${hours.opensAt}–${hours.closesAt}`).join(' · ')}</p>
              <p className="text-xs font-bold text-amber-900">{t('demoProviders.disclaimerShort', 'SYNTHETIC DEMO DATA – NOT A REAL HEALTHCARE PROVIDER')}</p>
              <button className="mt-2 text-sm font-semibold text-teal-800 underline" onClick={() => editFacility(facility)} type="button">
                {t('demoProviders.edit', 'Edit')}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-teal-100 bg-white p-5">
        <h2 className="text-xl font-bold">{t('demoProviders.addDoctor', 'Add synthetic dentist')}</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={saveDoctor}>
          <label className={labelClass}>
            {t('demoProviders.name', 'Fictional name')}
            <input className={inputClass} onChange={(event) => setDoctorForm({ ...doctorForm, fullName: event.target.value })} required value={doctorForm.fullName} />
          </label>
          <label className={labelClass}>
            {t('demoProviders.facility', 'Demo hospital or PHC')}
            <select className={inputClass} onChange={(event) => setDoctorForm({ ...doctorForm, facilityId: event.target.value })} required value={doctorForm.facilityId}>
              <option value="">{t('demoProviders.chooseFacility', 'Choose a synthetic facility')}</option>
              {facilities.map((facility) => <option key={facility._id} value={facility._id}>{facility.name}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            {t('demoProviders.specialty', 'Dental specialty')}
            <select className={inputClass} onChange={(event) => setDoctorForm({ ...doctorForm, specialty: event.target.value })} value={doctorForm.specialty}>
              {dentalSpecialties.map((specialty) => <option key={specialty} value={specialty}>{specialtyLabel(specialty, t)}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            {t('demoProviders.qualification', 'Demo qualification')}
            <input className={inputClass} onChange={(event) => setDoctorForm({ ...doctorForm, qualification: event.target.value })} required value={doctorForm.qualification} />
          </label>
          <label className={labelClass}>
            {t('demoProviders.experience', 'Demo experience in years')}
            <input className={inputClass} max="80" min="0" onChange={(event) => setDoctorForm({ ...doctorForm, experienceYears: event.target.value })} type="number" value={doctorForm.experienceYears} />
          </label>
          <label className={labelClass}>
            {t('demoProviders.fee', 'Demo consultation fee')}
            <input className={inputClass} max="1000000" min="0" onChange={(event) => setDoctorForm({ ...doctorForm, consultationFee: event.target.value })} type="number" value={doctorForm.consultationFee} />
          </label>
          <p className="text-sm text-muted sm:col-span-2">
            {t('demoProviders.schedule', 'Morning 09:00–12:00 · Afternoon 14:00–16:00 · Evening 17:00–18:30, Monday–Saturday.')}
          </p>
          <button className="min-h-touch rounded-xl bg-teal-800 px-4 font-bold text-white disabled:opacity-60 sm:col-span-2" disabled={busy || !facilities.length} type="submit">
            {busy ? t('demoProviders.saving', 'Saving...') : t('demoProviders.saveDoctor', 'Save synthetic dentist')}
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold">{t('demoProviders.directory', 'Synthetic dental directory')}</h2>
        {doctors.map((profile) => {
          const providerSlots = slots.filter((slot) => slot.doctorId === profile.userId?._id);
          const providerAppointments = appointments.filter((appointment) => appointment.doctorId === profile.userId?._id);
          return (
            <article className="space-y-3 rounded-2xl border-2 border-amber-300 bg-white p-5" key={profile._id}>
              <p className="rounded-lg bg-amber-50 p-2 text-sm font-bold text-amber-950">
                {t('demoProviders.disclaimerShort', 'SYNTHETIC DEMO DATA – NOT A REAL HEALTHCARE PROVIDER')} · {t('demoProviders.unverified', 'Unverified; not a real clinician')}
              </p>
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => saveDoctorEdits(profile, event)}>
                <label className={labelClass}>{t('demoProviders.name', 'Fictional name')}<input className={inputClass} defaultValue={profile.userId?.fullName || ''} name="fullName" required /></label>
                <label className={labelClass}>{t('demoProviders.facility', 'Demo facility')}<input className={inputClass} disabled value={profile.hospitalId?.name || ''} /></label>
                <label className={labelClass}>{t('demoProviders.specialty', 'Dental specialty')}<select className={inputClass} defaultValue={profile.specialty} name="specialty">{dentalSpecialties.map((specialty) => <option key={specialty} value={specialty}>{specialtyLabel(specialty, t)}</option>)}</select></label>
                <label className={labelClass}>{t('demoProviders.qualification', 'Demo qualification')}<input className={inputClass} defaultValue={profile.qualification} name="qualification" required /></label>
                <label className={labelClass}>{t('demoProviders.experience', 'Demo experience in years')}<input className={inputClass} defaultValue={profile.experienceYears} max="80" min="0" name="experienceYears" type="number" /></label>
                <label className={labelClass}>{t('demoProviders.fee', 'Demo consultation fee')}<input className={inputClass} defaultValue={profile.consultationFee} max="1000000" min="0" name="consultationFee" type="number" /></label>
                <button className="min-h-touch rounded-xl border border-teal-700 px-4 font-semibold text-teal-800 sm:col-span-2" disabled={busy} type="submit">{t('demoProviders.saveChanges', 'Save demo profile')}</button>
              </form>
              <p className="text-sm text-muted">
                {profile.hospitalId?.district} · {profile.hospitalId?.mandal} · {profile.hospitalId?.village} · {specialtyLabel(profile.specialty, t)} · {t('demoProviders.availableSlots', 'Available simulated slots')}: {providerSlots.length} · {t('demoProviders.appointmentRequests', 'Demo appointment requests')}: {providerAppointments.length}
              </p>
              <p className="text-sm">{profile.availability?.slice(0, 3).map((slot) => `${slot.startsAt}–${slot.endsAt}`).join(' · ')}</p>
            </article>
          );
        })}
      </section>

      <p className="text-sm text-muted">
        {t('demoProviders.refreshed', 'Last opened in')} {new Date().toLocaleString(i18n.language)}. {t('demoProviders.communication', '24/7 communication is simulated only; no messages or emergency response are provided.')}
      </p>
    </main>
  );
}
