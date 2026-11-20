import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../services/api.js';
import AppointmentAdminPanel from './AppointmentAdminPanel.jsx';
import { demoModeEnabled } from '../../config/demoMode.js';

const blankHospital = {
  name: '',
  centerType: 'hospital',
  ownership: 'unknown',
  specialties: '',
  rating: '',
  registrationInfo: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  contactEmail: '',
  contactPhone: '',
  latitude: '',
  longitude: '',
  facilities: '',
  services: '',
  status: 'active',
  workingHours: [],
  managerName: '',
  managerEmail: '',
  managerPhone: '',
};

function messageFor(error, t) {
  const code = error.response?.data?.code;
  return t(code ? `errors.${code}` : 'errors.requestFailed', {
    defaultValue: t('errors.requestFailed'),
  });
}

function auditParams(limit, action, resource, severity, from, to) {
  return {
    limit,
    ...(action ? { action } : {}),
    ...(resource ? { resourceType: resource } : {}),
    ...(severity ? { severity } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

function Metric({ label, value }) {
  return (
    <article className="rounded-2xl border border-teal-100 bg-surface p-5 shadow-sm">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold text-ink">{value ?? '—'}</p>
    </article>
  );
}

export default function AdminConsole() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [governanceRequests, setGovernanceRequests] = useState([]);
  const [staffAccessRequests, setStaffAccessRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [credentials, setCredentials] = useState(null);
  const [editingHospitalId, setEditingHospitalId] = useState('');
  const [hospitalForm, setHospitalForm] = useState(blankHospital);
  const [auditAction, setAuditAction] = useState('');
  const [auditResource, setAuditResource] = useState('');
  const [auditSeverity, setAuditSeverity] = useState('');
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [totals, hospitalRows, userRows, auditRows, governanceRows, staffRequests] =
        await Promise.all([
          api.get('/admin/summary'),
          api.get('/admin/hospitals'),
          api.get('/admin/users'),
          api.get('/admin/audit-logs', {
            params: auditParams(50, auditAction, auditResource, auditSeverity, auditFrom, auditTo),
          }),
          api.get('/governance/requests'),
          api.get('/staff-access-requests'),
        ]);
      setSummary(totals.data.details);
      setHospitals(hospitalRows.data.details);
      setUsers(userRows.data.details);
      setLogs(auditRows.data.details);
      setGovernanceRequests(governanceRows.data.data || []);
      setStaffAccessRequests(staffRequests.data.details);
    } catch (requestError) {
      setError(messageFor(requestError, t));
    } finally {
      setLoading(false);
    }
  }, [auditAction, auditFrom, auditResource, auditSeverity, auditTo, t]);

  useEffect(() => {
    load();
  }, [load]);

  function updateHospitalForm(event) {
    const { name, value } = event.target;
    setHospitalForm((current) => ({ ...current, [name]: value }));
  }

  function editHospital(hospital) {
    setEditingHospitalId(hospital._id);
    setHospitalForm({
      ...blankHospital,
      ...hospital,
      centerType: hospital.centerType ?? hospital.facilityType ?? 'hospital',
      ownership: hospital.ownership ?? 'unknown',
      specialties: (hospital.specialties ?? []).join(', '),
      rating: hospital.rating ?? '',
      latitude: hospital.coordinates?.latitude ?? '',
      longitude: hospital.coordinates?.longitude ?? '',
      facilities: (hospital.facilities ?? []).join(', '),
      services: (hospital.services ?? []).join(', '),
      workingHours: hospital.workingHours ?? [],
      address: hospital.address ?? '',
      city: hospital.city ?? '',
      postalCode: hospital.postalCode ?? '',
    });
    document.getElementById('hospital-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  function hospitalPayload() {
    const hospital = {
      name: hospitalForm.name,
      centerType: hospitalForm.centerType,
      ownership: hospitalForm.ownership,
      specialties: hospitalForm.specialties
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      ...(hospitalForm.rating !== '' ? { rating: Number(hospitalForm.rating) } : {}),
      address: hospitalForm.address,
      city: hospitalForm.city,
      state: hospitalForm.state,
      postalCode: hospitalForm.postalCode,
      contactEmail: hospitalForm.contactEmail || undefined,
      contactPhone: hospitalForm.contactPhone || undefined,
      facilities: hospitalForm.facilities
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      services: hospitalForm.services
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      workingHours: hospitalForm.workingHours ?? [],
    };
    if (hospitalForm.registrationInfo) hospital.registrationInfo = hospitalForm.registrationInfo;
    if (hospitalForm.latitude !== '' && hospitalForm.longitude !== '') {
      hospital.coordinates = {
        latitude: Number(hospitalForm.latitude),
        longitude: Number(hospitalForm.longitude),
      };
    }
    if (editingHospitalId && hospitalForm.status) hospital.status = hospitalForm.status;
    return hospital;
  }

  async function saveHospital(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    try {
      if (editingHospitalId) {
        await api.patch(`/admin/hospitals/${editingHospitalId}`, hospitalPayload());
        setSuccess(t('management.hospitalUpdated'));
      } else {
        const response = await api.post('/admin/hospitals', {
          hospital: hospitalPayload(),
          manager: {
            fullName: hospitalForm.managerName,
            email: hospitalForm.managerEmail,
            phone: hospitalForm.managerPhone,
          },
        });
        setCredentials(response.data.details.managerCredentials);
        setSuccess(t('management.hospitalCreated'));
      }
      setEditingHospitalId('');
      setHospitalForm(blankHospital);
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  async function updateUser(userId, field, value) {
    setError('');
    setSuccess('');
    try {
      await api.patch(`/admin/users/${userId}`, { [field]: value });
      setSuccess(t('management.userUpdated'));
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  async function exportAudit() {
    setError('');
    try {
      const response = await api.get('/admin/audit-logs/export', {
        params: auditParams(50, auditAction, auditResource, auditSeverity, auditFrom, auditTo),
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'aarogya-audit-log.csv';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setSuccess(t('management.auditExported'));
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  async function reviewGovernanceRequest(requestId, status) {
    setError('');
    try {
      await api.patch(`/governance/requests/${requestId}`, { status });
      setSuccess(t('management.governanceRequestReviewed'));
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  async function reviewStaffAccessRequest(requestId, status) {
    setError('');
    setSuccess('');
    try {
      const response = await api.patch(`/staff-access-requests/${requestId}/review`, { status });
      if (status === 'approved') setCredentials(response.data.details);
      setSuccess(
        status === 'approved'
          ? t('management.staffRequestApproved')
          : t('management.staffRequestRejected'),
      );
      await load();
    } catch (requestError) {
      setError(messageFor(requestError, t));
    }
  }

  const inputClass =
    'min-h-touch w-full rounded-xl border border-teal-200 bg-surface px-3 text-ink';
  const labelClass = 'grid gap-1 text-sm font-medium text-ink';

  if (loading && !summary) {
    return (
      <p role="status" className="text-muted">
        {t('management.loading')}
      </p>
    );
  }

  return (
    <section className="space-y-8" aria-labelledby="admin-title">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-teal-700">
          {t('management.adminEyebrow')}
        </p>
        <h1 id="admin-title" className="mt-2 text-display-sm text-ink">
          {t('management.adminTitle')}
        </h1>
        {demoModeEnabled ? (
          <Link
            className="mt-4 inline-flex min-h-touch items-center rounded-xl border border-teal-700 px-4 font-semibold text-teal-800"
            to="/admin/providers"
          >
            {t('demoProviders.adminLink', 'Manage synthetic demo providers')}
          </Link>
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
      <AppointmentAdminPanel />
      {credentials ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="credentials-title"
          className="rounded-2xl border border-amber-300 bg-amber-50 p-5"
        >
          <h2 id="credentials-title" className="text-lg font-bold">
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

      <section id="admin-staff-requests" className="space-y-3">
        <div>
          <h2 className="text-xl font-bold">{t('management.staffAccessRequests')}</h2>
          <p className="text-sm text-muted">{t('management.staffAccessRequestsDescription')}</p>
        </div>
        {staffAccessRequests.length ? (
          <div className="grid gap-3">
            {staffAccessRequests.map((request) => (
              <article
                className="rounded-2xl border border-teal-100 bg-surface p-4"
                key={request._id}
              >
                <h3 className="font-semibold">{request.fullName}</h3>
                <p className="text-sm">
                  {t(
                    `roles.${request.requestedRole === 'hospital_manager' ? 'hospitalManager' : request.requestedRole}`,
                  )}
                  {' · '}
                  {request.email}
                  {' · '}
                  {request.phone}
                </p>
                <p className="text-sm text-muted">
                  {[
                    request.district,
                    request.mandal,
                    request.phc,
                    request.assignedVillages?.join(', '),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {request.hospitalId ? (
                  <p className="text-sm text-muted">
                    {request.hospitalId.name} ({request.hospitalId.code})
                  </p>
                ) : null}
                {request.requestedRole === 'doctor' ? (
                  <p className="text-sm text-muted">
                    {request.qualification} · {request.registrationNumber} · {request.specialty}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="min-h-touch rounded-lg bg-teal-700 px-3 font-semibold text-white"
                    onClick={() => reviewStaffAccessRequest(request._id, 'approved')}
                    type="button"
                  >
                    {t('management.approveStaffRequest')}
                  </button>
                  <button
                    className="min-h-touch rounded-lg border border-red-300 px-3 font-semibold text-red-800"
                    onClick={() => reviewStaffAccessRequest(request._id, 'rejected')}
                    type="button"
                  >
                    {t('management.rejectStaffRequest')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-surface p-4 text-muted">
            {t('management.noStaffAccessRequests')}
          </p>
        )}
      </section>

      <div id="admin-overview" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label={t('management.hospitals')} value={summary?.hospitals} />
        <Metric label={t('management.users')} value={summary?.users} />
        <Metric label={t('management.patients')} value={summary?.patients} />
        <Metric label={t('management.doctors')} value={summary?.doctors} />
        <Metric label={t('management.specialists')} value={summary?.specialists} />
        <Metric label={t('management.appointments')} value={summary?.appointments} />
        <Metric label={t('management.screenings')} value={summary?.screeningSessions} />
      </div>
      <section
        className="rounded-2xl border border-teal-100 bg-surface p-5"
        aria-labelledby="admin-care-journey-title"
      >
        <h2 id="admin-care-journey-title" className="text-xl font-bold">
          {t('management.careJourneyTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('management.careJourneyDescription')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            'registered',
            'screening_completed',
            'doctor_review',
            'treatment_started',
            'follow_up_pending',
            'case_closed',
          ].map((stage) => (
            <Metric
              key={stage}
              label={t(`management.careJourney.${stage}`)}
              value={summary?.careJourney?.[stage] ?? '—'}
            />
          ))}
        </div>
      </section>
      {summary ? (
        <section
          className="rounded-2xl border border-teal-100 bg-surface p-5"
          aria-label={t('management.platformTotals')}
        >
          <h2 className="text-lg font-bold">{t('management.platformTotals')}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ['hospitals', summary.hospitals],
              ['doctors', summary.doctors],
              ['appointments', summary.appointments],
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
                      width: `${value ? Math.min(100, Math.max(2, (value / Math.max(1, summary.users)) * 100)) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section
        id="hospital-form"
        className="rounded-2xl border border-teal-100 bg-surface p-5 sm:p-7"
      >
        <h2 className="text-xl font-bold">
          {editingHospitalId ? t('management.editHospital') : t('management.createHospital')}
        </h2>
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={saveHospital}>
          <label className={labelClass}>
            {t('management.hospitalName')}
            <input
              className={inputClass}
              name="name"
              onChange={updateHospitalForm}
              required
              value={hospitalForm.name}
            />
          </label>
          <label className={labelClass}>
            {t('management.registrationInfo')}
            <input
              className={inputClass}
              name="registrationInfo"
              onChange={updateHospitalForm}
              value={hospitalForm.registrationInfo}
            />
          </label>
          <label className={labelClass}>
            {t('hospitals.specialty')}
            <select
              className={inputClass}
              name="centerType"
              value={hospitalForm.centerType}
              onChange={updateHospitalForm}
            >
              <option value="hospital">{t('hospitals.hospitalType')}</option>
              <option value="phc">{t('hospitals.phcType')}</option>
              <option value="cancer_center">{t('hospitals.cancer')}</option>
              <option value="dental_center">{t('hospitals.dental')}</option>
            </select>
          </label>
          <label className={labelClass}>
            {t('hospitals.ownership')}
            <select
              className={inputClass}
              name="ownership"
              value={hospitalForm.ownership}
              onChange={updateHospitalForm}
            >
              <option value="unknown">{t('hospitals.ownershipValues.unknown')}</option>
              <option value="government">{t('hospitals.government')}</option>
              <option value="private">{t('hospitals.private')}</option>
            </select>
          </label>
          <label className={labelClass}>
            {t('hospitals.specialties')}
            <input
              className={inputClass}
              name="specialties"
              value={hospitalForm.specialties}
              onChange={updateHospitalForm}
              placeholder={t('hospitals.specialtiesPlaceholder')}
            />
          </label>
          <label className={labelClass}>
            {t('hospitals.rating')}
            <input
              className={inputClass}
              type="number"
              min="0"
              max="5"
              step="0.1"
              name="rating"
              value={hospitalForm.rating}
              onChange={updateHospitalForm}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            {t('management.address')}
            <input
              className={inputClass}
              name="address"
              onChange={updateHospitalForm}
              required={!editingHospitalId}
              value={hospitalForm.address}
            />
          </label>
          <label className={labelClass}>
            {t('management.city')}
            <input
              className={inputClass}
              name="city"
              onChange={updateHospitalForm}
              required={!editingHospitalId}
              value={hospitalForm.city}
            />
          </label>
          <label className={labelClass}>
            {t('management.state')}
            <input
              className={inputClass}
              name="state"
              onChange={updateHospitalForm}
              required={!editingHospitalId}
              value={hospitalForm.state}
            />
          </label>
          <label className={labelClass}>
            {t('management.postalCode')}
            <input
              className={inputClass}
              name="postalCode"
              onChange={updateHospitalForm}
              required={!editingHospitalId}
              value={hospitalForm.postalCode}
            />
          </label>
          <label className={labelClass}>
            {t('management.contactEmail')}
            <input
              className={inputClass}
              name="contactEmail"
              onChange={updateHospitalForm}
              type="email"
              value={hospitalForm.contactEmail}
            />
          </label>
          <label className={labelClass}>
            {t('management.contactPhone')}
            <input
              className={inputClass}
              name="contactPhone"
              onChange={updateHospitalForm}
              value={hospitalForm.contactPhone}
            />
          </label>
          <label className={labelClass}>
            {t('management.latitude')}
            <input
              className={inputClass}
              max="90"
              min="-90"
              name="latitude"
              onChange={updateHospitalForm}
              step="any"
              type="number"
              value={hospitalForm.latitude}
            />
          </label>
          <label className={labelClass}>
            {t('management.longitude')}
            <input
              className={inputClass}
              max="180"
              min="-180"
              name="longitude"
              onChange={updateHospitalForm}
              step="any"
              type="number"
              value={hospitalForm.longitude}
            />
          </label>
          <label className={labelClass}>
            {t('management.facilities')}
            <input
              className={inputClass}
              name="facilities"
              onChange={updateHospitalForm}
              value={hospitalForm.facilities}
            />
          </label>
          <label className={labelClass}>
            {t('management.services')}
            <input
              className={inputClass}
              name="services"
              onChange={updateHospitalForm}
              value={hospitalForm.services}
            />
          </label>
          {editingHospitalId ? (
            <label className={labelClass}>
              {t('management.accountStatus')}
              <select
                className={inputClass}
                name="status"
                onChange={updateHospitalForm}
                value={hospitalForm.status}
              >
                <option value="active">{t('management.active')}</option>
                <option value="inactive">{t('management.inactive')}</option>
              </select>
            </label>
          ) : (
            <>
              <label className={labelClass}>
                {t('management.managerName')}
                <input
                  className={inputClass}
                  name="managerName"
                  onChange={updateHospitalForm}
                  required
                  value={hospitalForm.managerName}
                />
              </label>
              <label className={labelClass}>
                {t('management.managerEmail')}
                <input
                  className={inputClass}
                  name="managerEmail"
                  onChange={updateHospitalForm}
                  required
                  type="email"
                  value={hospitalForm.managerEmail}
                />
              </label>
              <label className={labelClass}>
                {t('management.managerPhone')}
                <input
                  className={inputClass}
                  name="managerPhone"
                  onChange={updateHospitalForm}
                  required
                  value={hospitalForm.managerPhone}
                />
              </label>
            </>
          )}
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <button
              className="min-h-touch rounded-xl bg-teal-800 px-5 font-semibold text-white"
              type="submit"
            >
              {editingHospitalId ? t('management.saveChanges') : t('management.createHospital')}
            </button>
            {editingHospitalId ? (
              <button
                className="min-h-touch rounded-xl border border-teal-200 px-4 font-semibold"
                onClick={() => {
                  setEditingHospitalId('');
                  setHospitalForm(blankHospital);
                }}
                type="button"
              >
                {t('management.cancel')}
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="space-y-4 rounded-2xl border border-teal-100 bg-surface p-5">
        <div>
          <h2 className="text-xl font-bold">{t('management.governanceRequests')}</h2>
          <p className="text-sm text-muted">{t('management.governanceRequestsDescription')}</p>
        </div>
        {governanceRequests.length ? (
          <div className="space-y-3">
            {governanceRequests.map((request) => (
              <article key={request._id} className="rounded-xl border border-teal-100 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="font-bold">{t(`governance.${request.requestType}`)}</h3>
                    <p className="mt-1 break-words text-sm text-muted">{request.reason}</p>
                    {Object.keys(request.requestedChanges || {}).length ? (
                      <pre className="mt-2 overflow-auto rounded-lg bg-teal-50 p-2 text-xs">
                        {JSON.stringify(request.requestedChanges, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="min-h-touch rounded-lg bg-teal-700 px-3 font-semibold text-white"
                      onClick={() => reviewGovernanceRequest(request._id, 'approved')}
                    >
                      {t('management.approve')}
                    </button>
                    <button
                      type="button"
                      className="min-h-touch rounded-lg border border-rose-300 px-3 font-semibold text-rose-800"
                      onClick={() => reviewGovernanceRequest(request._id, 'rejected')}
                    >
                      {t('management.reject')}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-teal-50 p-4 text-muted">
            {t('management.noGovernanceRequests')}
          </p>
        )}
      </section>

      <section id="admin-hospitals" className="space-y-3">
        <h2 className="text-xl font-bold">{t('management.hospitals')}</h2>
        {hospitals.length ? (
          <div className="overflow-x-auto rounded-2xl border border-teal-100 bg-surface">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-teal-50">
                <tr>
                  {[
                    'hospitalName',
                    'hospitalId',
                    'city',
                    'sourceRecord',
                    'accountStatus',
                    'actions',
                  ].map((key) => (
                    <th className="p-3" key={key}>
                      {t(`management.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hospitals.map((hospital) => (
                  <tr className="border-t border-teal-50" key={hospital._id}>
                    <td className="p-3 font-semibold">{hospital.name}</td>
                    <td className="p-3 font-mono">{hospital.code}</td>
                    <td className="p-3">{hospital.city || t('management.locationPending')}</td>
                    <td
                      className="p-3"
                      title={hospital.importSource?.originalFacilityName || undefined}
                    >
                      {hospital.importSource
                        ? t('management.sourceRow', {
                            file: hospital.importSource.sourceFile,
                            sheet: hospital.importSource.sheetName,
                            row: hospital.importSource.rowNumber,
                          })
                        : '—'}
                    </td>
                    <td className="p-3">{t(`management.status_${hospital.status}`)}</td>
                    <td className="p-3">
                      <button
                        className="min-h-touch rounded-lg border border-teal-200 px-3 font-semibold"
                        onClick={() => editHospital(hospital)}
                        type="button"
                      >
                        {t('management.edit')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl bg-surface p-4 text-muted">{t('management.emptyHospitals')}</p>
        )}
      </section>

      <section id="admin-users" className="space-y-3">
        <h2 className="text-xl font-bold">{t('management.userManagement')}</h2>
        {users.length ? (
          <div className="overflow-x-auto rounded-2xl border border-teal-100 bg-surface">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-teal-50">
                <tr>
                  {['fullName', 'email', 'staffId', 'role', 'accountStatus', 'catchment'].map(
                    (key) => (
                      <th className="p-3" key={key}>
                        {t(`management.${key}`)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr className="border-t border-teal-50" key={user._id}>
                    <td className="p-3 font-semibold">{user.fullName}</td>
                    <td className="p-3">{user.email ?? '—'}</td>
                    <td className="p-3">{user.staffId ?? '—'}</td>
                    <td className="p-2">
                      <label className="sr-only" htmlFor={`role-${user._id}`}>
                        {t('management.roleFor', { name: user.fullName })}
                      </label>
                      <select
                        className="min-h-touch rounded-lg border border-teal-200 bg-surface px-2"
                        id={`role-${user._id}`}
                        onChange={(event) => updateUser(user._id, 'role', event.target.value)}
                        value={user.role}
                      >
                        {[
                          'admin',
                          'hospital_manager',
                          'doctor',
                          'patient',
                          'health_worker',
                          'navigator',
                          'district_officer',
                        ].map((role) => (
                          <option key={role} value={role}>
                            {t(`roles.${role === 'hospital_manager' ? 'hospitalManager' : role}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="space-y-1 p-2">
                      {['district', 'mandal', 'phc'].map((field) => (
                        <input
                          aria-label={t('management.catchmentField', {
                            field: t(`field.${field}`),
                            name: user.fullName,
                          })}
                          className="min-h-9 w-36 rounded border border-teal-200 px-2"
                          defaultValue={user[field] ?? ''}
                          key={field}
                          onBlur={(event) => {
                            const value = event.target.value.trim();
                            if (value !== (user[field] ?? '')) updateUser(user._id, field, value);
                          }}
                          placeholder={t(`field.${field}`)}
                        />
                      ))}
                      <input
                        aria-label={t('management.assignedVillagesFor', { name: user.fullName })}
                        className="min-h-9 w-48 rounded border border-teal-200 px-2"
                        defaultValue={(user.assignedVillages ?? []).join(', ')}
                        onBlur={(event) => {
                          const villages = [
                            ...new Set(
                              event.target.value
                                .split(',')
                                .map((village) => village.trim())
                                .filter(Boolean),
                            ),
                          ];
                          if (
                            JSON.stringify(villages) !== JSON.stringify(user.assignedVillages ?? [])
                          ) {
                            updateUser(user._id, 'assignedVillages', villages);
                          }
                        }}
                        placeholder={t('management.assignedVillages')}
                      />
                    </td>
                    <td className="p-2">
                      <label className="sr-only" htmlFor={`status-${user._id}`}>
                        {t('management.statusFor', { name: user.fullName })}
                      </label>
                      <select
                        className="min-h-touch rounded-lg border border-teal-200 bg-surface px-2"
                        id={`status-${user._id}`}
                        onChange={(event) => updateUser(user._id, 'status', event.target.value)}
                        value={user.status}
                      >
                        {user.status === 'pending' ? (
                          <option disabled value="pending">
                            {t('management.status_pending')}
                          </option>
                        ) : null}
                        {['active', 'disabled', 'suspended'].map((status) => (
                          <option key={status} value={status}>
                            {t(`management.status_${status}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl bg-surface p-4 text-muted">{t('management.emptyUsers')}</p>
        )}
      </section>

      <section id="admin-audit" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{t('management.auditLogs')}</h2>
            <p className="text-sm text-muted">{t('management.auditDescription')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="grid gap-1 text-sm">
              {t('management.filterAction')}
              <select
                className="min-h-touch rounded-lg border border-teal-200 bg-surface px-3"
                onChange={(event) => setAuditAction(event.target.value)}
                value={auditAction}
              >
                <option value="">{t('management.allActions')}</option>
                {[
                  'login',
                  'login_failure',
                  'logout',
                  'password_change',
                  'role_change',
                  'read',
                  'create',
                  'edit',
                  'export',
                  'delete',
                  'access_denied',
                  'break_glass',
                ].map((action) => (
                  <option key={action} value={action}>
                    {t(`management.action_${action}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              {t('management.filterSeverity', 'Filter by severity')}
              <select
                className="min-h-touch rounded-lg border border-teal-200 bg-surface px-3"
                onChange={(event) => setAuditSeverity(event.target.value)}
                value={auditSeverity}
              >
                <option value="">{t('management.allSeverities', 'All severities')}</option>
                {['low', 'medium', 'high', 'critical'].map((severity) => (
                  <option key={severity} value={severity}>
                    {t(`management.severity_${severity}`, severity)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              {t('management.filterResource')}
              <input
                className="min-h-touch rounded-lg border border-teal-200 bg-surface px-3"
                onChange={(event) => setAuditResource(event.target.value)}
                value={auditResource}
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t('management.fromDate')}
              <input
                className="min-h-touch rounded-lg border border-teal-200 bg-surface px-3"
                onChange={(event) => setAuditFrom(event.target.value)}
                type="date"
                value={auditFrom}
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t('management.toDate')}
              <input
                className="min-h-touch rounded-lg border border-teal-200 bg-surface px-3"
                onChange={(event) => setAuditTo(event.target.value)}
                type="date"
                value={auditTo}
              />
            </label>
            <button
              className="min-h-touch rounded-xl border border-teal-200 px-4 font-semibold"
              onClick={exportAudit}
              type="button"
            >
              {t('management.exportAudit')}
            </button>
          </div>
        </div>
        {logs.length ? (
          <div className="overflow-x-auto rounded-2xl border border-teal-100 bg-surface">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-teal-50">
                <tr>
                  {['date', 'action', 'severity', 'resourceType', 'resourceId', 'actorId'].map(
                    (key) => (
                      <th className="p-3" key={key}>
                        {t(`management.${key}`)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr className="border-t border-teal-50" key={log._id}>
                    <td className="p-3">{new Date(log.occurredAt).toLocaleString()}</td>
                    <td className="p-3">{t(`management.action_${log.action}`)}</td>
                    <td className="p-3">
                      {t(`management.severity_${log.severity}`, log.severity)}
                    </td>
                    <td className="p-3">{log.resourceType}</td>
                    <td className="p-3 font-mono">{log.resourceId ?? '—'}</td>
                    <td className="p-3 font-mono">{log.actorId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl bg-surface p-4 text-muted">{t('management.emptyAudit')}</p>
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
