import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  AiAssistantSession,
  Appointment,
  Consent,
  FollowUp,
  Hospital,
  Patient,
  User,
} from '../models/index.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import { detectRedFlags } from '../services/aiAssistantService.js';
import {
  createClaudeAssistant,
  MUTATING_ASSISTANT_TOOLS,
  parseAssistantToolUse,
  sanitizeAssistantReply,
} from '../services/claudeAssistantService.js';
import { createAppointmentService } from '../services/appointmentService.js';
import { writeAuditLog } from '../services/auditService.js';
import { decryptField, encryptField } from '../services/fieldEncryption.js';
import { ApiError } from '../utils/apiError.js';

const languages = ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'bn', 'mr'];
const chatSchema = z.object({
  sessionId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  message: z.string().trim().min(1).max(4000),
  language: z.enum(languages).default('en'),
}).strict();
const confirmationSchema = z.object({
  actionId: z.string().uuid(),
  confirmed: z.boolean(),
}).strict();
const emergencyReplies = {
  en: 'These symptoms may require emergency help. Call 112 or contact the nearest emergency service now.',
  hi: 'इन लक्षणों में तुरंत आपातकालीन सहायता की आवश्यकता हो सकती है। अभी 112 पर कॉल करें या निकटतम आपातकालीन सेवा से संपर्क करें।',
  te: 'మీ లక్షణాలకు అత్యవసర సహాయం అవసరం కావచ్చు. వెంటనే 112కు కాల్ చేయండి లేదా సమీప అత్యవసర సేవను సంప్రదించండి.',
  ta: 'இந்த அறிகுறிகளுக்கு அவசர உதவி தேவைப்படலாம். உடனே 112-ஐ அழைக்கவும் அல்லது அருகிலுள்ள அவசர சேவையை அணுகவும்.',
  kn: 'ಈ ಲಕ್ಷಣಗಳಿಗೆ ತುರ್ತು ಸಹಾಯ ಬೇಕಾಗಬಹುದು. ಈಗಲೇ 112 ಕರೆ ಮಾಡಿ ಅಥವಾ ಹತ್ತಿರದ ತುರ್ತು ಸೇವೆಯನ್ನು ಸಂಪರ್ಕಿಸಿ.',
  ml: 'ഈ ലക്ഷണങ്ങൾക്ക് അടിയന്തര സഹായം ആവശ്യമായേക്കാം. ഇപ്പോൾ 112 വിളിക്കുക അല്ലെങ്കിൽ അടുത്തുള്ള അടിയന്തര സേവനത്തെ ബന്ധപ്പെടുക.',
  bn: 'এই উপসর্গগুলির জন্য জরুরি সহায়তা প্রয়োজন হতে পারে। এখনই 112-এ কল করুন বা নিকটস্থ জরুরি পরিষেবায় যোগাযোগ করুন।',
  mr: 'या लक्षणांसाठी तातडीची मदत आवश्यक असू शकते. आत्ताच 112 वर कॉल करा किंवा जवळच्या आपत्कालीन सेवेशी संपर्क साधा.',
};
const confirmedActionReplies = {
  en: {
    dismissed: 'Action dismissed. Nothing was changed.',
    booking: 'Your request is confirmed. Review the matching doctor and available time in the booking workflow, then submit the appointment there.',
    cancelled: 'Your appointment cancellation request was recorded.',
    reschedule: 'Your rescheduling request is confirmed. Choose a new available slot in the patient booking workflow; the current appointment has not been changed.',
    reminder: 'Your reminder request was saved to your care record. The app does not currently deliver reminder notifications; set a device alarm too. This is not a medication recommendation.',
  },
  hi: {
    dismissed: 'कार्रवाई रद्द कर दी गई। कुछ भी नहीं बदला।',
    booking: 'अनुरोध की पुष्टि हुई। बुकिंग कार्यप्रवाह में डॉक्टर और उपलब्ध समय की समीक्षा करके अपॉइंटमेंट जमा करें।',
    cancelled: 'अपॉइंटमेंट रद्द करने का अनुरोध दर्ज किया गया।',
    reschedule: 'समय बदलने के अनुरोध की पुष्टि हुई। नया समय चुनें; मौजूदा अपॉइंटमेंट अभी नहीं बदला है।',
    reminder: 'रिमाइंडर अनुरोध आपके रिकॉर्ड में सहेजा गया। ऐप अभी सूचना नहीं भेजता; डिवाइस अलार्म भी लगाएँ। यह दवा की सलाह नहीं है।',
  },
  te: {
    dismissed: 'చర్య రద్దు చేయబడింది. ఏ మార్పూ చేయలేదు.',
    booking: 'మీ అభ్యర్థన నిర్ధారించబడింది. బుకింగ్ విధానంలో వైద్యుడు, అందుబాటులో ఉన్న సమయాన్ని సమీక్షించి అపాయింట్‌మెంట్ పంపండి.',
    cancelled: 'అపాయింట్‌మెంట్ రద్దు అభ్యర్థన నమోదు చేయబడింది.',
    reschedule: 'సమయం మార్చే అభ్యర్థన నిర్ధారించబడింది. కొత్త సమయాన్ని ఎంచుకోండి; ప్రస్తుత అపాయింట్‌మెంట్ ఇంకా మారలేదు.',
    reminder: 'రిమైండర్ అభ్యర్థన మీ సంరక్షణ రికార్డులో సేవ్ చేయబడింది. యాప్ ప్రస్తుతం నోటిఫికేషన్ పంపదు; పరికరంలో అలారం కూడా పెట్టండి. ఇది మందుల సలహా కాదు.',
  },
  ta: {
    dismissed: 'செயல் ரத்து செய்யப்பட்டது. எதுவும் மாற்றப்படவில்லை.',
    booking: 'கோரிக்கை உறுதிசெய்யப்பட்டது. முன்பதிவு செயல்பாட்டில் மருத்துவர் மற்றும் நேரத்தைச் சரிபார்த்து சந்திப்பைச் சமர்ப்பிக்கவும்.',
    cancelled: 'சந்திப்பு ரத்து கோரிக்கை பதிவு செய்யப்பட்டது.',
    reschedule: 'மறுதிட்டமிடல் கோரிக்கை உறுதிசெய்யப்பட்டது. புதிய நேரத்தைத் தேர்ந்தெடுக்கவும்; தற்போதைய சந்திப்பு மாற்றப்படவில்லை.',
    reminder: 'நினைவூட்டல் கோரிக்கை பதிவில் சேமிக்கப்பட்டது. பயன்பாடு தற்போது அறிவிப்புகளை அனுப்பாது; சாதன அலாரத்தையும் அமைக்கவும். இது மருந்து ஆலோசனை அல்ல.',
  },
  kn: {
    dismissed: 'ಕ್ರಿಯೆಯನ್ನು ರದ್ದುಪಡಿಸಲಾಗಿದೆ. ಯಾವುದೇ ಬದಲಾವಣೆ ಮಾಡಿಲ್ಲ.',
    booking: 'ವಿನಂತಿಯನ್ನು ದೃಢೀಕರಿಸಲಾಗಿದೆ. ಬುಕಿಂಗ್ ಕಾರ್ಯಪ್ರವಾಹದಲ್ಲಿ ವೈದ್ಯರು ಮತ್ತು ಲಭ್ಯ ಸಮಯವನ್ನು ಪರಿಶೀಲಿಸಿ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಸಲ್ಲಿಸಿ.',
    cancelled: 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದತಿ ವಿನಂತಿ ದಾಖಲಿಸಲಾಗಿದೆ.',
    reschedule: 'ಮರುನಿಗದಿ ವಿನಂತಿಯನ್ನು ದೃಢೀಕರಿಸಲಾಗಿದೆ. ಹೊಸ ಸಮಯ ಆಯ್ಕೆಮಾಡಿ; ಈಗಿನ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬದಲಾಗಿಲ್ಲ.',
    reminder: 'ಜ್ಞಾಪನೆ ವಿನಂತಿಯನ್ನು ದಾಖಲಿಸಲಾಗಿದೆ. ಆ್ಯಪ್ ಈಗ ಅಧಿಸೂಚನೆ ಕಳುಹಿಸುವುದಿಲ್ಲ; ಸಾಧನದಲ್ಲೂ ಅಲಾರಂ ಇಡಿ. ಇದು ಔಷಧ ಸಲಹೆಯಲ್ಲ.',
  },
  ml: {
    dismissed: 'നടപടി റദ്ദാക്കി. മാറ്റമൊന്നും വരുത്തിയില്ല.',
    booking: 'അഭ്യർത്ഥന സ്ഥിരീകരിച്ചു. ബുക്കിംഗ് പ്രവർത്തനത്തിൽ ഡോക്ടറും ലഭ്യമായ സമയവും പരിശോധിച്ച് അപ്പോയിന്റ്മെന്റ് സമർപ്പിക്കുക.',
    cancelled: 'അപ്പോയിന്റ്മെന്റ് റദ്ദാക്കാനുള്ള അഭ്യർത്ഥന രേഖപ്പെടുത്തി.',
    reschedule: 'പുനഃക്രമീകരണ അഭ്യർത്ഥന സ്ഥിരീകരിച്ചു. പുതിയ സമയം തിരഞ്ഞെടുക്കുക; നിലവിലെ അപ്പോയിന്റ്മെന്റ് മാറ്റിയിട്ടില്ല.',
    reminder: 'ഓർമ്മപ്പെടുത്തൽ അഭ്യർത്ഥന രേഖയിൽ സൂക്ഷിച്ചു. ആപ്പ് ഇപ്പോൾ അറിയിപ്പുകൾ അയയ്ക്കില്ല; ഉപകരണ അലാറവും സജ്ജമാക്കുക. ഇത് മരുന്ന് ഉപദേശമല്ല.',
  },
  bn: {
    dismissed: 'কাজটি বাতিল করা হয়েছে। কিছু পরিবর্তন হয়নি।',
    booking: 'অনুরোধ নিশ্চিত হয়েছে। বুকিং ধাপে চিকিৎসক ও সময় দেখে অ্যাপয়েন্টমেন্ট জমা দিন।',
    cancelled: 'অ্যাপয়েন্টমেন্ট বাতিলের অনুরোধ নথিভুক্ত হয়েছে।',
    reschedule: 'সময় বদলের অনুরোধ নিশ্চিত হয়েছে। নতুন সময় বেছে নিন; বর্তমান অ্যাপয়েন্টমেন্ট বদলানো হয়নি।',
    reminder: 'রিমাইন্ডার অনুরোধ রেকর্ডে রাখা হয়েছে। অ্যাপ এখন বিজ্ঞপ্তি পাঠায় না; ডিভাইসের অ্যালার্মও দিন। এটি ওষুধের পরামর্শ নয়।',
  },
  mr: {
    dismissed: 'कृती रद्द केली. कोणताही बदल केला नाही.',
    booking: 'विनंती निश्चित झाली. बुकिंग प्रक्रियेत डॉक्टर आणि उपलब्ध वेळ तपासून अपॉइंटमेंट सादर करा.',
    cancelled: 'अपॉइंटमेंट रद्द करण्याची विनंती नोंदवली.',
    reschedule: 'वेळ बदलण्याची विनंती निश्चित झाली. नवीन वेळ निवडा; सध्याची अपॉइंटमेंट बदललेली नाही.',
    reminder: 'स्मरणपत्र विनंती नोंदीत जतन केली. अॅप सध्या सूचना पाठवत नाही; डिव्हाइस अलार्मही लावा. हा औषध सल्ला नाही.',
  },
};
const pendingActionReplies = {
  en: 'Review the requested action below and confirm before continuing.',
  hi: 'आगे बढ़ने से पहले नीचे दी गई कार्रवाई की समीक्षा करके पुष्टि करें।',
  te: 'కొనసాగించే ముందు దిగువ చర్యను సమీక్షించి నిర్ధారించండి.',
  ta: 'தொடர்வதற்கு முன் கீழே உள்ள செயலைப் பரிசீலித்து உறுதிப்படுத்தவும்.',
  kn: 'ಮುಂದುವರಿಯುವ ಮೊದಲು ಕೆಳಗಿನ ಕ್ರಿಯೆಯನ್ನು ಪರಿಶೀಲಿಸಿ ದೃಢೀಕರಿಸಿ.',
  ml: 'തുടരുന്നതിന് മുമ്പ് താഴെയുള്ള പ്രവർത്തനം പരിശോധിച്ച് സ്ഥിരീകരിക്കുക.',
  bn: 'এগোনোর আগে নিচের কাজটি দেখে নিশ্চিত করুন।',
  mr: 'पुढे जाण्यापूर्वी खालील कृती तपासून निश्चित करा.',
};

function escapedRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getPatientAndConsent(userId) {
  const patient = await Patient.findOne({ userId, active: true }).select('_id').lean();
  if (!patient) {
    throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
  }
  const consent = await Consent.findOne({ patientId: patient._id, consentType: 'ai_processing' })
    .sort({ recordedAt: -1 })
    .lean();
  if (!consent?.granted || consent.withdrawnAt) {
    throw new ApiError(403, 'CONSENT_REQUIRED', 'Active AI processing consent is required.');
  }
  return patient;
}

export async function executeReadOnlyTool(name, input) {
  if (name === 'cancel_or_reschedule_appointment' && input.operation === 'cancel' && !input.appointment_id) {
    return {
      text: 'I could not identify which appointment you mean. Open your appointment list, choose the specific appointment, then confirm cancellation there.',
      action: { type: 'navigate', href: '/patient/appointments' },
    };
  }

  if (name === 'find_nearby_hospitals') {
    const rawLocation = input.location?.trim();
    const location = rawLocation && !/^(nearest|nearby|closest)\b/i.test(rawLocation)
      ? rawLocation
      : '';
    const specialty = input.specialty
      ?? (/cancer|oncology/i.test(rawLocation ?? '') ? 'cancer' : 'general');
    const mapQuery = new URLSearchParams();
    if (location) mapQuery.set('query', location);
    if (specialty !== 'general') mapQuery.set('specialty', specialty);
    mapQuery.set('nearest', 'true');
    const hospitals = location
      ? await Hospital.find({
          status: 'active',
          $or: [
            { name: new RegExp(escapedRegex(location), 'i') },
            { city: new RegExp(escapedRegex(location), 'i') },
            { address: new RegExp(escapedRegex(location), 'i') },
            { district: new RegExp(escapedRegex(location), 'i') },
          ],
        }).select('name city address district isSynthetic').limit(8).lean()
      : [];
    return {
      text: location
        ? hospitals.length
          ? `I found ${hospitals.length} directory entries for ${location}. Some entries may be synthetic; check each listing before travel. Open the Hospitals tab to view locations and choose navigation.`
          : `I could not find a directory match for ${location}. Open the Hospitals tab to try another city or district, or choose location permission to search nearby.`
        : 'Open the Hospitals tab to allow location access or search manually. I will not access your location unless you choose the nearby search there.',
      action: { type: 'navigate', href: `/patient/hospitals?${mapQuery.toString()}` },
    };
  }

  if (name === 'get_diet_plan') {
    return {
      text: 'Open Diet and Lifestyle for general meal ideas and today’s planner. This is general guidance, not a replacement for a doctor or dietitian.',
      action: { type: 'navigate', href: '/patient/diet' },
    };
  }

  if (name === 'call_emergency') {
    return {
      text: 'If you are in immediate danger, call India emergency services at 112 now. The assistant cannot place the call for you.',
      action: { type: 'call', href: 'tel:112' },
    };
  }

  const actionRoutes = {
    open_camera: '/patient#patient-photo-capture',
    start_oral_scan: '/patient#patient-screening',
    show_my_reports: '/patient#patient-reports',
    show_screening_results: '/patient#patient-results',
    show_qr_code: '/patient',
  };
  if (actionRoutes[name]) {
    return {
      text: name === 'show_qr_code'
        ? 'Open your patient dashboard to check available records. A patient QR-code view is not enabled in this app yet.'
        : 'Open your patient dashboard to continue. You can review or submit the requested screening, report, or image action there.',
      action: { type: 'navigate', href: actionRoutes[name] },
    };
  }

  if (name === 'answer_general_oral_health_question') {
    return { text: 'Please ask your general oral-health question directly; I can share information, not a diagnosis or prescription.' };
  }

  return { text: 'That assistant action is not available.' };
}

