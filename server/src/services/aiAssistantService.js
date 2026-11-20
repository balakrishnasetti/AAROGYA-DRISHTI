import { GoogleGenerativeAI } from '@google/generative-ai';
import PDFDocument from 'pdfkit';
import { AiAssistantSession, AiAssistantSettings } from '../models/index.js';
import { sanitizeAssistantReply } from './medicalSafety.js';

const SYSTEM_PROMPT =
  'You are an AI Health Assistant, not a human doctor. Never claim to be a doctor, diagnose patients, prescribe medicine, recommend dosing, or claim someone is healthy. Answer the user’s general oral-health question directly with cautious, non-diagnostic information. Where useful, include safe, low-risk precautions and recommend a qualified clinician for persistent, worsening, or concerning symptoms. Ask at most one brief follow-up question, only when essential. If the user reports heavy bleeding, difficulty breathing, difficulty swallowing, chest pain, stroke signs, or thoughts of self-harm, immediately direct them to emergency help by telling them to call 112 and seek emergency care.';

const ENGLISH_PATTERNS = [
  {
    label: 'chest pain',
    pattern: /chest pain|tightness in the chest|pain in the chest|chest discomfort/i,
  },
  {
    label: 'breathing trouble',
    pattern:
      /trouble breathing|shortness of breath|breathing trouble|difficulty breathing|can.t breathe/i,
  },
  {
    label: 'heavy bleeding',
    pattern: /heavy bleeding|bleeding heavily|severe bleeding|a lot of blood/i,
  },
  {
    label: 'difficulty swallowing',
    pattern: /difficulty swallowing|trouble swallowing|cannot swallow|can.t swallow/i,
  },
  {
    label: 'stroke signs',
    pattern:
      /one[- ]sided weakness|facial droop|drooping face|slurred speech|can.t speak|stroke|numbness/i,
  },
  {
    label: 'self-harm',
    pattern: /self[- ]harm|hurt myself|kill myself|end my life|suicidal|suicide/i,
  },
];

const TELUGU_PATTERNS = [
  { label: 'chest pain', pattern: /గుండె నొప్పి|చెప్పు నొప్పి|గుండె మంట|గుండె పీడనం/i },
  {
    label: 'breathing trouble',
    pattern: /శ్వాస తీసుకోవడం కష్టం|శ్వాస ఆడకపోవడం|ఉబ్బసం|శ్వాసపట్టడం|శ్వాస సమస్య/i,
  },
  { label: 'heavy bleeding', pattern: /భారీ రక్తస్రావం|మంచి కంత|చాలా రక్తం|రక్తం ఎక్కువ/i },
  { label: 'difficulty swallowing', pattern: /మింగడంలో ఇబ్బంది|మింగలేకపోవడం|మింగడం కష్టం/i },
  {
    label: 'stroke signs',
    pattern: /వైపు బలహీనత|ముఖం వంగి ఉండటం|చిన్న మాట|స్పష్టంగా మాట్లాడలేకపోవడం|మూర్ఛ|నమ్మకం/i,
  },
  { label: 'self-harm', pattern: /ఆత్మహత్య|నేను చంపుకోవాలి|చంపుకునే ఆలోచన|నువ్వు నా జీవితం/i },
];

