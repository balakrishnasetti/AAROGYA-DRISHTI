import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/index.js';
import { useAuth } from '../../store/useAuth.js';
import guidance from '../../data/dietGuidance.json';
import {
  createDailyMealPlan,
  getDailyStorageKey,
  getMealIdeas,
  getReminderStorageKey,
  getStageGuidance,
} from '../../data/dietPersonalization.js';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
const REGIONS = ['andhra', 'telangana', 'south', 'north', 'east', 'west'];

function reportStorageError() {
  window.dispatchEvent(new CustomEvent('aarogya:toast', {
    detail: { message: i18n.t('diet.storageError') },
  }));
}

function writeStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    reportStorageError();
  }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readStoredJson(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? { ...fallback, ...JSON.parse(stored) } : fallback;
  } catch {
    reportStorageError();
    return fallback;
  }
}

function readStoredArray(key) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    reportStorageError();
    return [];
  }
}

export default function PatientDietPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const patientId = user?.id || user?._id || 'patient';
  const today = localDateKey();
  const [preferences, setPreferences] = useState(() =>
    readStoredJson(`aarogya.diet.preferences.${patientId}`, {
      stage: 'prevention',
      region: 'andhra',
      vegetarian: true,
    }),
  );
  const mealOptions = useMemo(
    () => getMealIdeas({ region: preferences.region, vegetarian: preferences.vegetarian }),
    [preferences.region, preferences.vegetarian],
  );
  const [daily, setDaily] = useState(() =>
    readStoredJson(
      getDailyStorageKey(patientId, today),
      { plan: createDailyMealPlan(mealOptions), completed: {}, hydration: 0 },
    ),
  );
  const [reminders, setReminders] = useState(() =>
    readStoredArray(getReminderStorageKey(patientId)),
  );
  const [reminderTimes, setReminderTimes] = useState({
    breakfast: '08:00',
    lunch: '13:00',
    dinner: '19:00',
    snack: '16:00',
  });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const stageInfo = getStageGuidance(preferences.stage);
  const selectedIds = new Set(Object.values(daily.plan || {}));
  const selectedMeals = mealOptions.filter((meal) => selectedIds.has(meal.id));

  useEffect(() => {
    writeStoredJson(`aarogya.diet.preferences.${patientId}`, preferences);
  }, [patientId, preferences]);

  useEffect(() => {
    writeStoredJson(getDailyStorageKey(patientId, today), daily);
  }, [daily, patientId, today]);

  useEffect(() => {
    writeStoredJson(getReminderStorageKey(patientId), reminders);
  }, [patientId, reminders]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const dueReminders = reminders.filter((reminder) =>
        reminder.date === localDateKey() && !reminder.notifiedAt && Date.parse(reminder.dueAt) <= now,
      );
      if (!dueReminders.length) return;
      const reminder = dueReminders[0];
      setNotice(t('diet.reminderDue', { meal: t(`diet.mealTypes.${reminder.mealType}`) }));
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(t('diet.reminderTitle'), {
            body: t('diet.reminderBody', { meal: t(`diet.mealTypes.${reminder.mealType}`) }),
          });
        } catch {
          setError(t('diet.notificationFailed'));
        }
      }
      setReminders((current) => current.map((item) =>
        dueReminders.includes(item) ? { ...item, notifiedAt: new Date().toISOString() } : item,
      ));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [reminders, t]);

  function updatePreference(name, value) {
    setPreferences((current) => ({ ...current, [name]: value }));
    if (name === 'region' || name === 'vegetarian') {
      const nextRegion = name === 'region' ? value : preferences.region;
      const nextVegetarian = name === 'vegetarian' ? value : preferences.vegetarian;
      const nextMeals = getMealIdeas({ region: nextRegion, vegetarian: nextVegetarian });
      setDaily((current) => ({
        ...current,
        plan: createDailyMealPlan(nextMeals),
        completed: {},
      }));
    }
  }

  function updateMeal(mealType, mealId) {
    setDaily((current) => ({
      ...current,
      plan: { ...current.plan, [mealType]: mealId },
      completed: { ...current.completed, [mealType]: false },
    }));
  }

  async function addReminder(mealType) {
    setError('');
    if (!('Notification' in window)) {
      setError(t('diet.notificationsUnsupported'));
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        setError(t('diet.notificationsDenied'));
        return;
      }
    }
    if (permission !== 'granted') {
      setError(t('diet.notificationsDenied'));
      return;
    }
    const dueAt = new Date(`${today}T${reminderTimes[mealType]}:00`);
    if (dueAt.getTime() <= Date.now()) {
      setError(t('diet.chooseFutureTime'));
      return;
    }
    setReminders((current) => [
      ...current.filter((item) => item.date !== today || item.mealType !== mealType),
      { date: today, mealType, dueAt: dueAt.toISOString(), notifiedAt: null },
    ]);
    setNotice(t('diet.reminderSaved', { meal: t(`diet.mealTypes.${mealType}`) }));
  }

  const foodsToEat = guidance.foodsToEat;
  const foodsToAvoid = guidance.foodsToAvoid;
  return (
    <main className="space-y-6">
      <header className="rounded-3xl bg-gradient-to-br from-teal-900 to-emerald-800 p-6 text-white sm:p-8">
        <p className="text-sm font-bold uppercase tracking-wide text-teal-100">{t('diet.eyebrow')}</p>
        <h1 className="mt-2 text-3xl font-bold">{t('diet.title')}</h1>
        <p className="mt-3 max-w-3xl text-teal-50">{t('diet.description')}</p>
      </header>

      <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>{t('diet.disclaimer')}</strong>{' '}
        {t('diet.reviewPending')}
      </p>
      <p className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        {t('diet.healthDisclaimer')}
      </p>

      <section aria-labelledby="diet-personalize-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950" id="diet-personalize-title">{t('diet.personalizeTitle')}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="grid gap-2 text-sm font-semibold text-slate-800">
            {t('diet.stage')}
            <select className="min-h-touch rounded-xl border border-slate-300 px-3" onChange={(event) => updatePreference('stage', event.target.value)} value={preferences.stage}>
              {Object.entries(guidance.stages).map(([stage, info]) => (
                <option key={stage} value={stage}>{t(info.titleKey)}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-800">
            {t('diet.region')}
            <select className="min-h-touch rounded-xl border border-slate-300 px-3" onChange={(event) => updatePreference('region', event.target.value)} value={preferences.region}>
              {REGIONS.map((region) => <option key={region} value={region}>{t(`diet.regions.${region}`)}</option>)}
            </select>
          </label>
          <label className="flex min-h-touch items-center gap-3 self-end rounded-xl border border-slate-300 p-3 text-sm font-semibold text-slate-800">
            <input checked={preferences.vegetarian} className="h-5 w-5 accent-teal-800" onChange={(event) => updatePreference('vegetarian', event.target.checked)} type="checkbox" />
            {t('diet.vegetarianOnly')}
          </label>
        </div>
        <p className="mt-2 text-sm text-slate-600">{t('diet.preferenceNote')}</p>
        <p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm text-teal-950">{t(stageInfo.tipKeys[0])}</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="diet-eat-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950" id="diet-eat-title">{t('diet.foodsToEat')}</h2>
          <ul className="mt-3 space-y-3">
            {foodsToEat.map(({ key }) => (
              <li className="rounded-xl bg-emerald-50 p-3 text-slate-800" key={key}>
                <strong>{t(`diet.foods.${key}.title`)}</strong>
                <p className="mt-1 text-sm">{t(`diet.foods.${key}.description`)}</p>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="diet-avoid-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950" id="diet-avoid-title">{t('diet.foodsToAvoid')}</h2>
          <ul className="mt-3 space-y-3">
            {foodsToAvoid.map(({ key }) => (
              <li className="rounded-xl bg-rose-50 p-3 text-slate-800" key={key}>
                <strong>{t(`diet.foods.${key}.title`)}</strong>
                <p className="mt-1 text-sm">{t(`diet.foods.${key}.description`)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="diet-meals-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-950" id="diet-meals-title">{t('diet.mealIdeas')}</h2>
            <p className="mt-1 text-sm text-slate-600">{t('diet.mealIdeasDescription')}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {selectedMeals.map((meal) => (
            <article className="overflow-hidden rounded-2xl border border-slate-200" key={meal.id}>
              <img alt={t(meal.titleKey)} className="h-36 w-full bg-emerald-50 object-contain p-2" height="160" loading="lazy" src={meal.image} width="240" />
              <div className="p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-teal-800">{t(`diet.mealTypes.${meal.mealType}`)} · {t(meal.vegetarian ? 'diet.vegetarian' : 'diet.nonVegetarian')}</p>
                <h3 className="mt-1 font-bold text-slate-950">{t(meal.titleKey)}</h3>
                <p className="mt-1 text-sm text-slate-700">{t(meal.descriptionKey)}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="diet-swallowing-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950" id="diet-swallowing-title">{t('diet.swallowingTips')}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-slate-800">
          <li>{t('diet.swallowingTip1')}</li>
          <li>{t('diet.swallowingTip2')}</li>
          <li>{t('diet.swallowingTip3')}</li>
        </ul>
        <a className="mt-4 inline-flex min-h-touch items-center rounded-xl bg-rose-700 px-4 font-bold text-white" href="tel:112">{t('diet.call112')}</a>
      </section>

      <section aria-labelledby="diet-hydration-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950" id="diet-hydration-title">{t('diet.hydration')}</h2>
        <p className="mt-2 text-slate-700">{t('diet.hydrationDescription')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button aria-label={t('diet.removeGlass')} className="min-h-touch min-w-touch rounded-xl border border-slate-300 px-4 text-xl" onClick={() => setDaily((current) => ({ ...current, hydration: Math.max(0, current.hydration - 1) }))} type="button">−</button>
          <p aria-live="polite" className="rounded-xl bg-sky-50 px-4 py-3 font-semibold text-sky-950">{t('diet.glassesLogged', { count: daily.hydration })}</p>
          <button aria-label={t('diet.addGlass')} className="min-h-touch min-w-touch rounded-xl bg-teal-800 px-4 text-xl font-bold text-white" onClick={() => setDaily((current) => ({ ...current, hydration: current.hydration + 1 }))} type="button">+</button>
        </div>
      </section>

      <section aria-labelledby="diet-planner-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950" id="diet-planner-title">{t('diet.plannerTitle')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('diet.plannerDescription', { date: today })}</p>
        <div className="mt-4 space-y-3">
          {MEAL_TYPES.map((mealType) => {
            const options = mealOptions.filter((meal) => meal.mealType === mealType);
            const time = reminderTimes[mealType];
            const savedReminder = reminders.find((item) => item.date === today && item.mealType === mealType);
            return (
              <div className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={mealType}>
                <div>
                  <label className="grid gap-2 text-sm font-semibold text-slate-800">
                    {t(`diet.mealTypes.${mealType}`)}
                    <select className="min-h-touch rounded-xl border border-slate-300 px-3" onChange={(event) => updateMeal(mealType, event.target.value)} value={daily.plan?.[mealType] || ''}>
                      {options.map((meal) => <option key={meal.id} value={meal.id}>{t(meal.titleKey)}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button aria-pressed={Boolean(daily.completed?.[mealType])} className={`min-h-touch rounded-xl px-4 font-semibold ${daily.completed?.[mealType] ? 'bg-emerald-700 text-white' : 'border border-emerald-700 text-emerald-900'}`} onClick={() => setDaily((current) => ({ ...current, completed: { ...current.completed, [mealType]: !current.completed?.[mealType] } }))} type="button">
                    {daily.completed?.[mealType] ? t('diet.logged') : t('diet.markEaten')}
                  </button>
                  <label className="sr-only" htmlFor={`diet-reminder-${mealType}`}>{t('diet.reminderTime', { meal: t(`diet.mealTypes.${mealType}`) })}</label>
                  <input className="min-h-touch rounded-xl border border-slate-300 px-2" id={`diet-reminder-${mealType}`} onChange={(event) => setReminderTimes((current) => ({ ...current, [mealType]: event.target.value }))} type="time" value={time} />
                  <button className="min-h-touch rounded-xl bg-teal-800 px-4 font-semibold text-white" onClick={() => addReminder(mealType)} type="button">
                    {savedReminder ? t('diet.reminderSet') : t('diet.setReminder')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-slate-600">{t('diet.reminderLimit')}</p>
        {notice ? <p aria-live="polite" className="mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-950" role="status">{notice}</p> : null}
        {error ? <p aria-live="assertive" className="mt-3 rounded-xl bg-rose-50 p-3 text-rose-900" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