export function createAssistantRoutes(environment) {
  const router = Router();
  const encryptionSecret = environment.DATA_ENCRYPTION_KEY || environment.JWT_ACCESS_SECRET;
  const claude = createClaudeAssistant({
    apiKey: environment.ANTHROPIC_API_KEY,
    model: environment.ANTHROPIC_MODEL,
  });
  const appointmentService = createAppointmentService();
  router.use(authenticate(environment), authorize('patient'));

  function readEncryptedState(session, key, fallback) {
    const stored = session.state?.[key];
    if (!stored) return fallback;
    return JSON.parse(decryptField(stored, encryptionSecret));
  }

  function storeEncryptedState(session, key, value) {
    session.state = {
      ...(session.state || {}),
      [key]: encryptField(JSON.stringify(value), encryptionSecret),
    };
  }

  router.post(
    '/',
    validateBody(chatSchema),
    asyncHandler(async (req, res) => {
      const patient = await getPatientAndConsent(req.user.id);
      let session = req.body.sessionId
        ? await AiAssistantSession.findOne({
          _id: req.body.sessionId,
          patientId: patient._id,
          userId: req.user.id,
          status: 'active',
        })
        : null;
      if (req.body.sessionId && !session) {
        throw new ApiError(404, 'ASSISTANT_SESSION_NOT_FOUND', 'Assistant session not found.');
      }
      if (!session) {
        session = await AiAssistantSession.create({
          patientId: patient._id,
          userId: req.user.id,
          language: req.body.language,
          status: 'active',
          state: {},
          recentTurns: [],
        });
      }

      const redFlags = detectRedFlags(req.body.message);
      if (redFlags.urgent) {
        const reply = emergencyReplies[req.body.language] || emergencyReplies.en;
        const turns = [
          ...readEncryptedState(session, 'assistantTranscript', []),
          { role: 'user', text: req.body.message },
          { role: 'assistant', text: reply },
        ].slice(-12);
        storeEncryptedState(session, 'assistantTranscript', turns);
        await session.save();
        return res.json({
          success: true,
          data: { sessionId: session._id, text: reply, urgent: true, action: { type: 'call', href: 'tel:112' } },
        });
      }

      if (readEncryptedState(session, 'pendingAssistantAction', null)) {
        throw new ApiError(409, 'ASSISTANT_ACTION_PENDING', 'Confirm or dismiss the pending assistant action first.');
      }
      let result;
      const messages = [
        ...readEncryptedState(session, 'assistantTranscript', []).slice(-12).map(({ role, text }) => ({
          role: role === 'assistant' ? 'assistant' : 'user',
          content: text,
        })),
        { role: 'user', content: req.body.message },
      ];
      try {
        result = await claude.respond(messages);
      } catch (error) {
        const code = error.code === 'ASSISTANT_NOT_CONFIGURED'
          ? 'ASSISTANT_NOT_CONFIGURED'
          : 'ASSISTANT_PROVIDER_ERROR';
        const status = code === 'ASSISTANT_NOT_CONFIGURED' ? 503 : 502;
        throw new ApiError(status, code, code === 'ASSISTANT_NOT_CONFIGURED'
          ? 'The assistant service is not configured.'
          : 'The assistant could not respond. Please try again.');
      }

      let text = result.text;
      let action = null;
      let pendingAction = null;
      if (result.toolUse) {
        let tool;
        try {
          tool = parseAssistantToolUse(result.toolUse);
        } catch {
          throw new ApiError(502, 'ASSISTANT_INVALID_TOOL', 'The assistant returned an invalid action.');
        }
        let routeToAppointments = tool.name === 'cancel_or_reschedule_appointment' &&
          tool.input.operation === 'cancel' &&
          !tool.input.appointment_id;
        let actionSummary = '';
        if (
          tool.name === 'cancel_or_reschedule_appointment' &&
          tool.input.operation === 'cancel' &&
          tool.input.appointment_id
        ) {
          const appointment = await Appointment.findOne({
            _id: tool.input.appointment_id,
            patientId: patient._id,
            status: { $in: ['requested', 'accepted', 'confirmed'] },
          }).select('slotStart doctorId').lean();
          if (!appointment) {
            routeToAppointments = true;
          } else {
            const doctor = await User.findById(appointment.doctorId).select('fullName').lean();
            actionSummary = `${doctor?.fullName || 'Doctor'} · ${new Date(appointment.slotStart).toISOString()}`;
          }
        }
        const needsActionConfirmation = MUTATING_ASSISTANT_TOOLS.has(tool.name) && !routeToAppointments;
        if (needsActionConfirmation) {
          pendingAction = {
            id: randomUUID(),
            name: tool.name,
            input: tool.input,
            ...(actionSummary ? { summary: actionSummary } : {}),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          };
          storeEncryptedState(session, 'pendingAssistantAction', pendingAction);
          text = text || pendingActionReplies[req.body.language] || pendingActionReplies.en;
        } else {
          const execution = await executeReadOnlyTool(
            tool.name,
            routeToAppointments ? { operation: 'cancel' } : tool.input,
          );
          const completed = await claude.respond([
            ...messages,
            { role: 'assistant', content: result.content },
            {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: tool.id,
                content: execution.text,
              }],
            },
          ], { allowTools: false });
          text = completed.text;
          action = execution.action || null;
        }
      }
      if (!text) {
        throw new ApiError(502, 'ASSISTANT_EMPTY_RESPONSE', 'The assistant returned no response. Please try again.');
      }
      text = sanitizeAssistantReply(text, req.body.language);

      session.language = req.body.language;
      const turns = [
        ...readEncryptedState(session, 'assistantTranscript', []),
        { role: 'user', text: req.body.message },
        { role: 'assistant', text },
      ].slice(-12);
      storeEncryptedState(session, 'assistantTranscript', turns);
      await session.save();
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'ai_assistant_turn',
        resourceId: session._id.toString(),
        requestId: req.id,
        metadata: { toolName: result.toolUse?.name || 'none' },
      });
      return res.json({
        success: true,
        data: { sessionId: session._id, text, action, pendingAction, urgent: false },
      });
    }),
  );

  router.get(
    '/:sessionId',
    asyncHandler(async (req, res) => {
      const patient = await getPatientAndConsent(req.user.id);
      if (!mongoose.isValidObjectId(req.params.sessionId)) {
        throw new ApiError(404, 'ASSISTANT_SESSION_NOT_FOUND', 'Assistant session not found.');
      }
      const session = await AiAssistantSession.findOne({
        _id: req.params.sessionId,
        patientId: patient._id,
        userId: req.user.id,
        status: 'active',
      }).select('state language').lean();
      if (!session) {
        throw new ApiError(404, 'ASSISTANT_SESSION_NOT_FOUND', 'Assistant session not found.');
      }
      return res.json({
        success: true,
        data: {
          sessionId: req.params.sessionId,
          turns: readEncryptedState(session, 'assistantTranscript', []),
          pendingAction: readEncryptedState(session, 'pendingAssistantAction', null),
          language: session.language,
        },
      });
    }),
  );

  router.post(
    '/:sessionId/confirm',
    validateBody(confirmationSchema),
    asyncHandler(async (req, res) => {
      const patient = await getPatientAndConsent(req.user.id);
      if (!mongoose.isValidObjectId(req.params.sessionId)) {
        throw new ApiError(404, 'ASSISTANT_SESSION_NOT_FOUND', 'Assistant session not found.');
      }
      const session = await AiAssistantSession.findOne({
        _id: req.params.sessionId,
        patientId: patient._id,
        userId: req.user.id,
        status: 'active',
      });
      const pending = session ? readEncryptedState(session, 'pendingAssistantAction', null) : null;
      if (!session || !pending || pending.id !== req.body.actionId) {
        throw new ApiError(409, 'ASSISTANT_ACTION_NOT_FOUND', 'This action is no longer available.');
      }
      if (Date.parse(pending.expiresAt) <= Date.now()) {
        storeEncryptedState(session, 'pendingAssistantAction', null);
        await session.save();
        throw new ApiError(410, 'ASSISTANT_ACTION_EXPIRED', 'The confirmation expired. Please ask again.');
      }

      let text;
      let action = null;
      if (!req.body.confirmed) {
        text = confirmedActionReplies[session.language]?.dismissed || confirmedActionReplies.en.dismissed;
      } else if (pending.name === 'book_appointment') {
        text = confirmedActionReplies[session.language]?.booking || confirmedActionReplies.en.booking;
        const query = new URLSearchParams({
          assistantDoctor: pending.input.doctor,
          assistantDate: pending.input.date,
          assistantTime: pending.input.time,
        });
        action = { type: 'navigate', href: `/patient/appointments?${query.toString()}` };
      } else if (pending.name === 'cancel_or_reschedule_appointment') {
        if (pending.input.operation === 'cancel') {
          if (!pending.input.appointment_id) {
            throw new ApiError(400, 'APPOINTMENT_ID_REQUIRED', 'Choose the appointment to cancel from your appointment list.');
          }
          const appointment = await Appointment.findOne({
            _id: pending.input.appointment_id,
            patientId: patient._id,
            status: { $in: ['requested', 'accepted', 'confirmed'] },
          }).select('_id').lean();
          if (!appointment) {
            throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'That active appointment was not found.');
          }
          await appointmentService.updateAppointmentStatus({
            appointmentId: appointment._id,
            patientId: patient._id,
            status: 'cancelled',
            reason: 'Cancelled at the patient confirmed request through the assistant.',
          });
          text = confirmedActionReplies[session.language]?.cancelled || confirmedActionReplies.en.cancelled;
        } else {
          text = confirmedActionReplies[session.language]?.reschedule || confirmedActionReplies.en.reschedule;
          action = { type: 'navigate', href: '/patient/appointments' };
        }
      } else if (pending.name === 'set_reminder') {
        const dueAt = new Date(pending.input.due_at);
        if (!Number.isFinite(dueAt.getTime()) || dueAt <= new Date() || dueAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
          throw new ApiError(400, 'REMINDER_DATE_INVALID', 'Choose a reminder time within the next year.');
        }
        await FollowUp.create({
          patientId: patient._id,
          followUpDate: dueAt,
          dueAt,
          reminderAt: dueAt,
          status: 'pending',
          instructions: encryptField(
            `Patient-requested ${pending.input.kind} reminder: ${pending.input.title}`,
            encryptionSecret,
          ),
        });
        text = confirmedActionReplies[session.language]?.reminder || confirmedActionReplies.en.reminder;
      } else {
        throw new ApiError(400, 'ASSISTANT_ACTION_INVALID', 'That action is not supported.');
      }

      storeEncryptedState(session, 'pendingAssistantAction', null);
      const turns = [
        ...readEncryptedState(session, 'assistantTranscript', []),
        { role: 'assistant', text },
      ].slice(-12);
      storeEncryptedState(session, 'assistantTranscript', turns);
      await session.save();
      await writeAuditLog({
        actorId: req.user.id,
        action: req.body.confirmed ? 'edit' : 'read',
        resourceType: 'ai_assistant_action',
        resourceId: session._id.toString(),
        requestId: req.id,
        metadata: { toolName: pending.name, confirmed: req.body.confirmed },
      });
      return res.json({
        success: true,
        data: { sessionId: session._id, text, action, pendingAction: null },
      });
    }),
  );

  return router;
}
