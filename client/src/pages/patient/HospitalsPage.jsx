import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../../services/api.js';

const REGION_CENTER = [18.08, 82.66];
const RADIUS_OPTIONS = [5, 10, 25, 50, 100, 250, 500];

function markerIcon(selected, synthetic) {
  const color = synthetic ? '#d97706' : selected ? '#153c47' : '#1e6578';
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:22px;height:22px;border:3px solid white;border-radius:50%;background:${color};box-shadow:0 1px 5px #0008"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function distanceKm(origin, destination) {
  if (!origin || !destination) return null;
  const radians = (value) => (value * Math.PI) / 180;
  const dLat = radians(destination.latitude - origin.latitude);
  const dLon = radians(destination.longitude - origin.longitude);
  const lat1 = radians(origin.latitude);
  const lat2 = radians(destination.latitude);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function isOpenNow(hours) {
  if (!hours?.length) return false;
  const nowParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(nowParts.map((part) => [part.type, part.value]));
  const day = values.weekday.toLowerCase().slice(0, 3);
  const time = `${values.hour}:${values.minute}`;
  const today = hours.find((item) => item.day === day);
  return Boolean(today && !today.closed && today.opensAt <= time && today.closesAt > time);
}

function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([latitude / 1e5, longitude / 1e5]);
  }
  return points;
}

function FitMap({ hospitals, selectedHospital, userLocation, routePoints }) {
  const map = useMap();
  useEffect(() => {
    if (routePoints?.length) {
      map.fitBounds(routePoints, { padding: [32, 32] });
    } else if (selectedHospital?.coordinates) {
      map.setView(
        [selectedHospital.coordinates.latitude, selectedHospital.coordinates.longitude],
        13,
      );
    } else if (userLocation) {
      map.setView([userLocation.latitude, userLocation.longitude], 11);
    } else if (hospitals.length) {
      const points = hospitals
        .filter((item) => item.coordinates)
        .map((item) => [item.coordinates.latitude, item.coordinates.longitude]);
      if (points.length) map.fitBounds(points, { padding: [32, 32], maxZoom: 11 });
    }
  }, [hospitals, map, routePoints, selectedHospital, userLocation]);
  return null;
}

