import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import api from '../services/api.js';
import { getAuthorizationToken, setAuthorizationToken } from '../services/tokenStore.js';
import i18n from '../i18n/index.js';
import { AuthContext } from './authContext.js';
import {
  clearExplicitLogout,
  isExplicitLogout,
  markExplicitLogout,
} from './logoutState.js';

let refreshInProgress = null;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [flow, setFlowState] = useState(null);
  const [loading, setLoading] = useState(true);

  const clearAuth = useCallback(() => {
    setAuthorizationToken(null);
    setUser(null);
    setFlowState(null);
  }, []);

  const applySession = useCallback((details) => {
    clearExplicitLogout();
    setAuthorizationToken(details.accessToken);
    setUser(details.user);
    setFlowState(null);
    return details;
  }, []);

  const setFlow = useCallback((nextFlow) => {
    clearExplicitLogout();
    setAuthorizationToken(nextFlow.flowToken);
    setUser(null);
    setFlowState(nextFlow);
  }, []);

  useEffect(() => {
    let active = true;
    if (isExplicitLogout()) {
      clearAuth();
      setLoading(false);
      return () => {
        active = false;
      };
    }
    if (!refreshInProgress) {
      refreshInProgress = axios
        .post(`${import.meta.env.VITE_API_BASE_URL || 'https://aarogya-drishti-1-pgdm.onrender.com/api/v1'}/auth/refresh`, null, {
          withCredentials: true,
          timeout: 10000,
        })
        .finally(() => {
          refreshInProgress = null;
        });
    }
    refreshInProgress
      .then((response) => {
        if (!active || isExplicitLogout()) return;
        if (response.status === 204) clearAuth();
        else applySession(response.data.details);
      })
      .catch(() => {
        if (active) clearAuth();
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [applySession, clearAuth]);

  useEffect(() => {
    const onExpired = () => clearAuth();
    window.addEventListener('aarogya:auth-expired', onExpired);
    return () => window.removeEventListener('aarogya:auth-expired', onExpired);
  }, [clearAuth]);

  const loginStaff = useCallback(
    async (identifier, password, role) => {
      const response = await api.post('/auth/login', {
        identifier,
        password,
        ...(role ? { role } : {}),
      });
      const details = response.data.details;
      if (details.flow) {
        setFlow(details);
        return details;
      }
      return applySession(details);
    },
    [applySession, setFlow],
  );

  const loginPatient = useCallback(
    async (identifier, password) => {
      const response = await api.post('/auth/patient/login', { identifier, password });
      return applySession(response.data.details);
    },
    [applySession],
  );

  const requestPatientRegistrationOtp = useCallback(async (registration) => {
    const response = await api.post('/auth/patient/register/request-otp', registration);
    return response.data.details;
  }, []);

  const verifyPatientRegistrationOtp = useCallback(async (verification) => {
    const response = await api.post('/auth/patient/register/verify-otp', verification);
    return response.data.details;
  }, []);

  const completeFirstPasswordChange = useCallback(
    async (newPassword) => {
      await api.post('/auth/password/change/first', { newPassword });
      clearAuth();
    },
    [clearAuth],
  );

  const logout = useCallback(async () => {
    const accessToken = getAuthorizationToken();
    markExplicitLogout();
    clearAuth();
    try {
      await api.post('/auth/logout', null, {
        skipAuthRefresh: true,
        skipToast: true,
        ...(accessToken
          ? { headers: { Authorization: `Bearer ${accessToken}` } }
          : {}),
      });
      clearExplicitLogout();
    } catch {
      window.dispatchEvent(
        new CustomEvent('aarogya:toast', {
          detail: {
            message: i18n.t('app.logoutServerUnavailable'),
          },
        }),
      );
    }
  }, [clearAuth]);

  const value = useMemo(
    () => ({
      user,
      flow,
      loading,
      loginStaff,
      loginPatient,
      requestPatientRegistrationOtp,
      verifyPatientRegistrationOtp,
      completeFirstPasswordChange,
      logout,
      clearAuth,
    }),
    [
      user,
      flow,
      loading,
      loginStaff,
      loginPatient,
      requestPatientRegistrationOtp,
      verifyPatientRegistrationOtp,
      completeFirstPasswordChange,
      logout,
      clearAuth,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