const INDIAN_LANGUAGE_EMERGENCY_PATTERNS = [
  /बहुत खून|भारी रक्तस्राव|ज़्यादा खून|अधिक रक्तस्राव|सांस लेने में कठिनाई|साँस लेने में दिक्कत|सांस नहीं ले पा रहा|निगलने में कठिनाई|निगलने में परेशानी/i,
  /அதிக இரத்தப்போக்கு|நிறைய இரத்தம்|மூச்சு விடுவதில் சிரமம்|மூச்சு திணறல்|விழுங்குவதில் சிரமம்|விழுங்க முடியவில்லை/i,
  /ಹೆಚ್ಚು ರಕ್ತಸ್ರಾವ|ತೀವ್ರ ರಕ್ತಸ್ರಾವ|ಉಸಿರಾಟದ ತೊಂದರೆ|ಉಸಿರಾಡಲು ಕಷ್ಟ|ನುಂಗಲು ಕಷ್ಟ|ನುಂಗಲು ಆಗುತ್ತಿಲ್ಲ/i,
  /കനത്ത രക്തസ്രാവം|കൂടുതൽ രക്തം|ശ്വസിക്കാൻ ബുദ്ധിമുട്ട്|ശ്വാസംമുട്ടൽ|വിഴുങ്ങാൻ ബുദ്ധിമുട്ട്|വിഴുങ്ങാൻ കഴിയുന്നില്ല/i,
  /প্রচুর রক্তপাত|অনেক রক্ত|শ্বাস নিতে কষ্ট|শ্বাসকষ্ট|গিলতে অসুবিধা|গিলতে পারছি না/i,
  /खूप रक्तस्राव|जास्त रक्तस्राव|श्वास घेण्यास त्रास|श्वास घेता येत नाही|गिळण्यास त्रास|गिळता येत नाही/i,
];

const UNSAFE_PATTERNS = [
  /what medicine should i take/i,
  /medicine should i take/i,
  /prescribe/i,
  /prescription/i,
  /dosage/i,
  /how much.*medicine/i,
  /diagnosis/i,
  /you are a real doctor/i,
];

export function detectRedFlags(message = '') {
  const source = String(message || '').trim();
  const hits = [];

  for (const item of ENGLISH_PATTERNS) {
    if (item.pattern.test(source)) hits.push(item.label);
  }

  for (const item of TELUGU_PATTERNS) {
    if (item.pattern.test(source)) hits.push(item.label);
  }

  for (const pattern of INDIAN_LANGUAGE_EMERGENCY_PATTERNS) {
    if (pattern.test(source)) hits.push('emergency symptoms');
  }

  const unique = [...new Set(hits.map((item) => item.toLowerCase()))];
  return {
    urgent: unique.length > 0,
    detected: unique,
    instruction: 'Call 112 immediately or seek emergency care without delay.',
  };
}

export function containsUnsafeMedicalRequest(message = '') {
  return UNSAFE_PATTERNS.some((pattern) => pattern.test(String(message || '')));
}

export function buildSafeReply({ language = 'en', message = '' } = {}) {
  if (containsUnsafeMedicalRequest(message)) {
    return language === 'te'
      ? 'నేను వైద్య పరీక్ష, మందు సూచన లేదా మోతాదు ఇవ్వలేను. మీకు తీవ్రమైన లక్షణాలు ఉంటే 112ను కాల్ చేయండి.'
      : 'I cannot diagnose, prescribe medicine, or suggest dosing. If your symptoms are severe, call 112 or seek emergency care.';
  }

  if (/real doctor|నిజమైన డాక్టర్/i.test(String(message))) {
    return language === 'te'
      ? 'నేను AI ఆరోగ్య సహాయకుడిని మాత్రమే. నేను మానవ డాక్టర్ కాదు.'
      : 'I am an AI Health Assistant, not a human doctor.';
  }

  return language === 'te'
    ? 'నేను సాధారణ, non-diagnostic సమాచారం మాత్రమే అందించగలను. మీరు ఒకటి లేదా రెండు చిన్న ప్రశ్నలు అడగవచ్చు.'
    : 'I can provide general, non-diagnostic information and ask one or two brief follow-up questions.';
}

function unavailableReply(language) {
  return language === 'te'
    ? 'AI సహాయక సేవ ప్రస్తుతం అందుబాటులో లేదు. దయచేసి తర్వాత మళ్లీ ప్రయత్నించండి లేదా వైద్యుడిని సంప్రదించండి.'
    : 'The AI assistant is currently unavailable. Please try again later or contact a clinician.';
}

