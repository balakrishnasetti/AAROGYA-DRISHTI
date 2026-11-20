import jwt from 'jsonwebtoken';
import { verifyAccessToken } from './tokenService.js';
import { ConsultationRequest, Consent, Patient, Session, User } from '../models/index.js';
import { writeAuditLog } from './auditService.js';

const roomFor = (id) => `consultation:${id}`;

export function createConsultationSocketServer(io, environment) {
  io.use(async (socket, next) => {
    try {
      const accessToken = socket.handshake.auth?.accessToken;
      if (!accessToken) return next(new Error('AUTHENTICATION_REQUIRED'));
      const payload = verifyAccessToken(accessToken, environment);
      const [session, user] = await Promise.all([
        Session.findOne({
          _id: payload.sid,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        }).select('_id role lastUsedAt'),
        User.findOne({ _id: payload.sub, status: 'active' }).select('_id role fullName'),
      ]);
      if (
        !session ||
        !user ||
        session.role !== user.role ||
        !session.lastUsedAt ||
        Date.now() - session.lastUsedAt.getTime() > 30 * 60 * 1000 ||
        !['doctor', 'patient'].includes(user.role)
      ) {
        return next(new Error('AUTHENTICATION_REQUIRED'));
      }
      socket.data.user = { id: user._id.toString(), role: user.role, name: user.fullName };
      return next();
    } catch {
      return next(new Error('AUTHENTICATION_REQUIRED'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);

    socket.on('consultation:join', async (input = {}, acknowledge = () => {}) => {
      try {
        const { requestId, roomToken } = input;
        if (typeof requestId !== 'string' || typeof roomToken !== 'string') {
          return acknowledge({ success: false, code: 'INVALID_JOIN_REQUEST' });
        }
        const request = await ConsultationRequest.findById(requestId)
          .select('patientId doctorId status callRoomName callStartedAt')
          .lean();
        if (!request || request.status !== 'accepted' || !request.callRoomName) {
          return acknowledge({ success: false, code: 'CALL_NOT_AVAILABLE' });
        }
        const patient =
          user.role === 'patient'
            ? await Patient.findOne({ _id: request.patientId, active: true })
                .select('userId')
                .lean()
            : null;
        const participant =
          (['doctor', 'specialist'].includes(user.role) &&
            request.doctorId.toString() === user.id) ||
          (user.role === 'patient' && patient?.userId.toString() === user.id);
        const token = jwt.verify(roomToken, environment.JWT_ACCESS_SECRET, {
          issuer: 'aarogya-drishti',
          audience: 'aarogya-consultation-room',
          algorithms: ['HS256'],
        });
        if (
          !participant ||
          token.sub !== user.id ||
          token.requestId !== requestId ||
          token.room !== request.callRoomName
        ) {
          return acknowledge({ success: false, code: 'CALL_ACCESS_DENIED' });
        }
        const consent = await Consent.findOne({
          patientId: request.patientId,
          consentType: 'teleconsultation',
        })
          .sort({ recordedAt: -1 })
          .select('granted withdrawnAt')
          .lean();
        if (!consent?.granted || consent.withdrawnAt) {
          return acknowledge({ success: false, code: 'TELECONSULTATION_CONSENT_REQUIRED' });
        }

        const room = roomFor(requestId);
        socket.data.callRequestId = requestId;
        socket.data.callRole = user.role;
        await socket.join(room);
        socket.to(room).emit('consultation:participant-joined', {
          role: user.role,
          name: user.name,
        });
        const participants = await io.in(room).fetchSockets();
        const roles = new Set(participants.map((item) => item.data.callRole));
        if (roles.has('patient') && roles.has('doctor')) {
          let startedAt = request.callStartedAt;
          if (!startedAt) {
            const now = new Date();
            const updated = await ConsultationRequest.findOneAndUpdate(
              { _id: requestId, status: 'accepted', callStartedAt: { $exists: false } },
              { $set: { callStartedAt: now } },
              { new: true },
            ).select('_id patientId doctorId hospitalId callStartedAt');
            startedAt = updated?.callStartedAt;
            if (updated) {
              await writeAuditLog({
                actorId: user.id,
                action: 'create',
                severity: 'medium',
                resourceType: 'teleconsultation_call',
                resourceId: requestId,
                hospitalId: updated.hospitalId,
                metadata: { event: 'call_started' },
              });
            }
          }
          if (startedAt) io.to(room).emit('consultation:call-started', { startedAt });
        }
        return acknowledge({ success: true });
      } catch {
        return acknowledge({ success: false, code: 'CALL_ACCESS_DENIED' });
      }
    });

    socket.on('consultation:signal', (message = {}) => {
      if (
        !socket.data.callRequestId ||
        typeof message.kind !== 'string' ||
        !['offer', 'answer', 'ice', 'restart'].includes(message.kind) ||
        !message.payload ||
        JSON.stringify(message.payload).length > 256_000
      ) {
        return;
      }
      socket.to(roomFor(socket.data.callRequestId)).emit('consultation:signal', {
        kind: message.kind,
        payload: message.payload,
      });
    });

    socket.on('consultation:chat', (message = {}) => {
      if (
        !socket.data.callRequestId ||
        typeof message.text !== 'string' ||
        !message.text.trim() ||
        message.text.length > 2000
      ) {
        return;
      }
      socket.to(roomFor(socket.data.callRequestId)).emit('consultation:chat', {
        text: message.text.trim(),
        sentAt: new Date().toISOString(),
        senderRole: user.role,
      });
    });

    socket.on('consultation:leave', () => {
      if (socket.data.callRequestId) {
        socket.to(roomFor(socket.data.callRequestId)).emit('consultation:participant-left', {
          role: user.role,
        });
        socket.leave(roomFor(socket.data.callRequestId));
        socket.data.callRequestId = null;
      }
    });
  });

  return io;
}
