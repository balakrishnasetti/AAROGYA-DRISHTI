import { ConsultationNote } from '../models/index.js';

export async function createConsultationNoteVersion({
  consultationId,
  noteKey,
  doctorId,
  body,
  signedAt = null,
  releasedToPatient = false,
  releasedAt = null,
}) {
  const previous = await ConsultationNote.findOne({ consultationId, noteKey })
    .sort({ version: -1 })
    .select('_id version');

  return ConsultationNote.create({
    consultationId,
    noteKey,
    doctorId,
    body,
    signedAt,
    releasedToPatient,
    releasedAt,
    version: previous ? previous.version + 1 : 1,
    previousVersionId: previous?._id ?? null,
  });
}
