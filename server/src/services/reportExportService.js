import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { Consent } from '../models/index.js';

const DISCLAIMER =
  'This report is informational only. It is not a diagnosis, treatment recommendation, or clinical conclusion.';

const QUESTION_LABELS = {
  symptom_duration: 'How long symptoms have been noticed',
  tobacco_type: 'Tobacco use',
  tobacco_frequency: 'Tobacco use frequency',
  tobacco_duration: 'Duration of tobacco use',
  alcohol: 'Alcohol use',
  betel_nut: 'Betel or areca nut use',
  family_history: 'Family history of oral cancer',
  free_text: 'Additional note for the clinician',
};

const ANSWER_LABELS = {
  both: 'Smoked and chewed',
  chewed: 'Chewed',
  smoked: 'Smoked',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  rarely: 'Rarely',
  less_than_1_year: 'Less than 1 year',
  '1_3_years': '1–3 years',
  '3_5_years': '3–5 years',
  more_than_5_years: 'More than 5 years',
  lt_1_week: 'Less than 1 week',
  '1_2_weeks': '1–2 weeks',
  '2_4_weeks': '2–4 weeks',
  '1_3_months': '1–3 months',
  gt_3_months: 'More than 3 months',
  white_patch: 'White patch',
  red_patch: 'Red patch',
  non_healing_ulcer: 'Non-healing ulcer',
  growth_or_lump: 'Growth or lump',
  difficulty_opening_mouth: 'Difficulty opening mouth',
  difficulty_breathing: 'Difficulty breathing',
  difficulty_swallowing: 'Difficulty swallowing',
  pain_chewing: 'Pain while chewing',
  bleeding: 'Bleeding',
  persistent_pain_or_numbness: 'Persistent pain or numbness',
  voice_change_or_neck_lump: 'Voice change or neck lump',
};

function readableAnswer(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    return value.map((item) => ANSWER_LABELS[item] || String(item)).join(', ');
  }
  if (typeof value !== 'string') return '';
  return ANSWER_LABELS[value] || value.replaceAll('_', ' ');
}

function safePatientText(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31) || code === 127
      ? ' '
      : character;
  })
    .join('')
    .trim()
    .slice(0, 2000);
}

function patientQuestionnaireDetails(answers = []) {
  if (!Array.isArray(answers)) return [];
  return answers.flatMap((item) => {
    const label = QUESTION_LABELS[item.questionKey];
    if (!label || item.skipped || item.answer === null || item.answer === undefined) return [];
    const value = safePatientText(
      item.questionKey === 'free_text' ? item.answer : readableAnswer(item.answer),
    );
    return value ? [{ label, value }] : [];
  });
}

export async function exportReportPdf(report, patientName = 'Patient') {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks = [];

  return new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text('Aarogya Drishti', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).text(`Patient: ${patientName}`);
    doc
      .fontSize(12)
      .text(`Report type: ${report?.riskCategory ? 'AI screening report' : 'Report'}`);
    doc.moveDown();
    doc.fontSize(12).text(`Category: ${report?.riskCategory ?? 'Not specified'}`);
    doc.moveDown();
    doc.fontSize(12).text(`Region: ${report?.region ?? 'Not specified'}`);
    doc.moveDown();
    doc.fontSize(12).text('Observations:');
    const observations = Array.isArray(report?.observations) ? report.observations : [];
    observations.forEach((item) => doc.text(`- ${item}`));
    doc.moveDown();
    doc.fontSize(12).text('Explanation:');
    doc.text(report?.explanation ?? 'No explanation available.');
    doc.moveDown();
    doc.fontSize(12).text('Disclaimer:');
    doc.text(DISCLAIMER);
    doc.moveDown();
    doc.fontSize(10).text('NOT FOR CLINICAL USE');
    doc.end();
  });
}

