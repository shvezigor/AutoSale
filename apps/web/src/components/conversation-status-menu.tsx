'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ConversationWorkflowStatus } from '../../../../packages/contracts/src/conversations';
import { useI18n } from '../i18n/i18n-provider';
import { conversationStatuses, useConversationTriage } from './conversation-triage-context';
import { LoadingButton } from './loading-button';

type Props = { id: string; name: string; workflowStatus: ConversationWorkflowStatus; statusVersion: number; detail?: boolean };

export function ConversationStatusMenu({ id, name, workflowStatus, statusVersion, detail = false }: Props) {
  const { t } = useI18n();
  const { confirmedStatus, pendingIds, moveConversation, error, announcement } = useConversationTriage();
  const current = confirmedStatus(id, { workflowStatus, statusVersion });
  const pending = pendingIds.has(id);
  const targets = conversationStatuses.filter(status => status !== current.workflowStatus);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [target, setTarget] = useState<ConversationWorkflowStatus | null>(null);
  function close(restoreFocus = false) { setPosition(null); if (restoreFocus) trigger.current?.focus(); }
  function open() {
    const rect = trigger.current!.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.right - 220, window.innerWidth - 228)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 116)) });
  }
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(); };
    const dismiss = () => close(true);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    // An anchored action must not float over an unrelated row after the list scrolls.
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) dismiss(); };
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', scroll, true); };
  }, [position]);
  async function move(status: ConversationWorkflowStatus) {
    setTarget(status);
    try { await moveConversation({ id, status, expectedVersion: current.statusVersion }); }
    catch { /* Provider owns localized recovery guidance on both surfaces. */ }
    finally {
      setTarget(null); close(true);
      // A successful row move may unmount this trigger. Keep the selected detail reachable.
      if (!trigger.current && document.activeElement === document.body) document.getElementById(`conversation-status-detail-${id}`)?.focus();
    }
  }
  return <div className={`conversation-status-control${detail ? ' conversation-status-detail' : ''}`}>
    <div className="conversation-status-summary">
      {detail && <span className="conversation-status-label">{t(`conversations.triage.${current.workflowStatus}`)}</span>}
      <button ref={trigger} id={detail ? `conversation-status-detail-${id}` : undefined} type="button" className="icon-button" disabled={pending} aria-label={t('conversations.triage.move', { name })} aria-haspopup="menu" aria-expanded={Boolean(position)} aria-controls={position ? menuId : undefined} onClick={() => position ? close(true) : open()} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); }
      }}><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg></button>
    </div>
    {detail && error && <p className="conversation-status-feedback" role="alert">{error}</p>}
    {detail && !error && announcement && <p className="conversation-status-feedback" role="status">{announcement}</p>}
    {position && createPortal(<div ref={menu} id={menuId} role="menu" aria-label={t('conversations.triage.move', { name })} className="conversation-status-menu" style={position} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
      if (event.key === 'Tab') { close(true); return; }
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    }}>{targets.map(status => <LoadingButton key={status} type="button" role="menuitem" tabIndex={-1} className="text-button" pending={pending && target === status} disabled={pending} onClick={() => void move(status)}>{t(`conversations.triage.to${status}`)}</LoadingButton>)}</div>, document.body)}
  </div>;
}
