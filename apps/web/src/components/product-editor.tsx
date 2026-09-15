'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';

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
  const activity = useActivity();
  const toast = useToast();
  const { t } = useI18n();

  useEffect(() => {
    const next = { ...emptyProduct, ...product };
    setForm(next);
    setAliasesText((next.aliases ?? []).join(', '));
    setState('idle');
  }, [product]);

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
      const response = await activity.run(t('catalogue.savingProduct'), () => mutatingFetch(editing ? `/api/catalogue/${product!.id}` : '/api/catalogue', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload(form, aliases)),
      }));
      if (!response.ok) {
        setState('error');
        toast.show({ type: 'error', title: t('catalogue.saveFailed') });
        return;
      }

      setState('saved');
      toast.show({ type: 'success', title: editing ? t('catalogue.changesSavedToast') : t('catalogue.addedToast') });
      router.refresh();
    } catch {
      setState('error');
      toast.show({ type: 'error', title: t('catalogue.saveFailed') });
    }
  }

  return <section className="product-editor" aria-labelledby="product-editor-title">
    <div className="product-editor-heading"><div><h2 id="product-editor-title">{editing ? t('catalogue.editTitle') : t('catalogue.newTitle')}</h2><p>{t('catalogue.requiredHint')}</p></div><button className="text-button" onClick={onClose} type="button">{t('catalogue.close')}</button></div>
    <form aria-busy={state === 'saving'} className="product-form" onSubmit={(event) => void save(event)}>
      <div className="product-form-grid">
        <label>{t('catalogue.sku')} *<input aria-label={t('catalogue.sku')} autoComplete="off" maxLength={120} onChange={(event) => update('sku', event.target.value)} required value={form.sku} /></label>
        <label>{t('catalogue.productName')} *<input aria-label={t('catalogue.productName')} maxLength={500} onChange={(event) => update('name', event.target.value)} required value={form.name} /></label>
        <label>{t('catalogue.price')}<input inputMode="decimal" min="0" onChange={(event) => update('price', numberOrNull(event.target.value))} step="0.01" type="number" value={form.price ?? ''} /></label>
        <label>{t('catalogue.currency')}<input maxLength={3} onChange={(event) => update('currency', event.target.value)} value={form.currency ?? ''} /></label>
        <label>{t('catalogue.stock')}<input min="0" onChange={(event) => update('stockQuantity', integerOrNull(event.target.value))} step="1" type="number" value={form.stockQuantity ?? ''} /></label>
        <label>{t('catalogue.category')}<input onChange={(event) => update('category', event.target.value)} value={form.category ?? ''} /></label>
        <label>{t('catalogue.brand')}<input onChange={(event) => update('brand', event.target.value)} value={form.brand ?? ''} /></label>
        <label>{t('catalogue.color')}<input onChange={(event) => update('color', event.target.value)} value={form.color ?? ''} /></label>
        <label>{t('catalogue.size')}<input onChange={(event) => update('size', event.target.value)} value={form.size ?? ''} /></label>
        <label className="product-form-wide">{t('catalogue.aliases')}<input aria-describedby="aliases-hint" aria-label={t('catalogue.aliases')} onChange={(event) => { setAliasesText(event.target.value); setState('idle'); }} value={aliasesText} /><small id="aliases-hint">{t('catalogue.aliasesHint')}</small></label>
        <label className="product-form-wide">{t('catalogue.description')}<textarea onChange={(event) => update('description', event.target.value)} value={form.description ?? ''} /></label>
      </div>
      <label className="active-field"><input checked={form.active ?? true} onChange={(event) => update('active', event.target.checked)} type="checkbox" /> {t('catalogue.productActive')}</label>
      <div className="product-editor-actions"><button className="primary-button" disabled={state === 'saving'} type="submit">{state === 'saving' ? t('catalogue.saving') : editing ? t('catalogue.saveChanges') : t('catalogue.add')}</button><div aria-atomic="true" aria-live="polite">{state === 'saved' && <p className="save-success" role="status">{editing ? t('catalogue.changesSaved') : t('catalogue.added')}</p>}{state === 'error' && <p className="save-error" role="status">{t('catalogue.saveError')}</p>}{state === 'validation-error' && <p className="save-error" role="status">{t('catalogue.duplicateAliases')}</p>}</div></div>
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
