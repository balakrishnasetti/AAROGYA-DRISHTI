export const LOGIN_METHODS = Object.freeze(['password', 'mobile', 'abha', 'aadhaar']);

const STORAGE_KEY = 'aarogya:last-login-method';

export function getLastLoginMethod(storage) {
  try {
    const method = (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY);
    return LOGIN_METHODS.includes(method) ? method : 'mobile';
  } catch {
    return 'mobile';
  }
}

export function saveLastLoginMethod(method, storage) {
  if (!LOGIN_METHODS.includes(method)) return;
  try {
    (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, method);
  } catch {
    // Login preference is optional; private browsing may block local storage.
  }
}
