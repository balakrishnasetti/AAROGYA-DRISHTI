import { Link, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/useAuth.js';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import OnlineBadge from '../components/OnlineBadge.jsx';
import { dashboardPathForRole } from '../routes/routeAccess.js';

export default function PublicLayout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <div className={`min-h-screen bg-canvas text-ink${user ? ' authenticated-layout' : ''}`}>
      {user ? <div aria-hidden="true" className="authenticated-background-image" /> : null}
      <header className="public-header border-b border-teal-100 bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link className="flex min-h-touch items-center gap-3 rounded-lg" to="/">
            <img
              alt=""
              className="brand-logo h-12 w-12 rounded-lg object-contain"
              src="/aarogya-logo.png"
            />
            <span>
              <span className="block text-lg font-bold leading-tight">{t('app.name')}</span>
              <span className="block text-xs text-muted">{t('app.tagline')}</span>
            </span>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <OnlineBadge />
            {user ? (
              <>
                <Link
                  className="inline-flex min-h-touch items-center rounded-lg px-3 font-semibold text-teal-700 underline"
                  to={dashboardPathForRole(user.role)}
                >
                  {t('app.myDashboard')}
                </Link>
                <button
                  className="min-h-touch rounded-lg border border-teal-100 px-3 font-semibold text-ink"
                  onClick={() => logout().catch(() => undefined)}
                  type="button"
                >
                  {t('app.signOut')}
                </button>
              </>
            ) : (
              <Link
                className="motion-button home-primary-button min-h-touch px-4 py-2"
                to="/login"
              >
                {t('app.signIn')}
              </Link>
            )}
            <LanguageSwitcher />
          </div>
        </div>
      </header>
      <main
        id="main-content"
        className="public-main mx-auto min-h-[65vh] max-w-6xl px-4 py-10 sm:px-6 sm:py-16"
      >
        <Outlet />
      </main>
      <footer className="border-t border-teal-100 bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted sm:px-6">
          {t('app.footer')}
        </div>
      </footer>
    </div>
  );
}
