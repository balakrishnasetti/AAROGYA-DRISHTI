const unsafeReplyPatterns = [
  /\bcancer detected\b|\bcancer ruled out\b|\bcancer[- ]free\b|\bnot cancer\b|\bnegative for (?:oral )?cancer\b|\bno (?:signs? of )?(?:oral )?cancer\b/i,
  /\byou (?:are|seem|look) safe\b|\bsafe from (?:oral )?cancer\b/i,
  /\byou (?:have|do not have|don't have|are suffering from)\s+(?:oral )?(?:cancer|leukoplakia|infection|ulcer|tumou?r)\b/i,
  /\bdiagnos(?:is|e|ed)\b|\bstaging\b|\byou(?:'re| are) healthy\b|\byour (?:mouth|teeth|gums) (?:look |seem )?healthy\b/i,
  /\bprescrib(?:e|ed|ing|tion)\b|\bdosage\b|\btake\s+\d+\s*(?:mg|mcg|g)\b/i,
  /निदान|दवा की खुराक|खुराक बताऊँ/i,
  /నిర్ధారణ|మోతాదు|మందు సూచన/i,
  /మీరు సురక్షితంగా ఉన్నారు|క్యాన్సర్ లేదు/i,
  /நோயறிதல்|மருந்து அளவு/i,
  /ರೋಗನಿರ್ಣಯ|ಔಷಧದ ಪ್ರಮಾಣ/i,
  /രോഗനിർണയം|മരുന്നിന്റെ അളവ്/i,
  /রোগ নির্ণয়|ওষুধের মাত্রা/i,
  /निदान|औषधाचा डोस/i,
];

const safeReplyByLanguage = {
  en: 'I can share general oral-health information, but cannot assess or treat symptoms. Please speak with a qualified clinician.',
  hi: 'मैं सामान्य मौखिक-स्वास्थ्य जानकारी दे सकता हूँ, लेकिन लक्षणों का आकलन या उपचार नहीं कर सकता। कृपया योग्य चिकित्सक से बात करें।',
  te: 'నేను సాధారణ నోటి ఆరోగ్య సమాచారాన్ని మాత్రమే అందించగలను; లక్షణాలను అంచనా వేయలేను లేదా చికిత్స చేయలేను. అర్హత కలిగిన వైద్యుడిని సంప్రదించండి.',
  ta: 'பொதுவான வாய்வழி சுகாதாரத் தகவலை மட்டுமே வழங்க முடியும்; அறிகுறிகளை மதிப்பிடவோ சிகிச்சையளிக்கவோ முடியாது. தகுதியான மருத்துவரை அணுகவும்.',
  kn: 'ನಾನು ಸಾಮಾನ್ಯ ಬಾಯಿ ಆರೋಗ್ಯ ಮಾಹಿತಿಯನ್ನು ಮಾತ್ರ ನೀಡಬಲ್ಲೆ; ಲಕ್ಷಣಗಳನ್ನು ಮೌಲ್ಯಮಾಪನ ಅಥವಾ ಚಿಕಿತ್ಸೆ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ. ಅರ್ಹ ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ.',
  ml: 'പൊതുവായ വായാരോഗ്യ വിവരം മാത്രമേ നൽകാനാകൂ; ലക്ഷണങ്ങൾ വിലയിരുത്താനോ ചികിത്സിക്കാനോ കഴിയില്ല. യോഗ്യനായ ഡോക്ടറെ സമീപിക്കുക.',
  bn: 'আমি শুধু সাধারণ মুখের স্বাস্থ্য তথ্য দিতে পারি; উপসর্গ মূল্যায়ন বা চিকিৎসা করতে পারি না। একজন যোগ্য চিকিৎসকের সঙ্গে কথা বলুন।',
  mr: 'मी फक्त तोंडाच्या आरोग्याची सामान्य माहिती देऊ शकतो; लक्षणांचे मूल्यमापन किंवा उपचार करू शकत नाही. पात्र डॉक्टरांशी बोला.',
};

export function sanitizeAssistantReply(text, language = 'en') {
  const reply = String(text || '').trim();
  return unsafeReplyPatterns.some((pattern) => pattern.test(reply))
    ? safeReplyByLanguage[language] || safeReplyByLanguage.en
    : reply;
}
