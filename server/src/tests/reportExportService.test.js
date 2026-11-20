import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import {
  exportOralScreeningPdf,
  exportOralScreeningPhotoRecordPdf,
} from '../services/reportExportService.js';

function extractPdfText(pdf) {
  const rawPdf = pdf.toString('latin1');
  const pageContent = [...rawPdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((match) => {
      try {
        return inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
      } catch {
        return match[1];
      }
    })
    .join('\n');
  return [...pageContent.matchAll(/<([0-9a-fA-F]+)>/g)]
    .map((match) => Buffer.from(match[1], 'hex').toString('latin1'))
    .join('');
}

test('photo-record PDF includes the saved image without claiming an AI screening result', async () => {
  const image = await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 120, g: 80, b: 80 },
    },
  })
    .png()
    .toBuffer();

  const pdf = await exportOralScreeningPhotoRecordPdf({
    screeningSession: { startedAt: new Date('2026-01-15T10:00:00Z') },
    photos: [
      {
        buffer: image,
        region: 'tongue_top',
        imageQuality: 'adequate',
        qualityReasons: [],
        createdAt: new Date('2026-01-15T10:05:00Z'),
      },
    ],
  });

  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1000);
  const rawPdf = pdf.toString('latin1');
  const pageText = extractPdfText(pdf);
  assert.match(pageText, /AI image analysis was unavailable/);
  assert.match(pageText, /NOT A DIAGNOSIS OR SCREENING RESULT/);
  assert.match(rawPdf, /\/Subtype \/Image/);
});

test('AI screening PDF reports low confidence as inconclusive and embeds the private photo', async () => {
  const image = await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 120, g: 80, b: 80 },
    },
  })
    .png()
    .toBuffer();

  const pdf = await exportOralScreeningPdf({
    report: {
      generatedAt: new Date('2026-01-15T10:05:00Z'),
      modelName: 'EfficientNet-B0',
      modelVersion: 'research',
      analysisStatus: 'inconclusive',
      analysisReasons: ['low_confidence'],
      predictedClass: null,
      finding: null,
      confidence: null,
      riskCategory: 'unclear',
      imageQuality: 'adequate',
      explanation: 'The model confidence was insufficient to provide a result.',
      reportedSymptoms: ['white_patch'],
      recommendedNextSteps: ['Consult a qualified doctor.'],
      limitations: ['This is not a diagnosis.'],
    },
    photoBuffer: image,
    questionnaireAnswers: [
      { questionKey: 'symptom_duration', answer: '2_4_weeks', skipped: false },
      { questionKey: 'tobacco_type', answer: 'both', skipped: false },
      { questionKey: 'free_text', answer: 'Patient reports soreness while eating.', skipped: false },
      { questionKey: 'alcohol', answer: true, skipped: false },
      { questionKey: 'family_history', answer: null, skipped: true },
    ],
  });

  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const pageText = extractPdfText(pdf);
  assert.match(pageText, /Result: Inconclusive/);
  assert.match(pageText, /no category or risk score was assigned/i);
  assert.match(pageText, /This is not a negative result/i);
  assert.match(pageText, /Reported symptoms/);
  assert.match(pageText, /White patch/);
  assert.match(pageText, /Additional patient-reported details/);
  assert.match(pageText, /2.?4 weeks/i);
  assert.match(pageText, /Smoked and chewed/);
  assert.match(pageText, /Patient reports soreness while eating/);
  assert.match(pageText, /Alcohol use: Yes/);
  assert.doesNotMatch(pageText, /Family history of oral cancer/);
  assert.doesNotMatch(pageText, /AI analysis is not available yet/);
  assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
});
