import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { hashToken } from './authCrypto.js';
import { Session, User } from '../models/index.js';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signAccessToken(user, sessionId, environment) {
  return jwt.sign(
    { role: user.role, sid: sessionId.toString(), tokenUse: 'access' },
    environment.JWT_ACCESS_SECRET,
    {
      subject: user._id.toString(),
      expiresIn: ACCESS_TTL_SECONDS,
      issuer: 'aarogya-drishti',
      audience: 'aarogya-drishti-client',
      algorithm: 'HS256',
    },
  );
}

export function signFlowToken(userId, purpose, environment) {
  return jwt.sign({ tokenUse: 'flow', purpose }, environment.JWT_ACCESS_SECRET, {
    subject: userId.toString(),
    expiresIn: '10m',
    issuer: 'aarogya-drishti',
    audience: 'aarogya-drishti-client',
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token, environment) {
  const payload = jwt.verify(token, environment.JWT_ACCESS_SECRET, {
    issuer: 'aarogya-drishti',
    audience: 'aarogya-drishti-client',
    algorithms: ['HS256'],
  });
  if (payload.tokenUse !== 'access' || !payload.sid || !payload.sub) {
    throw new Error('Access token is invalid.');
  }
  return payload;
}

export function verifyFlowToken(token, purpose, environment) {
  const payload = jwt.verify(token, environment.JWT_ACCESS_SECRET, {
    issuer: 'aarogya-drishti',
    audience: 'aarogya-drishti-client',
    algorithms: ['HS256'],
  });
  if (payload.tokenUse !== 'flow' || payload.purpose !== purpose || !payload.sub) {
    throw new Error('Authentication step is invalid.');
  }
  return payload;
}

export async function createSession(user, req, environment) {
  const refreshToken = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const session = await Session.create({
    userId: user._id,
    role: user.role,
    refreshTokenHash: hashToken(refreshToken),
    userAgent: req.get('user-agent')?.slice(0, 500),
    expiresAt,
    lastUsedAt: new Date(),
    isSynthetic: user.isSynthetic === true,
  });

  return {
    session,
    refreshToken,
    accessToken: signAccessToken(user, session._id, environment),
    accessExpiresIn: ACCESS_TTL_SECONDS,
  };
}

export async function rotateSession(refreshToken, req, environment) {
  if (typeof refreshToken !== 'string' || refreshToken.length < 50 || refreshToken.length > 200) {
    return null;
  }

  const nextRefreshToken = randomBytes(48).toString('base64url');
  const session = await Session.findOneAndUpdate(
    {
      refreshTokenHash: hashToken(refreshToken),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    },
    {
      $set: {
        refreshTokenHash: hashToken(nextRefreshToken),
        lastUsedAt: new Date(),
        userAgent: req.get('user-agent')?.slice(0, 500),
      },
    },
    { new: true },
  );
  if (!session) return null;

  const user = await User.findOne({ _id: session.userId, status: 'active' }).select(
    'fullName email phone role mustChangePassword isSynthetic district mandal phc',
  );
  if (!user || user.mustChangePassword || session.role !== user.role) {
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
    return null;
  }

  return {
    session,
    refreshToken: nextRefreshToken,
    accessToken: signAccessToken(user, session._id, environment),
    accessExpiresIn: ACCESS_TTL_SECONDS,
    user,
  };
}

export const refreshTtlMs = REFRESH_TTL_MS;
