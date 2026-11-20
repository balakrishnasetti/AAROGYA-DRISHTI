import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  Appointment,
  AuditLog,
  ClinicianReviewTask,
  DoctorProfile,
  FollowUp,
  Hospital,
  HospitalManager,
  Patient,
  ScreeningSession,
  Session,
  User,
} from '../models/index.js';
import { ApiError } from '../utils/apiError.js';
import { hospitalScopedFilter } from '../utils/hospitalScope.js';
import { writeAuditLog } from './auditService.js';
import { CARE_JOURNEY_STAGES } from '../models/careJourney.js';
import { formatCareJourneyStageCounts } from './patientJourneyService.js';

function initialPassword() {
  const value = randomBytes(24).toString('hex');
  return `${value[0].toUpperCase()}${value.slice(1)}a1!`;
}

function uniqueId(prefix) {
  return `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

async function audit(req, action, resourceType, resourceId, hospitalId = null, metadata = {}) {
  await writeAuditLog({
    actorId: req.user.id,
    action,
    resourceType,
    resourceId: resourceId?.toString(),
    hospitalId,
    requestId: req.id,
    metadata,
  });
}

function hospitalFilter(req) {
  if (!req.hospitalId) {
    throw new ApiError(
      403,
      'HOSPITAL_NOT_ASSIGNED',
      'Your account is not assigned to a hospital. Contact an administrator.',
    );
  }
  return hospitalScopedFilter(req.hospitalId);
}

export function hospitalDocumentFilter(req) {
  if (!req.hospitalId) {
    throw new ApiError(
      403,
      'HOSPITAL_NOT_ASSIGNED',
      'Your account is not assigned to a hospital. Contact an administrator.',
    );
  }
  return { _id: req.hospitalId };
}

function hospitalCoordinatesUpdate(updates) {
  if (!updates.coordinates) return updates;
  const { latitude, longitude } = updates.coordinates;
  return {
    ...updates,
    location: {
      type: 'Point',
      coordinates: [longitude, latitude],
    },
  };
}

export function doctorScopeFilter(hospitalId, doctorId) {
  return hospitalScopedFilter(hospitalId, { userId: doctorId });
}

export function appointmentScopeFilter(hospitalId, filters = {}) {
  return hospitalScopedFilter(hospitalId, filters);
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function publicDoctorProfile(profile) {
  const value = typeof profile.toObject === 'function' ? profile.toObject() : profile;
  const { photoStorageKey, documents, ...safeProfile } = value;
  return {
    ...safeProfile,
    hasPhoto: Boolean(photoStorageKey),
    documents: (documents ?? []).map((document) =>
      Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'storageKey')),
    ),
  };
}

function auditQuery(filters) {
  const query = {};
  if (filters.action) query.action = filters.action;
  if (filters.resourceType) query.resourceType = filters.resourceType;
  if (filters.severity) query.severity = filters.severity;
  if (filters.from || filters.to) {
    query.occurredAt = {};
    if (filters.from) query.occurredAt.$gte = filters.from;
    if (filters.to) {
      const inclusiveEnd = new Date(filters.to);
      if (
        inclusiveEnd.getUTCHours() === 0 &&
        inclusiveEnd.getUTCMinutes() === 0 &&
        inclusiveEnd.getUTCSeconds() === 0
      ) {
        inclusiveEnd.setUTCHours(23, 59, 59, 999);
      }
      query.occurredAt.$lte = inclusiveEnd;
    }
  }
  return query;
}

export function createManagementService({ privateStorage }) {
  return {
    async createHospital({ hospital: hospitalInput, manager: managerInput }, req) {
      const hospitalId = uniqueId('HOSP');
      const managerId = uniqueId('HMAN');
      const password = initialPassword();
      const passwordHash = await bcrypt.hash(password, 12);
      const hospital = await Hospital.create({
        ...hospitalCoordinatesUpdate(hospitalInput),
        code: hospitalId,
        status: 'active',
      });
      let manager;
      try {
        manager = await User.create({
          ...managerInput,
          staffId: managerId,
          role: 'hospital_manager',
          status: 'active',
          passwordHash,
          mustChangePassword: true,
        });
        await HospitalManager.create({
          hospitalId: hospital._id,
          managerId: manager._id,
          assignedBy: req.user.id,
          active: true,
        });
        await audit(req, 'create', 'hospital', hospital._id, hospital._id, {
          managerId: manager._id,
        });
      } catch (error) {
        await HospitalManager.deleteOne({ hospitalId: hospital._id });
        if (manager) await User.deleteOne({ _id: manager._id });
        await Hospital.deleteOne({ _id: hospital._id });
        throw error;
      }
      return {
        hospital: hospital.toObject(),
        managerCredentials: { staffId: manager.staffId, initialPassword: password },
      };
    },

    async listHospitals(req) {
      await audit(req, 'read', 'hospitals');
      return Hospital.find().sort({ name: 1 }).limit(200).lean();
    },

    async updateHospital(hospitalId, updates, req) {
      if (updates.status === 'active') {
        const current = await Hospital.findById(hospitalId)
          .select('address city state postalCode')
          .lean();
        if (!current)
          throw new ApiError(
            404,
            'HOSPITAL_NOT_FOUND',
            'We could not find that hospital. Refresh the list and try again.',
          );
        const location = { ...current, ...updates };
        if (
          ![location.address, location.city, location.state, location.postalCode].every((value) =>
            value?.trim(),
          )
        ) {
          throw new ApiError(
            400,
            'HOSPITAL_LOCATION_INCOMPLETE',
            'Add the full address, city, state, and postal code before activating this facility.',
          );
        }
      }
      const hospital = await Hospital.findByIdAndUpdate(
        hospitalId,
        { $set: hospitalCoordinatesUpdate(updates) },
        { new: true, runValidators: true },
      );
      if (!hospital)
        throw new ApiError(
          404,
          'HOSPITAL_NOT_FOUND',
          'We could not find that hospital. Refresh the list and try again.',
        );
      if (updates.status === 'inactive') {
        const [managers, doctors] = await Promise.all([
          HospitalManager.find({ hospitalId }).select('managerId').lean(),
          DoctorProfile.find({ hospitalId }).select('userId').lean(),
        ]);
        const userIds = [
          ...managers.map((item) => item.managerId),
          ...doctors.map((item) => item.userId),
        ];
        await Session.updateMany(
          { userId: { $in: userIds }, revokedAt: null },
          { $set: { revokedAt: new Date() } },
        );
      }
      await audit(req, 'edit', 'hospital', hospital._id, hospital._id);
      return hospital;
    },

    async setUser(userId, updates, req) {
      const user = await User.findById(userId);
      if (!user)
        throw new ApiError(
          404,
          'USER_NOT_FOUND',
          'We could not find that account. Refresh the list and try again.',
        );
      const oldRole = user.role;
      const catchmentChanged = ['district', 'mandal', 'phc', 'assignedVillages'].some(
        (field) =>
          Object.hasOwn(updates, field) &&
          JSON.stringify(updates[field]) !== JSON.stringify(user[field]),
      );
      Object.assign(user, updates);
      await user.save();
      if (
        (updates.status && updates.status !== 'active') ||
        (updates.role && updates.role !== oldRole) ||
        catchmentChanged
      ) {
        await Session.updateMany(
          { userId: user._id, revokedAt: null },
          { $set: { revokedAt: new Date() } },
        );
      }
      await audit(
        req,
        updates.role && updates.role !== oldRole ? 'role_change' : 'edit',
        'user',
        user._id,
        null,
        { role: user.role, status: user.status },
      );
      return {
        id: user._id,
        fullName: user.fullName,
        email: user.email ?? null,
        phone: user.phone ?? null,
        staffId: user.staffId ?? null,
        role: user.role,
        status: user.status,
        district: user.district ?? null,
        mandal: user.mandal ?? null,
        phc: user.phc ?? null,
        assignedVillages: user.assignedVillages ?? [],
        mustChangePassword: user.mustChangePassword,
      };
    },

    async listUsers(req) {
      await audit(req, 'read', 'users');
      return User.find()
        .select(
          'fullName email phone staffId role status district mandal phc assignedVillages mustChangePassword createdAt',
        )
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
    },

    async getSummary(req) {
      await audit(req, 'read', 'platform_summary');
      const [
        hospitals,
        users,
        patients,
        doctors,
        specialists,
        appointments,
        screeningSessions,
        journeyRows,
        legacyJourneyRows,
      ] =
        await Promise.all([
          Hospital.countDocuments(),
          User.countDocuments(),
          Patient.countDocuments(),
          User.countDocuments({ role: 'doctor' }),
          User.countDocuments({ role: 'specialist' }),
          Appointment.countDocuments(),
          ScreeningSession.countDocuments(),
          Patient.aggregate([
            { $match: { 'careJourney.stage': { $in: CARE_JOURNEY_STAGES } } },
            { $group: { _id: '$careJourney.stage', count: { $sum: 1 } } },
          ]),
          Patient.aggregate([
            { $match: { 'careJourney.stage': { $exists: false } } },
            {
              $lookup: {
                from: FollowUp.collection.name,
                let: { patientId: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$patientId', '$$patientId'] },
                          { $in: ['$status', ['pending', 'contacted']] },
                        ],
                      },
                    },
                  },
                  { $limit: 1 },
                ],
                as: 'pendingFollowUps',
              },
            },
            {
              $lookup: {
                from: FollowUp.collection.name,
                let: { patientId: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$patientId', '$$patientId'] },
                          { $eq: ['$status', 'completed'] },
                        ],
                      },
                    },
                  },
                  { $limit: 1 },
                ],
                as: 'completedFollowUps',
              },
            },
            {
              $lookup: {
                from: ClinicianReviewTask.collection.name,
                let: { patientId: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$patientId', '$$patientId'] },
                          { $in: ['$status', ['in_review', 'completed']] },
                        ],
                      },
                    },
                  },
                  { $limit: 1 },
                ],
                as: 'reviewTasks',
              },
            },
            {
              $lookup: {
                from: ScreeningSession.collection.name,
                let: { patientId: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$patientId', '$$patientId'] },
                          { $eq: ['$status', 'completed'] },
                        ],
                      },
                    },
                  },
                  { $limit: 1 },
                ],
                as: 'completedScreenings',
              },
            },
            {
              $project: {
                stage: {
                  $switch: {
                    branches: [
                      {
                        case: { $gt: [{ $size: '$pendingFollowUps' }, 0] },
                        then: 'follow_up_pending',
                      },
                      {
                        case: { $gt: [{ $size: '$completedFollowUps' }, 0] },
                        then: 'case_closed',
                      },
                      { case: { $gt: [{ $size: '$reviewTasks' }, 0] }, then: 'doctor_review' },
                      {
                        case: { $gt: [{ $size: '$completedScreenings' }, 0] },
                        then: 'screening_completed',
                      },
                    ],
                    default: 'registered',
                  },
                },
              },
            },
            { $group: { _id: '$stage', count: { $sum: 1 } } },
          ]),
        ]);
      return {
        hospitals,
        users,
        patients,
        doctors,
        specialists,
        appointments,
        screeningSessions,
        careJourney: formatCareJourneyStageCounts([...journeyRows, ...legacyJourneyRows]),
      };
    },

    async listAuditLogs(filters, req) {
      await audit(req, 'read', 'audit_logs');
      const query = auditQuery(filters);
      return AuditLog.find(query)
        .sort({ occurredAt: -1 })
        .limit(filters.limit)
        .select(
          'actorId action severity resourceType resourceId hospitalId requestId occurredAt metadata',
        )
        .lean();
    },

    async exportAuditLogs(filters, req) {
      await audit(req, 'export', 'audit_logs', null, null, {
        action: filters.action ?? '',
        resourceType: filters.resourceType ?? '',
      });
      const query = auditQuery(filters);
      const rows = await AuditLog.find(query)
        .sort({ occurredAt: -1 })
        .limit(filters.limit)
        .select(
          'actorId action severity resourceType resourceId hospitalId requestId occurredAt metadata',
        )
        .lean();
      const header = [
        'occurredAt',
        'actorId',
        'action',
        'severity',
        'resourceType',
        'resourceId',
        'hospitalId',
        'requestId',
        'metadata',
      ];
      const lines = rows.map((row) =>
        [
          row.occurredAt?.toISOString(),
          row.actorId,
          row.action,
          row.severity,
          row.resourceType,
          row.resourceId,
          row.hospitalId,
          row.requestId,
          JSON.stringify(
            row.metadata instanceof Map ? Object.fromEntries(row.metadata) : (row.metadata ?? {}),
          ),
        ]
          .map(csvCell)
          .join(','),
      );
      return [header.map(csvCell).join(','), ...lines].join('\r\n');
    },

    async getHospitalProfile(req) {
      const filter = hospitalDocumentFilter(req);
      await audit(req, 'read', 'hospital', filter._id, filter._id);
      const hospital = await Hospital.findOne(filter).lean();
      if (!hospital)
        throw new ApiError(
          404,
          'HOSPITAL_NOT_FOUND',
          'We could not find your hospital profile. Contact an administrator.',
        );
      return hospital;
    },

    async updateHospitalProfile(updates, req) {
      const filter = hospitalDocumentFilter(req);
      const hospital = await Hospital.findOneAndUpdate(
        filter,
        { $set: hospitalCoordinatesUpdate(updates) },
        { new: true, runValidators: true },
      );
      if (!hospital)
        throw new ApiError(
          404,
          'HOSPITAL_NOT_FOUND',
          'We could not find your hospital profile. Contact an administrator.',
        );
      await audit(req, 'edit', 'hospital', hospital._id, hospital._id);
      return hospital;
    },

    async getHospitalOverview(req) {
      const filter = hospitalFilter(req);
      await audit(req, 'read', 'hospital_overview', filter.hospitalId, filter.hospitalId);
      const now = new Date();
      const [doctors, appointments, upcoming, completed, pending, emergencyRequests] =
        await Promise.all([
          DoctorProfile.countDocuments(filter),
          Appointment.countDocuments(filter),
          Appointment.countDocuments(
            appointmentScopeFilter(filter.hospitalId, {
              slotStart: { $gte: now },
              status: { $in: ['requested', 'accepted'] },
            }),
          ),
          Appointment.countDocuments(
            appointmentScopeFilter(filter.hospitalId, { status: 'completed' }),
          ),
          Appointment.countDocuments(
            appointmentScopeFilter(filter.hospitalId, { status: 'requested' }),
          ),
          Appointment.countDocuments(
            appointmentScopeFilter(filter.hospitalId, {
              emergencyRequestedAt: { $ne: null },
              status: { $nin: ['cancelled', 'declined'] },
            }),
          ),
        ]);
      return { doctors, appointments, upcoming, completed, pending, emergencyRequests };
    },

    async listDoctors(req) {
      const filter = hospitalFilter(req);
      await audit(req, 'read', 'doctors', null, filter.hospitalId);
      const profiles = await DoctorProfile.find(filter)
        .populate({ path: 'userId', select: 'fullName email phone staffId status' })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
      return profiles.filter((profile) => profile.userId).map(publicDoctorProfile);
    },

    async createDoctor(input, req) {
      const filter = hospitalFilter(req);
      const staffId = uniqueId('DOC');
      const password = initialPassword();
      const user = await User.create({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        staffId,
        role: 'doctor',
        status: 'pending',
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: true,
      });
      let profile;
      try {
        profile = await DoctorProfile.create({
          userId: user._id,
          ...filter,
          qualification: input.qualification,
          registrationNumber: input.registrationNumber,
          specialty: input.specialty,
          experienceYears: input.experienceYears,
          previousWork: input.previousWork,
          achievements: input.achievements,
          expertise: input.expertise,
          consultationFee: input.consultationFee,
          availability: input.availability,
          verificationStatus: 'pending',
        });
        await audit(req, 'create', 'doctor', user._id, filter.hospitalId);
      } catch (error) {
        if (profile) await DoctorProfile.deleteOne({ _id: profile._id });
        await User.deleteOne({ _id: user._id });
        throw error;
      }
      return {
        profile: publicDoctorProfile({
          ...profile.toObject(),
          userId: {
            id: user._id,
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            staffId,
            status: user.status,
          },
        }),
        credentials: { staffId, initialPassword: password },
      };
    },

    async updateDoctor(doctorId, updates, req) {
      const filter = hospitalFilter(req);
      const profile = await DoctorProfile.findOne(doctorScopeFilter(filter.hospitalId, doctorId));
      if (!profile)
        throw new ApiError(
          404,
          'DOCTOR_NOT_FOUND',
          'We could not find that doctor at your hospital. Refresh the list and try again.',
        );
      const userUpdates = {};
      for (const key of ['fullName', 'email', 'phone']) {
        if (updates[key] !== undefined) {
          userUpdates[key] = updates[key];
          delete updates[key];
        }
      }
      if (Object.keys(userUpdates).length) {
        const user = await User.findOneAndUpdate(
          { _id: doctorId, role: { $in: ['doctor', 'specialist'] } },
          { $set: userUpdates },
          { new: true, runValidators: true },
        );
        if (!user)
          throw new ApiError(
            404,
            'DOCTOR_NOT_FOUND',
            'We could not find that doctor. Refresh the list and try again.',
          );
      }
      Object.assign(profile, updates);
      if (updates.qualification !== undefined || updates.registrationNumber !== undefined) {
        profile.verificationStatus = 'pending';
        profile.verifiedBy = undefined;
        profile.verifiedAt = undefined;
        await User.updateOne(
          { _id: doctorId, role: { $in: ['doctor', 'specialist'] } },
          { $set: { status: 'pending' } },
        );
      }
      await profile.save();
      await audit(req, 'edit', 'doctor', doctorId, filter.hospitalId);
      return publicDoctorProfile(profile);
    },

    async setDoctorStatus(doctorId, status, req) {
      const filter = hospitalFilter(req);
      const profile = await DoctorProfile.findOne(doctorScopeFilter(filter.hospitalId, doctorId));
      if (!profile)
        throw new ApiError(
          404,
          'DOCTOR_NOT_FOUND',
          'We could not find that doctor at your hospital. Refresh the list and try again.',
        );
      const user = await User.findOneAndUpdate(
        { _id: doctorId, role: { $in: ['doctor', 'specialist'] } },
        { $set: { status } },
        { new: true, runValidators: true },
      );
      if (!user)
        throw new ApiError(
          404,
          'DOCTOR_NOT_FOUND',
          'We could not find that doctor. Refresh the list and try again.',
        );
      if (status !== 'active') {
        await Session.updateMany(
          { userId: user._id, revokedAt: null },
          { $set: { revokedAt: new Date() } },
        );
      }
      await audit(req, 'edit', 'doctor_status', doctorId, filter.hospitalId, { status });
      return { id: user._id, status: user.status };
    },

    async uploadDoctorFile(doctorId, kind, file, req) {
      const filter = hospitalFilter(req);
      const profile = await DoctorProfile.findOne(doctorScopeFilter(filter.hospitalId, doctorId));
      if (!profile)
        throw new ApiError(
          404,
          'DOCTOR_NOT_FOUND',
          'We could not find that doctor at your hospital. Refresh the list and try again.',
        );
      const storageKey = await privateStorage.storeDoctorFile({
        hospitalId: filter.hospitalId,
        doctorId,
        file,
        kind,
      });
      if (kind === 'photo') {
        profile.photoStorageKey = storageKey.storageKey;
        profile.photoContentType = storageKey.contentType;
      } else {
        profile.documents.push({
          storageKey: storageKey.storageKey,
          contentType: storageKey.contentType,
          sizeBytes: storageKey.sizeBytes,
          documentType: kind,
          uploadedAt: new Date(),
          verificationStatus: 'pending',
        });
        profile.verificationStatus = 'pending';
        profile.verifiedBy = undefined;
        profile.verifiedAt = undefined;
      }
      await profile.save();
      if (kind !== 'photo') {
        await User.updateOne(
          { _id: doctorId, role: { $in: ['doctor', 'specialist'] } },
          { $set: { status: 'pending' } },
        );
      }
      await audit(
        req,
        'create',
        kind === 'photo' ? 'doctor_photo' : 'doctor_document',
        doctorId,
        filter.hospitalId,
      );
      return { uploaded: true };
    },

    async readDoctorFile(doctorId, documentId, req, photo = false) {
      const filter = hospitalFilter(req);
      const profile = await DoctorProfile.findOne(doctorScopeFilter(filter.hospitalId, doctorId));
      const document = photo ? null : profile?.documents.id(documentId);
      const storageKey = photo ? profile?.photoStorageKey : document?.storageKey;
      const contentType = photo ? profile?.photoContentType : document?.contentType;
      if (!profile || !storageKey || !contentType) {
        throw new ApiError(
          404,
          'DOCTOR_DOCUMENT_NOT_FOUND',
          'We could not find that private file at your hospital. Refresh and try again.',
        );
      }
      await audit(
        req,
        'read',
        photo ? 'doctor_photo' : 'doctor_document',
        documentId ?? doctorId,
        filter.hospitalId,
      );
      const file = await privateStorage.readObject(storageKey);
      return { ...file, contentType };
    },

    async reviewDoctorDocument(doctorId, documentId, verificationStatus, req) {
      const filter = hospitalFilter(req);
      const profile = await DoctorProfile.findOne(doctorScopeFilter(filter.hospitalId, doctorId));
      const document = profile?.documents.id(documentId);
      if (!profile || !document)
        throw new ApiError(
          404,
          'DOCTOR_DOCUMENT_NOT_FOUND',
          'We could not find that document at your hospital. Refresh and try again.',
        );
      document.verificationStatus = verificationStatus;
      document.reviewerId = req.user.id;
      document.reviewedAt = new Date();
      if (verificationStatus === 'rejected') {
        profile.verificationStatus = 'rejected';
        profile.verifiedBy = undefined;
        profile.verifiedAt = undefined;
        await User.updateOne(
          { _id: doctorId, role: { $in: ['doctor', 'specialist'] } },
          { $set: { status: 'pending' } },
        );
      }
      await profile.save();
      await audit(req, 'edit', 'doctor_document', documentId, filter.hospitalId, {
        verificationStatus,
      });
      return publicDoctorProfile(profile);
    },

    async verifyDoctor(doctorId, req) {
      const filter = hospitalFilter(req);
      const profile = await DoctorProfile.findOne(doctorScopeFilter(filter.hospitalId, doctorId));
      if (!profile)
        throw new ApiError(
          404,
          'DOCTOR_NOT_FOUND',
          'We could not find that doctor at your hospital. Refresh the list and try again.',
        );
      for (const type of ['qualification', 'registration']) {
        const required = profile.documents.filter((document) => document.documentType === type);
        if (
          !required.length ||
          required.some((document) => document.verificationStatus !== 'verified')
        ) {
          throw new ApiError(
            400,
            'DOCTOR_DOCUMENTS_REQUIRED',
            'Verify at least one qualification and registration document before enabling this doctor.',
          );
        }
      }
      profile.verificationStatus = 'verified';
      profile.verifiedBy = req.user.id;
      profile.verifiedAt = new Date();
      await profile.save();
      const user = await User.findOneAndUpdate(
        { _id: doctorId, role: { $in: ['doctor', 'specialist'] } },
        { $set: { status: 'active' } },
        { new: true },
      );
      if (!user)
        throw new ApiError(
          404,
          'DOCTOR_NOT_FOUND',
          'We could not find that doctor. Refresh the list and try again.',
        );
      await audit(req, 'edit', 'doctor_verification', doctorId, filter.hospitalId);
      return { id: user._id, status: user.status, verificationStatus: profile.verificationStatus };
    },
  };
}
