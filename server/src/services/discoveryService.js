import { Hospital, DoctorProfile, User } from '../models/index.js';
import { ApiError } from '../utils/apiError.js';
import { getAppointableDoctorFilter } from '../utils/providerEligibility.js';

function normalizeLatitude(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLongitude(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRadius(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 500 ? parsed : null;
}

function escapedSearch(value) {
  const term = String(value ?? '').trim().slice(0, 100);
  return term ? new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
}

function buildHospitalFilters(query = {}) {
  const filters = { status: 'active' };
  const city = escapedSearch(query.city);
  const service = escapedSearch(query.service);
  const department = escapedSearch(query.department);
  const district = escapedSearch(query.district);
  const specialty = escapedSearch(query.specialty);
  if (city) filters.$or = [{ city }, { district: city }];
  if (district) filters.district = district;
  if (service) filters.services = { $in: [service] };
  if (department) filters.services = { $in: [department] };
  if (specialty) filters.specialties = specialty;
  if (['government', 'private'].includes(query.ownership)) filters.ownership = query.ownership;
  if (['hospital', 'phc', 'cancer_center', 'dental_center'].includes(query.centerType)) {
    filters.centerType = query.centerType;
  }

  const latitude = normalizeLatitude(query.latitude);
  const longitude = normalizeLongitude(query.longitude);
  const radiusKm = normalizeRadius(query.radiusKm ?? query.radius);
  if (latitude !== null && longitude !== null && radiusKm !== null) {
    filters.location = {
      $near: {
        $geometry: { type: 'Point', coordinates: [longitude, latitude] },
        $maxDistance: radiusKm * 1000,
      },
    };
  }
  return filters;
}

export async function listHospitals(query = {}) {
  const filters = buildHospitalFilters(query);
  const hasNearbyOrigin = Boolean(filters.location);
  let hospitalQuery = Hospital.find(filters);
  if (!hasNearbyOrigin) hospitalQuery = hospitalQuery.sort({ name: 1 });
  const hospitals = await hospitalQuery.limit(100).lean();
  return hospitals.map((hospital) => ({
    id: hospital._id,
    name: hospital.name,
    code: hospital.code,
    facilityType: hospital.facilityType ?? 'hospital',
    centerType: hospital.centerType ?? hospital.facilityType ?? 'hospital',
    ownership: hospital.ownership ?? 'unknown',
    specialties: hospital.specialties ?? [],
    rating: hospital.rating ?? null,
    city: hospital.city,
    state: hospital.state,
    district: hospital.district ?? null,
    mandal: hospital.mandal ?? null,
    village: hospital.village ?? null,
    address: hospital.address,
    contactPhone: hospital.contactPhone ?? null,
    contactEmail: hospital.contactEmail ?? null,
    services: hospital.services ?? [],
    facilities: hospital.facilities ?? [],
    coordinates: hospital.coordinates ?? null,
    status: hospital.status,
    isSynthetic: hospital.isSynthetic,
    workingHours: hospital.workingHours ?? [],
  }));
}

export async function getHospitalById(hospitalId) {
  const hospital = await Hospital.findOne({ _id: hospitalId, status: 'active' }).lean();
  if (!hospital) {
    throw new ApiError(404, 'HOSPITAL_NOT_FOUND', 'We could not find that hospital.');
  }
  return {
    id: hospital._id,
    name: hospital.name,
    code: hospital.code,
    facilityType: hospital.facilityType ?? 'hospital',
    centerType: hospital.centerType ?? hospital.facilityType ?? 'hospital',
    ownership: hospital.ownership ?? 'unknown',
    specialties: hospital.specialties ?? [],
    rating: hospital.rating ?? null,
    city: hospital.city,
    state: hospital.state,
    district: hospital.district ?? null,
    mandal: hospital.mandal ?? null,
    village: hospital.village ?? null,
    address: hospital.address,
    postalCode: hospital.postalCode,
    contactPhone: hospital.contactPhone ?? null,
    contactEmail: hospital.contactEmail ?? null,
    services: hospital.services ?? [],
    facilities: hospital.facilities ?? [],
    workingHours: hospital.workingHours ?? [],
    coordinates: hospital.coordinates ?? null,
    status: hospital.status,
    isSynthetic: hospital.isSynthetic,
  };
}

export async function listHospitalDoctors(hospitalId, filters = {}) {
  const hospital = await Hospital.findOne({ _id: hospitalId, status: 'active' }).select('_id').lean();
  if (!hospital) {
    throw new ApiError(404, 'HOSPITAL_NOT_FOUND', 'We could not find that hospital.');
  }

  const query = {
    hospitalId,
    $or: getAppointableDoctorFilter(),
  };
  const specialization = escapedSearch(filters.specialization);
  if (specialization) query.specialty = specialization;
  if (filters.experienceMin) query.experienceYears = { $gte: Number(filters.experienceMin) };
  if (filters.onlineConsultation !== undefined) {
    query.availability = { $exists: true, $ne: [] };
  }

  const doctors = await DoctorProfile.find(query).sort({ experienceYears: -1, createdAt: -1 }).limit(50).lean();
  const users = await User.find({ _id: { $in: doctors.map((doctor) => doctor.userId) } })
    .select('fullName email phone role status isSynthetic')
    .lean();

  const userMap = new Map(users.map((user) => [user._id.toString(), user]));

  return doctors.map((doctor) => {
    const user = userMap.get(doctor.userId.toString()) || null;
    return {
      id: doctor._id,
      userId: doctor.userId,
      fullName: user?.fullName ?? null,
      phone: user?.phone ?? null,
      qualification: doctor.qualification,
      registrationNumber: doctor.registrationNumber,
      specialty: doctor.specialty ?? null,
      experienceYears: doctor.experienceYears ?? 0,
      expertise: doctor.expertise ?? [],
      consultationFee: doctor.consultationFee ?? 0,
      languages: doctor.languages ?? [],
      availability: doctor.availability ?? [],
      verificationStatus: doctor.verificationStatus,
      verified: doctor.verificationStatus === 'verified',
      isSynthetic: doctor.isSynthetic,
      demoLabel: doctor.isSynthetic
        ? 'SYNTHETIC DEMO DATA - NOT A REAL HEALTHCARE PROVIDER'
        : null,
      accountStatus: user?.status ?? 'disabled',
      hasPhoto: Boolean(doctor.photoStorageKey),
    };
  });
}
