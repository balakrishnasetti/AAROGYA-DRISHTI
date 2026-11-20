import { useTranslation } from 'react-i18next';
import SyntheticPatientDemoPanel from './SyntheticPatientDemoPanel.jsx';
import SyntheticPatientLookup from './SyntheticPatientLookup.jsx';
import { syntheticDemoLabels } from './syntheticDemoCases.js';

export default function SyntheticPatientDemoPage() {
  const { i18n } = useTranslation();
  const language = i18n.language.startsWith('te') ? 'te' : 'en';
  const labels = syntheticDemoLabels[language];
  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <header className="rounded-3xl border border-teal-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="mt-2 text-3xl font-bold text-slate-950">{labels.publicTitle}</h1>
        <p className="mt-3 leading-7 text-slate-700">{labels.publicDescription}</p>
      </header>
      <SyntheticPatientLookup />
      <SyntheticPatientDemoPanel />
    </main>
  );
}
