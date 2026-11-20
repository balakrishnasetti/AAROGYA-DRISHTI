const emergencyPatterns = [
  /\b(emergency|urgent emergency|can't breathe|cannot breathe|difficulty breathing|trouble breathing|severe bleeding|heavy bleeding|bleeding heavily)\b/i,
  /శ్వాస తీసుకోవడం కష్టం|శ్వాస ఆడకపోవడం|తీవ్ర రక్తస్రావం|భారీ రక్తస్రావం|అత్యవసర/i,
  /\b(shwasa|shvaasa)\b.*\b(kastam|ibbandi|aadatledu)\b|\b(heavy|severe) raktasraavam\b/i,
];

const clinicianPatterns = [
  /\b(bleeding|blood from my mouth|non.?healing ulcer|ulcer that (won't|doesn't) heal|ulcer.{0,30}(?:is not|isn't|doesn't) healing|sore that (won't|doesn't) heal|mouth lump|lump in my mouth|difficulty swallowing|trouble swallowing|can't swallow)\b/i,
  /రక్తస్రావం|రక్తం వస్తోంది|నయం కాని పుండు|మానని పుండు|నోటి పుండు.*(?:నయం కావడం లేదు|మానడం లేదు)|నోటిలో గడ్డ|మింగడంలో ఇబ్బంది|మింగలేక/i,
  /\b(raktam|raktasraavam)\b|\b(nayam kani|manani)\s+(pundu|gaayam)\b|\b(notilo gadda|mingadam kastam|shwasa kastam)\b/i,
];

const safetyReplies = {
  en: {
    emergency:
      'These symptoms may need emergency care. Call 112 now for breathing difficulty, severe bleeding, or immediate danger. Otherwise, contact a clinician promptly. I can open appointments or hospitals.',
    clinician:
      'Bleeding, a non-healing mouth ulcer, a lump, or difficulty swallowing should be checked by a qualified clinician promptly. I can open appointments or hospitals. This assistant cannot diagnose.',
  },
  te: {
    emergency:
      'ఈ లక్షణాలకు అత్యవసర చికిత్స అవసరమవచ్చు. శ్వాస ఇబ్బంది, తీవ్రమైన రక్తస్రావం లేదా తక్షణ ప్రమాదం ఉంటే ఇప్పుడే 112కు కాల్ చేయండి. లేకపోతే త్వరగా వైద్యుడిని సంప్రదించండి. అపాయింట్‌మెంట్ లేదా ఆసుపత్రుల పేజీని తెరవగలను.',
    clinician:
      'రక్తస్రావం, మానని నోటి పుండు, గడ్డ లేదా మింగడంలో ఇబ్బంది ఉంటే త్వరగా అర్హత కలిగిన వైద్యుడిని సంప్రదించండి. అపాయింట్‌మెంట్ లేదా ఆసుపత్రుల పేజీని తెరవగలను. ఈ సహాయకుడు నిర్ధారణ చేయలేడు.',
  },
};

export function getAssistantSafetyReply(value, preferredLanguage = 'en') {
  const message = String(value || '');
  const emergency = emergencyPatterns.some((pattern) => pattern.test(message));
  if (!emergency && !clinicianPatterns.some((pattern) => pattern.test(message))) return null;

  const language =
    /[\u0c00-\u0c7f]/.test(message) ||
    /\b(?:naa|notilo|undi|vastondi|raktam|pundu|mingadam|kastam|shwasa)\b/i.test(message) ||
    preferredLanguage === 'te'
      ? 'te'
      : 'en';
  return {
    emergency,
    text: safetyReplies[language][emergency ? 'emergency' : 'clinician'],
    actions: [
      { type: 'navigate', href: '/patient/appointments' },
      { type: 'navigate', href: '/patient/hospitals' },
      ...(emergency ? [{ type: 'call', href: 'tel:112' }] : []),
    ],
  };
}
