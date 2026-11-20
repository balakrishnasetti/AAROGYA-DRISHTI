const emergencyPattern =
  /\b(bleed(?:ing)?|heavy blood|trouble breathing|difficulty breathing|cannot breathe|can't breathe|breathlessness|trouble swallowing|difficulty swallowing|unable to swallow)\b|రక్తస్రావం|శ్వాస తీసుకోవడంలో ఇబ్బంది|మింగడంలో ఇబ్బంది/i;

export function detectUrgentCall(details = '') {
  return emergencyPattern.test(details);
}
