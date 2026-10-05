export interface SafeReplyInput {
  latestInbound: string;
  recentContext: string[];
}

export function buildSafeReplyInput(latestInbound: string, recentContext: readonly string[]): SafeReplyInput {
  return {
    latestInbound: sanitize(latestInbound, 600),
    recentContext: recentContext.slice(-3).map((line) => sanitize(line, 300)),
  };
}

function sanitize(value: string, maxLength: number): string {
  return value
    .replace(/\bUA\d{27}\b/giu, '[payment details removed]')
    .replace(/\b(?:\+?380|0)\d[\d\s()\-]{7,14}\b/gu, '[phone removed]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gu, '[email removed]')
    .replace(/\b(?:\d[ -]*?){16}\b/gu, '[payment details removed]')
    .replace(/(?:вул\.|вулиця|street|st\.|проспект|пр-т)\s+[^,\n.]{2,100}/giu, '[address removed]')
    .slice(0, maxLength)
    .trim();
}