export default function HospitalsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const voiceQuery = searchParams.get('query') ?? '';
  const voiceSpecialty = searchParams.get('specialty') ?? '';
  const [hospitals, setHospitals] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [nearbyMode, setNearbyMode] = useState(false);
  const [searchText, setSearchText] = useState(voiceQuery);
  const [radius, setRadius] = useState(25);
  const [specialty, setSpecialty] = useState(voiceSpecialty);
  const [ownership, setOwnership] = useState('');
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [route, setRoute] = useState(null);
  const [routeConsent, setRouteConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedHospital = hospitals.find((item) => item.id === selectedId) ?? null;

  const loadHospitals = useCallback(async (filters = {}) => {
    setLoading(true);
    setError('');
    try {
      const params = {
        ...(filters.city ? { city: filters.city } : {}),
        ...(filters.district ? { district: filters.district } : {}),
        ...(filters.origin ? {
          latitude: filters.origin.latitude,
          longitude: filters.origin.longitude,
          radiusKm: filters.radiusKm ?? 100,
        } : {}),
        ...(filters.specialty ? { specialty: filters.specialty } : {}),
      };
      const response = await api.get('/hospitals', { params });
      setHospitals(response.data.details ?? []);
      setSelectedId('');
      setRoute(null);
      setNotice('');
      if (!response.data.details?.length) setNotice(t('hospitals.noResults'));
      return response.data.details ?? [];
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('hospitals.loadError')));
      return [];
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadHospitals({
      ...(voiceQuery ? { city: voiceQuery } : {}),
      ...(voiceSpecialty ? { specialty: voiceSpecialty } : {}),
    });
  }, [loadHospitals, voiceQuery, voiceSpecialty]);

  function requestLocation(selectNearest = false) {
    setError('');
    setNotice('');
    if (!navigator.geolocation) {
      setError(t('hospitals.locationUnavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const origin = { latitude: coords.latitude, longitude: coords.longitude };
        setUserLocation(origin);
        setNearbyMode(true);
        const nearbyHospitals = await loadHospitals({
          origin,
          radiusKm: 500,
          ...(specialty ? { specialty } : {}),
        });
        if (selectNearest) {
          const nearest = nearbyHospitals
            .filter((hospital) => !hospital.isSynthetic && hospital.coordinates)
            .map((hospital) => ({ ...hospital, distance: distanceKm(origin, hospital.coordinates) }))
            .sort((left, right) => left.distance - right.distance)[0];
          if (nearest) setSelectedId(nearest.id);
          else setError(t('hospitals.noRealFacilities'));
        }
      },
      (locationError) => {
        setError(
          locationError.code === locationError.PERMISSION_DENIED
            ? t('hospitals.locationDenied')
            : t('hospitals.locationUnavailable'),
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function manualSearch(event) {
    event.preventDefault();
    const term = searchText.trim();
    if (!term) {
      setError(t('hospitals.enterPlace'));
      return;
    }
    setNearbyMode(false);
    await loadHospitals({
      city: term,
      ...(specialty ? { specialty } : {}),
    });
  }

  const visibleHospitals = useMemo(() => hospitals
    .map((hospital) => ({
      ...hospital,
      distance: distanceKm(userLocation, hospital.coordinates),
    }))
    .filter((hospital) => {
      if (!specialty) return true;
      if (hospital.centerType === `${specialty}_center`) return true;
      const terms = specialty === 'cancer' ? ['cancer', 'oncology'] : ['dental', 'dent', 'oral'];
      return [...(hospital.specialties ?? []), ...(hospital.services ?? [])]
        .some((item) => terms.some((term) => item.toLowerCase().includes(term)));
    })
    .filter((hospital) => !ownership || hospital.ownership === ownership)
    .filter((hospital) => !openNowOnly || isOpenNow(hospital.workingHours))
    .filter((hospital) => !nearbyMode || hospital.distance === null || hospital.distance <= radius)
    .sort((left, right) => (
      left.distance !== null && right.distance !== null
        ? left.distance - right.distance
        : (left.name ?? '').localeCompare(right.name ?? '')
    )), [hospitals, nearbyMode, openNowOnly, ownership, radius, specialty, userLocation]);

  useEffect(() => {
    if (searchParams.get('nearest') === 'true' && userLocation && visibleHospitals.length) {
      setRadius(500);
      const nearest = visibleHospitals.find((hospital) => !hospital.isSynthetic);
      if (nearest) setSelectedId(nearest.id);
      else setNotice(t('hospitals.noRealFacilities'));
    }
  }, [searchParams, t, userLocation, visibleHospitals]);

  async function previewRoute(hospital) {
    if (!userLocation || !hospital.coordinates) {
      setError(t('hospitals.locationNeeded'));
      return;
    }
    if (hospital.isSynthetic) {
      setError(t('hospitals.syntheticNavigationBlocked'));
      return;
    }
    if (!routeConsent) {
      setError(t('hospitals.routeConsentRequired'));
      return;
    }
    setError('');
    try {
      const response = await api.post('/hospitals/directions', {
        origin: userLocation,
        destination: hospital.coordinates,
        language: i18n.language.startsWith('te') ? 'te' : 'en',
      });
      const details = response.data.details;
      setRoute({
        ...details,
        points: details.encodedPolyline ? decodePolyline(details.encodedPolyline) : [],
      });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('hospitals.routeError')));
      setRoute(null);
    }
  }

  function startNavigation(hospital) {
    if (hospital.isSynthetic) {
      setError(t('hospitals.syntheticNavigationBlocked'));
      return;
    }
    if (!hospital.coordinates) {
      setError(t('hospitals.destinationMissing'));
      return;
    }
    if (!routeConsent) {
      setError(t('hospitals.routeConsentRequired'));
      return;
    }
    const origin = userLocation
      ? `${userLocation.latitude},${userLocation.longitude}`
      : '';
    const destination = `${hospital.coordinates.latitude},${hospital.coordinates.longitude}`;
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    if (origin) url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    url.searchParams.set('travelmode', 'driving');
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  async function goToNearestHospital() {
    setSpecialty('');
    if (!userLocation) {
      requestLocation(true);
      return;
    }
    setNearbyMode(true);
    setRadius(500);
    const nearbyHospitals = await loadHospitals({ origin: userLocation, radiusKm: 500 });
    const nearest = nearbyHospitals
      .filter((item) => !item.isSynthetic && item.coordinates)
      .map((item) => ({ ...item, distance: distanceKm(userLocation, item.coordinates) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!nearest) {
      setError(t('hospitals.noRealFacilities'));
      return;
    }
    setSelectedId(nearest.id);
  }

  const routePoints = route?.points?.length ? route.points : null;

  return (
    <main className="space-y-5" aria-labelledby="hospitals-title">
      <header className="space-y-2">
        <p className="text-sm font-bold uppercase tracking-wide text-teal-800">{t('hospitals.eyebrow')}</p>
        <h1 id="hospitals-title" className="text-3xl font-bold text-slate-950">{t('hospitals.title')}</h1>
        <p className="text-slate-700">{t('hospitals.description')}</p>
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          {t('hospitals.disclaimer')}
        </p>
      </header>

      <section className="flex flex-wrap gap-3" aria-label={t('hospitals.search')}>
        <button type="button" onClick={requestLocation} disabled={loading} className="min-h-touch rounded-xl bg-teal-800 px-4 font-bold text-white disabled:opacity-50">
          {t('hospitals.useLocation')}
        </button>
        <button type="button" onClick={goToNearestHospital} disabled={loading} className="min-h-touch rounded-xl border border-rose-700 bg-rose-50 px-4 font-bold text-rose-900 disabled:opacity-50">
          {t('hospitals.emergencyNearest')}
        </button>
        <a href="tel:112" className="inline-flex min-h-touch items-center rounded-xl bg-rose-700 px-4 font-bold text-white">
          {t('hospitals.call112')}
        </a>
      </section>

      <form className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr_auto]" onSubmit={manualSearch}>
        <label className="grid gap-1 font-semibold">
          {t('hospitals.manualSearch')}
          <input className="min-h-touch rounded-xl border border-slate-300 px-4" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={t('hospitals.placePlaceholder')} maxLength={100} />
        </label>
        <button type="submit" disabled={loading} className="min-h-touch self-end rounded-xl border border-teal-800 px-5 font-bold text-teal-900 disabled:opacity-50">
          {t('hospitals.search')}
        </button>
      </form>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('hospitals.filters')}>
        <label className="grid gap-1 font-semibold">
          {t('hospitals.specialty')}
          <select className="min-h-touch rounded-xl border border-slate-300 px-3" value={specialty} onChange={(event) => setSpecialty(event.target.value)}>
            <option value="">{t('hospitals.allSpecialties')}</option>
            <option value="cancer">{t('hospitals.cancer')}</option>
            <option value="dental">{t('hospitals.dental')}</option>
          </select>
        </label>
        <label className="grid gap-1 font-semibold">
          {t('hospitals.distance')}
          <select className="min-h-touch rounded-xl border border-slate-300 px-3" value={radius} onChange={(event) => setRadius(Number(event.target.value))}>
            {RADIUS_OPTIONS.map((km) => <option key={km} value={km}>{km} km</option>)}
          </select>
        </label>
        <label className="grid gap-1 font-semibold">
          {t('hospitals.ownership')}
          <select className="min-h-touch rounded-xl border border-slate-300 px-3" value={ownership} onChange={(event) => setOwnership(event.target.value)}>
            <option value="">{t('hospitals.anyOwnership')}</option>
            <option value="government">{t('hospitals.government')}</option>
            <option value="private">{t('hospitals.private')}</option>
          </select>
        </label>
        <label className="flex min-h-touch items-center gap-3 font-semibold">
          <input type="checkbox" checked={openNowOnly} onChange={(event) => setOpenNowOnly(event.target.checked)} />
          {t('hospitals.openNow')}
        </label>
      </section>

      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-900">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl bg-slate-100 p-4 text-slate-800">{notice}</p> : null}
      {searchParams.get('nearest') === 'true' && !userLocation ? (
        <p className="rounded-xl bg-teal-50 p-4 text-teal-950">{t('hospitals.voiceLocationPrompt')}</p>
      ) : null}
      {loading ? <p role="status" className="text-slate-700">{t('hospitals.loading')}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <section className="space-y-3" aria-label={t('hospitals.mapView')}>
          <MapContainer center={REGION_CENTER} zoom={8} scrollWheelZoom className="z-0 h-[420px] rounded-2xl border border-slate-300">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitMap hospitals={visibleHospitals} selectedHospital={selectedHospital} userLocation={userLocation} routePoints={routePoints} />
            {userLocation ? (
              <Marker position={[userLocation.latitude, userLocation.longitude]} icon={markerIcon(false, false)}>
                <Popup>{t('hospitals.yourLocation')}</Popup>
              </Marker>
            ) : null}
            {visibleHospitals.map((hospital) => hospital.coordinates ? (
              <Marker
                key={hospital.id}
                position={[hospital.coordinates.latitude, hospital.coordinates.longitude]}
                icon={markerIcon(hospital.id === selectedId, hospital.isSynthetic)}
                eventHandlers={{ click: () => setSelectedId(hospital.id) }}
              >
                <Popup>
                  <strong>{hospital.name}</strong>
                  <br />
                  {hospital.isSynthetic ? t('hospitals.syntheticLabel') : hospital.address}
                  {hospital.contactPhone ? <><br /><a href={`tel:${hospital.contactPhone}`}>{hospital.contactPhone}</a></> : null}
                </Popup>
              </Marker>
            ) : null)}
            {routePoints ? <Polyline positions={routePoints} pathOptions={{ color: '#28778e', weight: 5 }} /> : null}
          </MapContainer>
          <p className="text-xs text-slate-600">{t('hospitals.mapAttribution')}</p>
        </section>

        <section className="space-y-3" aria-label={t('hospitals.listView')}>
          <h2 className="text-xl font-bold text-slate-950">{t('hospitals.results', { count: visibleHospitals.length })}</h2>
          <ul className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {visibleHospitals.map((hospital) => (
              <li key={hospital.id} className={`rounded-2xl border bg-white p-4 ${selectedId === hospital.id ? 'border-teal-700 ring-2 ring-teal-100' : 'border-slate-200'}`}>
                <button type="button" className="w-full text-left" onClick={() => setSelectedId(hospital.id)}>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-950">{hospital.name}</span>
                    {hospital.isSynthetic ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-950">{t('hospitals.syntheticLabel')}</span> : null}
                  </span>
                  <span className="mt-1 block text-sm text-slate-700">{hospital.address}, {hospital.city}, {hospital.district}</span>
                  <span className="mt-1 block text-sm text-slate-700">
                    {hospital.specialties?.join(', ') || hospital.services?.join(', ') || t('hospitals.specialtiesUnavailable')}
                  </span>
                  <span className="mt-1 block text-sm text-slate-700">
                    {hospital.distance !== null ? `${hospital.distance.toFixed(1)} km · ` : ''}
                    {hospital.rating != null ? `★ ${hospital.rating.toFixed(1)} · ` : `${t('hospitals.ratingNotProvided')} · `}
                    {t(`hospitals.ownershipValues.${hospital.ownership}`, { defaultValue: t('hospitals.ownershipValues.unknown') })}
                  </span>
                  {hospital.workingHours?.length ? (
                    <span className="mt-1 block text-sm text-slate-700">
                      {hospital.workingHours.map((item) => `${item.day.toUpperCase()} ${item.closed ? t('hospitals.closed') : `${item.opensAt}-${item.closesAt}`}`).join(' · ')}
                    </span>
                  ) : <span className="mt-1 block text-sm text-slate-600">{t('hospitals.hoursUnavailable')}</span>}
                </button>
                <div className="mt-3 flex flex-wrap gap-2">
                  {hospital.contactPhone ? <a className="min-h-touch rounded-lg border border-slate-300 px-3 py-2 font-semibold" href={`tel:${hospital.contactPhone}`}>{t('hospitals.call')} {hospital.contactPhone}</a> : null}
                  <Link className="inline-flex min-h-touch items-center rounded-lg border border-teal-700 px-3 py-2 font-semibold text-teal-900" to={`/patient/appointments?hospitalId=${encodeURIComponent(hospital.id)}`}>
                    {t('hospitals.bookAppointment')}
                  </Link>
                  {!hospital.isSynthetic && hospital.coordinates ? (
                    <>
                      <button type="button" className="min-h-touch rounded-lg border border-slate-300 px-3 py-2 font-semibold" onClick={() => previewRoute(hospital)}>
                        {t('hospitals.previewRoute')}
                      </button>
                      <button type="button" className="min-h-touch rounded-lg bg-teal-800 px-3 py-2 font-semibold text-white" onClick={() => startNavigation(hospital)}>
                        {t('hospitals.startNavigation')}
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
            {!visibleHospitals.length && !loading ? <li className="rounded-xl bg-slate-100 p-4 text-slate-700">{t('hospitals.noResults')}</li> : null}
          </ul>
        </section>
      </div>

      {selectedHospital ? (
        <section className="space-y-3 rounded-2xl border border-teal-200 bg-white p-4">
          <h2 className="font-bold">{t('hospitals.routeTitle', { name: selectedHospital.name })}</h2>
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input type="checkbox" checked={routeConsent} onChange={(event) => setRouteConsent(event.target.checked)} />
            <span>{t('hospitals.routePrivacy')}</span>
          </label>
          {route ? (
            <div className="space-y-2">
              <p className="font-semibold">{t('hospitals.routeSummary', { distance: route.distanceText, duration: route.durationText })}</p>
              <ol className="list-decimal space-y-1 pl-6">
                {route.steps.map((step, index) => (
                  <li key={`${step.instruction}-${index}`}>
                    {step.instruction} <span className="text-sm text-slate-600">({step.distanceText})</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
