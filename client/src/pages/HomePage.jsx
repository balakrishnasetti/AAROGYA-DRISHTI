import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { demoModeEnabled } from '../config/demoMode.js';

export default function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-6xl">
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="home-eyebrow">{t('home.eyebrow')}</p>
          <h1 className="home-title">{t('home.title')}</h1>
          <p className="home-description">{t('home.description')}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="motion-button home-primary-button" to="/login">
              {t('home.startScreening')}
              <span aria-hidden="true">→</span>
            </Link>
            {demoModeEnabled ? (
              <Link className="motion-button home-secondary-button" to="/demo/patient-cases">
                {t('home.syntheticCases')}
              </Link>
            ) : null}
          </div>
          <p className="home-safety-note">
            <span aria-hidden="true" className="home-safety-dot" />
            {t('home.safetyNote')}
          </p>
        </div>

        <div className="home-visual-wrap">
          <div className="home-visual-glow" />
          <div className="home-visual-orbit home-visual-orbit-one" />
          <div className="home-visual-orbit home-visual-orbit-two" />
          <div className="home-logo-card">
            <img
              alt="Blue eye surrounding a green tooth, representing oral health screening"
              className="home-logo-image"
              src="/aarogya-vision-logo.png"
            />
          </div>
          <div className="home-float-card home-float-card-top">
            <span className="home-float-icon">✓</span>
            <span><strong>{t('home.visualConsent')}</strong><small>{t('home.visualYourChoice')}</small></span>
          </div>
          <div className="home-float-card home-float-card-bottom">
            <span className="home-float-icon home-float-icon-soft">♡</span>
            <span><strong>{t('home.visualCareAccess')}</strong><small>{t('home.visualCareWhenReady')}</small></span>
          </div>
          <span className="home-decor home-decor-cross">＋</span>
          <span className="home-decor home-decor-sparkle">✳</span>
        </div>
      </section>

    </div>
  );
}
