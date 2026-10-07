'use client';

import type { ConversationDetailResponse, ConversationMessage } from '../../../../packages/contracts/src/conversations';
import Link from 'next/link';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { ConversationReplyApiError, createConversationReplyDraft, refreshConversation, retryConversationMessage, sendConversationMessage } from '../api/conversation-replies';
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
  const initialLatestInbound = [...initialConversation.messages].reverse()
    .find((message) => message.direction === 'INBOUND');
  const initialReadyDraft = draftsEnabled
    ? initialConversation.replyDrafts?.find((draft) => (
      draft.anchorMessageId === initialLatestInbound?.id
      && draft.status === 'READY'
      && Boolean(draft.generatedText)
    )) ?? null
    : null;
  const [conversation, setConversation] = useState(initialConversation);
  const [text, setText] = useState(() => initialReadyDraft?.generatedText ?? '');
  const [textError, setTextError] = useState<string | null>(null);
  const [draftReviewRequired, setDraftReviewRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(() => initialReadyDraft?.id ?? null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const refreshInFlight = useRef(false);
  const keepThreadAtBottom = useRef(true);
  const pendingSubmission = useRef<PendingSubmission | null>(null);
  const pendingDraftRequest = useRef<string | null>(null);
  const editorTouched = useRef(false);
  const restoringInitialDraft = useRef(Boolean(initialReadyDraft));
  const autoFilledDraftId = useRef<string | null>(initialReadyDraft?.id ?? null);
  const offeredDraftIds = useRef(new Set<string>(initialReadyDraft ? [initialReadyDraft.id] : []));
  const activeConversationId = useRef(initialConversation.id);
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
  const anchoredDrafts = drafts.filter((draft) => draft.anchorMessageId === latestInbound?.id);
  const currentDraft = anchoredDrafts.find((draft) => draft.status === 'READY') ?? anchoredDrafts[0] ?? null;
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
    if (draftReviewRequired) {
      setTextError(t('conversations.replyDraftReviewRequired'));
      textareaRef.current?.focus();
      return;
    }
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
      setDraftReviewRequired(false);
      editorTouched.current = false;
      autoFilledDraftId.current = null;
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      if (submission.draftId && error instanceof ConversationReplyApiError && error.status === 409) {
        const reviewMessage = t('conversations.replyDraftReviewRequired');
        setText(submission.text);
        setTextError(reviewMessage);
        setDraftReviewRequired(true);
        setSelectedDraftId(null);
        pendingSubmission.current = null;
        editorTouched.current = true;
        autoFilledDraftId.current = null;
        try {
          setConversation(await refreshConversation(conversation.id));
        } catch {
          // The draft-linked send is still blocked locally until the manager edits the preserved text.
        }
        textareaRef.current?.focus();
        toast.show({ type: 'error', title: t('conversations.messageSendFailed'), message: reviewMessage });
      } else {
        toast.show({ type: 'error', title: t('conversations.messageSendFailed'), message: t('conversations.messagePreserved') });
      }
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

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const generatedText = initialReadyDraft?.generatedText;
      if (generatedText && restoringInitialDraft.current) {
        setText(generatedText);
        if (textareaRef.current && textareaRef.current.value !== generatedText) {
          textareaRef.current.value = generatedText;
        }
      }
      restoringInitialDraft.current = false;
    }, 150);
    return () => window.clearTimeout(timer);
  }, []);

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
    if (activeConversationId.current !== initialConversation.id) {
      activeConversationId.current = initialConversation.id;
      setText('');
      setTextError(null);
      setDraftReviewRequired(false);
      setSelectedDraftId(null);
      pendingSubmission.current = null;
      pendingDraftRequest.current = null;
      editorTouched.current = false;
      autoFilledDraftId.current = null;
      offeredDraftIds.current.clear();
    }
    setConversation(initialConversation);
    deliveryStatuses.current = new Map(
      initialConversation.messages.map((message) => [message.id, message.delivery?.status ?? null]),
    );
  }, [initialConversation]);

  useEffect(() => {
    if (!selectedDraftId) return;
    const selected = conversation.replyDrafts?.find((draft) => draft.id === selectedDraftId);
    if (!selected || selected.status !== 'READY' || selected.anchorMessageId !== latestInbound?.id) {
      if (!editorTouched.current && autoFilledDraftId.current === selectedDraftId && text === selected?.generatedText) {
        setText('');
      }
      autoFilledDraftId.current = null;
      setSelectedDraftId(null);
      pendingSubmission.current = null;
    }
  }, [conversation.replyDrafts, latestInbound?.id, selectedDraftId, text]);

  useEffect(() => {
    if (!draftsEnabled || currentDraft?.status !== 'READY' || !currentDraft.generatedText) return;
    if (offeredDraftIds.current.has(currentDraft.id)) return;
    const replacingUntouchedAutoFill = Boolean(
      selectedDraftId
      && appliedDraft
      && selectedDraftId !== currentDraft.id
      && !editorTouched.current
      && text === appliedDraft.generatedText,
    );
    if (replacingUntouchedAutoFill) return;
    offeredDraftIds.current.add(currentDraft.id);
    if (editorTouched.current || text !== '') return;
    setText(currentDraft.generatedText);
    setTextError(null);
    setSelectedDraftId(currentDraft.id);
    pendingSubmission.current = null;
    autoFilledDraftId.current = currentDraft.id;
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [appliedDraft, currentDraft, draftsEnabled, selectedDraftId, text]);

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
        {copyOnly && <p className="reply-guidance" role="status">{t('conversations.facebookReadOnly')}</p>}
        {disabledReason ? (
          <div className="reply-guidance" role="status">
            <span>{disabledReason}</span>
            {canManageSettings ? <Link href="/settings?tab=social">{t('conversations.configureChannel', { channel })}</Link> : null}
          </div>
        ) : null}
        <form className="social-reply-composer" onSubmit={(event) => void submit(event)}>
          {draftsEnabled && <div className="reply-draft-inline" aria-label={t('conversations.replyDraftTitle')}>
            {draftBusy && <p role="status">{t('conversations.replyDraftWorking')}</p>}
            {draftError && <p role="alert">{draftError}</p>}
            {currentDraft && ['STALE', 'BLOCKED', 'FAILED'].includes(currentDraft.status) && <div className="reply-draft-inline-state">
              <p role="status">{t('conversations.replyDraftUnavailable')}</p>
              {['BLOCKED', 'FAILED'].includes(currentDraft.status) && <LoadingButton className="secondary-button" type="button"
                pending={generatingDraft} disabled={!latestInbound || generatingDraft} onClick={() => void generateDraft()}>
                {t('conversations.replyDraftGenerate')}
              </LoadingButton>}
            </div>}
            {currentDraft?.status === 'READY' && currentDraft.generatedText && !appliedDraft && <details className="reply-draft-available">
              <summary>{t('conversations.replyDraftTitle')}</summary>
              <p>{currentDraft.generatedText}</p>
              {renderDraftSources(currentDraft.sources, t, formatDate)}
            </details>}
            {appliedDraft && <div className="reply-draft-applied">
              <p role="status">{t('conversations.replyDraftApplied')}</p>
              {appliedDraft.sources.length > 0 && <details className="reply-draft-sources">
                <summary>{t('conversations.replyDraftSources')} ({appliedDraft.sources.length})</summary>
                {renderDraftSourceList(appliedDraft.sources, t, formatDate)}
              </details>}
            </div>}
          </div>}
          <label className="sr-only" htmlFor="social-reply">{t('conversations.reply')}</label>
          <textarea
            autoComplete="off"
            aria-describedby={textError ? 'social-reply-hint social-reply-error' : 'social-reply-hint'}
            aria-invalid={Boolean(textError)}
            aria-label={t('conversations.reply')}
            disabled={!conversation.replyCapability.enabled && !copyOnly}
            id="social-reply"
            onChange={(event) => {
              const nextText = event.target.value;
              if (restoringInitialDraft.current && initialReadyDraft && nextText === '') return;
              editorTouched.current = true;
              autoFilledDraftId.current = null;
              setDraftReviewRequired(false);
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

type ReplyDraftSource = NonNullable<ConversationDetailResponse['replyDrafts']>[number]['sources'][number];

function renderDraftSources(
  sources: ReplyDraftSource[],
  t: ReturnType<typeof useI18n>['t'],
  formatDate: ReturnType<typeof useI18n>['formatDate'],
) {
  if (sources.length === 0) return null;
  return <div className="reply-draft-sources">
    <strong>{t('conversations.replyDraftSources')}</strong>
    {renderDraftSourceList(sources, t, formatDate)}
  </div>;
}

function renderDraftSourceList(
  sources: ReplyDraftSource[],
  t: ReturnType<typeof useI18n>['t'],
  formatDate: ReturnType<typeof useI18n>['formatDate'],
) {
  return <ul>{sources.map((source) => <li key={source.productId}>
    <strong>{source.name}</strong> · {source.sku}
    {source.price && source.currency ? <> · {t('conversations.replyDraftPrice')}: {source.price} {source.currency}</> : null}
    {source.stockQuantity !== null ? <> · {t('conversations.replyDraftStock')}: {source.stockQuantity}</> : null}
    <small> · {t('conversations.replyDraftSourceUpdated')}: {formatDate(source.updatedAt)}</small>
  </li>)}</ul>;
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
