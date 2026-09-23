'use client';

import type {
  BankAccountInput,
  BankAccountSummary,
  CommercialSettingsSummary,
  LegalEntityInput,
  LegalEntitySummary,
  LegalEntityType,
} from '../../../../packages/contracts/src/commercial';
import { type FormEvent, type ReactNode, useState } from 'react';

import {
  createBankAccount,
  createLegalEntity,
  getBankAccountDetail,
  updateBankAccount,
  updateLegalEntity,
} from '../api/commercial-settings';
import { useI18n } from '../i18n/i18n-provider';
import { ValidationApiError } from '../api/validation-errors';
import { FormField } from './form-field';
import { clearFieldError, focusFirstInvalid, nativeConstraintMessage, type FieldErrors } from './form-validation';

type Panel = 'entities' | 'accounts';
type Role = 'OWNER' | 'MANAGER';
type EntityField = 'displayName' | 'legalName' | 'type' | 'registrationId';
type AccountField = 'legalEntityId' | 'label' | 'iban' | 'bankName' | 'currency';

const emptyEntity: LegalEntityInput = { displayName: '', legalName: '', type: 'COMPANY', registrationId: null, active: true, isDefault: false };
const emptyAccount = (legalEntityId = ''): BankAccountInput => ({ legalEntityId, label: '', iban: '', bankName: null, currency: 'UAH', active: true, isDefault: false });