export async function exportOralScreeningPdf({
  report,
  photoBuffer,
  heatmapBuffer,
  questionnaireAnswers,
}) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks = [];
  const result =
    report.analysisStatus === 'inconclusive'
      ? 'Inconclusive — no category or risk score was assigned. This is not a negative result.'
      : report.analysisStatus === 'consent_not_granted'
        ? 'AI analysis was not performed because consent was not granted.'
        : report.analysisStatus === 'unavailable'
          ? 'AI analysis is not available yet. No AI finding or risk score was generated.'
          : report.predictedClass || report.finding || 'No AI finding was assigned.';

  return new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text('Aarogya Drishti — Screening report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text('Screening result, needs clinician review.');
    doc.fontSize(11).text(`Date: ${new Date(report.generatedAt).toLocaleString('en-IN')}`);
    doc.text(`Model: ${report.modelName} (${report.modelVersion})`);
    doc.text(`Result: ${result}`);
    doc.text(`Risk level: ${report.riskCategory || 'unclear'}`);
    doc.text(`Photo quality: ${report.imageQuality || 'uncertain'}`);
    if (Number.isFinite(report.confidence)) {
      doc.text(
        `Model confidence score: ${Math.round(report.confidence * 100)}%${
          report.confidenceCalibrated ? ' (calibrated)' : ' (not calibrated)'
        }`,
      );
    }
    doc.moveDown();
    doc.fontSize(12).text('What this means');
    doc.fontSize(10).text(report.explanation);
    doc.moveDown();
    if (Array.isArray(report.reportedSymptoms) && report.reportedSymptoms.length) {
      doc.fontSize(12).text('Reported symptoms');
      doc
        .fontSize(10)
        .text(
          report.reportedSymptoms
            .map((symptom) => ANSWER_LABELS[symptom] || String(symptom).replaceAll('_', ' '))
            .join(', '),
        );
      doc.fontSize(9).text('These symptoms were reported by the patient and have not been clinically verified.');
      doc.moveDown();
    }
    const patientDetails = patientQuestionnaireDetails(questionnaireAnswers);
    if (patientDetails.length) {
      doc.fontSize(12).text('Additional patient-reported details');
      doc.fontSize(9).text('Questionnaire responses are self-reported and are included for clinician review.');
      doc.moveDown(0.25);
      patientDetails.forEach(({ label, value }) => {
        doc.fontSize(10).text(`${label}:`, { continued: true });
        doc.font('Helvetica').text(` ${value}`);
      });
      doc.moveDown();
    }
    if (Array.isArray(report.lifestyleFactors) && report.lifestyleFactors.length) {
      doc.fontSize(12).text('Reported lifestyle factors');
      doc.fontSize(10).text(report.lifestyleFactors.join(', '));
      doc.moveDown();
    }
    doc.fontSize(12).text('Recommended next step');
    doc.fontSize(10).text(report.recommendedNextSteps.join(' '));
    doc.moveDown();
    doc.fontSize(12).text('Limitations');
    doc.fontSize(10).text(report.limitations.join(' '));
    if (report.riskCategory === 'low') {
      doc.moveDown();
      doc
        .fontSize(10)
        .text(
          'This does not rule out cancer. See a doctor if the symptom lasts more than 2 weeks.',
        );
    }
    doc.moveDown();
    if (photoBuffer) {
      doc.fontSize(12).text('Photo');
      doc.image(photoBuffer, { fit: [240, 180], align: 'center' });
      doc.moveDown();
    }
    if (heatmapBuffer) {
      doc.fontSize(12).text('Experimental model attention heatmap');
      doc.image(heatmapBuffer, { fit: [240, 180], align: 'center' });
      doc
        .fontSize(9)
        .text(
          'The heatmap shows model attention only. It is not a confirmed lesion boundary or clinical finding.',
        );
      doc.moveDown();
    }
    doc
      .fontSize(10)
      .text(
        'This is an AI screening aid and not a medical diagnosis. Please consult a qualified doctor.',
      );
    doc.moveDown();
    doc.fontSize(10).text('Photographs supplement, and never replace, a clinical examination.');
    doc.moveDown();
    doc
      .fontSize(10)
      .text(
        'Screening result, needs clinician review. This experimental software is not clinically validated and is not for clinical use.',
      );
    doc.end();
  });
}

export async function exportOralScreeningPhotoRecordPdf({ screeningSession, photos }) {
  const preparedPhotos = await Promise.all(
    photos.map(async (photo) => ({
      ...photo,
      buffer: await sharp(photo.buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
        .jpeg({ quality: 85 })
        .toBuffer(),
    })),
  );
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks = [];

  return new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text('Aarogya Drishti — Oral screening photo record', { align: 'center' });
    doc.moveDown();
    doc
      .fontSize(12)
      .text(`Screening started: ${new Date(screeningSession.startedAt).toLocaleString('en-IN')}`);
    doc.moveDown();
    doc
      .fontSize(13)
      .fillColor('#92400e')
      .text('AI image analysis was unavailable. No AI finding or risk score was generated.');
    doc.fillColor('#000000').moveDown();
    doc
      .fontSize(12)
      .text(
        'This record contains uploaded photographs and capture details only. It is not a diagnosis, clinical assessment, or negative result, and it does not rule out cancer.',
      );
    doc.moveDown();
    doc.text(
      'Please share this record with a qualified clinician for assessment. Photographs supplement, and never replace, a clinical examination.',
    );

    for (const [index, photo] of preparedPhotos.entries()) {
      if (index > 0) doc.addPage();
      doc.moveDown(2);
      doc.fontSize(14).text(`Photo ${index + 1}: ${photo.region.replaceAll('_', ' ')}`);
      doc.fontSize(10).text(`Uploaded: ${new Date(photo.createdAt).toLocaleString('en-IN')}`);
      doc.text(`Image quality check: ${photo.imageQuality || 'not assessed'}`);
      if (photo.qualityReasons?.length) {
        doc.text(`Quality notes: ${photo.qualityReasons.join(', ').replaceAll('_', ' ')}`);
      }
      doc.moveDown();
      doc.image(photo.buffer, { fit: [500, 500], align: 'center' });
      doc.moveDown();
      doc.fontSize(9).text('No automated visual interpretation was performed for this photo.');
    }

    doc.moveDown();
    doc.fontSize(9).text('PHOTO RECORD ONLY — NOT A DIAGNOSIS OR SCREENING RESULT');
    doc.end();
  });
}

export async function canShareReport({ patientId, consentType = 'data_sharing' }, shareWithUserId) {
  const consent = await Consent.findOne({
    patientId,
    consentType,
    granted: true,
    withdrawnAt: { $exists: false },
  })
    .sort({ recordedAt: -1 })
    .lean();

  if (!consent) return false;
  if (shareWithUserId) {
    return consent.recordedBy
      ? consent.recordedBy.toString() === shareWithUserId.toString() || true
      : true;
  }
  return true;
}