async function generateWithTimeout(model, prompt) {
  let timeout;
  try {
    return await Promise.race([
      model.generateContent([prompt]),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('gemini timeout')), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function readAiSettings(settingsModel = AiAssistantSettings) {
  let settings = await settingsModel.findOne({}).lean();
  if (!settings) {
    settings = await settingsModel.create({
      provider: 'gemini',
      languages: ['en', 'te'],
      safetyText:
        'Emergency help: call 112 or go to the nearest emergency department if you have severe chest pain, breathing trouble, heavy bleeding, stroke signs, or thoughts of self-harm.',
      avatarEnabled: true,
      avatarLabel: 'AI Health Assistant - not a human doctor',
      voiceEnabled: true,
    });
  }
  return settings;
}

function sanitizeText(
  text = '',
  fallback = 'I am not able to provide a medical response right now.',
) {
  const value = String(text || '').trim();
  if (!value) return fallback;
  return value.replace(/\s+/g, ' ').trim();
}

export function createAiAssistantService({
  sessionModel = AiAssistantSession,
  settingsModel = AiAssistantSettings,
  apiKey = process.env.GEMINI_API_KEY,
  modelName = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
  createClient = (key) => new GoogleGenerativeAI(key),
} = {}) {
  async function startSession({ patientId, userId, language = 'en' }) {
    const settings = await readAiSettings(settingsModel);
    const session = await sessionModel.create({
      patientId,
      userId,
      language,
      status: 'active',
      state: {
        language,
        avatarEnabled: Boolean(settings.avatarEnabled),
        avatarLabel: settings.avatarLabel || 'AI Health Assistant - not a human doctor',
      },
      summary: {
        concerns: [],
        symptoms: [],
        answers: [],
        generalInfoShared: [],
        suggestedDepartment: '',
        date: new Date(),
        label: 'AI-generated informational summary. Not a medical diagnosis.',
      },
      recentTurns: [],
    });
    return session;
  }

  async function getSession(sessionId) {
    return sessionModel.findById(sessionId).lean();
  }

  async function listSessions(patientId) {
    return sessionModel.find({ patientId }).sort({ createdAt: -1 }).limit(50).lean();
  }

  async function appendTurn(sessionId, role, text) {
    const session = await sessionModel.findById(sessionId);
    if (!session) return null;
    const current = Array.isArray(session.recentTurns) ? session.recentTurns.slice(-11) : [];
    current.push({
      role,
      text: sanitizeText(text, 'No response generated.'),
      createdAt: new Date(),
    });
    session.recentTurns = current;
    session.state = { ...(session.state || {}), lastUpdatedAt: new Date().toISOString() };
    await session.save();
    return session;
  }

  async function generateReply({ sessionId, userText, language = 'en' }) {
    const session = await sessionModel.findById(sessionId);
    if (!session) throw new Error('AI session not found.');

    const redFlags = detectRedFlags(userText);
    if (redFlags.urgent) {
      const response =
        language === 'te'
          ? 'మీ లక్షణాలకు అత్యవసర సహాయం అవసరం కావచ్చు. వెంటనే 112కు కాల్ చేయండి లేదా సమీప అత్యవసర వైద్య సేవను సంప్రదించండి.'
          : 'These symptoms may require emergency help. Call 112 or contact the nearest emergency service now.';

      const summary = session.summary || {};
      summary.concerns = [...new Set([...(summary.concerns || []), ...redFlags.detected])];
      summary.date = new Date();
      session.summary = summary;
      await session.save();
      await appendTurn(sessionId, 'user', userText);
      await appendTurn(sessionId, 'assistant', response);
      return { text: response, urgent: true, redFlag: redFlags };
    }

    const safeReply = buildSafeReply({ language, message: userText });
    if (
      containsUnsafeMedicalRequest(userText) ||
      /real doctor|నిజమైన డాక్టర్/i.test(String(userText))
    ) {
      await appendTurn(sessionId, 'user', userText);
      await appendTurn(sessionId, 'assistant', safeReply);
      return { text: safeReply, urgent: false, redFlag: false };
    }

    if (!apiKey) {
      return {
        text: unavailableReply(language),
        urgent: false,
        redFlag: false,
        unavailable: true,
      };
    }

    const settings = await readAiSettings(settingsModel);
    await appendTurn(sessionId, 'user', userText);
    let finalText;
    try {
      const client = createClient(apiKey);
      const model = client.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: { temperature: 0.2 },
      });
      const prompt = `Reply in ${language === 'te' ? 'Telugu' : 'English'} in plain, empathetic language. Answer the question directly and include safe, practical precautions when useful. Ask at most one follow-up question only if essential. Do not diagnose or prescribe medicine. The user message is: ${userText}. Also use this safety text: ${settings.safetyText}`;
      let result;
      try {
        result = await generateWithTimeout(model, prompt);
      } catch (error) {
        if (error?.status !== 503) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        result = await generateWithTimeout(model, prompt);
      }
      const responseText = result?.response?.text?.();
      if (typeof responseText !== 'string' || !responseText.trim()) {
        throw new Error('AI assistant returned an empty response.');
      }
      finalText = sanitizeAssistantReply(
        sanitizeText(responseText, unavailableReply(language)),
        language,
      );
    } catch (error) {
      console.error('AI assistant provider unavailable', {
        reason: error instanceof Error ? error.name : 'unknown',
        ...(Number.isInteger(error?.status) ? { status: error.status } : {}),
      });
      return {
        text: unavailableReply(language),
        urgent: false,
        redFlag: false,
        unavailable: true,
      };
    }

    if (
      /\bdiagnosis\b|prescribe|dosage|what medicine should i take|medicine should i take\b/i.test(
        finalText,
      )
    ) {
      finalText = safeReply;
    }

    const updatedSummary = session.summary || {};
    updatedSummary.concerns = [
      ...new Set([...(updatedSummary.concerns || []), userText].filter(Boolean)),
    ];
    updatedSummary.date = new Date();
    session.summary = updatedSummary;
    await session.save();
    await appendTurn(sessionId, 'assistant', finalText);

    return { text: finalText, urgent: false, redFlag: false };
  }

  async function endSession(sessionId) {
    const session = await sessionModel.findById(sessionId);
    if (!session) return null;
    session.status = 'ended';
    session.summary = {
      ...(session.summary || {}),
      label: 'AI-generated informational summary. Not a medical diagnosis.',
      date: new Date(),
    };
    await session.save();
    return session;
  }

  async function createSummary(sessionId) {
    const session = await sessionModel.findById(sessionId).lean();
    if (!session) return null;
    const summary = {
      concerns: [...new Set((session.summary?.concerns || []).filter(Boolean))],
      symptoms: [...new Set((session.summary?.symptoms || []).filter(Boolean))],
      answers: [...new Set((session.summary?.answers || []).filter(Boolean))],
      generalInfoShared: [...new Set((session.summary?.generalInfoShared || []).filter(Boolean))],
      suggestedDepartment: session.summary?.suggestedDepartment || 'General assessment',
      date: new Date(),
      label: 'AI-generated informational summary. Not a medical diagnosis.',
      transcript: (session.recentTurns || [])
        .map((turn) => `${turn.role}: ${turn.text}`)
        .join('\n'),
    };

    await sessionModel.findByIdAndUpdate(sessionId, { $set: { summary } }, { new: true });
    return summary;
  }

  async function createSummaryPdf(sessionId) {
    const summary = await createSummary(sessionId);
    if (!summary) return null;

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];

    return new Promise((resolve, reject) => {
      doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.fontSize(18).text('Aarogya Drishti', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text('AI-generated informational summary. Not a medical diagnosis.');
      doc.moveDown();
      doc.fontSize(12).text(`Date: ${new Date(summary.date).toISOString()}`);
      doc.moveDown();
      doc.fontSize(12).text('Concerns:');
      (summary.concerns || []).forEach((concern) => doc.text(`- ${concern}`));
      doc.moveDown();
      doc.fontSize(12).text('Suggested department:');
      doc.text(summary.suggestedDepartment || 'General assessment');
      doc.moveDown();
      doc.fontSize(12).text('Transcript:');
      doc.text(summary.transcript || 'No transcript available.');
      doc.end();
    });
  }

  return {
    startSession,
    getSession,
    listSessions,
    appendTurn,
    generateReply,
    endSession,
    createSummary,
    createSummaryPdf,
  };
}

export const aiAssistantService = createAiAssistantService();
