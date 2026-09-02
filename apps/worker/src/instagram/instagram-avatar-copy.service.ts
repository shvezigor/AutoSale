import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

import type { ObjectStorage } from '@autosale/integrations';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const ALLOWED_HOST_SUFFIXES = ['cdninstagram.com', 'fbcdn.net', 'fbsbx.com'] as const;
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export interface ResolvedAvatarAddress {
  address: string;
  family: 4 | 6;
}

export interface PinnedAvatarResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
}

type ResolveHost = (hostname: string) => Promise<ResolvedAvatarAddress[]>;
type RequestPinned = (
  url: URL,
  address: ResolvedAvatarAddress,
  signal: AbortSignal,
) => Promise<PinnedAvatarResponse>;

export class AvatarCopyError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AvatarCopyError';
  }
}

export class InstagramAvatarCopyService {
  private readonly resolveHost: ResolveHost;
  private readonly requestPinned: RequestPinned;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly storage: ObjectStorage,
    options: {
      resolveHost?: ResolveHost;
      requestPinned?: RequestPinned;
      maxBytes?: number;
      timeoutMs?: number;
    } = {},
  ) {
    this.resolveHost = options.resolveHost ?? resolvePublicAddresses;
    this.requestPinned = options.requestPinned ?? requestPinnedHttps;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async copy(input: { tenantId: string; profileId: string; refreshVersion: number; sourceUrl: string }): Promise<{
    key: string;
    etag: string;
    checksum: string;
    contentType: string;
  }> {
    try {
      if (!Number.isSafeInteger(input.refreshVersion) || input.refreshVersion < 1) {
        throw new AvatarCopyError('INVALID_AVATAR_REFRESH_VERSION', false, 'Avatar refresh version is invalid');
      }
      const url = parseAllowedUrl(input.sourceUrl);
      const addresses = await this.resolveHost(url.hostname);
      if (addresses.length === 0) {
        throw new AvatarCopyError('AVATAR_DNS_FAILURE', true, 'Avatar hostname has no addresses');
      }
      if (addresses.some(({ address }) => !isPublicAddress(address))) {
        throw new AvatarCopyError('UNSAFE_AVATAR_ADDRESS', false, 'Avatar hostname resolves to a non-public address');
      }

      const response = await this.requestPinned(url, addresses[0]!, AbortSignal.timeout(this.timeoutMs));
      if (response.status < 200 || response.status >= 300) {
        throw new AvatarCopyError(
          'AVATAR_UPSTREAM_HTTP',
          response.status === 429 || response.status >= 500,
          `Avatar provider returned HTTP ${response.status}`,
        );
      }

      const contentType = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
      const extension = contentType ? MIME_EXTENSIONS.get(contentType) : undefined;
      if (!contentType || !extension) {
        throw new AvatarCopyError('UNSUPPORTED_AVATAR_TYPE', false, 'Avatar content type is not supported');
      }
      const contentLength = Number(response.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > this.maxBytes) {
        throw new AvatarCopyError('AVATAR_TOO_LARGE', false, 'Avatar exceeds the configured byte ceiling');
      }

      const body = await readWithLimit(response.body, this.maxBytes);
      if (!matchesMimeSignature(body, contentType)) {
        throw new AvatarCopyError('INVALID_AVATAR_BODY', false, 'Avatar bytes do not match the declared content type');
      }
      const checksum = createHash('sha256').update(body).digest('hex');
      const key = `tenants/${input.tenantId}/instagram/profiles/${input.profileId}/versions/${input.refreshVersion}/sha256/${checksum}.${extension}`;
      const stored = await this.storage.put({ key, body, contentType });
      return { ...stored, checksum, contentType };
    } catch (error) {
      if (error instanceof AvatarCopyError) throw error;
      throw new AvatarCopyError('AVATAR_UPSTREAM_FAILURE', true, 'Unable to copy Instagram avatar', { cause: error });
    }
  }
}

function parseAllowedUrl(sourceUrl: string): URL {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new AvatarCopyError('UNSAFE_AVATAR_URL', false, 'Avatar URL is invalid');
  }
  const hostname = url.hostname.toLowerCase();
  const allowed = ALLOWED_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.port !== '' && url.port !== '443') ||
    isIP(hostname) !== 0 ||
    !allowed
  ) {
    throw new AvatarCopyError('UNSAFE_AVATAR_URL', false, 'Avatar URL is not allowlisted');
  }
  return url;
}

async function resolvePublicAddresses(hostname: string): Promise<ResolvedAvatarAddress[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.flatMap(({ address, family }) => family === 4 || family === 6
    ? [{ address, family }]
    : []);
}

function requestPinnedHttps(
  url: URL,
  address: ResolvedAvatarAddress,
  signal: AbortSignal,
): Promise<PinnedAvatarResponse> {
  return new Promise((resolve, reject) => {
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, address.address, address.family);
    };
    const outgoing = request(url, {
      method: 'GET',
      agent: false,
      lookup: pinnedLookup,
      servername: url.hostname,
      headers: { host: url.host, accept: 'image/jpeg,image/png,image/webp' },
    }, (incoming) => {
      resolve({
        status: incoming.statusCode ?? 0,
        headers: {
          'content-type': singleHeader(incoming.headers['content-type']),
          'content-length': singleHeader(incoming.headers['content-length']),
        },
        body: incoming,
      });
    });
    const abort = () => outgoing.destroy(new Error('Avatar request aborted'));
    signal.addEventListener('abort', abort, { once: true });
    outgoing.once('close', () => signal.removeEventListener('abort', abort));
    outgoing.once('error', reject);
    outgoing.end();
  });
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readWithLimit(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new AvatarCopyError('AVATAR_TOO_LARGE', false, 'Avatar exceeds the configured byte ceiling');
    }
    chunks.push(chunk);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function matchesMimeSignature(body: Uint8Array, contentType: string): boolean {
  if (contentType === 'image/jpeg') return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (contentType === 'image/png') {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((byte, index) => body[index] === byte);
  }
  return contentType === 'image/webp' &&
    String.fromCharCode(...body.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...body.slice(8, 12)) === 'WEBP';
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPublicIpv4(mapped);
  return !(
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  );
}

function isPublicIpv4(address: string): boolean {
  const [a, b, c] = address.split('.').map(Number);
  return !(
    a === 0 || a === 10 || a === 127 || a === 255 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  );
}
