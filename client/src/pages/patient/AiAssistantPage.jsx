import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import api, { getApiErrorMessage } from '../../services/api.js';
import { normalizeAssistantMarkdown } from '../../components/assistantSpeech.js';

export default function AiAssistantPage() {
  const { t, i18n } = useTranslation();
  const [sessionId, setSessionId] = useState('');
  const [turns, setTurns] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [consentRequired, setConsentRequired] = useState(false);
  const [error, setError] = useState('');
  const language = i18n.language.startsWith('te') ? 'te' : 'en';

  const handleLoadError = useCallback(
    (loadError) => {
      if (loadError.response?.data?.code === 'CONSENT_REQUIRED') {
        setConsentRequired(true);
        setError('');
        return;
      }
      setError(getApiErrorMessage(loadError, t('aiAssistant.loadError')));
    },
    [t],
  );

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError('');
    setConsentRequired(false);
    try {
      const response = await api.get('/ai/sessions');
      const activeSession = (response.data.data || []).find((item) => item.status === 'active');
      if (activeSession) {
        setSessionId(activeSession._id);
        setTurns(activeSession.recentTurns || []);
      } else {
        setSessionId('');
        setTurns([]);
      }
    } catch (loadError) {
      handleLoadError(loadError);
    } finally {
      setLoading(false);
    }
  }, [handleLoadError]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  async function startSession() {
    setBusy(true);
    setError('');
    try {
      const response = await api.post('/ai/sessions', { language });
      setSessionId(response.data.data._id);
      setTurns([]);
      setConsentRequired(false);
    } catch (startError) {
      handleLoadError(startError);
    } finally {
      setBusy(false);
    }
  }

  async function giveAiConsent() {
    setBusy(true);
    setError('');
    try {
      const profile = await api.get('/patients/me');
      const patientId = profile.data.details.id;
      await api.post(`/patients/${patientId}/consents`, {
        consentType: 'ai_processing',
        textVersion: 'governance-v1',
        language,
        granted: true,
      });
      setConsentRequired(false);
      await loadSession();
    } catch (consentError) {
      setError(getApiErrorMessage(consentError, t('aiAssistant.consentSaveError')));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const submittedMessage = message.trim();
    if (!sessionId || !submittedMessage || busy) return;

    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/ai/sessions/${sessionId}/message`, {
        message: submittedMessage,
        language,
      });
      const result = response.data.data;
      setTurns((current) => [
        ...current,
        { role: 'user', text: submittedMessage },
        { role: 'assistant', text: result.text, urgent: Boolean(result.urgent) },
      ]);
      setMessage('');
    } catch (sendError) {
      if (sendError.response?.data?.code === 'CONSENT_REQUIRED') {
        setConsentRequired(true);
      }
      setError(getApiErrorMessage(sendError, t('aiAssistant.sendError')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-4xl space-y-5">
      <header className="space-y-2 rounded-2xl bg-white p-5 sm:p-7">
        <p className="text-sm font-bold uppercase tracking-wide text-teal-800">
          {t('aiAssistant.eyebrow')}
        </p>
        <h1 className="text-3xl font-bold text-ink">{t('aiAssistant.title')}</h1>
        <p
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="note"
        >
          {t('aiAssistant.disclaimer')}
        </p>
      </header>

      {loading ? (
        <p className="rounded-2xl bg-white p-5 text-slate-700" role="status">
          {t('aiAssistant.loading')}
        </p>
      ) : null}

      {consentRequired ? (
        <aside
          className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5"
          aria-labelledby="ai-consent-title"
        >
          <h2 className="font-bold" id="ai-consent-title">
            {t('aiAssistant.consentRequired')}
          </h2>
          <p>{t('aiAssistant.consentDisclosure')}</p>
          <div className="flex flex-wrap items-center gap-4">
            <button
              className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white disabled:opacity-50"
              disabled={busy}
              onClick={giveAiConsent}
              type="button"
            >
              {busy ? t('aiAssistant.grantingConsent') : t('aiAssistant.grantConsent')}
            </button>
            <Link className="font-bold text-teal-900 underline" to="/patient/consent">
              {t('aiAssistant.reviewConsent')}
            </Link>
          </div>
        </aside>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900" role="alert">
          {error}
          <button className="ml-3 font-bold underline" onClick={loadSession} type="button">
            {t('screening.retryLoad')}
          </button>
        </p>
      ) : null}

      {!loading && !consentRequired && !sessionId ? (
        <div className="space-y-4 rounded-2xl bg-white p-5">
          <p className="text-slate-700">{t('aiAssistant.welcome')}</p>
          <button
            className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white disabled:opacity-50"
            disabled={busy}
            onClick={startSession}
            type="button"
          >
            {busy ? t('aiAssistant.loading') : t('screening.start')}
          </button>
        </div>
      ) : null}

      {sessionId ? (
        <div className="space-y-4 rounded-2xl bg-white p-5">
          <div aria-live="polite" className="space-y-4" role="log">
            {turns.length ? (
              turns.map((turn, index) => (
                <article
                  className={`rounded-xl p-4 ${turn.role === 'assistant' ? 'bg-teal-50 text-teal-950' : 'bg-slate-100 text-slate-950'}`}
                  key={`${turn.role}-${turn.createdAt || index}-${index}`}
                >
                  <h2 className="font-bold">
                    {turn.role === 'assistant' ? t('aiAssistant.assistant') : t('aiAssistant.you')}
                  </h2>
                  {turn.role === 'assistant' ? (
                    <div className="assistant-markdown mt-1 break-words">
                      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                        {normalizeAssistantMarkdown(turn.text)}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap">{turn.text}</p>
                  )}
                  {turn.urgent ? (
                    <a
                      className="mt-3 inline-flex min-h-touch items-center rounded-xl bg-rose-700 px-5 font-bold text-white"
                      href="tel:112"
                    >
                      {t('aiAssistant.call112')}
                    </a>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="rounded-xl bg-slate-50 p-4 text-slate-700">
                {t('aiAssistant.welcome')}
              </p>
            )}
          </div>

          <form className="space-y-3 border-t border-slate-200 pt-4" onSubmit={sendMessage}>
            <label className="grid gap-2 font-semibold" htmlFor="ai-assistant-message">
              {t('aiAssistant.messageLabel')}
              <textarea
                autoComplete="off"
                className="min-h-28 w-full rounded-xl border border-slate-300 bg-white p-3"
                disabled={busy}
                id="ai-assistant-message"
                maxLength={4000}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t('aiAssistant.placeholder')}
                value={message}
              />
            </label>
            <button
              className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white disabled:opacity-50"
              disabled={busy || !message.trim()}
              type="submit"
            >
              {busy ? t('aiAssistant.sending') : t('aiAssistant.send')}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
