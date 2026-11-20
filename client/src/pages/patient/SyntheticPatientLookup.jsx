import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { syntheticDemoLabels } from './syntheticDemoCases.js';
import { findSyntheticReferencePatient } from './syntheticReferenceDataset.js';

const fields = [
  'patientId',
  'name',
  'sex',
  'age',
  'village',
  'mandal',
  'language',
  'tobacco',
  'betelQuid',
  'alcohol',
  'symptomWeeks',
  'aiFinding',
  'site',
  'riskLevel',
  'confidence',
  'doctorAction',
  'workflowStatus',
  'biopsy',
  'district',
  'state',
];

function formatValue(record, key, labels) {
  const value = record[key];
  if (typeof value === 'boolean') return value ? labels.yes : labels.no;
  if (key === 'sex') return value === 'F' ? labels.female : labels.male;
  if (key === 'confidence') {
    return labels.percent.replace('{{value}}', String(Math.round(value * 100)));
  }
  return String(value);
}

export default function SyntheticPatientLookup() {
  const { i18n } = useTranslation();
  const language = i18n.language.startsWith('te') ? 'te' : 'en';
  const labels = syntheticDemoLabels[language].patientLookup;
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [record, setRecord] = useState(null);

  function searchPatient(event) {
    event.preventDefault();
    setSubmitted(true);
    setRecord(findSyntheticReferencePatient(query));
  }

  return (
    <section className="space-y-4 rounded-3xl border border-teal-200 bg-white p-5 shadow-sm sm:p-7">
      <header>
        <h2 className="text-2xl font-bold text-slate-950">{labels.title}</h2>
        <p className="mt-2 text-slate-700">{labels.note}</p>
      </header>
      <form className="flex flex-col gap-3 sm:flex-row" onSubmit={searchPatient}>
        <label className="sr-only" htmlFor="synthetic-patient-query">
          {labels.placeholder}
        </label>
        <input
          autoComplete="off"
          className="min-h-touch min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3"
          id="synthetic-patient-query"
          onChange={(event) => {
            setQuery(event.target.value);
            setSubmitted(false);
            setRecord(null);
          }}
          placeholder={labels.placeholder}
          value={query}
        />
        <button
          className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white"
          type="submit"
        >
          {labels.search}
        </button>
      </form>

      {submitted && !record ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950" role="status">
          {query.trim() ? labels.noMatch : labels.empty}
        </p>
      ) : null}

      {record ? (
        <article className="space-y-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div>
            <h3 className="text-xl font-bold text-slate-950">
              {record.caseId} · {record.patientId}
            </h3>
            <p className="mt-2 font-bold text-amber-950">{labels.syntheticDisclosure}</p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((key) => (
              <div className="min-w-0 rounded-lg bg-white p-3" key={key}>
                <dt className="font-semibold text-slate-700">{labels[key]}</dt>
                <dd className="break-words text-slate-950">{formatValue(record, key, labels)}</dd>
              </div>
            ))}
          </dl>
        </article>
      ) : null}
    </section>
  );
}
