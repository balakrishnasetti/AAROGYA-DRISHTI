import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import rehypeSanitize from 'rehype-sanitize';
import api from '../services/api.js';
import { downloadScreeningReport } from '../services/reportDownloads.js';
import { useAuth } from '../store/useAuth.js';
import { detectAssistantIntent } from './assistantIntents.js';
import { assistantLanguages, assistantText, detectAssistantLanguage } from './assistantLocales.js';
import { getAssistantSafetyReply } from './assistantSafety.js';
import {
  getSpeechPreview,
  markdownToSpeechText,
  normalizeAssistantMarkdown,
  speechErrorKey,
} from './assistantSpeech.js';

const speechLocales = Object.fromEntries(
  assistantLanguages.map((item) => [item.code, item.speech]),
);

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function latestReportFromSessions(sessions = []) {
  return sessions
    .flatMap((session) =>
      (session.reports || []).map((report) => ({
        ...report,
        id: report.id || report._id,
        screeningSessionId: report.screeningSessionId || session._id,
      })),
    )
    .sort((left, right) => new Date(right.generatedAt) - new Date(left.generatedAt))[0];
}

export default function FloatingAssistant() {
  const location = useLocation();

  if (location.pathname === '/demo/patient-cases') return null;

  return <FloatingAssistantWidget />;
}

