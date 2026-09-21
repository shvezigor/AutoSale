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

type Panel = 'entities' | 'accounts';
type Role = 'OWNER' | 'MANAGER';

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
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = (panel: Panel) => { setOpen((current) => current === panel ? null : panel); setMessage(null); };

  async function submitEntity(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage(null);
    try {
      const saved = entityId ? await updateLegalEntity(entityId, entityForm) : await createLegalEntity(entityForm);
      setSettings((current) => ({ ...current, legalEntities: replaceOrAdd(current.legalEntities, saved) }));
      setEntityId(null); setEntityForm(emptyEntity); setMessage(t('settings.commercialSettingsSaved'));
    } catch { setMessage(t('settings.commercialSettingsFailed')); } finally { setPending(false); }
  }

  async function editAccount(account: BankAccountSummary) {
    setPending(true); setMessage(null);
    try {
      const detail = await getBankAccountDetail(account.id);
      setAccountId(detail.id);
      setAccountForm({ legalEntityId: detail.legalEntityId, label: detail.label, iban: detail.iban, bankName: detail.bankName, currency: detail.currency, active: detail.active, isDefault: detail.isDefault });
    } catch { setMessage(t('settings.commercialSettingsFailed')); } finally { setPending(false); }
  }

  async function submitAccount(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage(null);
    try {
      const saved = accountId ? await updateBankAccount(accountId, accountForm) : await createBankAccount(accountForm);
      setSettings((current) => ({ ...current, bankAccounts: replaceOrAdd(current.bankAccounts, saved) }));
      setAccountId(null); setAccountForm(emptyAccount(settings.legalEntities[0]?.id)); setMessage(t('settings.commercialSettingsSaved'));
    } catch { setMessage(t('settings.commercialSettingsFailed')); } finally { setPending(false); }
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
              ? <EntityPanel items={settings.legalEntities} role={role} form={entityForm} editing={entityId} pending={pending} onForm={setEntityForm} onEdit={(item) => { setEntityId(item.id); setEntityForm(toEntityInput(item)); }} onCancel={() => { setEntityId(null); setEntityForm(emptyEntity); }} onSubmit={submitEntity} t={t} />
              : <AccountPanel items={settings.bankAccounts} entities={settings.legalEntities} role={role} form={accountForm} editing={accountId} pending={pending} onForm={setAccountForm} onEdit={editAccount} onCancel={() => { setAccountId(null); setAccountForm(emptyAccount(settings.legalEntities[0]?.id)); }} onSubmit={submitAccount} t={t} />}
            {message && <p className="settings-inline-message" role="status">{message}</p>}
          </div>}
        </section>;
      })}
    </div>
  </div>;
}

type T = ReturnType<typeof useI18n>['t'];
function EntityPanel({ items, role, form, editing, pending, onForm, onEdit, onCancel, onSubmit, t }: { items: LegalEntitySummary[]; role: Role; form: LegalEntityInput; editing: string | null; pending: boolean; onForm: (v: LegalEntityInput) => void; onEdit: (v: LegalEntitySummary) => void; onCancel: () => void; onSubmit: (e: FormEvent) => void; t: T }) {
  return <div className="commercial-panel-content"><CommercialList empty={t('settings.noLegalEntities')}>{items.map((item) => <div className="commercial-list-row" key={item.id}><span><strong>{item.displayName}</strong><small>{item.legalName}{item.registrationId ? ` · ${item.registrationId}` : ''}</small></span><span>{item.isDefault ? t('settings.commercialDefault') : item.active ? t('settings.active') : t('settings.inactive')}</span>{role === 'OWNER' && <button type="button" className="secondary-button" onClick={() => onEdit(item)}>{t('settings.edit')}</button>}</div>)}</CommercialList>
    {role === 'OWNER' && <form className="commercial-form" onSubmit={onSubmit}><div className="commercial-form-grid">
      <label>{t('settings.legalEntityDisplayName')}<input required value={form.displayName} onChange={(e) => onForm({ ...form, displayName: e.target.value })} /></label>
      <label>{t('settings.legalEntityLegalName')}<input required value={form.legalName} onChange={(e) => onForm({ ...form, legalName: e.target.value })} /></label>
      <label>{t('settings.legalEntityType')}<select value={form.type} onChange={(e) => onForm({ ...form, type: e.target.value as LegalEntityType })}><option value="COMPANY">{t('settings.company')}</option><option value="SOLE_PROPRIETOR">{t('settings.soleProprietor')}</option><option value="OTHER">{t('settings.other')}</option></select></label>
      <label>{t('settings.registrationId')}<input value={form.registrationId ?? ''} onChange={(e) => onForm({ ...form, registrationId: e.target.value || null })} /></label>
    </div><CommercialFlags active={form.active} isDefault={form.isDefault} onChange={(next) => onForm({ ...form, ...next })} t={t} /><FormActions editing={editing} pending={pending} onCancel={onCancel} t={t} /></form>}
  </div>;
}

