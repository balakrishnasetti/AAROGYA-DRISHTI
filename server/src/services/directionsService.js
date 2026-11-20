import { ApiError } from '../utils/apiError.js';

const DIRECTIONS_ENDPOINT = 'https://maps.googleapis.com/maps/api/directions/json';

function coordinatePair(value) {
  return `${value.latitude},${value.longitude}`;
}

function plainInstruction(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export async function getDrivingDirections({
  origin,
  destination,
  apiKey,
  language = 'en',
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey) {
    throw new ApiError(503, 'DIRECTIONS_UNAVAILABLE', 'Turn-by-turn route preview is not configured. You can still open navigation in Google Maps.');
  }
  const url = new URL(DIRECTIONS_ENDPOINT);
  url.searchParams.set('origin', coordinatePair(origin));
  url.searchParams.set('destination', coordinatePair(destination));
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('language', language);
  url.searchParams.set('key', apiKey);

  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new ApiError(502, 'DIRECTIONS_PROVIDER_UNAVAILABLE', 'Route preview could not be reached. Open Google Maps to navigate.');
  }
  if (!response.ok) {
    throw new ApiError(502, 'DIRECTIONS_PROVIDER_UNAVAILABLE', 'Route preview could not be loaded. Open Google Maps to navigate.');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(502, 'DIRECTIONS_PROVIDER_INVALID_RESPONSE', 'The route provider returned an invalid response.');
  }
  if (result.status !== 'OK' || !result.routes?.[0]?.legs?.[0]) {
    throw new ApiError(404, 'DIRECTIONS_NOT_FOUND', 'No driving route was found. Check the destination or open Google Maps.');
  }

  const leg = result.routes[0].legs[0];
  return {
    encodedPolyline: String(result.routes[0].overview_polyline?.points ?? '').slice(0, 100000),
    distanceMeters: leg.distance.value,
    distanceText: leg.distance.text,
    durationSeconds: leg.duration.value,
    durationText: leg.duration.text,
    steps: (leg.steps ?? []).slice(0, 60).map((step) => ({
      instruction: plainInstruction(step.html_instructions),
      distanceText: String(step.distance?.text ?? ''),
      durationText: String(step.duration?.text ?? ''),
    })),
  };
}