function FloatingAssistantWidget() {
  const { user, loading: authLoading } = useAuth();
  const { i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem('aarogya.assistant.language');
    const browserLanguage = navigator.language?.slice(0, 2);
    const preferred = assistantLanguages.some((item) => item.code === saved)
      ? saved
      : browserLanguage;
    return assistantLanguages.some((item) => item.code === preferred) ? preferred : 'en';
  });
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [turns, setTurns] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [pendingAction, setPendingAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const [speechState, setSpeechState] = useState('idle');
  const [error, setError] = useState('');
  const [consentRequired, setConsentRequired] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(
    () => localStorage.getItem('aarogya.assistant.voiceReplies') !== 'false',
  );
  const [speechNote, setSpeechNote] = useState('');
  const recognitionRef = useRef(null);
  const recognitionModeRef = useRef(null);
  const recognitionFailedRef = useRef(false);
  const messagesEndRef = useRef(null);
  const panelRef = useRef(null);
  const voiceRepliesRef = useRef(voiceReplies);
  const wakeTriggeredRef = useRef(false);

  const words = useMemo(() => (key) => assistantText(language, key), [language]);
  const isPatient = user?.role === 'patient';
  const sessionStorageKey = user?.id ? `aarogya.assistant.session.${user.id}` : '';

  useEffect(() => {
    if (location.state?.openAssistant) {
      setOpen(true);
    }
  }, [location.state]);

  useEffect(() => {
    setTurns([]);
    setSessionId('');
    setPendingAction(null);
    setConsentRequired(false);
  }, [user?.id]);

  useEffect(() => {
    if (!isPatient || !sessionStorageKey) return undefined;
    const savedSessionId = sessionStorage.getItem(sessionStorageKey);
    if (!savedSessionId) return undefined;
    let active = true;
    api
      .get(`/assistant/${savedSessionId}`)
      .then((response) => {
        if (!active) return;
        const saved = response.data.data;
        setSessionId(saved.sessionId);
        setTurns(saved.turns || []);
        setPendingAction(saved.pendingAction || null);
        if (assistantLanguages.some((item) => item.code === saved.language)) {
          setLanguage(saved.language);
        }
      })
      .catch((requestError) => {
        if (!active) return;
        sessionStorage.removeItem(sessionStorageKey);
        if (requestError.response?.data?.code === 'CONSENT_REQUIRED') setConsentRequired(true);
      });
    return () => {
      active = false;
    };
  }, [isPatient, sessionStorageKey]);

  useEffect(() => {
    localStorage.setItem('aarogya.assistant.language', language);
  }, [language]);

  useEffect(() => {
    voiceRepliesRef.current = voiceReplies;
    localStorage.setItem('aarogya.assistant.voiceReplies', String(voiceReplies));
    if (!voiceReplies && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [voiceReplies]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, pendingAction, open]);

  const stopRecognition = useCallback(() => {
    const activeRecognition = recognitionRef.current;
    if (activeRecognition) activeRecognition.stop();
    else recognitionModeRef.current = null;
    setSpeechState('idle');
  }, []);

  const startRecognition = useCallback((mode) => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setError(words('speechUnavailable'));
      setSpeechState('error');
      if (mode === 'wake') setWakeEnabled(false);
      return;
    }
    if (!window.isSecureContext) {
      setError(words('secureContextRequired'));
      setSpeechState('error');
      if (mode === 'wake') setWakeEnabled(false);
      return;
    }
    if (recognitionRef.current) {
      setError(words('wakeRestart'));
      if (mode === 'wake') setWakeEnabled(false);
      return;
    }
    setError('');
    setSpeechState('requesting');
    let recognition;
    try {
      recognition = new SpeechRecognition();
    } catch (startError) {
      setError(
        startError?.name === 'NotAllowedError'
          ? words('micDenied')
          : words('speechError'),
      );
      setSpeechState('error');
      if (mode === 'wake') setWakeEnabled(false);
      return;
    }
    recognitionRef.current = recognition;
    recognitionModeRef.current = mode;
    recognitionFailedRef.current = false;
    recognition.lang = speechLocales[language] || 'en-IN';
    recognition.continuous = mode === 'wake';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (recognitionRef.current === recognition) setSpeechState('listening');
    };
    recognition.onresult = (event) => {
      const results = Array.from(event.results || []);
      const transcript = results.map((result) => result[0]?.transcript || '').join(' ').trim();
      if (mode === 'wake') {
        const wakeMatch = transcript.match(/\bhey\s+(?:aarogya|arogya|aarogy|arogy)\b/i);
        if (wakeMatch) {
          wakeTriggeredRef.current = true;
          setText(transcript.slice(wakeMatch.index + wakeMatch[0].length).trim());
          setOpen(true);
          recognition.stop();
        }
        return;
      }
      if (transcript) setText(transcript);
    };
    recognition.onerror = (event) => {
      setError(words(speechErrorKey(event.error)));
      setSpeechState('error');
      recognitionFailedRef.current = true;
      if (mode === 'wake') {
        setWakeEnabled(false);
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      const endedMode = recognitionModeRef.current;
      recognitionModeRef.current = null;
      const recognitionFailed = recognitionFailedRef.current;
      recognitionFailedRef.current = false;
      setSpeechState((current) => (current === 'error' ? current : 'idle'));
      if (endedMode === 'wake' && wakeTriggeredRef.current) {
        wakeTriggeredRef.current = false;
        return;
      }
      if (endedMode === 'wake' && wakeEnabled && !open && !document.hidden && !recognitionFailed) {
        setWakeEnabled(false);
        setError(words('wakeRestart'));
      }
    };
    try {
      recognition.start();
    } catch (startError) {
      recognitionRef.current = null;
      recognitionModeRef.current = null;
      setError(
        startError?.name === 'NotAllowedError'
          ? words('micDenied')
          : words('speechError'),
      );
      setSpeechState('error');
      if (mode === 'wake') setWakeEnabled(false);
    }
  }, [language, open, wakeEnabled, words]);

  const startListening = useCallback(() => {
    if (!isPatient || busy || consentRequired) return;
    if (recognitionModeRef.current === 'wake') {
      stopRecognition();
      setError(words('wakeRestart'));
      return;
    }
    startRecognition('push');
  }, [busy, consentRequired, isPatient, startRecognition, stopRecognition, words]);

  const toggleWakePhrase = useCallback((enabled) => {
    setError('');
    if (!enabled) {
      setWakeEnabled(false);
      if (recognitionModeRef.current === 'wake') stopRecognition();
      return;
    }
    if (!isPatient) {
      setError(words('wakeRestart'));
      return;
    }
    if (!getSpeechRecognition()) {
      setError(words('speechUnavailable'));
      setSpeechState('error');
      return;
    }
    if (!window.isSecureContext) {
      setError(words('secureContextRequired'));
      setSpeechState('error');
      return;
    }
    setWakeEnabled(true);
    if (!open) {
      startRecognition('wake');
    } else if (recognitionModeRef.current === 'wake') {
      stopRecognition();
    }
  }, [isPatient, open, startRecognition, stopRecognition, words]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    [],
  );

  useEffect(() => {
    const stopWhenHidden = () => {
      if (!document.hidden) return;
      stopRecognition();
      setWakeEnabled(false);
      window.speechSynthesis?.cancel();
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => document.removeEventListener('visibilitychange', stopWhenHidden);
  }, [stopRecognition]);

  useEffect(() => {
    if (open && window.matchMedia('(max-width: 1023px)').matches) {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [open]);

  const speak = useCallback(
    (spokenText, readMore = false, speechLanguage = language) => {
      if (!voiceRepliesRef.current || !('speechSynthesis' in window) || !spokenText) return;
      const cleaned = markdownToSpeechText(spokenText);
      if (!cleaned) return;
      const matchingVoice = window.speechSynthesis
        .getVoices()
        .find((voice) => voice.lang.toLowerCase().startsWith(speechLanguage));
      if (speechLanguage === 'te' && !matchingVoice) {
        setSpeechNote(words('noTeluguVoice'));
        setSpeechState('idle');
        return;
      }
      setSpeechNote('');
      window.speechSynthesis.cancel();
      const preview = getSpeechPreview(cleaned);
      const utterance = new SpeechSynthesisUtterance(
        readMore ? preview.remainder || preview.text : preview.text,
      );
      utterance.lang = speechLocales[speechLanguage] || 'en-IN';
      if (matchingVoice) utterance.voice = matchingVoice;
      utterance.onstart = () => setSpeechState('speaking');
      utterance.onend = () => setSpeechState('idle');
      utterance.onerror = () => setSpeechState('idle');
      window.speechSynthesis.speak(utterance);
    },
    [language, words],
  );

  const sendToAssistant = useCallback(
    async (message, displayText, requestLanguage, userAlreadyAdded = false) => {
      if (!userAlreadyAdded) {
        setTurns((current) => [...current, { role: 'user', text: displayText }]);
      }
      setText('');
      setError('');
      setBusy(true);
      setSpeechState('processing');
      try {
        const response = await api.post(
          '/assistant',
          {
            ...(sessionId ? { sessionId } : {}),
            message,
            language: requestLanguage,
          },
          { timeout: 25000 },
        );
        const result = response.data.data;
        setSessionId(result.sessionId);
        sessionStorage.setItem(sessionStorageKey, result.sessionId);
        setConsentRequired(false);
        setPendingAction(result.pendingAction || null);
        setTurns((current) => [
          ...current,
          {
            role: 'assistant',
            text: result.text,
            action: result.action || null,
            urgent: Boolean(result.urgent),
          },
        ]);
        if (voiceRepliesRef.current) speak(result.text);
        else setSpeechState('idle');
      } catch (requestError) {
        const code = requestError.response?.data?.code;
        if (code === 'CONSENT_REQUIRED') {
          setConsentRequired(true);
          setSessionId('');
          setPendingAction(null);
          setTurns([]);
          sessionStorage.removeItem(sessionStorageKey);
        }
        if (code === 'ASSISTANT_ACTION_PENDING') setError(words('pending'));
        else if (code === 'ASSISTANT_NOT_CONFIGURED') setError(words('notConfigured'));
        else if (!navigator.onLine) setError(words('offline'));
        else setError(words('apiError'));
        setSpeechState('error');
      } finally {
        setBusy(false);
      }
    },
    [sessionId, sessionStorageKey, speak, words],
  );

  const replyLocally = useCallback(
    (userText, reply, actions = [], urgent = false, speechLanguage = language) => {
      setText('');
      setError('');
      setTurns((current) => [
        ...current,
        ...(userText ? [{ role: 'user', text: userText }] : []),
        { role: 'assistant', text: reply, actions, urgent },
      ]);
      if (voiceRepliesRef.current) speak(reply, false, speechLanguage);
      else setSpeechState('idle');
    },
    [language, speak],
  );

  const sendText = useCallback(
    async (value) => {
      const message = value.trim();
      if (!message || busy || !isPatient) return;
      if (!navigator.onLine) {
        setError(words('offline'));
        setSpeechState('error');
        return;
      }

      const requestLanguage = detectAssistantLanguage(message, language);
      const safetyReply = getAssistantSafetyReply(message, requestLanguage);
      if (safetyReply) {
        setLanguage(requestLanguage);
        replyLocally(message, safetyReply.text, safetyReply.actions, safetyReply.emergency);
        return;
      }

      const intent = detectAssistantIntent(message);
      if (intent.type === 'question') {
        setLanguage(requestLanguage);
        await sendToAssistant(message, message, requestLanguage);
        return;
      }
      if (intent.type === 'help') {
        replyLocally(message, words('intentHelp'));
        return;
      }
      if (intent.type === 'clarify' || intent.type === 'unclear') {
        replyLocally(message, words('intentClarify'));
        return;
      }
      if (intent.type === 'change_language') {
        if (!intent.language) {
          replyLocally(message, words('intentLanguageChange'));
          return;
        }
        setLanguage(intent.language);
        await i18n.changeLanguage(intent.language);
        replyLocally(
          message,
          assistantText(intent.language, 'intentChangedLanguage'),
          [],
          false,
          intent.language,
        );
        return;
      }
      if (intent.type === 'explain_report' || intent.type === 'download_report') {
        setTurns((current) => [...current, { role: 'user', text: message }]);
        setText('');
        setError('');
        setBusy(true);
        setSpeechState('processing');
        try {
          const response = await api.get('/patients/me/screenings');
          const report = latestReportFromSessions(response.data.details || []);
          if (!report) {
            replyLocally('', words('noReports'));
            return;
          }
          if (intent.type === 'download_report') {
            await downloadScreeningReport(report);
            replyLocally('', words('intentDownloadReport'));
            return;
          }
          if (
            report.analysisStatus !== 'completed' ||
            (!report.predictedClass && !report.finding)
          ) {
            replyLocally('', words('noFindingToExplain'));
            return;
          }
          const reportFacts = [
            `Date: ${new Date(report.generatedAt).toLocaleDateString(requestLanguage)}`,
            `Recorded finding: ${report.predictedClass || report.finding}`,
            report.confidenceCalibrated && Number.isFinite(report.confidence)
              ? `Recorded confidence: ${Math.round(report.confidence * 100)}%`
              : '',
            `Recorded risk category: ${report.riskCategory}`,
            `Saved explanation: ${report.explanation}`,
            `Recorded next steps: ${(report.recommendedNextSteps || []).join('; ')}`,
            'Explain only these saved details in simple words. Do not add a diagnosis or claim that the patient is safe.',
          ]
            .filter(Boolean)
            .join('\n');
          const prompt =
            requestLanguage === 'te'
              ? `దయచేసి నా తాజా స్క్రీనింగ్ రిపోర్ట్‌ను సరళమైన తెలుగులో వివరించండి. క్రింది సేవ్ చేసిన వివరాలనే ఉపయోగించండి; నిర్ధారణ చేయవద్దు లేదా నేను సురక్షితంగా ఉన్నానని చెప్పవద్దు.\n${reportFacts}`
              : `Please explain my latest screening report in simple English using only these saved details. Do not diagnose or say that I am safe.\n${reportFacts}`;
          await sendToAssistant(prompt, message, requestLanguage, true);
        } catch {
          replyLocally(
            '',
            words(intent.type === 'download_report' ? 'downloadError' : 'apiError'),
          );
          setSpeechState('error');
        } finally {
          setBusy(false);
        }
        return;
      }

      const destinations = {
        start_screening: ['/patient#patient-screening', 'intentStartScreening'],
        show_results: ['/patient#patient-results', 'intentShowResults'],
        book_appointment: ['/patient/appointments', 'intentAppointment'],
        call_doctor: ['/patient/appointments', 'intentCallDoctor'],
        find_hospital: ['/patient/hospitals', 'intentHospitals'],
      };
      const destination = destinations[intent.type];
      if (destination) {
        replyLocally(message, words(destination[1]));
        navigate(destination[0]);
      }
    },
    [
      busy,
      i18n,
      isPatient,
      language,
      navigate,
      replyLocally,
      sendToAssistant,
      words,
    ],
  );

  async function confirmAction(confirmed) {
    if (!sessionId || !pendingAction || busy) return;
    setBusy(true);
    setSpeechState('thinking');
    setError('');
    try {
      const response = await api.post(`/assistant/${sessionId}/confirm`, {
        actionId: pendingAction.id,
        confirmed,
      });
      const result = response.data.data;
      setPendingAction(null);
      setTurns((current) => [
        ...current,
        {
          role: 'assistant',
          text: result.text,
          action: result.action || null,
        },
      ]);
      if (voiceReplies) speak(result.text);
      else setSpeechState('idle');
    } catch (requestError) {
      if (requestError.response?.data?.code === 'CONSENT_REQUIRED') {
        setConsentRequired(true);
        setSessionId('');
        setPendingAction(null);
        setTurns([]);
        sessionStorage.removeItem(sessionStorageKey);
      }
      if (requestError.response?.data?.code === 'ASSISTANT_ACTION_EXPIRED') setPendingAction(null);
      setError(words('apiError'));
      setSpeechState('idle');
    } finally {
      setBusy(false);
    }
  }

  function runAction(action) {
    if (!action) return;
    if (action.type === 'navigate') {
      navigate(action.href);
    } else if (action.type === 'open_map_search') {
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(action.query)}`,
        '_blank',
        'noopener,noreferrer',
      );
    } else if (action.type === 'call' && action.href === 'tel:112') {
      window.location.href = 'tel:112';
    }
  }

  const pendingTitle =
    pendingAction?.name === 'book_appointment'
      ? `${words('book')} ${pendingAction.input.doctor} · ${pendingAction.input.date} · ${pendingAction.input.time}`
      : pendingAction?.name === 'cancel_or_reschedule_appointment'
        ? `${pendingAction.input.operation === 'cancel' ? words('cancel') : words('reschedule')}${pendingAction.summary ? ` · ${pendingAction.summary}` : ''}`
        : pendingAction?.input.title || words('reminder');

  function closePanel() {
    const activeMode = recognitionModeRef.current;
    stopRecognition();
    window.speechSynthesis?.cancel();
    setOpen(false);
    if (activeMode && wakeEnabled) setWakeEnabled(false);
    else if (wakeEnabled && isPatient && !document.hidden) startRecognition('wake');
  }

  function openPanel() {
    if (recognitionModeRef.current === 'wake') wakeTriggeredRef.current = true;
    if (recognitionRef.current) stopRecognition();
    setOpen(true);
    setError('');
  }

  return (
    <aside
      className={
        open
          ? 'mt-4 w-full shrink-0 p-3 lg:sticky lg:top-4 lg:mt-0 lg:w-[min(25rem,32vw)]'
          : 'fixed bottom-4 right-4 z-50'
      }
    >
      {open ? (
        <section
          ref={panelRef}
          aria-label={words('title')}
          aria-modal="false"
          className="flex h-[min(70vh,42rem)] min-h-[24rem] w-full flex-col overflow-hidden rounded-3xl border border-teal-200 bg-white shadow-2xl lg:h-[calc(100vh-2rem)] lg:max-h-[52rem]"
          role="dialog"
        >
          <header className="assistant-header flex items-start justify-between gap-3 bg-teal-900 p-4 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <div aria-hidden="true" className={`assistant-orb assistant-orb-${speechState}`}>
                <span />
                <i />
                <b />
              </div>
              <div>
                <h2 className="text-lg font-bold">{words('title')}</h2>
                <p
                  aria-live="polite"
                  className="mt-1 flex items-center gap-2 text-sm text-teal-100"
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2.5 w-2.5 rounded-full ${speechState === 'listening' ? 'animate-ping bg-rose-300' : speechState === 'processing' || speechState === 'requesting' ? 'animate-pulse bg-amber-300' : speechState === 'speaking' ? 'animate-pulse bg-sky-300' : speechState === 'error' ? 'bg-rose-300' : 'bg-emerald-300'}`}
                  />
                  {speechState === 'thinking' ? words('processing') : words(speechState)}
                </p>
              </div>
            </div>
            {speechState === 'speaking' ? (
              <button
                className="min-h-touch rounded-lg border border-teal-500 px-2 text-sm"
                onClick={() => {
                  window.speechSynthesis?.cancel();
                  setSpeechState('idle');
                }}
                type="button"
              >
                {words('stopSpeaking')}
              </button>
            ) : null}
            <button
              aria-label={words('close')}
              className="min-h-touch min-w-touch rounded-lg px-3 text-xl"
              onClick={closePanel}
              type="button"
            >
              ×
            </button>
          </header>

          <div className="space-y-3 overflow-y-auto p-4" aria-live="polite">
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              {words('disclaimer')}
            </p>
            {!authLoading && !isPatient ? (
              <div className="rounded-xl bg-slate-50 p-4 text-sm">
                <p>{words('signedOut')}</p>
                <Link
                  className="mt-3 inline-flex min-h-touch items-center rounded-xl bg-teal-800 px-4 font-semibold text-white"
                  to={user ? '/forbidden' : '/login'}
                >
                  {words('signIn')}
                </Link>
              </div>
            ) : null}
            {isPatient && consentRequired ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                <p>{words('consent')}</p>
                <Link
                  className="mt-3 inline-flex min-h-touch items-center rounded-xl bg-teal-800 px-4 font-semibold text-white"
                  to="/patient/consent"
                >
                  {words('consentLink')}
                </Link>
              </div>
            ) : null}
            {isPatient && !turns.length && !consentRequired ? (
              <p className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-800">
                {words('greeting')}
              </p>
            ) : null}
            {turns.map((turn, index) => (
              <article
                className={`max-w-[95%] rounded-2xl p-3 text-sm ${turn.role === 'user' ? 'ml-auto bg-teal-50 text-teal-950' : 'bg-slate-100 text-slate-950'}`}
                key={`${turn.role}-${index}`}
              >
                {turn.role === 'assistant' ? (
                  <div className="assistant-markdown break-words">
                    <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                      {normalizeAssistantMarkdown(turn.text)}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                )}
                {turn.urgent ? (
                  <a
                    className="mt-2 inline-flex min-h-touch items-center rounded-xl bg-rose-700 px-4 font-bold text-white"
                    href="tel:112"
                  >
                    {words('call112')}
                  </a>
                ) : null}
                {turn.action ? (
                  <button
                    className="mt-2 inline-flex min-h-touch items-center rounded-xl bg-teal-800 px-4 font-semibold text-white"
                    onClick={() => runAction(turn.action)}
                    type="button"
                  >
                    {turn.action.type === 'call' ? words('call112') : words('openAction')}
                  </button>
                ) : null}
                {turn.actions?.map((action, actionIndex) => (
                  <button
                    className="mr-2 mt-2 inline-flex min-h-touch items-center rounded-xl bg-teal-800 px-4 font-semibold text-white"
                    key={`${action.href}-${actionIndex}`}
                    onClick={() => runAction(action)}
                    type="button"
                  >
                    {action.href === 'tel:112'
                      ? words('call112')
                      : action.href.includes('hospitals')
                        ? words('intentHospitals')
                        : action.href.includes('appointments')
                          ? words('intentAppointment')
                          : words('openAction')}
                  </button>
                ))}
                {turn.role === 'assistant' && voiceReplies ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      aria-label={words('speak')}
                      className="min-h-touch rounded-lg border border-slate-300 px-3"
                      onClick={() => speak(turn.text)}
                      type="button"
                    >
                      🔊 {words('speak')}
                    </button>
                    {getSpeechPreview(turn.text).remainder ? (
                      <button
                        className="min-h-touch rounded-lg border border-slate-300 px-3"
                        onClick={() => speak(turn.text, true)}
                        type="button"
                      >
                        {words('readMore')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {isPatient && pendingAction ? (
            <div className="mx-3 mb-2 rounded-2xl border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-semibold">{words('confirmation')}</p>
              <p className="mt-1">{pendingTitle}</p>
              <div className="mt-3 flex gap-2">
                <button
                  className="min-h-touch rounded-xl bg-teal-800 px-4 font-semibold text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => confirmAction(true)}
                  type="button"
                >
                  {words('confirm')}
                </button>
                <button
                  className="min-h-touch rounded-xl border border-slate-300 bg-white px-4 font-semibold"
                  disabled={busy}
                  onClick={() => confirmAction(false)}
                  type="button"
                >
                  {words('dismiss')}
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="mx-3 mb-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-900" role="alert">
              {error}
            </p>
          ) : null}
          {speechNote ? (
            <p className="mx-3 mb-2 text-xs text-slate-600" role="status">
              {speechNote}
            </p>
          ) : null}
          <div className="space-y-2 border-t border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-700" htmlFor="assistant-language">
                {words('language')}
              </label>
              <select
                aria-label={words('language')}
                className="min-h-touch rounded-lg border border-slate-300 bg-white px-2 text-sm"
                id="assistant-language"
                onChange={(event) => {
                  const nextLanguage = event.target.value;
                  setLanguage(nextLanguage);
                  i18n.changeLanguage(nextLanguage);
                  stopRecognition();
                }}
                value={language}
              >
                {assistantLanguages.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            {isPatient ? (
              <>
                <form
                  className="flex items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendText(text);
                  }}
                >
                  <label className="sr-only" htmlFor="assistant-input">
                    {words('input')}
                  </label>
                  <textarea
                    className="min-h-12 max-h-28 min-w-0 flex-1 resize-y rounded-xl border border-slate-300 p-3 text-sm"
                    disabled={busy || consentRequired}
                    id="assistant-input"
                    maxLength={4000}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        sendText(text);
                      }
                    }}
                    placeholder={words('placeholder')}
                    value={text}
                  />
                  <button
                    aria-label={speechState === 'listening' ? words('stop') : words('mic')}
                    className={`grid min-h-touch min-w-touch place-items-center rounded-full text-xl text-white ${speechState === 'listening' ? 'animate-pulse bg-rose-700' : 'bg-teal-800'}`}
                    disabled={busy || consentRequired}
                    onClick={
                      ['listening', 'requesting'].includes(speechState)
                        ? stopRecognition
                        : startListening
                    }
                    type="button"
                  >
                    🎙
                  </button>
                  <button
                    className="min-h-touch rounded-xl bg-teal-800 px-3 text-sm font-bold text-white disabled:opacity-50"
                    disabled={busy || consentRequired || !text.trim()}
                    type="submit"
                  >
                    {busy ? '…' : words('send')}
                  </button>
                </form>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <label className="flex items-start gap-2 text-slate-700">
                    <input
                      checked={wakeEnabled}
                      onChange={(event) => toggleWakePhrase(event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      {words('wake')}
                      <span className="block text-slate-500">{words('wakeNote')}</span>
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-slate-700">
                    <input
                      checked={voiceReplies}
                      onChange={(event) => setVoiceReplies(event.target.checked)}
                      type="checkbox"
                    />
                    {words('voiceReplies')}
                  </label>
                  <button
                    className="min-h-touch rounded-lg border border-slate-300 px-3 text-xs"
                    onClick={() => {
                      setVoiceReplies((enabled) => !enabled);
                      window.speechSynthesis?.cancel();
                      setSpeechState('idle');
                    }}
                    type="button"
                  >
                    {voiceReplies ? words('mute') : words('unmute')}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">{authLoading ? '…' : words('signedOut')}</p>
            )}
          </div>
        </section>
      ) : null}
      {!open ? (
        <button
          aria-expanded={open}
          aria-label={words('title')}
          className={`grid h-14 w-14 place-items-center rounded-full bg-teal-800 text-2xl text-white shadow-xl ring-2 ring-white ${speechState === 'listening' ? 'animate-pulse bg-rose-700' : ''}`}
          onClick={openPanel}
          type="button"
        >
          {speechState === 'listening' ? '●' : '🎙'}
        </button>
      ) : null}
    </aside>
  );
}
