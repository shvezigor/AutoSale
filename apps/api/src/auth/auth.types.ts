export interface SessionMetadata {
  ipPrefix?: string;
  userAgent?: string;
}

export interface IssuedSession {
  sessionId: string;
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}
