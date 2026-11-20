import mongoose from 'mongoose';
import { createModel, createTimestampedSchema, objectId } from './shared.js';

const appointmentSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: objectId, ref: 'User', required: true },
    hospitalId: { type: objectId, ref: 'Hospital', required: true },
    timeSlotId: { type: objectId, ref: 'TimeSlot', required: true },
    slotStart: { type: Date, required: true },
    consultationMode: {
      type: String,
      enum: ['in_person', 'video'],
      default: 'in_person',
      required: true,
    },
    paymentOption: {
      type: String,
      enum: ['pay_at_hospital'],
      default: 'pay_at_hospital',
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['due_at_hospital', 'paid', 'refunded'],
      default: 'due_at_hospital',
      required: true,
    },
    feeAmount: { type: Number, min: 0, required: true, default: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR', required: true },
    patientNameAtBooking: { type: String, trim: true, maxlength: 120 },
    patientPhoneAtBooking: { type: String, trim: true, maxlength: 20 },
    previousSlotStart: Date,
    rescheduledAt: Date,
    checkedInAt: Date,
    reminderClaimedAt: Date,
    reminderSentAt: Date,
    status: {
      type: String,
      enum: [
        'requested',
        'accepted',
        'confirmed',
        'declined',
        'cancelled',
        'completed',
        'missed',
        'no_show',
        'rescheduled',
      ],
      default: 'requested',
      required: true,
    },
    acceptedAt: Date,
    confirmedAt: Date,
    cancelledAt: Date,
    cancellationReason: { type: String, trim: true, maxlength: 500 },
    emergencyRequestedAt: Date,
    screeningSessionId: { type: objectId, ref: 'ScreeningSession' },
    rescheduledFrom: { type: objectId, ref: 'Appointment' },
    reason: { type: String, trim: true, maxlength: 1000 },
  },
  { collection: 'appointments' },
);
appointmentSchema.index(
  { doctorId: 1, slotStart: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['requested', 'accepted', 'confirmed'] } },
  },
);
appointmentSchema.index({ hospitalId: 1, slotStart: 1 });
appointmentSchema.index({ patientId: 1, slotStart: -1 });
export const Appointment = createModel('Appointment', appointmentSchema);

const urgentRequestSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    hospitalId: { type: objectId, ref: 'Hospital', required: true, index: true },
    doctorIds: { type: [objectId], ref: 'User', default: [] },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'redirected'],
      default: 'pending',
      required: true,
    },
    assignedTo: { type: objectId, ref: 'User' },
    redirectedToHospitalId: { type: objectId, ref: 'Hospital' },
    notifiedAt: Date,
    reviewedAt: Date,
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  { collection: 'urgent_requests' },
);
urgentRequestSchema.index({ patientId: 1, createdAt: -1 });
urgentRequestSchema.index({ status: 1, createdAt: 1 });
export const UrgentRequest = createModel('UrgentRequest', urgentRequestSchema);

const timeSlotSchema = createTimestampedSchema(
  {
    doctorId: { type: objectId, ref: 'User', required: true },
    hospitalId: { type: objectId, ref: 'Hospital', required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['available', 'held', 'booked', 'unavailable'],
      default: 'available',
      required: true,
    },
  },
  { collection: 'time_slots' },
);
timeSlotSchema.index({ doctorId: 1, startAt: 1 }, { unique: true });
timeSlotSchema.index({ hospitalId: 1, startAt: 1, status: 1 });
timeSlotSchema.pre('validate', function validateSlotRange() {
  if (this.endAt <= this.startAt)
    this.invalidate('endAt', 'Slot end must be later than slot start.');
});
export const TimeSlot = createModel('TimeSlot', timeSlotSchema);

const consultationSchema = createTimestampedSchema(
  {
    appointmentId: { type: objectId, ref: 'Appointment', required: true, unique: true },
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: objectId, ref: 'User', required: true },
    hospitalId: { type: objectId, ref: 'Hospital', required: true },
    status: {
      type: String,
      enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
      default: 'scheduled',
      required: true,
    },
    startedAt: Date,
    completedAt: Date,
  },
  { collection: 'consultations' },
);
consultationSchema.index({ hospitalId: 1, createdAt: -1 });
export const Consultation = createModel('Consultation', consultationSchema);

