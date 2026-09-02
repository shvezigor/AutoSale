'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';

export type EditableProduct = {
  id?: string | undefined;
  sku: string;
  name: string;
  description?: string | null | undefined;
  price?: number | null | undefined;
  currency?: string | null | undefined;
  stockQuantity?: number | null | undefined;
  category?: string | null | undefined;
  brand?: string | null | undefined;
  aliases?: string[] | undefined;
  color?: string | null | undefined;
  size?: string | null | undefined;
  imageUrls?: string[] | undefined;
  attributes?: Record<string, unknown> | undefined;
  active?: boolean | undefined;
  sourceId?: string | null | undefined;
  sourceRowKey?: string | null | undefined;
  sourceUpdatedAt?: string | null | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};

type ProductEditorProps = { product?: EditableProduct; onClose: () => void };
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'validation-error';

const emptyProduct: Required<Omit<EditableProduct, 'id'>> = {
  sku: '', name: '', description: null, price: null, currency: 'UAH', stockQuantity: null,
  category: null, brand: null, aliases: [], color: null, size: null, imageUrls: [], attributes: {}, active: true,
  sourceId: null, sourceRowKey: null, sourceUpdatedAt: null, createdAt: '', updatedAt: '',
};

export function ProductEditor({ product, onClose }: ProductEditorProps) {
  const router = useRouter();
  const initial = { ...emptyProduct, ...product };
  const [form, setForm] = useState(initial);
  const [aliasesText, setAliasesText] = useState((initial.aliases ?? []).join(', '));
  const [state, setState] = useState<SaveState>('idle');
  const editing = Boolean(product?.id);

  function update<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setState('idle');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const aliases = aliasesText.split(',').map((alias) => alias.trim()).filter(Boolean);
    if (new Set(aliases).size !== aliases.length) { setState('validation-error'); return; }
    setState('saving');
    try {
      const response = await mutatingFetch(editing ? `/api/catalogue/${product!.id}` : '/api/catalogue', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload(form, aliases)),
      });
      if (!response.ok) {
        setState('error');
        return;
      }

      setState('saved');
      router.refresh();
    } catch {
      setState('error');
    }
  }

  return <section className="product-editor" aria-labelledby="product-editor-title">
    <div className="product-editor-heading"><div><h2 id="product-editor-title">{editing ? 'Редагувати товар' : 'Новий товар'}</h2><p>Поля з позначкою * обов’язкові.</p></div><button className="text-button" onClick={onClose} type="button">Закрити</button></div>
    <form aria-busy={state === 'saving'} className="product-form" onSubmit={(event) => void save(event)}>
      <div className="product-form-grid">
        <label>Артикул *<input aria-label="Артикул" autoComplete="off" maxLength={120} onChange={(event) => update('sku', event.target.value)} required value={form.sku} /></label>
        <label>Назва товару *<input aria-label="Назва товару" maxLength={500} onChange={(event) => update('name', event.target.value)} required value={form.name} /></label>
        <label>Ціна<input inputMode="decimal" min="0" onChange={(event) => update('price', numberOrNull(event.target.value))} step="0.01" type="number" value={form.price ?? ''} /></label>
        <label>Валюта<input maxLength={3} onChange={(event) => update('currency', event.target.value)} value={form.currency ?? ''} /></label>
        <label>Залишок<input min="0" onChange={(event) => update('stockQuantity', integerOrNull(event.target.value))} step="1" type="number" value={form.stockQuantity ?? ''} /></label>
        <label>Категорія<input onChange={(event) => update('category', event.target.value)} value={form.category ?? ''} /></label>
        <label>Бренд<input onChange={(event) => update('brand', event.target.value)} value={form.brand ?? ''} /></label>
        <label>Колір<input onChange={(event) => update('color', event.target.value)} value={form.color ?? ''} /></label>
        <label>Розмір<input onChange={(event) => update('size', event.target.value)} value={form.size ?? ''} /></label>
        <label className="product-form-wide">Аліаси<input aria-describedby="aliases-hint" aria-label="Аліаси" onChange={(event) => { setAliasesText(event.target.value); setState('idle'); }} value={aliasesText} /><small id="aliases-hint">Відокремлюйте назви комами.</small></label>
        <label className="product-form-wide">Опис<textarea onChange={(event) => update('description', event.target.value)} value={form.description ?? ''} /></label>
      </div>
      <label className="active-field"><input checked={form.active ?? true} onChange={(event) => update('active', event.target.checked)} type="checkbox" /> Товар активний</label>
      <div className="product-editor-actions"><button className="primary-button" disabled={state === 'saving'} type="submit">{state === 'saving' ? 'Збереження…' : editing ? 'Зберегти зміни' : 'Додати товар'}</button><div aria-atomic="true" aria-live="polite">{state === 'saved' && <p className="save-success" role="status">{editing ? 'Зміни збережено' : 'Товар додано'}</p>}{state === 'error' && <p className="save-error" role="status">Не вдалося зберегти товар. Спробуйте ще раз.</p>}{state === 'validation-error' && <p className="save-error" role="status">Аліаси не мають повторюватися.</p>}</div></div>
    </form>
  </section>;
}

function buildPayload(form: EditableProduct, aliases: string[]) {
  return {
    sku: form.sku.trim(),
    name: form.name.trim(),
    description: nullable(form.description),
    price: form.price ?? null,
    currency: nullable(form.currency)?.toUpperCase() ?? null,
    stockQuantity: form.stockQuantity ?? null,
    category: nullable(form.category),
    brand: nullable(form.brand),
    aliases,
    color: nullable(form.color),
    size: nullable(form.size),
    imageUrls: form.imageUrls ?? [],
    attributes: form.attributes ?? {},
    active: form.active ?? true,
  };
}

function nullable(value: string | null | undefined) { const normalized = value?.trim(); return normalized ? normalized : null; }
function numberOrNull(value: string) { return value === '' ? null : Number(value); }
function integerOrNull(value: string) { return value === '' ? null : Number(value); }
