const EXPLICIT_LOGOUT_KEY = 'aarogya.explicitLogout';

export function isExplicitLogout() {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(EXPLICIT_LOGOUT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markExplicitLogout() {
  try {
    window.sessionStorage.setItem(EXPLICIT_LOGOUT_KEY, 'true');
  } catch {
    return false;
  }
  return true;
}

export function clearExplicitLogout() {
  try {
    window.sessionStorage.removeItem(EXPLICIT_LOGOUT_KEY);
  } catch {
    return false;
  }
  return true;
}
