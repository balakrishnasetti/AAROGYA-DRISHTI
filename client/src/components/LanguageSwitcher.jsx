import { useTranslation } from 'react-i18next';

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const language =
    ['en', 'te', 'hi'].find((code) => i18n.resolvedLanguage?.startsWith(code)) ?? 'en';

  async function changeLanguage(event) {
    await i18n.changeLanguage(event.target.value);
    localStorage.setItem('i18nextLng', event.target.value);
  }

  return (
    <label className="flex min-h-touch items-center gap-2 text-sm font-medium text-ink">
      <span className="sr-only">{t('app.chooseLanguage')}</span>
      <select
        aria-label={t('app.chooseLanguage')}
        className="min-h-touch rounded-lg border border-teal-100 bg-surface px-3 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        onChange={changeLanguage}
        value={language}
      >
        <option value="en">English</option>
        <option value="te">తెలుగు</option>
        <option value="hi">हिन्दी</option>
      </select>
    </label>
  );
}
