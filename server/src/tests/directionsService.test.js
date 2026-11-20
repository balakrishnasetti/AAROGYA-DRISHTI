import test from 'node:test';
import assert from 'node:assert/strict';
import { getDrivingDirections } from '../services/directionsService.js';

test('directions are sanitized and return route details without exposing the provider key', async () => {
  let requestedUrl;
  const directions = await getDrivingDirections({
    origin: { latitude: 18.08, longitude: 82.66 },
    destination: { latitude: 17.72, longitude: 83.3 },
    apiKey: 'server-only-test-key',
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        async json() {
          return {
            status: 'OK',
            routes: [{
              overview_polyline: { points: 'encoded-route' },
              legs: [{
                distance: { value: 1000, text: '1 km' },
                duration: { value: 600, text: '10 mins' },
                steps: [{
                  html_instructions: 'Turn <b>left</b> &amp; continue',
                  distance: { text: '1 km' },
                  duration: { text: '10 mins' },
                }],
              }],
            }],
          };
        },
      };
    },
  });

  assert.equal(requestedUrl.searchParams.get('key'), 'server-only-test-key');
  assert.equal(directions.distanceText, '1 km');
  assert.equal(directions.durationText, '10 mins');
  assert.equal(directions.encodedPolyline, 'encoded-route');
  assert.equal(directions.steps[0].instruction, 'Turn left & continue');
  assert.equal(JSON.stringify(directions).includes('server-only-test-key'), false);
});

test('directions fail clearly when the server key is not configured', async () => {
  await assert.rejects(
    () => getDrivingDirections({
      origin: { latitude: 18.08, longitude: 82.66 },
      destination: { latitude: 17.72, longitude: 83.3 },
      apiKey: '',
    }),
    (error) => error.code === 'DIRECTIONS_UNAVAILABLE',
  );
});
