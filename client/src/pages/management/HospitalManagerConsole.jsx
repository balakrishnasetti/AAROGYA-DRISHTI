import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api.js';

const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const blankDoctor = {
  fullName: '',
  email: '',
  phone: '',
  qualification: '',
  registrationNumber: '',
  specialty: '',
  experienceYears: '0',
  previousWork: '',
  achievements: '',
  expertise: '',
  consultationFee: '0',
  availability: [],
};
const emptyHours = days.map((day) => ({
  day,
  opensAt: '09:00',
  closesAt: '17:00',
  closed: day === 'sun',
}));

function messageFor(error, t) {
  const code = error.response?.data?.code;
  return t(code ? `errors.${code}` : 'errors.requestFailed', {
    defaultValue: t('errors.requestFailed'),
  });
}

function Metric({ label, value }) {
  return (
    <article className="rounded-2xl border border-teal-100 bg-surface p-5 shadow-sm">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value ?? '—'}</p>
    </article>
  );
}

function listValue(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function HospitalManagerConsole() {
  const { t } = useTranslation();
  const [hospital, setHospital] = useState(null);
  const [profileForm, setProfileForm] = useState(null);
  const [overview, setOverview] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [credentials, setCredentials] = useState(null);
  const [doctorForm, setDoctorForm] = useState(blankDoctor);
  const [editingDoctorId, setEditingDoctorId] = useState('');
  const [documentKind, setDocumentKind] = useState({});
  const [doctorSearch, setDoctorSearch] = useState('');
  const [doctorStatusFilter, setDoctorStatusFilter] = useState('');
  const [privateFiles, setPrivateFiles] = useState({});
  const privateFileUrls = useRef(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [hospitalResponse, overviewResponse, doctorsResponse] = await Promise.all([
        api.get('/hospital-manager/hospital'),
        api.get('/hospital-manager/overview'),
        api.get('/hospital-manager/doctors'),
      ]);
      const nextHospital = hospitalResponse.data.details;
      setHospital(nextHospital);
      setOverview(overviewResponse.data.details);
      setDoctors(doctorsResponse.data.details);
      setProfileForm({
        name: nextHospital.name ?? '',
        address: nextHospital.address ?? '',
        city: nextHospital.city ?? '',
        state: nextHospital.state ?? '',
        postalCode: nextHospital.postalCode ?? '',
        contactEmail: nextHospital.contactEmail ?? '',
        contactPhone: nextHospital.contactPhone ?? '',
        latitude: nextHospital.coordinates?.latitude ?? '',
        longitude: nextHospital.coordinates?.longitude ?? '',
        facilities: (nextHospital.facilities ?? []).join(', '),
        services: (nextHospital.services ?? []).join(', '),
        workingHours: days.map(
          (day) =>
            nextHospital.workingHours?.find((item) => item.day === day) ??
            emptyHours.find((item) => item.day === day),
        ),
      });
    } catch (requestError) {
      setError(messageFor(requestError, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () => () => {
      for (const url of privateFileUrls.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );

  function updateProfile(event) {
    const { name, value } = event.target;
    setProfileForm((current) => ({ ...current, [name]: value }));
  }

  async function saveProfile(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    const payload = {
      name: profileForm.name,
      address: profileForm.address,
      city: profileForm.city,
      state: profileForm.state,
      postalCode: profileForm.postalCode,
      contactEmail: profileForm.contactEmail || undefined,
      contactPhone: profileForm.contactPhone || undefined,
      facilities: listValue(profileForm.facilities),
      services: listValue(profileForm.services),
      workingHours: profileForm.workingHours.map(({ day, opensAt, closesAt, closed }) => ({
        day,
        closed,
        ...(closed ? {} : { opensAt, closesAt }),
      })),
    };
    if (profileForm.latitude !== '' && profileForm.longitude !== '') {
      payload.coordinates = {
        latitude: Number(profileForm.latitude),
        longitude: Number(profileForm.longitude),
      };
    }
    try {
      await api.patch('/hospital-manager/hospital', payload);
      setSuccess(t('management.hospitalUpdated'));
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  function updateDoctor(event) {
    const { name, value } = event.target;
    setDoctorForm((current) => ({ ...current, [name]: value }));
  }

  function editDoctor(profile) {
    const user = profile.userId;
    setEditingDoctorId(user._id);
    setDoctorForm({
      fullName: user.fullName ?? '',
      email: user.email ?? '',
      phone: user.phone ?? '',
      qualification: profile.qualification ?? '',
      registrationNumber: profile.registrationNumber ?? '',
      specialty: profile.specialty ?? '',
      experienceYears: String(profile.experienceYears ?? 0),
      previousWork: (profile.previousWork ?? []).join(', '),
      achievements: (profile.achievements ?? []).join(', '),
      expertise: (profile.expertise ?? []).join(', '),
      consultationFee: String(profile.consultationFee ?? 0),
      availability: profile.availability ?? [],
    });
    document.getElementById('doctor-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  function doctorPayload() {
    return {
      fullName: doctorForm.fullName,
      email: doctorForm.email,
      phone: doctorForm.phone,
      qualification: doctorForm.qualification,
      registrationNumber: doctorForm.registrationNumber,
      specialty: doctorForm.specialty || undefined,
      experienceYears: Number(doctorForm.experienceYears),
      previousWork: listValue(doctorForm.previousWork),
      achievements: listValue(doctorForm.achievements),
      expertise: listValue(doctorForm.expertise),
      consultationFee: Number(doctorForm.consultationFee),
      availability: doctorForm.availability,
    };
  }

  async function saveDoctor(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    try {
      if (editingDoctorId) {
        await api.patch(`/hospital-manager/doctors/${editingDoctorId}`, doctorPayload());
        setSuccess(t('management.doctorUpdated'));
      } else {
        const response = await api.post('/hospital-manager/doctors', doctorPayload());
        setCredentials(response.data.details.credentials);
        setSuccess(t('management.doctorCreated'));
      }
      setDoctorForm(blankDoctor);
      setEditingDoctorId('');
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  async function uploadFile(doctorId, kind, file) {
    if (!file) return;
    setError('');
    setSuccess('');
    const body = new FormData();
    body.append('file', file);
    try {
      await api.post(`/hospital-manager/doctors/${doctorId}/documents/${kind}`, body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSuccess(t('management.documentUploaded'));
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  async function uploadPhoto(doctorId, file) {
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    try {
      await api.post(`/hospital-manager/doctors/${doctorId}/photo`, body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSuccess(t('management.photoUploaded'));
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  async function reviewDocument(doctorId, documentId, verificationStatus) {
    setError('');
    try {
      await api.patch(`/hospital-manager/doctors/${doctorId}/documents/${documentId}/review`, {
        verificationStatus,
      });
      setSuccess(t('management.documentReviewed'));
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  async function openPrivateFile(doctorId, documentId) {
    setError('');
    try {
      const response = await api.get(
        `/hospital-manager/doctors/${doctorId}/documents/${documentId}/content`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(response.data);
      setPrivateFileUrl(`document-${documentId}`, url);
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  async function openPrivatePhoto(doctorId) {
    setError('');
    try {
      const response = await api.get(`/hospital-manager/doctors/${doctorId}/photo`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      setPrivateFileUrl(`photo-${doctorId}`, url);
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  function setPrivateFileUrl(key, url) {
    const previousUrl = privateFileUrls.current.get(key);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    privateFileUrls.current.set(key, url);
    setPrivateFiles((current) => ({ ...current, [key]: url }));
  }

  async function verifyDoctor(doctorId) {
    setError('');
    try {
      await api.post(`/hospital-manager/doctors/${doctorId}/verify`);
      setSuccess(t('management.doctorVerified'));
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  async function setDoctorStatus(doctorId, status) {
    try {
      await api.patch(`/hospital-manager/doctors/${doctorId}/status`, { status });
      setSuccess(t('management.doctorUpdated'));
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  const inputClass =
    'min-h-touch w-full rounded-xl border border-teal-200 bg-surface px-3 text-ink';
  const labelClass = 'grid gap-1 text-sm font-medium text-ink';
  const visibleDoctors = doctors.filter((profile) => {
    const user = profile.userId;
    const query = doctorSearch.toLocaleLowerCase();
    const matchesText =
      !query ||
      [user.fullName, user.staffId, profile.specialty, profile.registrationNumber].some((value) =>
        value?.toLocaleLowerCase().includes(query),
      );
    return matchesText && (!doctorStatusFilter || user.status === doctorStatusFilter);
  });

  if (loading && !hospital)
    return (
      <p role="status" className="text-muted">
        {t('management.loading')}
      </p>
    );

  return (
    <section className="space-y-8" aria-labelledby="manager-title">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-teal-700">
          {t('management.managerEyebrow')}
        </p>
        <h1 id="manager-title" className="mt-2 text-display-sm text-ink">
          {t('management.managerTitle')}
        </h1>
        {hospital ? (
          <p className="mt-2 text-muted">
            {hospital.name} · {hospital.code}
          </p>
        ) : null}
      </header>
      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
          {success}
        </p>
      ) : null}
      {credentials ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="credential-title"
          className="rounded-2xl border border-amber-300 bg-amber-50 p-5"
        >
          <h2 id="credential-title" className="text-lg font-bold">
            {t('management.oneTimeCredentials')}
          </h2>
          <p className="mt-2">{t('management.credentialsWarning')}</p>
          <p className="mt-3 break-all font-mono">
            {t('management.staffId')}: {credentials.staffId}
          </p>
          <p className="break-all font-mono">
            {t('management.initialPassword')}: {credentials.initialPassword}
          </p>
          <button
            className="mt-4 min-h-touch rounded-xl bg-teal-800 px-4 font-semibold text-white"
            onClick={() => setCredentials(null)}
            type="button"
          >
            {t('management.close')}
          </button>
        </div>
      ) : null}

      <div id="manager-overview" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label={t('management.doctors')} value={overview?.doctors} />
        <Metric label={t('management.appointments')} value={overview?.appointments} />
        <Metric label={t('management.upcoming')} value={overview?.upcoming} />
        <Metric label={t('management.completed')} value={overview?.completed} />
        <Metric label={t('management.pending')} value={overview?.pending} />
        <Metric label={t('management.emergencyRequests')} value={overview?.emergencyRequests} />
      </div>
      {overview ? (
        <section
          id="manager-appointments"
          className="rounded-2xl border border-teal-100 bg-surface p-5"
          aria-label={t('management.appointmentChart')}
        >
          <h2 className="text-lg font-bold">{t('management.appointmentChart')}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ['upcoming', overview.upcoming],
              ['completed', overview.completed],
              ['pending', overview.pending],
              ['emergencyRequests', overview.emergencyRequests],
            ].map(([key, value]) => (
              <div key={key}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{t(`management.${key}`)}</span>
                  <span>{value}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-teal-50">
                  <div
                    className="h-full rounded-full bg-teal-700"
                    style={{
                      width: `${Math.min(100, Math.max(value ? 3 : 0, (value / Math.max(1, overview.appointments)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <p className="rounded-xl border border-teal-100 bg-surface p-4 text-sm text-muted">
        {t('management.noClinicalDetails')}
      </p>

      {profileForm ? (
        <section id="manager-profile" className="rounded-2xl border border-teal-100 bg-surface p-5 sm:p-7">
          <h2 className="text-xl font-bold">{t('management.hospitalProfile')}</h2>
          <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={saveProfile}>
            <label className={labelClass}>
              {t('management.hospitalName')}
              <input
                className={inputClass}
                name="name"
                onChange={updateProfile}
                required
                value={profileForm.name}
              />
            </label>
            <label className={labelClass}>
              {t('management.contactEmail')}
              <input
                className={inputClass}
                name="contactEmail"
                onChange={updateProfile}
                type="email"
                value={profileForm.contactEmail}
              />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              {t('management.address')}
              <input
                className={inputClass}
                name="address"
                onChange={updateProfile}
                required
                value={profileForm.address}
              />
            </label>
            <label className={labelClass}>
              {t('management.city')}
              <input
                className={inputClass}
                name="city"
                onChange={updateProfile}
                required
                value={profileForm.city}
              />
            </label>
            <label className={labelClass}>
              {t('management.state')}
              <input
                className={inputClass}
                name="state"
                onChange={updateProfile}
                required
                value={profileForm.state}
              />
            </label>
            <label className={labelClass}>
              {t('management.postalCode')}
              <input
                className={inputClass}
                name="postalCode"
                onChange={updateProfile}
                required
                value={profileForm.postalCode}
              />
            </label>
            <label className={labelClass}>
              {t('management.contactPhone')}
              <input
                className={inputClass}
                name="contactPhone"
                onChange={updateProfile}
                value={profileForm.contactPhone}
              />
            </label>
            <label className={labelClass}>
              {t('management.latitude')}
              <input
                className={inputClass}
                max="90"
                min="-90"
                name="latitude"
                onChange={updateProfile}
                step="any"
                type="number"
                value={profileForm.latitude}
              />
            </label>
            <label className={labelClass}>
              {t('management.longitude')}
              <input
                className={inputClass}
                max="180"
                min="-180"
                name="longitude"
                onChange={updateProfile}
                step="any"
                type="number"
                value={profileForm.longitude}
              />
            </label>
            <label className={labelClass}>
              {t('management.facilities')}
              <input
                className={inputClass}
                name="facilities"
                onChange={updateProfile}
                value={profileForm.facilities}
              />
            </label>
            <label className={labelClass}>
              {t('management.services')}
              <input
                className={inputClass}
                name="services"
                onChange={updateProfile}
                value={profileForm.services}
              />
            </label>
            <fieldset className="grid gap-3 sm:col-span-2">
              <legend className="mb-2 font-semibold">{t('management.workingHours')}</legend>
              {profileForm.workingHours.map((hours, index) => (
                <div
                  className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2"
                  key={hours.day}
                >
                  <span className="w-10 text-sm font-medium">
                    {t(`management.day_${hours.day}`)}
                  </span>
                  <label className="sr-only" htmlFor={`open-${hours.day}`}>
                    {t('management.opensAt')}
                  </label>
                  <input
                    className={inputClass}
                    disabled={hours.closed}
                    id={`open-${hours.day}`}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        workingHours: current.workingHours.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, opensAt: event.target.value } : item,
                        ),
                      }))
                    }
                    type="time"
                    value={hours.opensAt ?? '09:00'}
                  />
                  <label className="sr-only" htmlFor={`close-${hours.day}`}>
                    {t('management.closesAt')}
                  </label>
                  <input
                    className={inputClass}
                    disabled={hours.closed}
                    id={`close-${hours.day}`}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        workingHours: current.workingHours.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, closesAt: event.target.value } : item,
                        ),
                      }))
                    }
                    type="time"
                    value={hours.closesAt ?? '17:00'}
                  />
                  <label className="flex min-h-touch items-center gap-1 text-sm">
                    <input
                      checked={hours.closed}
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          workingHours: current.workingHours.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, closed: event.target.checked } : item,
                          ),
                        }))
                      }
                      type="checkbox"
                    />
                    {t('management.closed')}
                  </label>
                </div>
              ))}
            </fieldset>
            <button
              className="min-h-touch rounded-xl bg-teal-800 px-5 font-semibold text-white sm:col-span-2"
              type="submit"
            >
              {t('management.saveChanges')}
            </button>
          </form>
        </section>
      ) : null}

      <section
        id="doctor-form"
        className="rounded-2xl border border-teal-100 bg-surface p-5 sm:p-7"
      >
        <h2 className="text-xl font-bold">
          {editingDoctorId ? t('management.editDoctor') : t('management.addDoctor')}
        </h2>
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={saveDoctor}>
          <label className={labelClass}>
            {t('management.fullName')}
            <input
              className={inputClass}
              name="fullName"
              onChange={updateDoctor}
              required
              value={doctorForm.fullName}
            />
          </label>
          <label className={labelClass}>
            {t('management.email')}
            <input
              className={inputClass}
              name="email"
              onChange={updateDoctor}
              required
              type="email"
              value={doctorForm.email}
            />
          </label>
          <label className={labelClass}>
            {t('management.phone')}
            <input
              className={inputClass}
              name="phone"
              onChange={updateDoctor}
              required
              value={doctorForm.phone}
            />
          </label>
          <label className={labelClass}>
            {t('management.qualification')}
            <input
              className={inputClass}
              name="qualification"
              onChange={updateDoctor}
              required
              value={doctorForm.qualification}
            />
          </label>
          <label className={labelClass}>
            {t('management.registrationNumber')}
            <input
              className={inputClass}
              name="registrationNumber"
              onChange={updateDoctor}
              required
              value={doctorForm.registrationNumber}
            />
          </label>
          <label className={labelClass}>
            {t('management.specialization')}
            <input
              className={inputClass}
              name="specialty"
              onChange={updateDoctor}
              value={doctorForm.specialty}
            />
          </label>
          <label className={labelClass}>
            {t('management.experienceYears')}
            <input
              className={inputClass}
              min="0"
              max="80"
              name="experienceYears"
              onChange={updateDoctor}
              type="number"
              value={doctorForm.experienceYears}
            />
          </label>
          <label className={labelClass}>
            {t('management.consultationFee')}
            <input
              className={inputClass}
              min="0"
              name="consultationFee"
              onChange={updateDoctor}
              type="number"
              value={doctorForm.consultationFee}
            />
          </label>
          <label className={labelClass}>
            {t('management.previousWork')}
            <input
              className={inputClass}
              name="previousWork"
              onChange={updateDoctor}
              value={doctorForm.previousWork}
            />
          </label>
          <label className={labelClass}>
            {t('management.achievements')}
            <input
              className={inputClass}
              name="achievements"
              onChange={updateDoctor}
              value={doctorForm.achievements}
            />
          </label>
          <label className={labelClass}>
            {t('management.expertise')}
            <input
              className={inputClass}
              name="expertise"
              onChange={updateDoctor}
              value={doctorForm.expertise}
            />
          </label>
          <fieldset className="grid gap-3 sm:col-span-2">
            <legend className="font-semibold">{t('management.availability')}</legend>
            {doctorForm.availability.map((slot, index) => (
              <div className="grid grid-cols-3 gap-2" key={`${slot.day}-${index}`}>
                <label className={labelClass}>
                  <span>{t('management.day')}</span>
                  <select
                    className={inputClass}
                    onChange={(event) =>
                      setDoctorForm((current) => ({
                        ...current,
                        availability: current.availability.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, day: event.target.value } : item,
                        ),
                      }))
                    }
                    value={slot.day}
                  >
                    {days.map((day) => (
                      <option key={day} value={day}>
                        {t(`management.day_${day}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  <span>{t('management.opensAt')}</span>
                  <input
                    className={inputClass}
                    onChange={(event) =>
                      setDoctorForm((current) => ({
                        ...current,
                        availability: current.availability.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, startsAt: event.target.value } : item,
                        ),
                      }))
                    }
                    type="time"
                    value={slot.startsAt}
                  />
                </label>
                <label className={labelClass}>
                  <span>{t('management.closesAt')}</span>
                  <input
                    className={inputClass}
                    onChange={(event) =>
                      setDoctorForm((current) => ({
                        ...current,
                        availability: current.availability.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, endsAt: event.target.value } : item,
                        ),
                      }))
                    }
                    type="time"
                    value={slot.endsAt}
                  />
                </label>
              </div>
            ))}
            <button
              className="min-h-touch justify-self-start rounded-lg border border-teal-200 px-3 font-semibold"
              onClick={() =>
                setDoctorForm((current) => ({
                  ...current,
                  availability: [
                    ...current.availability,
                    { day: 'mon', startsAt: '09:00', endsAt: '17:00' },
                  ],
                }))
              }
              type="button"
            >
              {t('management.addAvailability')}
            </button>
          </fieldset>
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <button
              className="min-h-touch rounded-xl bg-teal-800 px-5 font-semibold text-white"
              type="submit"
            >
              {editingDoctorId ? t('management.saveChanges') : t('management.addDoctor')}
            </button>
            {editingDoctorId ? (
              <button
                className="min-h-touch rounded-xl border border-teal-200 px-4 font-semibold"
                onClick={() => {
                  setEditingDoctorId('');
                  setDoctorForm(blankDoctor);
                }}
                type="button"
              >
                {t('management.cancel')}
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section id="manager-staff" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{t('management.doctors')}</h2>
            <p className="text-sm text-muted">{t('management.doctorListDescription')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="grid gap-1 text-sm">
              {t('management.searchDoctors')}
              <input
                className="min-h-touch rounded-lg border border-teal-200 bg-surface px-3"
                onChange={(event) => setDoctorSearch(event.target.value)}
                value={doctorSearch}
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t('management.accountStatus')}
              <select
                className="min-h-touch rounded-lg border border-teal-200 bg-surface px-3"
                onChange={(event) => setDoctorStatusFilter(event.target.value)}
                value={doctorStatusFilter}
              >
                <option value="">{t('management.allStatuses')}</option>
                {['pending', 'active', 'disabled', 'suspended'].map((status) => (
                  <option key={status} value={status}>
                    {t(`management.status_${status}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {doctors.length ? (
          <div className="overflow-x-auto rounded-2xl border border-teal-100 bg-surface">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-teal-50">
                <tr>
                  {[
                    'fullName',
                    'staffId',
                    'specialization',
                    'accountStatus',
                    'experienceYears',
                  ].map((key) => (
                    <th className="p-3" key={key}>
                      {t(`management.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleDoctors.map((profile) => (
                  <tr className="border-t border-teal-50" key={profile._id}>
                    <td className="p-3">{profile.userId.fullName}</td>
                    <td className="p-3">{profile.userId.staffId}</td>
                    <td className="p-3">{profile.specialty ?? profile.qualification}</td>
                    <td className="p-3">{t(`management.status_${profile.userId.status}`)}</td>
                    <td className="p-3">{profile.experienceYears ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {doctors.length ? (
          visibleDoctors.map((profile) => {
            const user = profile.userId;
            const doctorId = user._id;
            return (
              <article
                className="rounded-2xl border border-teal-100 bg-surface p-5"
                key={profile._id}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold">{user.fullName}</h3>
                    <p className="text-sm text-muted">
                      {user.staffId} · {profile.specialty ?? profile.qualification}
                    </p>
                    <p className="text-sm text-muted">
                      {user.email} · {user.phone}
                    </p>
                    <p className="mt-1 text-sm">
                      {t('management.accountStatus')}: {t(`management.status_${user.status}`)} ·{' '}
                      {t('management.verificationStatus')}:{' '}
                      {t(`management.verification_${profile.verificationStatus}`)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="min-h-touch rounded-lg border border-teal-200 px-3 font-semibold"
                      onClick={() => editDoctor(profile)}
                      type="button"
                    >
                      {t('management.edit')}
                    </button>
                    {profile.hasPhoto ? (
                      <>
                        <button
                          className="min-h-touch rounded-lg border border-teal-200 px-3 font-semibold"
                          onClick={() => openPrivatePhoto(doctorId)}
                          type="button"
                        >
                          {t('management.loadPrivatePhoto')}
                        </button>
                        {privateFiles[`photo-${doctorId}`] ? (
                          <a
                            className="inline-flex min-h-touch items-center rounded-lg border border-teal-200 px-3 font-semibold"
                            href={privateFiles[`photo-${doctorId}`]}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {t('management.openLoadedFile')}
                          </a>
                        ) : null}
                      </>
                    ) : null}
                    {user.status === 'active' ? (
                      <button
                        className="min-h-touch rounded-lg border border-red-200 px-3 font-semibold text-red-800"
                        onClick={() => setDoctorStatus(doctorId, 'disabled')}
                        type="button"
                      >
                        {t('management.deactivate')}
                      </button>
                    ) : (
                      <button
                        className="min-h-touch rounded-lg border border-teal-200 px-3 font-semibold"
                        onClick={() => verifyDoctor(doctorId)}
                        type="button"
                      >
                        {t('management.verifyAndEnable')}
                      </button>
                    )}
                  </div>
                </div>
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold">{t('management.registrationNumber')}</dt>
                    <dd>{profile.registrationNumber}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">{t('management.experienceYears')}</dt>
                    <dd>{profile.experienceYears ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">{t('management.consultationFee')}</dt>
                    <dd>{profile.consultationFee ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">{t('management.previousWork')}</dt>
                    <dd>{profile.previousWork?.join(', ') || '—'}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">{t('management.achievements')}</dt>
                    <dd>{profile.achievements?.join(', ') || '—'}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">{t('management.expertise')}</dt>
                    <dd>{profile.expertise?.join(', ') || '—'}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">{t('management.availability')}</dt>
                    <dd>
                      {profile.availability
                        ?.map(
                          (slot) =>
                            `${t(`management.day_${slot.day}`)} ${slot.startsAt}-${slot.endsAt}`,
                        )
                        .join(', ') || '—'}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="grid gap-1 text-sm">
                    {t('management.documentType')}
                    <select
                      className="min-h-touch rounded-lg border border-teal-200 bg-surface px-3"
                      onChange={(event) =>
                        setDocumentKind((current) => ({
                          ...current,
                          [doctorId]: event.target.value,
                        }))
                      }
                      value={documentKind[doctorId] ?? 'qualification'}
                    >
                      <option value="qualification">{t('management.qualification')}</option>
                      <option value="registration">{t('management.registrationDocument')}</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    {t('management.uploadDocument')}
                    <input
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      className="min-h-touch max-w-full"
                      onChange={(event) =>
                        uploadFile(
                          doctorId,
                          documentKind[doctorId] ?? 'qualification',
                          event.target.files?.[0],
                        )
                      }
                      type="file"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    {t('management.uploadPhoto')}
                    <input
                      accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                      className="min-h-touch max-w-full"
                      onChange={(event) => uploadPhoto(doctorId, event.target.files?.[0])}
                      type="file"
                    />
                  </label>
                </div>
                {profile.documents?.length ? (
                  <div className="mt-4 space-y-2">
                    <h4 className="font-semibold">{t('management.documents')}</h4>
                    {profile.documents.map((document) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-teal-50 p-3"
                        key={document._id}
                      >
                        <span className="text-sm">
                          {t(`management.document_${document.documentType}`)} ·{' '}
                          {t(`management.verification_${document.verificationStatus}`)}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="min-h-touch rounded-lg border border-teal-200 bg-surface px-3 text-sm font-semibold"
                            onClick={() => openPrivateFile(doctorId, document._id)}
                            type="button"
                          >
                            {t('management.loadPrivateFile')}
                          </button>
                          {privateFiles[`document-${document._id}`] ? (
                            <a
                              className="inline-flex min-h-touch items-center rounded-lg border border-teal-200 bg-surface px-3 text-sm font-semibold"
                              href={privateFiles[`document-${document._id}`]}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {t('management.openLoadedFile')}
                            </a>
                          ) : null}
                          {document.verificationStatus !== 'verified' ? (
                            <button
                              className="min-h-touch rounded-lg bg-teal-800 px-3 text-sm font-semibold text-white"
                              onClick={() => reviewDocument(doctorId, document._id, 'verified')}
                              type="button"
                            >
                              {t('management.markVerified')}
                            </button>
                          ) : null}
                          {document.verificationStatus !== 'rejected' ? (
                            <button
                              className="min-h-touch rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-800"
                              onClick={() => reviewDocument(doctorId, document._id, 'rejected')}
                              type="button"
                            >
                              {t('management.reject')}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted">{t('management.noDocuments')}</p>
                )}
              </article>
            );
          })
        ) : doctors.length ? (
          <p className="rounded-xl bg-surface p-4 text-muted">
            {t('management.noMatchingDoctors')}
          </p>
        ) : (
          <p className="rounded-xl bg-surface p-4 text-muted">{t('management.emptyDoctors')}</p>
        )}
      </section>
      {loading ? (
        <p role="status" className="text-sm text-muted">
          {t('management.refreshing')}
        </p>
      ) : null}
    </section>
  );
}
