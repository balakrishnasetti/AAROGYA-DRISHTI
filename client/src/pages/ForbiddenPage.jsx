import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-teal-100 bg-surface p-6 sm:p-8">
      <h1 className="text-3xl font-bold">{t('auth.forbiddenTitle')}</h1>
      <p className="mt-3 leading-7 text-muted">{t('auth.forbiddenDescription')}</p>
      <Link
        className="mt-5 inline-flex min-h-touch items-center font-semibold text-teal-700 underline"
        to="/"
      >
        {t('errors.goHome')}
      </Link>
    </section>
  );
}
