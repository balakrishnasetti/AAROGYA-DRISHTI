import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticDemoCases, syntheticDemoLabels } from './syntheticDemoCases.js';
import {
  findSyntheticReferencePatient,
  syntheticReferenceDataset,
} from './syntheticReferenceDataset.js';

test('synthetic patient demo library has twenty complete fictional cases', () => {
  assert.equal(syntheticDemoCases.length, 20);
  assert.equal(new Set(syntheticDemoCases.map((item) => item.id)).size, 20);
  for (const item of syntheticDemoCases) {
    assert.match(item.profile.name, /^Demo Patient \d{2}$/);
    assert.match(item.profile.location, /^Demo Village \d{2}, Demo Mandal$/);
    assert.equal(item.questionnaireAnswers.length, 10);
    assert.ok(item.questionnaireAnswers.every((answer) => answer.label.en && answer.label.te));
    assert.ok(['low', 'moderate', 'prompt'].includes(item.risk));
    assert.ok(['requested', 'confirmed', 'accepted', 'completed'].includes(item.appointmentStatus));
    assert.ok(['requested', 'scheduled', 'completed'].includes(item.consultationStatus));
    assert.ok(Number.isInteger(item.followUpDays) && item.followUpDays > 0);
    assert.equal(typeof item.imageQualityPass, 'boolean');
  }
});

test('risk categories cover low, moderate, and prompt-review examples', () => {
  assert.deepEqual(new Set(syntheticDemoCases.map((item) => item.risk)), new Set(['low', 'moderate', 'prompt']));
  assert.ok(syntheticDemoCases.some((item) => item.risk === 'prompt' && item.followUpDays === 1));
});

test('provided synthetic case dataset preserves twenty complete read-only demo records', () => {
  assert.equal(syntheticReferenceDataset.length, 20);
  assert.equal(new Set(syntheticReferenceDataset.map((item) => item.patientId)).size, 20);
  assert.equal(syntheticReferenceDataset[0].patientId, 'AD-DEMO-0001');
  assert.equal(syntheticReferenceDataset[0].name, 'Ramesh Naidu');
  assert.equal(syntheticReferenceDataset[11].riskLevel, 'Unclear');
  assert.equal(syntheticReferenceDataset[11].confidence, 0);
  assert.equal(
    syntheticReferenceDataset[13].doctorAction,
    'Override: reclassified Low (frictional keratosis)',
  );
  assert.ok(syntheticReferenceDataset.every((item) => item.district === 'Alluri Sitharama Raju'));
  assert.ok(syntheticReferenceDataset.every((item) => item.state === 'Andhra Pradesh'));
  for (const item of syntheticReferenceDataset) {
    assert.ok(item.caseId && item.name && item.village && item.mandal);
    assert.ok(['M', 'F'].includes(item.sex));
    assert.ok(['English', 'Telugu'].includes(item.language));
    assert.ok(['Low', 'Moderate', 'High', 'Unclear'].includes(item.riskLevel));
    assert.ok(item.confidence >= 0 && item.confidence <= 1);
    assert.ok(item.aiFinding && item.site && item.workflowStatus && item.biopsy);
    assert.equal(typeof item.tobacco, 'boolean');
    assert.equal(typeof item.betelQuid, 'boolean');
    assert.equal(typeof item.alcohol, 'boolean');
  }
  assert.deepEqual(
    Object.keys(syntheticDemoLabels.en.patientLookup).sort(),
    Object.keys(syntheticDemoLabels.te.patientLookup).sort(),
  );
  assert.match(syntheticDemoLabels.en.patientLookup.note, /read-only synthetic examples/i);
  assert.match(syntheticDemoLabels.en.patientLookup.aiFinding, /not live AI output/i);
  assert.doesNotMatch(Object.keys(syntheticDemoLabels.en.tabs).join(' '), /dataset/i);
});

test('synthetic patient details are only found by an exact ID, case ID, or full name', () => {
  assert.equal(findSyntheticReferencePatient(''), null);
  assert.equal(findSyntheticReferencePatient('  AD-DEMO-0001  ').name, 'Ramesh Naidu');
  assert.equal(findSyntheticReferencePatient('case 14').patientId, 'AD-DEMO-0014');
  assert.equal(findSyntheticReferencePatient('bhargavi').patientId, 'AD-DEMO-0020');
  assert.equal(findSyntheticReferencePatient('Ramesh'), null);
  assert.equal(findSyntheticReferencePatient('unknown patient'), null);
});

test('demo disclosures clearly distinguish schematic illustrations from real images', () => {
  assert.match(syntheticDemoLabels.en.disclaimer, /fictional example/i);
  assert.match(syntheticDemoLabels.en.imageLabel, /not a photograph/i);
  assert.match(syntheticDemoLabels.en.notDiagnosis, /not a medical assessment/i);
  assert.match(syntheticDemoLabels.te.notDiagnosis, /వైద్య అంచనా/);
  assert.equal('requiredDisclaimer' in syntheticDemoLabels.en, false);
  assert.match(syntheticDemoLabels.en.notDiagnosis, /fictional example.*confirmed diagnosis.*does not determine urgency by itself/i);
  assert.match(syntheticDemoLabels.en.assistantLive, /does not connect example cases or details/);
  assert.doesNotMatch(syntheticDemoLabels.en.assistantLive, /sign in/i);
  assert.doesNotMatch(syntheticDemoLabels.te.assistantLive, /సైన్ ఇన్/);
  assert.match(syntheticDemoLabels.en.assistantLaunch, /voice assistant/i);
  assert.ok(syntheticDemoLabels.te.assistantLaunch);
  assert.match(syntheticDemoLabels.en.liveScreeningNote, /secure patient screening flow/);
  assert.ok(syntheticDemoLabels.te.liveScreeningSignIn);
});
