import type { AiProviderUsageStore } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';

import { createWorkerResponses } from '../ai-usage/worker-responses.js';
import type { ResponsesRequest } from '../ai-usage/metered-responses.js';
import { CatalogueMappingProcessor } from './catalogue-mapping.processor.js';
import { GoogleCatalogueSyncProcessor } from './google-catalogue-sync.processor.js';
import { OpenAiColumnMapper } from './openai-column-mapper.js';
import { OpenAiTableStructureAnalyzer } from './openai-table-structure-analyzer.js';
import { OpenAiAmbiguousRowClassifier } from './openai-ambiguous-row-classifier.js';

vi.mock('@autosale/database', async (importOriginal) => ({
  ...await importOriginal<typeof import('@autosale/database')>(),
  withTenantTransaction: async <T>(prisma: unknown, _tenantId: string, operation: (transaction: unknown) => Promise<T>) => operation(prisma),
}));

const tenantId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const sourceId = '33333333-3333-4333-8333-333333333333';
type Mode = 'mapping' | 'hybrid' | 'google';
type Stop = 'freeze' | 'revoke' | 'expire';
type Stage = 'read' | 'structure' | 'column-batch' | 'row-batch';

function fixture(mode: Mode, stop: Stop, stage: Stage, enabled: boolean) {
  let frozen = false;
  let revoked = false;
  let expired = false;
  const interrupt = () => {
    if (stop === 'freeze') frozen = true;
    if (stop === 'revoke') revoked = true;
    if (stop === 'expire') expired = true;
  };
  const store = {
    start: vi.fn<AiProviderUsageStore['start']>().mockResolvedValue(undefined),
    finalize: vi.fn<AiProviderUsageStore['finalize']>().mockResolvedValue(true),
  };
  const create = vi.fn().mockImplementation(async (request: ResponsesRequest) => {
    const schema = request.text?.format?.type === 'json_schema' ? request.text.format.name : '';
    let output: unknown;
    if (schema === 'catalogue_column_mapping') {
      const { headers } = JSON.parse(String(request.input)) as { headers: string[] };
      output = { columns: headers.map((source) => ({ source, target: 'ignore', confidence: 0.5 })) };
      if (stage === 'column-batch') interrupt();
    } else if (schema === 'catalogue_table_structure') {
      output = { headerStartRow: 1, headerEndRow: 1, dataStartRow: 2, structureConfidence: 0.6,
        columns: [{ index: 0, label: 'Name', target: 'name', confidence: 0.9 },
          { index: 1, label: 'Price', target: 'price', confidence: 0.9 }] };
      if (stage === 'structure') interrupt();
    } else {
      const { rows } = JSON.parse(String(request.input)) as { rows: Array<{ rowNumber: number }> };
      output = { decisions: rows.map(({ rowNumber }) => ({ rowNumber, kind: 'SKIP', confidence: 0.9 })) };
      if (stage === 'row-batch') interrupt();
    }
    return { id: 'resp-fictional', model: 'fictional-model', output_text: JSON.stringify(output),
      usage: { input_tokens: 10, output_tokens: 2 } };
  });
  const boundary = createWorkerResponses('fictional-key', enabled, store, vi.fn(), () => ({ responses: { create } }));
  const mapper = new OpenAiColumnMapper(boundary, 'fictional-model');
  const hybrid = { structureAnalyzer: new OpenAiTableStructureAnalyzer(boundary, 'fictional-model'),
    ambiguousRows: new OpenAiAmbiguousRowClassifier(boundary, 'fictional-model') };
  let activeLease: string | null = null;
  const update = vi.fn().mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const lease = where.mappingLeaseId ?? where.syncLeaseId;
    if (lease) {
      if (revoked || (expired && (where.mappingLeaseExpiresAt || where.syncLeaseExpiresAt))) return { count: 0 };
      expect(lease).toBe(activeLease);
    }
    if (data.mappingLeaseId) activeLease = String(data.mappingLeaseId);
    if (data.syncLeaseId) activeLease = String(data.syncLeaseId);
    return { count: 1 };
  });
  const lifecycle = vi.fn().mockImplementation(async () => frozen ? { id: 'fictional-deletion-request' } : null);
  const prisma = {
    tenantLifecycleRequest: { findFirst: lifecycle },
    catalogueImportRun: { updateMany: update, findFirst: vi.fn().mockResolvedValue({
      id: runId, tenantId, sourceId, sourceRevision: 'fictional-revision',
      source: { type: 'CSV_UPLOAD', objectKey: 'fictional.csv', headerFingerprint: 'fictional-fingerprint' },
    }), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: runId }) },
    catalogueSource: { updateMany: update, findFirst: vi.fn().mockResolvedValue({
      id: sourceId, spreadsheetId: 'fictional-sheet', sheetName: 'Fictional tab', syncVersion: 1, syncSchedule: 'MANUAL',
    }) },
    catalogueMapping: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'fictional-mapping' }) },
  };
  const dataRows = Array.from({ length: stage === 'row-batch' ? 101 : 1 }, (_, index) => [null, index + 1]);
  const matrix = { revision: 'fictional-revision',
    rows: [['Name', 'Price'], ['Fictional product', 10], ...dataRows].map((cells, index) => ({ rowNumber: index + 1, cells })) };
  const read = () => { if (stage === 'read') interrupt(); };
  const storage = { get: vi.fn().mockImplementation(async () => {
    read();
    const csv = stage === 'column-batch'
      ? Array.from({ length: 51 }, (_, index) => 'Fictional ' + index).join(',') + '\n'
      : 'Name,Price\nFictional product,10\n' + dataRows.map((row) => ',' + row[1]).join('\n') + '\n';
    return { body: Buffer.from(csv) };
  }), put: vi.fn().mockResolvedValue({ key: 'fictional-snapshot' }) };
  const process = mode === 'google'
    ? () => new GoogleCatalogueSyncProcessor(prisma as never, { readMatrix: async () => { read(); return matrix; } } as never,
      storage as never, undefined, undefined, undefined, hybrid).process({ tenantId, sourceId, finalAttempt: false })
    : () => new CatalogueMappingProcessor(prisma as never, storage as never, mapper, undefined, mode === 'hybrid' ? hybrid : undefined)
      .process({ tenantId, runId });
  return { process, store, create, lifecycle, update, prisma };
}

