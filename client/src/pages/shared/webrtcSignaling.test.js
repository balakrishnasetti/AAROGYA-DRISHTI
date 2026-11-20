import test from 'node:test';
import assert from 'node:assert/strict';
import { addIceCandidateOrQueue, applyPendingIceCandidates } from './webrtcSignaling.js';

test('ICE candidates received before remote description are queued and flushed in order', async () => {
  const added = [];
  const pending = [];
  const peer = {
    remoteDescription: null,
    async addIceCandidate(candidate) {
      added.push(candidate);
    },
  };
  const first = { candidate: 'first' };
  const second = { candidate: 'second' };

  await addIceCandidateOrQueue(peer, first, pending);
  await addIceCandidateOrQueue(peer, second, pending);
  assert.deepEqual(added, []);
  assert.deepEqual(pending, [first, second]);

  peer.remoteDescription = { type: 'offer' };
  await applyPendingIceCandidates(peer, pending);
  assert.deepEqual(added, [first, second]);
  assert.deepEqual(pending, []);
});

test('ICE candidates are added immediately after remote description is set', async () => {
  const candidate = { candidate: 'ready' };
  const added = [];
  const peer = {
    remoteDescription: { type: 'answer' },
    async addIceCandidate(item) {
      added.push(item);
    },
  };

  await addIceCandidateOrQueue(peer, candidate, []);
  assert.deepEqual(added, [candidate]);
});
