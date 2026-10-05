'use client';

import type { ConversationDetailResponse, ConversationMessage } from '../../../../packages/contracts/src/conversations';
import Link from 'next/link';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { ReplyDraftSummary } from '../../../../packages/contracts/src/reply-drafts';

import { createConversationReplyDraft, refreshConversation, retryConversationMessage, sendConversationMessage } from '../api/conversation-replies';
import { useI18n } from '../i18n/i18n-provider';
import { FieldError } from './form-field';
import { LoadingButton } from './loading-button';
import { MessageThread } from './message-thread';
import { useToast } from './toast-provider';

const MAX_MESSAGE_LENGTH = 1_000;
const POLL_INTERVAL_MS = 2_000;
type PendingSubmission = { text: string; idempotencyKey: string; draftId?: string };

export function SocialReplyComposer({
  initialConversation,
  canManageSettings,
  draftsEnabled = false,
}: {
  initialConversation: ConversationDetailResponse;
  canManageSettings: boolean;
  draftsEnabled?: boolean;
}) {
  const [conversation, setConversation] = useState(initialConversation);
  const [text, setText] = useState('');
  const [textError, setTextError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const refreshInFlight = useRef(false);
  const keepThreadAtBottom = useRef(true);
  const pendingSubmission = useRef<PendingSubmission | null>(null);
  const pendingDraftRequest = useRef<string | null>(null);
  const deliveryStatuses = useRef(new Map(
    initialConversation.messages.map((message) => [message.id, message.delivery?.status ?? null]),
  ));
  const toast = useToast();
  const { t, formatDate } = useI18n();
  const trimmedText = text.trim();
  const channel = conversation.channel === 'TIKTOK'
    ? t('conversations.channelTikTok')
    : conversation.channel === 'FACEBOOK' ? t('conversations.channelFacebook') : t('conversations.channelInstagram');
  const copyOnly = conversation.channel === 'FACEBOOK';
  const latestInbound = [...conversation.messages].reverse().find((message) => message.direction === 'INBOUND');
  const drafts = conversation.replyDrafts ?? [];
  const currentDraft = drafts.find((draft) => draft.anchorMessageId === latestInbound?.id) ?? null;
  const appliedDraft = drafts.find((draft) => draft.id === selectedDraftId);
  const draftReady = currentDraft?.status === 'READY';
  const draftBusy = currentDraft?.status === 'QUEUED' || currentDraft?.status === 'PROCESSING';

  function mergeMessage(message: ConversationMessage) {
    setConversation((current) => {
      const index = current.messages.findIndex((item) => item.id === message.id);
      if (index < 0) return { ...current, messages: [...current.messages, message] };
      const messages = [...current.messages];
      messages[index] = message;
      return { ...current, messages };
    });
    deliveryStatuses.current.set(message.id, message.delivery?.status ?? null);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if ((!conversation.replyCapability.enabled && !copyOnly) || submitting) return;
    const error = !trimmedText ? t('validation.required')
      : trimmedText.length > MAX_MESSAGE_LENGTH ? t('validation.tooLong', { count: MAX_MESSAGE_LENGTH }) : null;
    if (error) {
      setTextError(error);
      textareaRef.current?.focus();
      return;
    }
    setTextError(null);
    if (copyOnly) {
      try {
        await navigator.clipboard.writeText(trimmedText);
        toast.show({ type: 'success', title: t('conversations.replyDraftCopied') });
      } catch {
        toast.show({ type: 'error', title: t('conversations.replyDraftCopyFailed') });
      }
      return;
    }
    setSubmitting(true);
    const submission = pendingSubmission.current?.text === trimmedText && pendingSubmission.current.draftId === (selectedDraftId ?? undefined)
      ? pendingSubmission.current
      : { text: trimmedText, idempotencyKey: crypto.randomUUID(), ...(selectedDraftId ? { draftId: selectedDraftId } : {}) };
    pendingSubmission.current = submission;
    try {
      const message = await sendConversationMessage(conversation.id, submission);
      mergeMessage(message);
      pendingSubmission.current = null;
      setSelectedDraftId(null);
      setText('');
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    } catch {
      toast.show({ type: 'error', title: t('conversations.messageSendFailed'), message: t('conversations.messagePreserved') });
    } finally {
      setSubmitting(false);
    }
  }

  async function generateDraft() {
    if (generatingDraft || draftBusy || !latestInbound) return;
    setGeneratingDraft(true);
    setDraftError(null);
    const key = pendingDraftRequest.current ?? crypto.randomUUID();
    pendingDraftRequest.current = key;
    try {
      const draft = await createConversationReplyDraft(conversation.id, key);
      setConversation((current) => ({ ...current, replyDrafts: [draft, ...(current.replyDrafts ?? []).filter((item) => item.id !== draft.id)] }));
      pendingDraftRequest.current = null;
    } catch { setDraftError(t('conversations.replyDraftFailed')); }
    finally { setGeneratingDraft(false); }
  }

  function applyDraft(draft: ReplyDraftSummary) {
    if (!draft.generatedText || draft.status !== 'READY') return;
    if (text.trim() && text !== draft.generatedText && !window.confirm(t('conversations.replyDraftReplaceConfirm'))) return;
    setText(draft.generatedText);
    setTextError(null);
    setSelectedDraftId(draft.id);
    pendingSubmission.current = null;
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  async function retry(messageId: string) {
    if (retryingMessageId) return;
    setRetryingMessageId(messageId);
    try {
      mergeMessage(await retryConversationMessage(conversation.id, messageId));
    } catch {
      toast.show({ type: 'error', title: t('conversations.retryFailed'), message: t('conversations.notDuplicated') });
    } finally {
      setRetryingMessageId(null);
    }
  }

  useEffect(() => {
    setConversation(initialConversation);
    deliveryStatuses.current = new Map(
      initialConversation.messages.map((message) => [message.id, message.delivery?.status ?? null]),
    );
  }, [initialConversation]);

  useEffect(() => {
    if (!selectedDraftId) return;
    const selected = conversation.replyDrafts?.find((draft) => draft.id === selectedDraftId);
    if (!selected || selected.status !== 'READY' || selected.anchorMessageId !== latestInbound?.id) {
      setSelectedDraftId(null);
      pendingSubmission.current = null;
    }
  }, [conversation.replyDrafts, latestInbound?.id, selectedDraftId]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled || document.visibilityState === 'hidden' || refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        const refreshed = await refreshConversation(conversation.id);
        if (cancelled) return;
        for (const message of refreshed.messages) {
          const previous = deliveryStatuses.current.get(message.id);
          const next = message.delivery?.status ?? null;
          if (previous && previous !== next && next === 'SENT') {
            toast.show({ type: 'success', title: t('conversations.messageSent') });
          }
          if (previous && previous !== next && next === 'FAILED') {
            toast.show({ type: 'error', title: t('conversations.messageSendFailed'), message: deliveryErrorText(message, t) });
          }
          deliveryStatuses.current.set(message.id, next);
        }
        setConversation(refreshed);
      } catch {
        // A temporary refresh failure must not duplicate an outbound message.
      } finally {
        refreshInFlight.current = false;
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conversation.id, t, toast]);

  useEffect(() => {
    if (!keepThreadAtBottom.current) return;
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [conversation.messages.length]);

  const disabledReason = !copyOnly && !conversation.replyCapability.enabled
    ? replyDisabledText(conversation.channel, conversation.replyCapability.reason, t)
    : null;

  return (
    <>
      <div
        aria-label={t('conversations.messagesRegion')}
        className="thread-scroll"
        onScroll={(event) => {
          const thread = event.currentTarget;
          keepThreadAtBottom.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 96;
        }}
        ref={threadRef}
        role="region"
      >
        <p className="day-label">{t('conversations.today')}</p>
        <MessageThread conversation={conversation} onRetry={(messageId) => void retry(messageId)} retryingMessageId={retryingMessageId} />
      </div>
      <div className="reply-area">
        {draftsEnabled && <section className="reply-draft-panel" aria-label={t('conversations.replyDraftTitle')}>
          <div className="reply-draft-panel-heading"><div><strong>{t('conversations.replyDraftTitle')}</strong>
            <small>{t('conversations.replyDraftManualNote')}</small></div>
            <LoadingButton className="secondary-button" type="button" pending={generatingDraft}
              disabled={!latestInbound || draftBusy || generatingDraft} onClick={() => void generateDraft()}>
              {t('conversations.replyDraftGenerate')}
            </LoadingButton></div>
          {draftBusy && <p role="status">{t('conversations.replyDraftWorking')}</p>}
          {draftError && <p role="alert">{draftError}</p>}
          {currentDraft?.status === 'READY' && currentDraft.generatedText && <div className="reply-draft-result">
            <p>{currentDraft.generatedText}</p>
            {currentDraft.sources.length > 0 && <div className="reply-draft-sources"><small>{t('conversations.replyDraftSources')}</small>
              <ul>{currentDraft.sources.map((source) => <li key={source.productId}>
                <strong>{source.name}</strong> · {source.sku}
                {source.price && source.currency ? <> · {t('conversations.replyDraftPrice')}: {source.price} {source.currency}</> : null}
                {source.stockQuantity !== null ? <> · {t('conversations.replyDraftStock')}: {source.stockQuantity}</> : null}
                <small> · {t('conversations.replyDraftSourceUpdated')}: {formatDate(source.updatedAt)}</small>
              </li>)}</ul>
            </div>}
            <button className="secondary-button" type="button" onClick={() => applyDraft(currentDraft)}>
              {t('conversations.replyDraftUse')}
            </button>
          </div>}
          {currentDraft && ['STALE', 'BLOCKED', 'FAILED'].includes(currentDraft.status) &&
            <p role="status">{t('conversations.replyDraftUnavailable')}</p>}
          {appliedDraft && <p className="reply-draft-applied" role="status">{t('conversations.replyDraftApplied')}</p>}
        </section>}
        {copyOnly && <p className="reply-guidance" role="status">{t('conversations.facebookReadOnly')}</p>}
        {disabledReason ? (
          <div className="reply-guidance" role="status">
            <span>{disabledReason}</span>
            {canManageSettings ? <Link href="/settings?tab=social">{t('conversations.configureChannel', { channel })}</Link> : null}
          </div>
        ) : null}
        <form className="social-reply-composer" onSubmit={(event) => void submit(event)}>
          <label className="sr-only" htmlFor="social-reply">{t('conversations.reply')}</label>
          <textarea
            aria-describedby={textError ? 'social-reply-hint social-reply-error' : 'social-reply-hint'}
            aria-invalid={Boolean(textError)}
            aria-label={t('conversations.reply')}
            disabled={!conversation.replyCapability.enabled && !copyOnly}
            id="social-reply"
            onChange={(event) => {
              const nextText = event.target.value;
              if (pendingSubmission.current?.text !== nextText.trim()) pendingSubmission.current = null;
              setText(nextText);
              setTextError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('conversations.placeholder')}
            ref={textareaRef}
            rows={2}
            value={text}
          />
          <FieldError id="social-reply-error" message={textError} />
          <div className="reply-composer-actions">
            <small id="social-reply-hint">{text.length >= 900 ? `${text.length}/${MAX_MESSAGE_LENGTH}` : t('conversations.newLineHint')}</small>
            <LoadingButton disabled={(!conversation.replyCapability.enabled && !copyOnly) || submitting} pending={submitting} pendingLabel={t('conversations.sending')} type="submit">
              {copyOnly ? t('conversations.replyDraftCopy') : t('conversations.send')}
            </LoadingButton>
          </div>
        </form>
      </div>
    </>
  );
}

function replyDisabledText(
  channel: ConversationDetailResponse['channel'],
  reason: ConversationDetailResponse['replyCapability']['reason'],
  t: ReturnType<typeof useI18n>['t'],
) {
  if (reason === 'TIKTOK_CAPABILITY_UNAVAILABLE') return t('conversations.tiktokCapabilityUnavailable');
  if (reason === 'TIKTOK_REPLY_NOT_PERMITTED') return t('conversations.tiktokReplyWindowExpired');
  if (reason === 'REPLY_WINDOW_EXPIRED') return t('conversations.replyWindowExpired');
  const channelName = channel === 'TIKTOK' ? t('conversations.channelTikTok') : t('conversations.channelInstagram');
  return reason === 'RECONNECT_REQUIRED'
    ? t('conversations.reconnectChannelToReply', { channel: channelName })
    : t('conversations.connectChannelToReply', { channel: channelName });
}

function deliveryErrorText(message: ConversationMessage, t: ReturnType<typeof useI18n>['t']) {
  if (message.delivery?.errorCode === 'INSTAGRAM_RECONNECT_REQUIRED') return t('conversations.reconnectInSettings');
  if (message.delivery?.errorCode === 'INSTAGRAM_RATE_LIMITED') return t('conversations.rateLimited');
  if (message.delivery?.errorCode === 'INSTAGRAM_REPLY_WINDOW_EXPIRED') return t('conversations.replyWindowExpired');
  if (message.delivery?.errorCode === 'INSTAGRAM_HUMAN_AGENT_UNAVAILABLE') return t('conversations.humanAgentUnavailable');
  if (message.delivery?.errorCode === 'TIKTOK_RECONNECT_REQUIRED') return t('conversations.tiktokReconnectInSettings');
  if (message.delivery?.errorCode === 'TIKTOK_RATE_LIMITED') return t('conversations.tiktokRateLimited');
  if (message.delivery?.errorCode === 'TIKTOK_REPLY_NOT_PERMITTED') return t('conversations.tiktokReplyWindowExpired');
  return t('conversations.retryLater');
}
