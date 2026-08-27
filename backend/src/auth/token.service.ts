import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

const REFRESH_TTL_MS = parseTtlToMs(process.env.JWT_REFRESH_TTL ?? '7d');

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  signAccessToken(userId: string, tenantId: string): string {
    return this.jwt.sign(
      { sub: userId, tenantId, type: 'access' },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
      },
    );
  }

  /** Issues a fresh opaque refresh token and stores only its hash. */
  async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(48).toString('hex');
    const tokenHash = hashToken(raw);
    await this.tenantPrisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return raw;
  }

  async issueTokenPair(userId: string, tenantId: string): Promise<TokenPair> {
    return {
      accessToken: this.signAccessToken(userId, tenantId),
      refreshToken: await this.issueRefreshToken(userId),
      expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
    };
  }

  /** Looks up a live (unrevoked, unexpired) refresh token by its raw value. */
  async findLiveRefreshToken(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    return this.tenantPrisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.tenantPrisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every live refresh token for a user — "log out everywhere". */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.tenantPrisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function parseTtlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return value * unitMs;
}
