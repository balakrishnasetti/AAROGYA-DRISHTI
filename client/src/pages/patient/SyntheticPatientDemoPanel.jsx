import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../store/useAuth.js';
import { getDemoTranslation, syntheticDemoCases, syntheticDemoLabels } from './syntheticDemoCases.js';

const tabs = ['dashboard', 'assistant', 'screening', 'results', 'consultation', 'reports'];
const regionPositions = {
  tongue: [165, 122],
  gums: [165, 90],
  teeth: [112, 93],
  'inner cheek': [76, 105],
  lips: [165, 64],
  jaw: [220, 126],
  throat: [165, 150],
};

function SyntheticMouthIllustration({ caseItem, language }) {
  const [markX, markY] = regionPositions[caseItem.region] || regionPositions.tongue;
  const labels = syntheticDemoLabels[language];
  return (
    <figure className="relative overflow-hidden rounded-2xl border border-slate-200 bg-[#fff9f3] p-3">
      <svg
        aria-label={`${labels.imageLabel}: ${caseItem.region}`}
        className="mx-auto block w-full max-w-sm"
        role="img"
        viewBox="0 0 330 190"
      >
        <rect fill="#fff9f3" height="190" rx="18" width="330" />
        <path
          d="M37 78 Q165 4 293 78 Q276 161 165 174 Q54 161 37 78Z"
          fill="#bd6268"
          stroke="#8f424b"
          strokeWidth="5"
        />
        <path
          d="M59 83 Q165 36 271 83 Q250 132 165 142 Q80 132 59 83Z"
          fill="#471f2b"
        />
        <path d="M92 88 Q165 74 238 88 L228 108 Q165 119 102 108Z" fill="#fff8eb" />
        <path d="M99 118 Q165 105 231 118 Q216 151 165 155 Q114 151 99 118Z" fill="#c85f70" />
        <path
          d={`M${markX - 18} ${markY} Q${markX} ${markY - 15} ${markX + 18} ${markY} Q${markX + 12} ${markY + 18} ${markX - 13} ${markY + 13}Z`}
          fill={caseItem.markColor}
          fillOpacity="0.88"
          stroke="#633744"
          strokeDasharray="3 3"
          strokeWidth="2"
        />
        <rect fill="#ffffff" fillOpacity="0.95" height="25" rx="7" width="290" x="20" y="156" />
        <text fill="#472d32" fontSize="8.5" fontWeight="700" textAnchor="middle" x="165" y="172">
          {labels.imageLabel}
        </text>
      </svg>
      <figcaption className="mt-2 text-center text-xs font-semibold text-slate-700">
        {labels.imageLabel} · {labels.imageNote}
      </figcaption>
    </figure>
  );
}

function CasePicker({ selected, onChange, language }) {
  const labels = syntheticDemoLabels[language];
  return (
    <label className="grid gap-2 font-semibold text-slate-900">
      {labels.caseNumber.replace('{{number}}', '')}
      <select
        className="min-h-touch w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
        onChange={(event) => onChange(event.target.value)}
        value={selected.id}
      >
        {syntheticDemoCases.map((item) => (
          <option key={item.id} value={item.id}>
            {labels.caseNumber.replace('{{number}}', String(item.number).padStart(2, '0'))} ·{' '}
            {getDemoTranslation(item.concern, language)}
          </option>
        ))}
      </select>
    </label>
  );
}