function AccountPanel({ items, entities, role, form, editing, pending, onForm, onEdit, onCancel, onSubmit, t }: { items: BankAccountSummary[]; entities: LegalEntitySummary[]; role: Role; form: BankAccountInput; editing: string | null; pending: boolean; onForm: (v: BankAccountInput) => void; onEdit: (v: BankAccountSummary) => void; onCancel: () => void; onSubmit: (e: FormEvent) => void; t: T }) {
  return <div className="commercial-panel-content"><CommercialList empty={t('settings.noBankAccounts')}>{items.map((item) => <div className="commercial-list-row" key={item.id}><span><strong>{item.label} · {item.currency}</strong><small>{item.maskedIban}{item.bankName ? ` · ${item.bankName}` : ''}</small></span><span>{item.isDefault ? t('settings.commercialDefault') : item.active ? t('settings.active') : t('settings.inactive')}</span>{role === 'OWNER' && <button type="button" className="secondary-button" disabled={pending} onClick={() => void onEdit(item)}>{t('settings.edit')}</button>}</div>)}</CommercialList>
    {role === 'OWNER' && entities.length > 0 && <form className="commercial-form" onSubmit={onSubmit}><div className="commercial-form-grid">
      <label>{t('settings.legalEntities')}<select required value={form.legalEntityId} onChange={(e) => onForm({ ...form, legalEntityId: e.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.displayName}</option>)}</select></label>
      <label>{t('settings.accountLabel')}<input required value={form.label} onChange={(e) => onForm({ ...form, label: e.target.value })} /></label>
      <label>{t('settings.iban')}<input required value={form.iban} onChange={(e) => onForm({ ...form, iban: e.target.value })} /></label>
      <label>{t('settings.bankName')}<input value={form.bankName ?? ''} onChange={(e) => onForm({ ...form, bankName: e.target.value || null })} /></label>
      <label>{t('settings.currency')}<input required maxLength={3} value={form.currency} onChange={(e) => onForm({ ...form, currency: e.target.value.toUpperCase() })} /></label>
    </div><CommercialFlags active={form.active} isDefault={form.isDefault} onChange={(next) => onForm({ ...form, ...next })} t={t} /><FormActions editing={editing} pending={pending} onCancel={onCancel} t={t} /></form>}
  </div>;
}

function CommercialList({ empty, children }: { empty: string; children: ReactNode }) { return <div className="commercial-list">{Array.isArray(children) && children.length === 0 ? <p>{empty}</p> : children}</div>; }
function CommercialFlags({ active, isDefault, onChange, t }: { active: boolean; isDefault: boolean; onChange: (v: { active: boolean; isDefault: boolean }) => void; t: T }) { return <div className="commercial-flags"><label><input type="checkbox" checked={active} onChange={(e) => onChange({ active: e.target.checked, isDefault })} /> {t('settings.active')}</label><label><input type="checkbox" checked={isDefault} onChange={(e) => onChange({ active, isDefault: e.target.checked })} /> {t('settings.commercialDefault')}</label></div>; }
function FormActions({ editing, pending, onCancel, t }: { editing: string | null; pending: boolean; onCancel: () => void; t: T }) { return <div className="commercial-form-actions">{editing && <button type="button" className="secondary-button" onClick={onCancel}>{t('settings.cancel')}</button>}<button type="submit" className="primary-button" disabled={pending}>{pending ? t('settings.saving') : editing ? t('settings.save') : t('settings.add')}</button></div>; }
function replaceOrAdd<T extends { id: string }>(items: T[], saved: T): T[] { return items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]; }
function toEntityInput(item: LegalEntitySummary): LegalEntityInput { return { displayName: item.displayName, legalName: item.legalName, type: item.type, registrationId: item.registrationId, active: item.active, isDefault: item.isDefault }; }
