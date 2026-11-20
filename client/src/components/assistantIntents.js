const intentPatterns = [
  {
    type: 'explain_report',
    patterns: [
      /\bexplain\b.*\b(last|latest|my)\s+report\b/i,
      /\bexplain\b.*\breport\b/i,
      /(?:నా|నా చివరి|చివరి) రిపోర్ట్.*(?:వివరించ|అర్థం)/i,
      /\bnaa\b.*\breport\b.*\b(simple|explain|artham|vivarinch)/i,
      /\breport\b.*\b(simple ga|artham ayyela|vivarinchu)/i,
    ],
  },
  {
    type: 'download_report',
    patterns: [
      /\bdownload\b.*\breport\b|\breport\b.*\bdownload\b/i,
      /(?:నా )?రిపోర్ట్.*(?:డౌన్‌లోడ్|డౌన్లోడ్|సేవ్)/i,
      /\bnaa\b.*\breport\b.*\b(download|save)\b/i,
      /\breport\b.*\b(download|save)\s+cheyy/i,
    ],
  },
  {
    type: 'show_results',
    patterns: [
      /\b(show|open|view|see)\b.*\b(my )?(results?|reports?)\b/i,
      /\bmy (latest )?report\b/i,
      /(?:నా|చివరి) (?:రిపోర్ట్|ఫలితాలు).*(?:చూపించ|చూడ)/i,
      /\bnaa\b.*\b(report|results?)\b.*\b(chupinchu|chupin|chudali|choodu)\b/i,
      /\b(report|results?)\b.*\b(chupinchu|chudali|choodu)\b/i,
    ],
  },
  {
    type: 'start_screening',
    patterns: [
      /\b(start|begin|new)\b.*\b(oral )?(screening|scan)\b/i,
      /\b(upload|take|add)\b.*\b(a |my )?(oral )?(photo|picture|image)\b/i,
      /\bnew photo\b|\bupload photo\b/i,
      /(?:కొత్త )?(?:ఓరల్ )?(?:స్క్రీనింగ్|పరీక్ష|స్కాన్).*(?:ప్రారంభించ|మొదలుపెట్టు|చేయ)/i,
      /(?:ఫోటో|చిత్రం).*(?:అప్‌లోడ్|అప్‌లోడు|తీయాలి)/i,
      /\b(naa )?(screening|photo)\b.*\b(start|upload|cheyyali|prarambhinchu)\b/i,
      /\bphoto upload cheyyali\b|\bscreening start cheyy/i,
    ],
  },
  {
    type: 'find_hospital',
    patterns: [
      /\b(find|show|open|locate)\b.*\b(hospital|clinic)\b/i,
      /\bnearby hospital\b|\bhospital near me\b/i,
      /(?:హాస్పిటల్|ఆసుపత్రి).*(?:ఎక్కడ|కనుగొను|చూపించ)/i,
      /\b(hospital|aasupatri)\b.*\b(ekkada|chupinchu|kanukoni|find)\b/i,
      /\bnearby\b.*\b(hospital|clinic)\b/i,
    ],
  },
  {
    type: 'call_doctor',
    patterns: [
      /\b(call|contact|talk to)\b.*\b(a )?(doctor|clinician)\b/i,
      /\bdoctor\b.*\b(call|phone|contact)\b/i,
      /(?:వైద్యుడు|డాక్టర్).*(?:కాల్|మాట్లాడు|సంప్రదించ)/i,
      /\bdoctor ni\b.*\b(call|contact|matladali)\b/i,
      /\bdoctor ki call\b|\bdoctor tho matladali\b/i,
    ],
  },
  {
    type: 'book_appointment',
    patterns: [
      /\b(book|schedule|make)\b.*\b(doctor )?(an )?appointment\b/i,
      /\bappointment\b.*\b(book|schedule|cheyy)\b/i,
      /(?:అపాయింట్‌మెంట్|అపాయింట్మెంట్).*(?:బుక్|చేయ)/i,
      /\bappointment\b.*\b(book|cheyyali|pettukovali)\b/i,
      /\bdoctor ni kalavaali\b|\bappointment book cheyy/i,
    ],
  },
  {
    type: 'change_language',
    patterns: [
      /\b(change|switch)\b.*\blanguage\b/i,
      /\b(switch|change|speak|talk)\b.*\b(telugu|telegu|english)\b/i,
      /(?:తెలుగు|ఇంగ్లీష్).*(?:మాట్లాడు|మాట్లాడండి|భాష)/i,
      /\b(telugu|తెలుగు)\b.*\b(language|లో మాట్లాడు|లో మాట్లాడండి)\b/i,
      /\b(english|ఇంగ్లీష్)\b.*\b(language|లో మాట్లాడు|లో మాట్లాడండి)\b/i,
      /భాష.*(?:మార్చు|మార్చండి)/i,
      /\bbhaasha\b.*\b(march|change)\b/i,
      /\b(telugu|telegu)\b.*\blo\b.*\b(matladu|maatlaadu)\b/i,
      /\benglish\b.*\blo\b.*\b(matladu|maatlaadu)\b/i,
    ],
  },
  {
    type: 'help',
    patterns: [
      /^\s*(help|what can i say|commands|options)\s*[?.!]*$/i,
      /^\s*(సహాయం|ఏమి చెప్పాలి|ఏం చేయగలవు)\s*[?.!]*$/i,
      /^\s*(help|sahayam|emi cheppali)\s*[?.!]*$/i,
    ],
  },
];

export function detectAssistantIntent(value) {
  const message = String(value || '').trim();
  if (!message) return { type: 'unclear' };

  for (const intent of intentPatterns) {
    if (!intent.patterns.some((pattern) => pattern.test(message))) continue;
    if (intent.type !== 'change_language') return { type: intent.type };
    if (/\b(telugu|telegu)\b|తెలుగు/i.test(message)) {
      return { type: 'change_language', language: 'te' };
    }
    if (/\benglish\b|ఇంగ్లీష్/i.test(message)) {
      return { type: 'change_language', language: 'en' };
    }
    return { type: 'change_language', language: null };
  }

  if (/\b(report|screening|photo|hospital|appointment|doctor)\b|రిపోర్ట్|స్క్రీనింగ్|ఫోటో|హాస్పిటల్|డాక్టర్/i.test(message)) {
    return { type: 'clarify' };
  }
  return { type: 'question' };
}
