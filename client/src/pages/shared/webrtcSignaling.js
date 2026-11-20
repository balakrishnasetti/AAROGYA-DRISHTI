export async function addIceCandidateOrQueue(peer, candidate, pendingCandidates) {
  if (peer.remoteDescription) {
    await peer.addIceCandidate(candidate);
  } else {
    pendingCandidates.push(candidate);
  }
}

export async function applyPendingIceCandidates(peer, pendingCandidates) {
  while (pendingCandidates.length && peer.remoteDescription) {
    await peer.addIceCandidate(pendingCandidates.shift());
  }
}
