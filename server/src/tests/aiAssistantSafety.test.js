import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiAssistantService, detectRedFlags } from '../services/aiAssistantService.js';
import {
  ASSISTANT_SYSTEM_PROMPT,
  ASSISTANT_TOOLS,
  createClaudeAssistant,
  MUTATING_ASSISTANT_TOOLS,
  parseAssistantToolUse,
  sanitizeAssistantReply,
} from '../services/claudeAssistantService.js';

test('English emergency symptoms trigger urgent guidance', () => {
  for (const message of [
    'I have heavy bleeding',
    'I am having difficulty breathing',
    'I have difficulty swallowing',
  ]) {
    assert.equal(detectRedFlags(message).urgent, true, message);
  }
});

test('Telugu emergency symptoms trigger urgent guidance', () => {
  for (const message of ['చాలా రక్తం వస్తోంది', 'శ్వాస తీసుకోవడం కష్టం', 'మింగడంలో ఇబ్బంది']) {
    assert.equal(detectRedFlags(message).urgent, true, message);
  }
});

test('non-emergency questions do not trigger urgent guidance', () => {
  assert.equal(detectRedFlags('How can I improve my brushing routine?').urgent, false);
});

test('assistant reports unavailable instead of using a scripted ordinary response', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const service = createAiAssistantService({
      sessionModel: {
        findById: async () => ({ summary: {}, state: {} }),
      },
    });

    const result = await service.generateReply({
      sessionId: 'session-id',
      userText: 'How can I improve my brushing routine?',
      language: 'en',
    });
    assert.equal(result.unavailable, true);
    assert.match(result.text, /currently unavailable/);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('configured Gemini assistant uses the configured model and saves both transcript turns', async () => {
  const session = {
    summary: { concerns: [] },
    recentTurns: [],
    state: {},
    async save() {},
  };
  let selectedModel = '';
  let systemInstruction = '';
  let generatedPrompt = '';
  let generateAttempts = 0;
  const service = createAiAssistantService({
    apiKey: 'server-only-test-key',
    modelName: 'gemini-test-model',
    sessionModel: { findById: async () => session },
    settingsModel: {
      findOne: () => ({ lean: async () => ({ safetyText: 'Call 112 in an emergency.' }) }),
    },
    createClient: (key) => {
      assert.equal(key, 'server-only-test-key');
      return {
        getGenerativeModel(options) {
          selectedModel = options.model;
          systemInstruction = options.systemInstruction;
          return {
            generateContent: async ([prompt]) => {
              generatedPrompt = prompt;
              generateAttempts += 1;
              if (generateAttempts === 1) {
                throw Object.assign(new Error('temporary provider overload'), { status: 503 });
              }
              return {
                response: {
                  text: () => 'Brush gently twice a day and speak with a dentist about concerns.',
                },
              };
            },
          };
        },
      };
    },
  });

  const result = await service.generateReply({
    sessionId: 'session-id',
    userText: 'How should I brush my teeth?',
  });

  assert.equal(selectedModel, 'gemini-test-model');
  assert.equal(generateAttempts, 2);
  assert.match(systemInstruction, /Answer the user.s general oral-health question directly/);
  assert.match(systemInstruction, /safe, low-risk precautions/);
  assert.match(generatedPrompt, /include safe, practical precautions/);
  assert.equal(result.unavailable, undefined);
  assert.match(result.text, /Brush gently/);
  assert.deepEqual(
    session.recentTurns.map(({ role }) => role),
    ['user', 'assistant'],
  );
  assert.match(session.summary.concerns[0], /brush my teeth/i);
});

test('emergency symptoms in supported Indian languages trigger urgent guidance', () => {
  for (const message of [
    'बहुत खून बह रहा है',
    'सांस लेने में कठिनाई',
    'निगलने में परेशानी',
    'அதிக இரத்தப்போக்கு',
    'மூச்சு விடுவதில் சிரமம்',
    'விழுங்குவதில் சிரமம்',
    'ಹೆಚ್ಚು ರಕ್ತಸ್ರಾವ',
    'ಉಸಿರಾಟದ ತೊಂದರೆ',
    'ನುಂಗಲು ಕಷ್ಟ',
    'കനത്ത രക്തസ്രാവം',
    'ശ്വസിക്കാൻ ബുദ്ധിമുട്ട്',
    'വിഴുങ്ങാൻ ബുദ്ധിമുട്ട്',
    'প্রচুর রক্তপাত',
    'শ্বাস নিতে কষ্ট',
    'গিলতে অসুবিধা',
    'खूप रक्तस्राव',
    'श्वास घेण्यास त्रास',
    'गिळण्यास त्रास',
  ]) {
    assert.equal(detectRedFlags(message).urgent, true, message);
  }
});

test('Claude tool catalog contains the requested actions and guarded system prompt', () => {
  const toolNames = ASSISTANT_TOOLS.map((tool) => tool.name);
  for (const name of [
    'book_appointment',
    'cancel_or_reschedule_appointment',
    'find_nearby_hospitals',
    'open_camera',
    'start_oral_scan',
    'show_my_reports',
    'show_screening_results',
    'show_qr_code',
    'get_diet_plan',
    'set_reminder',
    'answer_general_oral_health_question',
    'call_emergency',
  ]) {
    assert.ok(toolNames.includes(name), `missing ${name}`);
  }
  assert.match(ASSISTANT_SYSTEM_PROMPT, /Never diagnose/i);
  assert.match(ASSISTANT_SYSTEM_PROMPT, /112/);
  assert.deepEqual(
    [...MUTATING_ASSISTANT_TOOLS].sort(),
    ['book_appointment', 'cancel_or_reschedule_appointment', 'set_reminder'].sort(),
  );
});

test('tool input is schema-validated before it can become an assistant action', () => {
  const parsed = parseAssistantToolUse({
    type: 'tool_use',
    id: 'tool-call-1',
    name: 'book_appointment',
    input: { doctor: 'Dr Rao', date: '2026-12-01', time: '17:00' },
  });
  assert.equal(parsed.input.time, '17:00');
  assert.throws(() =>
    parseAssistantToolUse({
      type: 'tool_use',
      id: 'tool-call-2',
      name: 'set_reminder',
      input: { kind: 'medicine', title: 'Reminder', due_at: 'tomorrow' },
    }),
  );
  assert.throws(() =>
    parseAssistantToolUse({
      type: 'tool_use',
      id: 'tool-call-3',
      name: 'delete_patient_records',
      input: {},
    }),
  );
});

test('Claude tool requests keep credentials server-side and parse tool_use blocks', async () => {
  let request;
  const client = createClaudeAssistant({
    apiKey: 'server-only-test-key',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'tool-call-4',
                name: 'call_emergency',
                input: { reason: 'breathing trouble' },
              },
            ],
          };
        },
      };
    },
  });
  const result = await client.respond([{ role: 'user', content: 'I cannot breathe' }]);
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.options.headers['x-api-key'], 'server-only-test-key');
  assert.equal(request.body.tools.length, 12);
  assert.equal(result.toolUse.name, 'call_emergency');
  assert.equal(result.text, '');
});

