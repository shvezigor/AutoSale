'use client';

import type {
  ConversationDetailResponse,
  ConversationMessage,
} from '../../../../packages/contracts/src/conversations';
import Link from 'next/link';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';

import {
  refreshConversation,
  retryConversationMessage,
  sendConversationMessage,
} from '../api/conversation-replies';
import { MessageThread } from './message-thread';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';
import { FieldError } from './form-field';
import { LoadingButton } from './loading-button';

const MAX_MESSAGE_LENGTH = 1_000;
const POLL_INTERVAL_MS = 2_000;

export function InstagramReplyComposer({
  initialConversation,
  canManageSettings,
}: {
  initialConversation: ConversationDetailResponse;
  canManageSettings: boolean;
}) {
  const [conversation, setConversation] = useState(initialConversation);
  const [text, setText] = useState('');
  const [textError, setTextError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const refreshInFlight = useRef(false);
  const keepThreadAtBottom = useRef(true);
  const deliveryStatuses = useRef(new Map(
    initialConversation.messages.map((message) => [message.id, message.delivery?.status ?? null]),
  ));
  const toast = useToast();
  const { t } = useI18n();

  const trimmedText = text.trim();
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
    if (!conversation.replyCapability.enabled || submitting) return;
    const error = !trimmedText ? t('validation.required')
      : trimmedText.length > MAX_MESSAGE_LENGTH ? t('validation.tooLong', { count: MAX_MESSAGE_LENGTH }) : null;
    if (error) {
      setTextError(error);
      textareaRef.current?.focus();
      return;
    }
    setTextError(null);
    setSubmitting(true);
    try {
      const message = await sendConversationMessage(conversation.id, {
        text: trimmedText,
        idempotencyKey: crypto.randomUUID(),
      });
      mergeMessage(message);
      setText('');
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    } catch {
      toast.show({
        type: 'error',
        title: t('conversations.messageSendFailed'),
        message: t('conversations.messagePreserved'),
      });
    } finally {
      setSubmitting(false);
    }
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
      toast.show({
        type: 'error',
        title: t('conversations.retryFailed'),
        message: t('conversations.notDuplicated'),
      });
    } finally {
      setRetryingMessageId(null);
    }
  }

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
            toast.show({
              type: 'error',
              title: t('conversations.messageSendFailed'),
              message: deliveryErrorText(message, t),
            });
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
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [conversation.messages.length]);

  const disabledReason = !conversation.replyCapability.enabled
    ? replyDisabledText(conversation.replyCapability.reason, t)
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
        <MessageThread
          conversation={conversation}
          onRetry={(messageId) => void retry(messageId)}
          retryingMessageId={retryingMessageId}
        />
      </div>
      <div className="reply-area">
        {disabledReason ? (
          <div className="reply-guidance" role="status">
            <span>{disabledReason}</span>
            {canManageSettings ? <Link href="/settings?tab=social">{t('conversations.configureInstagram')}</Link> : null}
          </div>
        ) : null}
        <form className="instagram-reply-composer" onSubmit={(event) => void submit(event)}>
          <label className="sr-only" htmlFor="instagram-reply">{t('conversations.reply')}</label>
          <textarea
            aria-describedby={textError ? 'instagram-reply-hint instagram-reply-error' : 'instagram-reply-hint'}
            aria-invalid={Boolean(textError)}
            aria-label={t('conversations.reply')}
            disabled={!conversation.replyCapability.enabled}
            id="instagram-reply"
            onChange={(event) => { setText(event.target.value); setTextError(null); }}
            onKeyDown={handleKeyDown}
            placeholder={t('conversations.placeholder')}
            ref={textareaRef}
            rows={2}
            value={text}
          />
          <FieldError id="instagram-reply-error" message={textError} />
          <div className="reply-composer-actions">
            <small id="instagram-reply-hint">
              {text.length >= 900 ? `${text.length}/${MAX_MESSAGE_LENGTH}` : t('conversations.newLineHint')}
            </small>
            <LoadingButton pending={submitting} pendingLabel={t('conversations.sending')} disabled={!conversation.replyCapability.enabled || submitting} type="submit">{t('conversations.send')}</LoadingButton>
          </div>
        </form>
      </div>
    </>
  );
}

function replyDisabledText(reason: ConversationDetailResponse['replyCapability']['reason'], t: ReturnType<typeof useI18n>['t']) {
  return reason === 'RECONNECT_REQUIRED'
    ? t('conversations.reconnectToReply')
    : t('conversations.connectToReply');
}

function deliveryErrorText(message: ConversationMessage, t: ReturnType<typeof useI18n>['t']) {
  if (message.delivery?.errorCode === 'INSTAGRAM_RECONNECT_REQUIRED') return t('conversations.reconnectInSettings');
  if (message.delivery?.errorCode === 'INSTAGRAM_RATE_LIMITED') return t('conversations.rateLimited');
  return t('conversations.retryLater');
}