const consultationNoteSchema = createTimestampedSchema(
  {
    consultationId: { type: objectId, ref: 'Consultation', required: true, index: true },
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    noteKey: { type: String, required: true, trim: true, maxlength: 80 },
    version: { type: Number, required: true, min: 1 },
    previousVersionId: { type: objectId, ref: 'ConsultationNote', default: null },
    doctorId: { type: objectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 20000 },
    signedAt: Date,
    releasedToPatient: { type: Boolean, default: false, required: true },
    releasedAt: Date,
  },
  { collection: 'consultation_notes' },
);
consultationNoteSchema.index({ consultationId: 1, noteKey: 1, version: 1 }, { unique: true });
consultationNoteSchema.index({ consultationId: 1, noteKey: 1, version: -1 });
consultationNoteSchema.pre('save', function preserveNoteVersions() {
  if (!this.isNew)
    throw new Error('Consultation notes are versioned; create a new version instead of editing.');
});
for (const operation of [
  'update',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'findOneAndDelete',
]) {
  consultationNoteSchema.pre(operation, function blockNoteMutation() {
    throw new Error('Consultation notes are versioned; create a new version instead of editing.');
  });
}
consultationNoteSchema.pre('deleteMany', function onlyDeleteSyntheticNotes() {
  if (this.getFilter().isSynthetic !== true) {
    throw new Error('Consultation notes are versioned and cannot be deleted.');
  }
});
consultationNoteSchema.pre(
  'deleteOne',
  { document: true, query: false },
  function blockNoteDelete() {
    throw new Error('Consultation notes are versioned and cannot be deleted.');
  },
);
export const ConsultationNote = createModel('ConsultationNote', consultationNoteSchema);

const videoParticipantSchema = new mongoose.Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    role: { type: String, enum: ['patient', 'doctor', 'specialist'], required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    status: { type: String, enum: ['waiting', 'joined', 'left'], default: 'waiting' },
    joinedAt: Date,
    leftAt: Date,
  },
  { _id: false, strict: 'throw' },
);

const videoSessionSchema = createTimestampedSchema(
  {
    appointmentId: { type: objectId, ref: 'Appointment', required: true, unique: true, index: true },
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: objectId, ref: 'User', required: true, index: true },
    hospitalId: { type: objectId, ref: 'Hospital', required: true, index: true },
    roomName: { type: String, required: true, trim: true, maxlength: 128, unique: true },
    slotStart: { type: Date, required: true },
    provider: {
      type: String,
      enum: ['jitsi', 'livekit', 'daily', 'twilio', 'webrtc'],
      default: 'webrtc',
      required: true,
    },
    status: {
      type: String,
      enum: ['scheduled', 'active', 'ended', 'cancelled', 'failed'],
      default: 'scheduled',
      required: true,
    },
    startedAt: Date,
    endedAt: Date,
    durationSeconds: { type: Number, min: 0, default: 0 },
    recordingEnabled: { type: Boolean, default: false, required: true },
    joinTokenExpiresAt: { type: Date, required: true },
    joinTokenHashes: {
      type: [
        new mongoose.Schema(
          {
            userId: { type: objectId, ref: 'User', required: true },
            role: { type: String, enum: ['patient', 'doctor', 'specialist'], required: true },
            tokenHash: { type: String, required: true, select: false, maxlength: 128 },
            expiresAt: { type: Date, required: true },
          },
          { _id: false, strict: 'throw' },
        ),
      ],
      default: [],
    },
    participants: { type: [videoParticipantSchema], default: [] },
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  { collection: 'video_sessions' },
);
export const VideoSession = createModel('VideoSession', videoSessionSchema);

const referralSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    screeningSessionId: { type: objectId, ref: 'ScreeningSession' },
    consultationRequestId: { type: objectId, ref: 'ConsultationRequest' },
    consultationId: { type: objectId, ref: 'Consultation' },
    hospitalId: { type: objectId, ref: 'Hospital', required: true, index: true },
    referredBy: { type: objectId, ref: 'User', required: true },
    referredToHospitalId: { type: objectId, ref: 'Hospital' },
    destinationName: { type: String, trim: true, maxlength: 160 },
    specialty: { type: String, trim: true, maxlength: 120 },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    urgency: { type: String, enum: ['routine', 'soon', 'urgent'], required: true },
    status: {
      type: String,
      enum: ['open', 'accepted', 'declined', 'closed'],
      default: 'open',
      required: true,
    },
  },
  { collection: 'referrals' },
);
referralSchema.index({ hospitalId: 1, createdAt: -1 });
export const Referral = createModel('Referral', referralSchema);

const followUpSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    screeningSessionId: { type: objectId, ref: 'ScreeningSession' },
    consultationRequestId: { type: objectId, ref: 'ConsultationRequest' },
    consultationId: { type: objectId, ref: 'Consultation' },
    assignedTo: { type: objectId, ref: 'User' },
    followUpDate: { type: Date, required: true, index: true },
    dueAt: { type: Date, required: true, index: true },
    reminderAt: { type: Date, index: true },
    remindedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'contacted', 'completed', 'cancelled'],
      default: 'pending',
      required: true,
    },
    instructions: { type: String, trim: true, maxlength: 2000 },
    outcome: { type: String, trim: true, maxlength: 2000 },
  },
  { collection: 'follow_ups' },
);
followUpSchema.index({ patientId: 1, dueAt: 1 });
export const FollowUp = createModel('FollowUp', followUpSchema);

const consultationRequestSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: objectId, ref: 'User', required: true, index: true },
    hospitalId: { type: objectId, ref: 'Hospital', required: true, index: true },
    reason: {
      type: String,
      enum: ['follow_up', 'new_symptom', 'report_question'],
      required: true,
    },
    details: { type: String, trim: true, maxlength: 3000, default: '' },
    urgent: { type: Boolean, default: false, required: true },
    screeningSessionId: { type: objectId, ref: 'ScreeningSession' },
    screeningReportId: { type: objectId, ref: 'AiReport' },
    teleconsultationConsentVersion: { type: String, required: true, trim: true, maxlength: 80 },
    teleconsultationConsentedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'expired', 'completed'],
      default: 'pending',
      required: true,
      index: true,
    },
    requestedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    acceptedAt: Date,
    declinedAt: Date,
    suggestedAt: Date,
    suggestionAcceptedAt: Date,
    callRoomName: { type: String, trim: true, maxlength: 128 },
    callStartedAt: Date,
    callEndedAt: Date,
    callDurationSeconds: { type: Number, min: 0, default: 0 },
    recordingEnabled: { type: Boolean, default: false, required: true },
  },
  { collection: 'consultation_requests' },
);
consultationRequestSchema.index({ patientId: 1, createdAt: -1 });
consultationRequestSchema.index({ doctorId: 1, status: 1, requestedAt: 1 });
consultationRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
export const ConsultationRequest = createModel('ConsultationRequest', consultationRequestSchema);

const teleconsultationNoteSchema = createTimestampedSchema(
  {
    callRequestId: { type: objectId, ref: 'ConsultationRequest', required: true, index: true },
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: objectId, ref: 'User', required: true },
    version: { type: Number, required: true, min: 1 },
    previousVersionId: { type: objectId, ref: 'TeleconsultationNote', default: null },
    body: { type: String, required: true, trim: true, maxlength: 20000 },
    signedAt: { type: Date, required: true },
    releasedToPatient: { type: Boolean, default: true, required: true },
    releasedAt: { type: Date, required: true },
  },
  { collection: 'teleconsultation_notes' },
);
teleconsultationNoteSchema.index({ callRequestId: 1, version: 1 }, { unique: true });
teleconsultationNoteSchema.pre('save', function preserveTeleconsultationNoteVersions() {
  if (!this.isNew) throw new Error('Teleconsultation notes are versioned; create a new version instead.');
});
for (const operation of [
  'update',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'findOneAndDelete',
]) {
  teleconsultationNoteSchema.pre(operation, function blockTeleconsultationNoteMutation() {
    throw new Error('Teleconsultation notes are versioned; create a new version instead.');
  });
}
teleconsultationNoteSchema.pre('deleteMany', function blockTeleconsultationNoteDeletion() {
  throw new Error('Teleconsultation notes are versioned and cannot be deleted.');
});
export const TeleconsultationNote = createModel('TeleconsultationNote', teleconsultationNoteSchema);
