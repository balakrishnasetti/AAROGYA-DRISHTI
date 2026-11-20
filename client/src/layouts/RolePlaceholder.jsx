import { useTranslation } from 'react-i18next';

export default function RolePlaceholder({ role }) {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="role-title" className="mx-auto max-w-3xl">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-teal-700">
        {t('app.layoutPreview')}
      </p>
      <h1 className="text-display-sm text-ink" id="role-title">
        {t(`roles.${role}`)}
      </h1>
      <div className="mt-8 rounded-2xl border border-teal-100 bg-surface p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-semibold">{t('app.phaseOneTitle')}</h2>
        <p className="mt-3 leading-7 text-muted">{t('app.phaseOneDescription')}</p>
      </div>
    </section>
  );
}