test('Claude failures are surfaced and an absent key is not treated as success', async () => {
  await assert.rejects(
    () => createClaudeAssistant({}).respond([]),
    (error) => error.code === 'ASSISTANT_NOT_CONFIGURED',
  );
  await assert.rejects(
    () =>
      createClaudeAssistant({
        apiKey: 'test-key',
        fetchImpl: async () => ({ ok: false }),
      }).respond([]),
    (error) => error.code === 'ASSISTANT_PROVIDER_ERROR',
  );
});

test('assistant output filter replaces diagnosis and medication-dose language', () => {
  const diagnosis = sanitizeAssistantReply('The image shows cancer detected.', 'te');
  assert.match(diagnosis, /సాధారణ నోటి ఆరోగ్య సమాచారాన్ని మాత్రమే/);
  const prescription = sanitizeAssistantReply('Take 500 mg every day.', 'en');
  assert.match(prescription, /qualified clinician/);
  assert.match(
    sanitizeAssistantReply('You have oral cancer.', 'en'),
    /cannot assess or treat symptoms/,
  );
  assert.match(sanitizeAssistantReply('You are safe.', 'en'), /cannot assess or treat symptoms/);
  assert.match(
    sanitizeAssistantReply('You do not have cancer.', 'en'),
    /cannot assess or treat symptoms/,
  );
  assert.equal(
    sanitizeAssistantReply('Please ask a clinician about persistent symptoms.', 'en'),
    'Please ask a clinician about persistent symptoms.',
  );
  assert.equal(
    sanitizeAssistantReply('Brush daily to help keep your teeth and gums healthy.', 'en'),
    'Brush daily to help keep your teeth and gums healthy.',
  );
  assert.match(sanitizeAssistantReply('You are healthy.', 'en'), /cannot assess or treat symptoms/);
});
