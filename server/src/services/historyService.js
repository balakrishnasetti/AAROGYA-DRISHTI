import {
  AiReport,
  Appointment,
  Consultation,
  ConsultationNote,
  FollowUp,
  Investigation,
  MediaAsset,
  OutsideReport,
  QuestionnaireResponse,
  Referral,
  ScreeningSession,
  TeleconsultationNote,
} from '../models/index.js';
import { decryptField } from './fieldEncryption.js';

export async function buildPatientHistory({ patientId, viewerRole, viewerId, hospitalId }) {
  if (viewerRole === 'hospital_manager' || viewerRole === 'admin') {
    return { items: [], note: 'Managers do not have access to clinical history.' };
  }

  const [
    screenings,
    questionnaireResponses,
    images,
    appointments,
    consultations,
    notes,
    outsideReports,
    followUps,
    referrals,
    investigations,
    teleconsultationNotes,
  ] = await Promise.all([
    ScreeningSession.find({ patientId }).sort({ createdAt: -1 }).limit(50).lean(),
    QuestionnaireResponse.find({ patientId }).sort({ createdAt: -1 }).limit(50).lean(),
    MediaAsset.find({ patientId }).sort({ createdAt: -1 }).limit(50).lean(),
    Appointment.find({ patientId }).sort({ createdAt: -1 }).limit(50).lean(),
    Consultation.find({ patientId }).sort({ createdAt: -1 }).limit(50).lean(),
    ConsultationNote.find({
      patientId,
      ...(viewerRole === 'doctor' ? {} : { releasedToPatient: true }),
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    OutsideReport.find({ patientId }).sort({ uploadedAt: -1 }).limit(50).lean(),
    FollowUp.find({ patientId }).sort({ dueAt: -1 }).limit(50).lean(),
    Referral.find({ patientId }).sort({ createdAt: -1 }).limit(50).lean(),
    Investigation.find({ patientId }).sort({ createdAt: -1 }).limit(50).lean(),
    TeleconsultationNote.find({
      patientId,
      releasedToPatient: true,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);
  const aiReports = screenings.length
    ? await AiReport.find({ screeningSessionId: { $in: screenings.map((item) => item._id) } })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean()
    : [];
  for (const response of questionnaireResponses) {
    response.answers = (response.answers || []).map((answer) => {
      if (typeof answer.answer !== 'string' || !answer.answer.startsWith('enc:v1:')) return answer;
      return { ...answer, answer: JSON.parse(decryptField(answer.answer)) };
    });
  }

  const bySession = new Map();
  for (const screening of screenings) {
    bySession.set(String(screening._id), screening);
  }

  const surfaces = [
    ...screenings.map((item) => ({ type: 'screening', createdAt: item.createdAt, item })),
    ...questionnaireResponses.map((item) => ({
      type: 'questionnaire',
      createdAt: item.createdAt,
      item,
    })),
    ...images.map((item) => ({
      type: 'image',
      createdAt: item.createdAt,
      item: {
        _id: item._id,
        screeningSessionId: item.screeningSessionId,
        region: item.region,
        contentType: item.contentType,
        sizeBytes: item.sizeBytes,
        capturedAt: item.capturedAt,
        createdAt: item.createdAt,
      },
    })),
    ...aiReports
      .filter((report) => {
        const screeningId =
          report.screeningSessionId && report.screeningSessionId._id
            ? report.screeningSessionId._id
            : report.screeningSessionId;
        return bySession.has(String(screeningId));
      })
      .map((item) => {
        const report = { ...item };
        delete report.heatmapStorageKey;
        return { type: 'ai_report', createdAt: item.createdAt, item: report };
      }),
    ...appointments.map((item) => ({ type: 'appointment', createdAt: item.createdAt, item })),
    ...consultations.map((item) => ({ type: 'consultation', createdAt: item.createdAt, item })),
    ...notes.map((item) => ({ type: 'released_note', createdAt: item.createdAt, item })),
    ...teleconsultationNotes.map((item) => ({
      type: 'released_note',
      createdAt: item.createdAt,
      item: { ...item, callRequestId: item.callRequestId },
    })),
    ...outsideReports.map((item) => ({
      type: 'outside_report',
      createdAt: item.uploadedAt || item.createdAt,
      item: {
        _id: item._id,
        title: item.title,
        source: item.source,
        documentType: item.documentType,
        contentType: item.contentType,
        sizeBytes: item.sizeBytes,
        description: item.description,
        disclaimer: item.disclaimer,
        uploadedAt: item.uploadedAt,
      },
    })),
    ...followUps.map((item) => ({
      type: 'follow_up',
      createdAt: item.followUpDate || item.createdAt,
      item: {
        ...item,
        ...(typeof item.instructions === 'string' && item.instructions.startsWith('enc:v1:')
          ? { instructions: decryptField(item.instructions) }
          : {}),
      },
    })),
    ...referrals.map((item) => ({ type: 'referral', createdAt: item.createdAt, item })),
    ...investigations.map((item) => ({ type: 'investigation', createdAt: item.createdAt, item })),
  ];

  const filtered = surfaces.filter((entry) => {
    if (viewerRole === 'doctor') {
      return (
        entry.type === 'screening' ||
        entry.type === 'questionnaire' ||
        entry.type === 'image' ||
        entry.type === 'ai_report' ||
        entry.type === 'appointment' ||
        entry.type === 'consultation' ||
        entry.type === 'released_note' ||
        entry.type === 'follow_up' ||
        entry.type === 'referral' ||
        entry.type === 'investigation'
      );
    }
    return true;
  });

  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    patientId,
    viewerRole,
    viewerId,
    hospitalId,
    items: filtered.slice(0, 50),
  };
}
