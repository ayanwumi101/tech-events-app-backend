import crypto from "node:crypto";

import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";

import { env } from "../config/env.js";
import { addDays, addSeconds } from "./time.js";
import { AccessTokenPayload, RefreshTokenPayload, SessionTokens } from "../types/auth.js";

interface CreateSessionTokensInput {
  userId: string;
}

interface DecodedAccessToken extends AccessTokenPayload {
  iat: number;
  exp: number;
}

interface DecodedRefreshToken extends RefreshTokenPayload {
  iat: number;
  exp: number;
}

export interface RefreshTokenRecordInput {
  id: string;
  tokenHash: string;
  expiresAt: Date;
}

export const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

export const createSessionTokens = ({
  userId,
}: CreateSessionTokensInput): {
  tokens: SessionTokens;
  refreshTokenRecord: RefreshTokenRecordInput;
} => {
  const now = new Date();
  const accessExpiresAt = addSeconds(now, env.accessTokenTtlSeconds);
  const refreshExpiresAt = addDays(now, env.REFRESH_TOKEN_TTL_DAYS);
  const refreshTokenId = nanoid(32);

  const accessToken = jwt.sign(
    {
      sub: userId,
      type: "access",
    } satisfies AccessTokenPayload,
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
    },
  );

  const refreshToken = jwt.sign(
    {
      sub: userId,
      jti: refreshTokenId,
      type: "refresh",
    } satisfies RefreshTokenPayload,
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d` as jwt.SignOptions["expiresIn"],
    },
  );

  return {
    tokens: {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: accessExpiresAt.toISOString(),
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    },
    refreshTokenRecord: {
      id: refreshTokenId,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiresAt,
    },
  };
};

export const verifyAccessToken = (token: string): DecodedAccessToken => {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as DecodedAccessToken;
};

export const verifyRefreshToken = (token: string): DecodedRefreshToken => {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as DecodedRefreshToken;
};