export function CommercialSettingsHub({ initial, role }: { initial: CommercialSettingsSummary; role: Role }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState(initial);
  const [open, setOpen] = useState<Panel | null>(null);
  const [entityForm, setEntityForm] = useState<LegalEntityInput>(emptyEntity);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState<BankAccountInput>(emptyAccount(initial.legalEntities[0]?.id));
  const [accountId, setAccountId] = useState<string | null>(null);
  const [entityErrors, setEntityErrors] = useState<FieldErrors<EntityField>>({});
  const [accountErrors, setAccountErrors] = useState<FieldErrors<AccountField>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = (panel: Panel) => { setOpen((current) => current === panel ? null : panel); setMessage(null); };

  function updateEntity(next: LegalEntityInput) {
    for (const field of ['displayName', 'legalName', 'type', 'registrationId'] as const) {
      if (entityForm[field] !== next[field]) setEntityErrors((current) => clearFieldError(current, field));
    }
    setEntityForm(next);
  }

  function updateAccount(next: BankAccountInput) {
    for (const field of ['legalEntityId', 'label', 'iban', 'bankName', 'currency'] as const) {
      if (accountForm[field] !== next[field]) setAccountErrors((current) => clearFieldError(current, field));
    }
    setAccountForm(next);
  }

  async function submitEntity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const errors = validateControls<EntityField>(form, ['displayName', 'legalName'], t);
    if (!entityForm.displayName.trim()) errors.displayName = t('validation.required');
    if (!entityForm.legalName.trim()) errors.legalName = t('validation.required');
    setEntityErrors(errors);
    if (Object.keys(errors).length) { focusFirstInvalid(form, Object.keys(errors)); return; }
    setPending(true); setMessage(null);
    try {
      const saved = entityId ? await updateLegalEntity(entityId, entityForm) : await createLegalEntity(entityForm);
      setSettings((current) => ({ ...current, legalEntities: replaceOrAdd(current.legalEntities, saved) }));
      setEntityId(null); setEntityForm(emptyEntity); setEntityErrors({}); setMessage(t('settings.commercialSettingsSaved'));
    } catch (reason) {
      if (reason instanceof ValidationApiError) {
        const mapped = mapEntityIssues(reason, t);
        setEntityErrors(mapped);
        if (Object.keys(mapped).length) focusFirstInvalid(form, Object.keys(mapped));
        else setMessage(t('settings.commercialSettingsFailed'));
      } else setMessage(t('settings.commercialSettingsFailed'));
    } finally { setPending(false); }
  }

  async function editAccount(account: BankAccountSummary) {
    setPending(true); setMessage(null);
    try {
      const detail = await getBankAccountDetail(account.id);
      setAccountId(detail.id);
      setAccountForm({ legalEntityId: detail.legalEntityId, label: detail.label, iban: detail.iban, bankName: detail.bankName, currency: detail.currency, active: detail.active, isDefault: detail.isDefault });
    } catch { setMessage(t('settings.commercialSettingsFailed')); } finally { setPending(false); }
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    const form = event.currentTarget;
    const normalizedIban = normalizeIban(accountForm.iban);
    const errors = validateControls<AccountField>(form, ['legalEntityId', 'label', 'iban', 'currency'], t);
    if (!accountForm.label.trim()) errors.label = t('validation.required');
    if (!accountForm.legalEntityId) errors.legalEntityId = t('validation.required');
    if (!isValidIbanFormat(normalizedIban)) errors.iban = t('settings.invalidIban');
    if (!/^[A-Z]{3}$/.test(accountForm.currency.trim())) errors.currency = t('validation.currency');
    setAccountErrors(errors);
    if (Object.keys(errors).length) { focusFirstInvalid(form, Object.keys(errors)); return; }
    setPending(true);
    try {
      const input = { ...accountForm, iban: normalizedIban };
      const saved = accountId ? await updateBankAccount(accountId, input) : await createBankAccount(input);
      setSettings((current) => ({ ...current, bankAccounts: replaceOrAdd(current.bankAccounts, saved) }));
      setAccountId(null); setAccountForm(emptyAccount(settings.legalEntities[0]?.id)); setAccountErrors({}); setMessage(t('settings.commercialSettingsSaved'));
    } catch (reason) {
      if (reason instanceof ValidationApiError) {
        const mapped = mapAccountIssues(reason, t);
        setAccountErrors(mapped);
        if (Object.keys(mapped).length) focusFirstInvalid(form, Object.keys(mapped));
        else setMessage(t('settings.commercialSettingsFailed'));
      } else setMessage(t('settings.commercialSettingsFailed'));
    } finally { setPending(false); }
  }

  const panels = [
    { id: 'entities' as const, mark: 'ЮО', title: t('settings.legalEntities'), description: t('settings.legalEntitiesDescription'), count: settings.legalEntities.length },
    { id: 'accounts' as const, mark: '₴', title: t('settings.bankAccounts'), description: t('settings.bankAccountsDescription'), count: settings.bankAccounts.length },
  ];

  return <div className="delivery-carrier-hub commercial-settings-hub" aria-label={t('settings.commercialSettings')}>
    <div className="delivery-hub-summary"><span>{t('settings.configured')}</span><strong>{settings.legalEntities.length + settings.bankAccounts.length}</strong><p>{t('settings.openCommercialSection')}</p></div>
    <div className="delivery-carrier-list">
      {panels.map((panel) => {
        const expanded = open === panel.id;
        return <section key={panel.id} className={`delivery-carrier ${expanded ? 'is-open' : ''}`}>
          <button className="delivery-carrier-trigger" type="button" aria-expanded={expanded} aria-controls={`commercial-${panel.id}`} onClick={() => toggle(panel.id)}>
            <span className="delivery-carrier-mark commercial-mark" aria-hidden="true">{panel.mark}</span>
            <span className="delivery-carrier-copy"><strong>{panel.title}</strong><small>{panel.description}</small></span>
            <span className="connection-status status-active">{panel.count}</span>
            <svg className="delivery-carrier-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
          </button>
          {expanded && <div id={`commercial-${panel.id}`} className="delivery-carrier-panel commercial-panel">
            {panel.id === 'entities'
              ? <EntityPanel items={settings.legalEntities} role={role} form={entityForm} errors={entityErrors} editing={entityId} pending={pending} onForm={updateEntity} onEdit={(item) => { setEntityId(item.id); setEntityForm(toEntityInput(item)); setEntityErrors({}); }} onCancel={() => { setEntityId(null); setEntityForm(emptyEntity); setEntityErrors({}); }} onSubmit={submitEntity} t={t} />
              : <AccountPanel items={settings.bankAccounts} entities={settings.legalEntities} role={role} form={accountForm} errors={accountErrors} editing={accountId} pending={pending} onForm={updateAccount} onEdit={editAccount} onCancel={() => { setAccountId(null); setAccountForm(emptyAccount(settings.legalEntities[0]?.id)); setAccountErrors({}); }} onSubmit={submitAccount} t={t} />}
            {message && <p className="settings-inline-message" role="status">{message}</p>}
          </div>}
        </section>;
      })}
    </div>
  </div>;
}