function RiskBadge({ caseItem, language }) {
  const colors = {
    low: 'border-emerald-300 bg-emerald-50 text-emerald-950',
    moderate: 'border-amber-300 bg-amber-50 text-amber-950',
    prompt: 'border-rose-300 bg-rose-50 text-rose-950',
  };
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-bold ${colors[caseItem.risk]}`}>
      {getDemoTranslation(caseItem.riskLabel, language)}
    </span>
  );
}

function formatFollowUpDays(labels, count) {
  return (count === 1 ? labels.day : labels.days).replace('{{count}}', String(count));
}

export default function SyntheticPatientDemoPanel() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const language = i18n.language.startsWith('te') ? 'te' : 'en';
  const labels = syntheticDemoLabels[language];
  const [selectedId, setSelectedId] = useState(syntheticDemoCases[0].id);
  const [activeTab, setActiveTab] = useState('dashboard');
  const selected = syntheticDemoCases.find((item) => item.id === selectedId);

  return (
    <section className="space-y-5 rounded-3xl border-2 border-dashed border-amber-400 bg-white p-5 shadow-sm sm:p-7">
      <header className="space-y-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">{labels.dashboard}</h2>
            <p className="mt-1 text-slate-700">{labels.dashboardSummary}</p>
          </div>
          <div className="sm:min-w-80">
            <CasePicker language={language} onChange={setSelectedId} selected={selected} />
          </div>
        </div>
      </header>

      <nav aria-label={labels.demoModules} className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map((tab) => (
          <button
            aria-pressed={activeTab === tab}
            className={`min-h-touch shrink-0 rounded-xl px-4 font-semibold ${
              activeTab === tab
                ? 'bg-teal-800 text-white'
                : 'border border-slate-300 bg-white text-slate-800'
            }`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {labels.tabs[tab]}
          </button>
        ))}
      </nav>

      <div className="space-y-5">
        {activeTab === 'dashboard' ? (
          <>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
              <article className="space-y-4 rounded-2xl border border-slate-200 p-4">
                <h3 className="text-lg font-bold">{labels.profile}</h3>
                <p className="font-semibold">
                  {language === 'te' ? selected.profile.nameTe : selected.profile.name}
                </p>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="font-semibold">{labels.caseNumber.replace('{{number}}', '')}</dt><dd>{String(selected.number).padStart(2, '0')}</dd></div>
                  <div><dt className="font-semibold">{labels.age}</dt><dd>{selected.profile.age}</dd></div>
                  <div><dt className="font-semibold">{labels.gender}</dt><dd>{labels[selected.profile.gender]}</dd></div>
                  <div><dt className="font-semibold">{labels.language}</dt><dd>{selected.profile.language === 'te' ? 'తెలుగు' : 'English'}</dd></div>
                  <div className="col-span-2"><dt className="font-semibold">{labels.location}</dt><dd>{language === 'te' ? selected.profile.locationTe : selected.profile.location}</dd></div>
                </dl>
                <p><span className="font-semibold">{labels.scenario}:</span> {getDemoTranslation(selected.scenario, language)}</p>
                <RiskBadge caseItem={selected} language={language} />
              </article>
              <SyntheticMouthIllustration caseItem={selected} language={language} />
            </div>
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 font-semibold text-amber-950">
              {labels.notDiagnosis}
            </p>
          </>
        ) : null}

        {activeTab === 'assistant' ? (
          <article className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <h3 className="text-xl font-bold">{labels.aiAssistant}</h3>
            <p className="rounded-xl bg-blue-50 p-4 text-blue-950">{labels.assistantLive}</p>
            <Link
              aria-label={labels.assistantLaunch}
              className="inline-flex min-h-touch items-center gap-2 rounded-xl bg-teal-800 px-5 font-semibold text-white"
              to={user?.role === 'patient' ? '/patient/assistant' : '/login'}
            >
              <span aria-hidden="true" className="text-xl">🎙</span>
              {labels.assistantLaunch}
            </Link>
          </article>
        ) : null}

        {activeTab === 'screening' ? (
          <>
            <div className="grid gap-5 lg:grid-cols-2">
              <article className="space-y-3 rounded-2xl border border-slate-200 p-4">
                <h3 className="text-xl font-bold">{labels.screening}</h3>
                <p className="font-semibold">{getDemoTranslation(selected.concern, language)}</p>
                <dl className="space-y-3">
                  {selected.questionnaireAnswers.map((answer) => (
                    <div className="rounded-lg bg-slate-50 p-3" key={answer.label.en}>
                      <dt className="font-semibold">{getDemoTranslation(answer.label, language)}</dt>
                      <dd className="mt-1">{getDemoTranslation(answer.value, language)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
              <div className="space-y-3">
                <SyntheticMouthIllustration caseItem={selected} language={language} />
                <p className={`rounded-xl p-3 font-semibold ${selected.imageQualityPass ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'}`}>
                  {labels.imageQuality}: {selected.imageQualityPass ? labels.qualityPass : labels.qualityRetake}
                </p>
                <p className="text-sm text-slate-700">{labels.imageNote}</p>
              </div>
            </div>
            <aside className="space-y-3 rounded-2xl border border-teal-200 bg-teal-50 p-4">
              <h3 className="text-lg font-bold text-teal-950">{labels.liveScreeningTitle}</h3>
              <p className="text-teal-950">{labels.liveScreeningNote}</p>
              <Link
                className="inline-flex min-h-touch items-center gap-2 rounded-xl bg-teal-800 px-5 font-semibold text-white"
                to={user?.role === 'patient' ? '/patient' : '/login'}
              >
                <span aria-hidden="true">📷</span>
                {user?.role === 'patient' ? labels.liveScreeningOpen : labels.liveScreeningSignIn}
              </Link>
            </aside>
          </>
        ) : null}

        {activeTab === 'results' ? (
          <article className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <h3 className="text-xl font-bold">{labels.screeningResult}</h3>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">{labels.risk}:</span>
              <RiskBadge caseItem={selected} language={language} />
            </div>
            <p><span className="font-semibold">{labels.observations}:</span> {getDemoTranslation(selected.symptom, language)}</p>
            <p className="rounded-xl bg-amber-50 p-4 text-amber-950">{labels.notDiagnosis}</p>
            <div className="rounded-xl bg-slate-50 p-4">
              <h4 className="font-bold">{labels.nextSteps}</h4>
              <p className="mt-2">
                {selected.risk === 'prompt'
                  ? labels.promptAdvice
                  : selected.risk === 'moderate'
                    ? labels.moderateAdvice
                    : labels.hygiene}
              </p>
            </div>
          </article>
        ) : null}

        {activeTab === 'consultation' ? (
          <article className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <h3 className="text-xl font-bold">{labels.consultation}</h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="font-semibold">{labels.appointment}</dt><dd>{labels.appointmentStatuses[selected.appointmentStatus]}</dd></div>
              <div><dt className="font-semibold">{labels.consultationStatus}</dt><dd>{labels.consultationStatuses[selected.consultationStatus]}</dd></div>
              <div><dt className="font-semibold">{labels.referral}</dt><dd>{getDemoTranslation(selected.referralSpecialty, language)}</dd></div>
              <div><dt className="font-semibold">{labels.followUp}</dt><dd>{formatFollowUpDays(labels, selected.followUpDays)}</dd></div>
            </dl>
            {selected.consultationStatus === 'completed' ? (
              <p><span className="font-semibold">{labels.consultationNote}:</span> {getDemoTranslation(selected.symptom, language)}</p>
            ) : null}
            <p className="rounded-xl bg-amber-50 p-4 text-amber-950">{labels.disclaimer} No appointment, referral, or message is actually created.</p>
          </article>
        ) : null}

        {activeTab === 'reports' ? (
          <article className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <h3 className="text-xl font-bold">{labels.reports}</h3>
            <ol className="space-y-2">
              {selected.history.map((item, index) => (
                <li className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between" key={item}>
                  <span className="font-semibold">{labels[item]}</span>
                  <span className="text-sm text-slate-600">{labels.reportDate} {index + 1} · {labels.disclaimer}</span>
                </li>
              ))}
            </ol>
            <p className="text-sm text-slate-700">{labels.notDiagnosis}</p>
          </article>
        ) : null}

      </div>
    </section>
  );
}
