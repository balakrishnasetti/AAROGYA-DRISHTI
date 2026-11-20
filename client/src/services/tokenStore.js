let authorizationToken = null;

export function setAuthorizationToken(token) {
  if (authorizationToken === token) return;
  authorizationToken = token;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aarogya:token-updated'));
  }
}

export function getAuthorizationToken() {
  return authorizationToken;
}