type T = ReturnType<typeof useI18n>['t'];
function EntityPanel({ items, role, form, errors, editing, pending, onForm, onEdit, onCancel, onSubmit, t }: { items: LegalEntitySummary[]; role: Role; form: LegalEntityInput; errors: FieldErrors<EntityField>; editing: string | null; pending: boolean; onForm: (v: LegalEntityInput) => void; onEdit: (v: LegalEntitySummary) => void; onCancel: () => void; onSubmit: (e: FormEvent<HTMLFormElement>) => void; t: T }) {
  return <div className="commercial-panel-content"><CommercialList empty={t('settings.noLegalEntities')}>{items.map((item) => <div className="commercial-list-row" key={item.id}><span><strong>{item.displayName}</strong><small>{item.legalName}{item.registrationId ? ` · ${item.registrationId}` : ''}</small></span><span>{item.isDefault ? t('settings.commercialDefault') : item.active ? t('settings.active') : t('settings.inactive')}</span>{role === 'OWNER' && <button type="button" className="secondary-button" onClick={() => onEdit(item)}>{t('settings.edit')}</button>}</div>)}</CommercialList>
    {role === 'OWNER' && <form className="commercial-form" noValidate onSubmit={onSubmit}><div className="commercial-form-grid">
      <FormField id="legal-entity-display-name" label={t('settings.legalEntityDisplayName')} error={errors.displayName} required><input name="displayName" required maxLength={120} value={form.displayName} onChange={(e) => onForm({ ...form, displayName: e.target.value })} /></FormField>
      <FormField id="legal-entity-legal-name" label={t('settings.legalEntityLegalName')} error={errors.legalName} required><input name="legalName" required maxLength={240} value={form.legalName} onChange={(e) => onForm({ ...form, legalName: e.target.value })} /></FormField>
      <FormField id="legal-entity-type" label={t('settings.legalEntityType')} error={errors.type}><select name="type" value={form.type} onChange={(e) => onForm({ ...form, type: e.target.value as LegalEntityType })}><option value="COMPANY">{t('settings.company')}</option><option value="SOLE_PROPRIETOR">{t('settings.soleProprietor')}</option><option value="OTHER">{t('settings.other')}</option></select></FormField>
      <FormField id="legal-entity-registration-id" label={t('settings.registrationId')} error={errors.registrationId}><input name="registrationId" maxLength={64} value={form.registrationId ?? ''} onChange={(e) => onForm({ ...form, registrationId: e.target.value || null })} /></FormField>
    </div><CommercialFlags active={form.active} isDefault={form.isDefault} onChange={(next) => onForm({ ...form, ...next })} t={t} /><FormActions editing={editing} pending={pending} onCancel={onCancel} t={t} /></form>}
  </div>;
}

function AccountPanel({ items, entities, role, form, errors, editing, pending, onForm, onEdit, onCancel, onSubmit, t }: { items: BankAccountSummary[]; entities: LegalEntitySummary[]; role: Role; form: BankAccountInput; errors: FieldErrors<AccountField>; editing: string | null; pending: boolean; onForm: (v: BankAccountInput) => void; onEdit: (v: BankAccountSummary) => void; onCancel: () => void; onSubmit: (e: FormEvent<HTMLFormElement>) => void; t: T }) {
  return <div className="commercial-panel-content"><CommercialList empty={t('settings.noBankAccounts')}>{items.map((item) => <div className="commercial-list-row" key={item.id}><span><strong>{item.label} · {item.currency}</strong><small>{item.maskedIban}{item.bankName ? ` · ${item.bankName}` : ''}</small></span><span>{item.isDefault ? t('settings.commercialDefault') : item.active ? t('settings.active') : t('settings.inactive')}</span>{role === 'OWNER' && <button type="button" className="secondary-button" disabled={pending} onClick={() => void onEdit(item)}>{t('settings.edit')}</button>}</div>)}</CommercialList>
    {role === 'OWNER' && entities.length > 0 && <form className="commercial-form" noValidate onSubmit={onSubmit}><div className="commercial-form-grid">
      <FormField id="bank-account-legal-entity" label={t('settings.legalEntities')} error={errors.legalEntityId} required><select name="legalEntityId" required value={form.legalEntityId} onChange={(e) => onForm({ ...form, legalEntityId: e.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.displayName}</option>)}</select></FormField>
      <FormField id="bank-account-label" label={t('settings.accountLabel')} error={errors.label} required><input name="label" required maxLength={120} value={form.label} onChange={(e) => onForm({ ...form, label: e.target.value })} /></FormField>
      <FormField id="bank-account-iban" label={t('settings.iban')} error={errors.iban} required><input name="iban" required maxLength={42} autoCapitalize="characters" autoComplete="off" spellCheck={false} value={form.iban} onChange={(e) => onForm({ ...form, iban: e.target.value.toUpperCase() })} onBlur={() => onForm({ ...form, iban: formatIban(form.iban) })} /></FormField>
      <FormField id="bank-account-bank-name" label={t('settings.bankName')} error={errors.bankName}><input name="bankName" maxLength={160} value={form.bankName ?? ''} onChange={(e) => onForm({ ...form, bankName: e.target.value || null })} /></FormField>
      <FormField id="bank-account-currency" label={t('settings.currency')} error={errors.currency} required><input name="currency" required maxLength={3} value={form.currency} onChange={(e) => onForm({ ...form, currency: e.target.value.toUpperCase() })} /></FormField>
    </div><CommercialFlags active={form.active} isDefault={form.isDefault} onChange={(next) => onForm({ ...form, ...next })} t={t} /><FormActions editing={editing} pending={pending} onCancel={onCancel} t={t} /></form>}
  </div>;
}