describe.each([false, true])('catalogue dispatch gates (collection=%s)', (enabled) => {
  it.each(['mapping', 'hybrid', 'google'] as const)('stops %s when freeze starts during source read', async (mode) => {
    const f = fixture(mode, 'freeze', 'read', enabled);
    expect(await f.process()).toMatchObject({ status: 'IGNORED_FROZEN' });
    expect(f.create).not.toHaveBeenCalled();
    expect(f.store.start).not.toHaveBeenCalled();
  });

  it.each(['revoke', 'expire'] as const)('stops Google source dispatch when its lease changes (%s) during readMatrix', async (stop) => {
    const f = fixture('google', stop, 'read', enabled);
    expect(await f.process()).toMatchObject({ status: 'BUSY' });
    expect(f.create).not.toHaveBeenCalled();
    expect(f.store.start).not.toHaveBeenCalled();
  });

  it.each(['hybrid', 'google'] as const)('rechecks %s between structure and classification', async (mode) => {
    const f = fixture(mode, 'freeze', 'structure', enabled);
    expect(await f.process()).toMatchObject({ status: 'IGNORED_FROZEN' });
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.store.start).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(f.store.finalize).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });

  it.each([
    ['mapping', 'column-batch', 1],
    ['hybrid', 'row-batch', 2],
    ['google', 'row-batch', 2],
  ] as const)('stops %s %s after freeze without opening another attempt', async (mode, stage, dispatched) => {
    const f = fixture(mode, 'freeze', stage, enabled);
    expect(await f.process()).toMatchObject({ status: 'IGNORED_FROZEN' });
    expect(f.create).toHaveBeenCalledTimes(dispatched);
    expect(f.store.start).toHaveBeenCalledTimes(enabled ? dispatched : 0);
    expect(f.store.finalize).toHaveBeenCalledTimes(enabled ? dispatched : 0);
  });

  it.each([
    ['mapping', 'column-batch', 'revoke', 1],
    ['hybrid', 'row-batch', 'revoke', 2],
    ['google', 'row-batch', 'revoke', 2],
    ['hybrid', 'structure', 'revoke', 1],
    ['google', 'structure', 'revoke', 1],
    ['mapping', 'column-batch', 'expire', 1],
    ['hybrid', 'row-batch', 'expire', 2],
    ['google', 'row-batch', 'expire', 2],
  ] as const)('stops %s %s after lease change (%s) without provider retry', async (mode, stage, stop, dispatched) => {
    const f = fixture(mode, stop, stage, enabled);
    expect(await f.process()).toMatchObject({ status: mode === 'google' ? 'BUSY' : 'SKIPPED' });
    expect(f.create).toHaveBeenCalledTimes(dispatched);
    expect(f.store.start).toHaveBeenCalledTimes(enabled ? dispatched : 0);
    expect(f.store.finalize).toHaveBeenCalledTimes(enabled ? dispatched : 0);
    if (enabled) expect(f.store.finalize.mock.calls.every(([, , outcome]) => outcome === 'REPORTED')).toBe(true);
    expect(f.prisma.catalogueMapping.create).not.toHaveBeenCalled();
  });
});
