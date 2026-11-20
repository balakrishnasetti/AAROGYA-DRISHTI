import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { VideoSession } from '../models/index.js';

export function createVideoSessionService({
  videoSessionModel = VideoSession,
  jwtSecret = process.env.JWT_ACCESS_SECRET,
} = {}) {
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('A strong video-session signing secret is required.');
  }

  async function createSession({
    appointmentId,
    patientId,
    patientUserId,
    doctorId,
    clinicianRole = 'doctor',
    hospitalId,
    slotStart,
    provider = 'webrtc',
  }) {
    const appointmentStart = new Date(slotStart);
    const joinTokenExpiresAt = new Date(appointmentStart.getTime() + 30 * 60 * 1000);
    const roomName = `video-${appointmentId.toString()}-${crypto.randomUUID()}`;
    const participants = [
      { userId: patientUserId, role: 'patient', displayName: 'Patient', status: 'waiting' },
      {
        userId: doctorId,
        role: clinicianRole,
        displayName: clinicianRole === 'specialist' ? 'Specialist' : 'Doctor',
        status: 'waiting',
      },
    ];
    const session = await videoSessionModel.create({
      appointmentId,
      patientId,
      doctorId,
      hospitalId,
      slotStart: appointmentStart,
      roomName,
      provider,
      status: 'scheduled',
      joinTokenExpiresAt,
      recordingEnabled: false,
      participants,
      joinTokenHashes: [],
    });

    const tokens = {};
    for (const participant of participants) {
      const token = jwt.sign(
        {
          sub: participant.userId.toString(),
          role: participant.role,
          room: roomName,
          videoSessionId: session._id.toString(),
        },
        jwtSecret,
        {
          expiresIn: Math.max(1, Math.floor((joinTokenExpiresAt.getTime() - Date.now()) / 1000)),
          issuer: 'aarogya-drishti',
          audience: 'aarogya-video-participant',
          algorithm: 'HS256',
        },
      );
      tokens[participant.userId.toString()] = token;
      session.joinTokenHashes.push({
        userId: participant.userId,
        role: participant.role,
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        expiresAt: joinTokenExpiresAt,
      });
    }
    await session.save();
    return { session, tokens };
  }

  async function validateJoinToken({ videoSessionId, userId, token }) {
    if (!videoSessionId || !userId || !token) return false;
    const session = await videoSessionModel.findById(videoSessionId).select('+joinTokenHashes.tokenHash').lean();
    if (!session || ['cancelled', 'ended', 'failed'].includes(session.status)) return false;

    const now = Date.now();
    const startsAt = new Date(session.slotStart).getTime();
    if (now < startsAt - 10 * 60 * 1000 || now > startsAt + 30 * 60 * 1000) return false;

    try {
      const payload = jwt.verify(token, jwtSecret, {
        issuer: 'aarogya-drishti',
        audience: 'aarogya-video-participant',
        algorithms: ['HS256'],
      });
      if (payload.videoSessionId !== session._id.toString()) return false;
      if (payload.room !== session.roomName || payload.sub !== userId.toString()) return false;

      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const allowedToken = session.joinTokenHashes?.find(
        (item) =>
          item.userId.toString() === userId.toString() &&
          item.role === payload.role &&
          item.tokenHash === hash &&
          new Date(item.expiresAt).getTime() > now,
      );
      const participant = session.participants?.find(
        (item) => item.userId.toString() === userId.toString() && item.role === payload.role,
      );
      return Boolean(allowedToken && participant);
    } catch {
      return false;
    }
  }

  return { createSession, validateJoinToken };
}