function CommercialList({ empty, children }: { empty: string; children: ReactNode }) { return <div className="commercial-list">{Array.isArray(children) && children.length === 0 ? <p>{empty}</p> : children}</div>; }
function CommercialFlags({ active, isDefault, onChange, t }: { active: boolean; isDefault: boolean; onChange: (v: { active: boolean; isDefault: boolean }) => void; t: T }) { return <div className="commercial-flags"><label><input type="checkbox" checked={active} onChange={(e) => onChange({ active: e.target.checked, isDefault })} /> {t('settings.active')}</label><label><input type="checkbox" checked={isDefault} onChange={(e) => onChange({ active, isDefault: e.target.checked })} /> {t('settings.commercialDefault')}</label></div>; }
function FormActions({ editing, pending, onCancel, t }: { editing: string | null; pending: boolean; onCancel: () => void; t: T }) { return <div className="commercial-form-actions">{editing && <button type="button" className="secondary-button" onClick={onCancel}>{t('settings.cancel')}</button>}<button type="submit" className="primary-button" disabled={pending}>{pending ? t('settings.saving') : editing ? t('settings.save') : t('settings.add')}</button></div>; }
function replaceOrAdd<T extends { id: string }>(items: T[], saved: T): T[] { return items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]; }
function toEntityInput(item: LegalEntitySummary): LegalEntityInput { return { displayName: item.displayName, legalName: item.legalName, type: item.type, registrationId: item.registrationId, active: item.active, isDefault: item.isDefault }; }
function normalizeIban(value: string): string { return value.replace(/\s/g, '').toUpperCase(); }
function formatIban(value: string): string { return normalizeIban(value).replace(/(.{4})(?=.)/g, '$1 '); }
function isValidIbanFormat(value: string): boolean { return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value) && (!value.startsWith('UA') || value.length === 29); }

function validateControls<TField extends string>(form: HTMLFormElement, fields: readonly TField[], t: T): FieldErrors<TField> {
  const errors: FieldErrors<TField> = {};
  for (const field of fields) {
    const control = form.elements.namedItem(field);
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      const message = nativeConstraintMessage(control, t);
      if (message) errors[field] = message;
    }
  }
  return errors;
}

function mapEntityIssues(reason: ValidationApiError, t: T): FieldErrors<EntityField> {
  const errors: FieldErrors<EntityField> = {};
  for (const issue of reason.failure.issues) {
    if (issue.field === 'displayName') errors.displayName = t('validation.invalid');
    if (issue.field === 'legalName') errors.legalName = t('validation.invalid');
    if (issue.field === 'type') errors.type = t('validation.invalid');
    if (issue.field === 'registrationId') errors.registrationId = t('validation.invalid');
  }
  return errors;
}

function mapAccountIssues(reason: ValidationApiError, t: T): FieldErrors<AccountField> {
  const errors: FieldErrors<AccountField> = {};
  for (const issue of reason.failure.issues) {
    if (issue.field === 'legalEntityId') errors.legalEntityId = t('validation.invalid');
    if (issue.field === 'label') errors.label = t('validation.invalid');
    if (issue.field === 'iban') errors.iban = t('settings.invalidIban');
    if (issue.field === 'bankName') errors.bankName = t('validation.invalid');
    if (issue.field === 'currency') errors.currency = t('validation.currency');
  }
  return errors;
}
