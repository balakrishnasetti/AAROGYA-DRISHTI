import axios from 'axios';
import i18n from '../i18n/index.js';
import { getAuthorizationToken, setAuthorizationToken } from './tokenStore.js';

const baseURL = "https://aarogya-drishti-1-pgdm.onrender.com/api/v1" ;
const api = axios.create({
  baseURL,
  timeout: 10000,
  withCredentials: true,
});
const refreshApi = axios.create({ baseURL, timeout: 10000, withCredentials: true });

export function getApiErrorMessage(error, fallback) {
  const response = error.response?.data;
  const serverMessage = response?.message;
  const code = response?.code;
  return code
    ? i18n.t(`errors.${code}`, { defaultValue: serverMessage || fallback })
    : serverMessage || fallback;
}

api.interceptors.request.use((config) => {
  if (config.url?.includes('/auth/')) config.skipToast = true;
  const token = getAuthorizationToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (
      error.response?.status === 401 &&
      config &&
      !config._retried &&
      !config.skipAuthRefresh &&
      (!config.url?.includes('/auth/') || config.url?.includes('/auth/logout'))
    ) {
      config._retried = true;
      try {
        const response = await refreshApi.post('/auth/refresh');
        if (response.status === 204) {
          setAuthorizationToken(null);
          window.dispatchEvent(new CustomEvent('aarogya:auth-expired'));
          return Promise.reject(error);
        }
        const { accessToken } = response.data.details;
        setAuthorizationToken(accessToken);
        config.headers.Authorization = `Bearer ${accessToken}`;
        return api(config);
      } catch {
        setAuthorizationToken(null);
        window.dispatchEvent(new CustomEvent('aarogya:auth-expired'));
      }
    }

    const code = error.response?.data?.code;
    const translationKey = code ? `errors.${code}` : 'errors.requestFailed';
    const message = i18n.t(translationKey, {
      defaultValue: i18n.t('errors.requestFailed'),
    });

    if (typeof window !== 'undefined' && !config?.skipToast) {
      window.dispatchEvent(new CustomEvent('aarogya:toast', { detail: { message } }));
    }
    return Promise.reject(error);
  },
);

export default api;
