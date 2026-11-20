const emergencyPatterns = {
  en: [
    /\bheavy bleeding\b|\bbleeding heavily\b|\bsevere bleeding\b|\ba lot of blood\b/i,
    /\bdifficulty breathing\b|\btrouble breathing\b|\bshortness of breath\b|\bcan't breathe\b|\bcannot breathe\b/i,
    /\bdifficulty swallowing\b|\btrouble swallowing\b|\bcannot swallow\b|\bcan't swallow\b/i,
  ],
  te: [
    /భారీ రక్తస్రావం|చాలా రక్తం|రక్తం ఎక్కువ/i,
    /శ్వాస తీసుకోవడం కష్టం|శ్వాస ఆడకపోవడం|శ్వాస సమస్య/i,
    /మింగడంలో ఇబ్బంది|మింగలేకపోవడం|మింగడం కష్టం/i,
  ],
  hi: [
    /बहुत खून|भारी रक्तस्राव|ज़्यादा खून|अधिक रक्तस्राव/i,
    /सांस लेने में कठिनाई|साँस लेने में दिक्कत|सांस नहीं ले पा रहा/i,
    /निगलने में कठिनाई|निगलने में परेशानी/i,
  ],
  ta: [
    /அதிக இரத்தப்போக்கு|நிறைய இரத்தம்/i,
    /மூச்சு விடுவதில் சிரமம்|மூச்சு திணறல்/i,
    /விழுங்குவதில் சிரமம்|விழுங்க முடியவில்லை/i,
  ],
  kn: [
    /ಹೆಚ್ಚು ರಕ್ತಸ್ರಾವ|ತೀವ್ರ ರಕ್ತಸ್ರಾವ/i,
    /ಉಸಿರಾಟದ ತೊಂದರೆ|ಉಸಿರಾಡಲು ಕಷ್ಟ/i,
    /ನುಂಗಲು ಕಷ್ಟ|ನುಂಗಲು ಆಗುತ್ತಿಲ್ಲ/i,
  ],
  ml: [
    /കനത്ത രക്തസ്രാവം|കൂടുതൽ രക്തം/i,
    /ശ്വസിക്കാൻ ബുദ്ധിമുട്ട്|ശ്വാസംമുട്ടൽ/i,
    /വിഴുങ്ങാൻ ബുദ്ധിമുട്ട്|വിഴുങ്ങാൻ കഴിയുന്നില്ല/i,
  ],
  bn: [
    /প্রচুর রক্তপাত|অনেক রক্ত/i,
    /শ্বাস নিতে কষ্ট|শ্বাসকষ্ট/i,
    /গিলতে অসুবিধা|গিলতে পারছি না/i,
  ],
  mr: [
    /खूप रक्तस्राव|जास्त रक्तस्राव/i,
    /श्वास घेण्यास त्रास|श्वास घेता येत नाही/i,
    /गिळण्यास त्रास|गिळता येत नाही/i,
  ],
};

export function hasEmergencyRedFlag(message, language = 'en') {
  const patterns = [
    ...(emergencyPatterns[language] || []),
    ...Object.entries(emergencyPatterns)
      .filter(([code]) => code !== language)
      .flatMap(([, languagePatterns]) => languagePatterns),
  ];
  return patterns.some((pattern) => pattern.test(String(message ?? '')));
}
