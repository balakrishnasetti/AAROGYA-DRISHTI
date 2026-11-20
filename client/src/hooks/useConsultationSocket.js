import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { getAuthorizationToken } from '../services/tokenStore.js';

function socketOrigin() {
  const configuredApiUrl = import.meta.env.VITE_API_BASE_URL;
  return configuredApiUrl
    ? new URL(configuredApiUrl, window.location.origin).origin
    : window.location.origin;
}

export default function useConsultationSocket(enabled = true) {
  const [socket, setSocket] = useState(null);
  const [accessToken, setAccessToken] = useState(() => getAuthorizationToken());

  useEffect(() => {
    const updateAccessToken = () => setAccessToken(getAuthorizationToken());
    window.addEventListener('aarogya:token-updated', updateAccessToken);
    return () => window.removeEventListener('aarogya:token-updated', updateAccessToken);
  }, []);

  useEffect(() => {
    if (!enabled || !accessToken) return undefined;
    const connection = io(socketOrigin(), {
      auth: { accessToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 10_000,
    });
    setSocket(connection);
    return () => {
      connection.disconnect();
      setSocket(null);
    };
  }, [accessToken, enabled]);
  return socket;
}
