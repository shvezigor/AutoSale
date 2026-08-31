import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutatingFetch } = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));

import { CatalogueImportWizard } from './catalogue-import-wizard';

const runId = '11111111-1111-4111-8111-111111111111';
const upload = { id: runId, sourceId: '22222222-2222-4222-8222-222222222222', status: 'UPLOADED', totalRows: 2, validRows: 0, createdRows: 0, updatedRows: 0, skippedRows: 0, failedRows: 0, startedAt: null, completedAt: null, headers: ['sku', 'name', 'note'] };
const proposal = { ...upload, status: 'MAPPING_REVIEW', mapping: { columns: [{ source: 'sku', target: 'sku', confidence: 0.99 }, { source: 'name', target: 'name', confidence: 0.98 }, { source: 'note', target: 'ignore', confidence: 0.7 }], aiModel: 'gpt-5.4-mini', promptVersion: 'catalogue-column-mapping-v1', schemaVersion: 'catalogue-mapping-proposal-v1' }, mappingFailure: null };
const preview = { rows: [], totals: { created: 1, updated: 1, skipped: 0, failed: 0 } };

afterEach(() => { cleanup(); mutatingFetch.mockReset(); vi.unstubAllGlobals(); });

describe('CatalogueImportWizard', () => {
  it('moves an owner through source upload, reviewed mapping, preview, confirmation, and progress without persisting source rows', async () => {
    mutatingFetch
      .mockResolvedValueOnce(response(upload))
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(response({ ...upload, status: 'PROCESSING' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(proposal)));
    render(<CatalogueImportWizard session={{ membershipRole: 'OWNER' }} />);

    expect(screen.getAllByText(/Крок [1-7] з 7/)).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Обрати файл' }));
    fireEvent.change(screen.getByLabelText('Файл каталогу'), { target: { files: [new File(['sku,name\nA,Alpha'], 'catalogue.csv', { type: 'text/csv' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Завантажити каталог' }));

    await screen.findByText('AI запропонував зіставлення');
    expect(screen.getByText('99%')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'category' } });
    fireEvent.click(screen.getByRole('button', { name: 'Перевірити зіставлення' }));
    await screen.findByText('Обов’язкові поля зіставлено');
    fireEvent.click(screen.getByRole('button', { name: 'Створити попередній перегляд' }));
    await screen.findByText('Нових: 1');
    expect(screen.getByRole('button', { name: 'Підтвердити імпорт' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Я підтверджую зіставлення та підсумки попереднього перегляду'));
    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити імпорт' }));
    await screen.findByText('Імпорт обробляється');

    expect(mutatingFetch).toHaveBeenNthCalledWith(1, '/api/catalogue/imports/upload', expect.objectContaining({ method: 'POST' }));
    expect(mutatingFetch).toHaveBeenNthCalledWith(2, `/api/catalogue/imports/${runId}/mapping`, expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('category') }));
    expect(mutatingFetch).toHaveBeenNthCalledWith(3, `/api/catalogue/imports/${runId}/confirm`, expect.objectContaining({ method: 'POST' }));
    expect(window.location.search).not.toContain('Alpha');
    expect(window.localStorage.length).toBe(0);
  });

  it('offers an empty manual mapping when the AI mapper is unavailable and blocks a missing required field', async () => {
    mutatingFetch.mockResolvedValueOnce(response(upload));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...upload, status: 'MAPPING_REVIEW', mapping: null, mappingFailure: 'MAPPING_UNAVAILABLE' })));
    render(<CatalogueImportWizard session={{ membershipRole: 'OWNER' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Обрати файл' }));
    fireEvent.change(screen.getByLabelText('Файл каталогу'), { target: { files: [new File(['sku,name\nA,Alpha'], 'catalogue.csv', { type: 'text/csv' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Завантажити каталог' }));

    await screen.findByText('AI недоступний — зіставте колонки вручну');
    fireEvent.change(screen.getByLabelText('sku'), { target: { value: 'sku' } });
    fireEvent.click(screen.getByRole('button', { name: 'Перевірити зіставлення' }));
    expect(screen.getByText('Зіставте обов’язкові поля SKU та назву.')).toBeInTheDocument();
  });
});

function response(body: unknown) { return { ok: true, json: async () => body } as Response; }
