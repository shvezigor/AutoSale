import {
  conversationQuerySchema,
  conversationOrderStartResponseSchema,
  conversationOrderStateSchema,
  outboundMessageInputSchema,
  type ConversationDetailResponse,
  type ConversationListResponse,
  type ConversationMessage,
  type ConversationOrderStartResponse,
  type ConversationOrderState,
} from '@autosale/contracts/conversations';
import type { AuthPrincipal } from '@autosale/contracts/auth';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ZodError } from 'zod';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { ConversationsService } from './conversations.service.js';

type OpenApiSchema = {
  type: 'array' | 'boolean' | 'integer' | 'object' | 'string';
  format?: string;
  nullable?: boolean;
  enum?: string[];
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
};

@ApiTags('conversations')
@Controller('api/conversations')
@RequireMembership('MANAGER')
export class ConversationsController {
  constructor(
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List manager conversations' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ schema: conversationListOpenApiSchema() })
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Query() rawQuery: Record<string, unknown>): Promise<ConversationListResponse> {
    try {
      return await this.conversations.list(principal.tenantId!, conversationQuerySchema.parse(rawQuery));
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException('Invalid conversation query');
      }
      throw error;
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a manager conversation with messages' })
  @ApiOkResponse({ schema: conversationDetailOpenApiSchema() })
  detail(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ConversationDetailResponse> {
    return this.conversations.detail(principal.tenantId!, id);
  }

  @Get(':id/order')
  @ApiOperation({ summary: 'Get the latest order for a conversation' })
  @ApiOkResponse({ schema: zodObjectOpenApiSchema(conversationOrderStateSchema) })
  orderState(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ConversationOrderState> {
    return this.conversations.orderState(principal.tenantId!, id);
  }

  @Post(':id/order')
  @ApiOperation({ summary: 'Start AI order recognition for a conversation' })
  @ApiCreatedResponse({ schema: zodObjectOpenApiSchema(conversationOrderStartResponseSchema) })
  createOrder(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ConversationOrderStartResponse> {
    return this.conversations.createOrder(principal.tenantId!, id);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send an Instagram conversation reply' })
  @ApiCreatedResponse({ schema: conversationMessageOpenApiSchema() })
  send(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() raw: unknown,
  ): Promise<ConversationMessage> {
    try {
      return this.conversations.send(
        principal.tenantId!,
        principal.userId,
        id,
        outboundMessageInputSchema.parse(raw),
      );
    } catch (error) {
      if (error instanceof ZodError) throw new BadRequestException('Invalid Instagram reply');
      throw error;
    }
  }

  @Post(':id/messages/:messageId/retry')
  @ApiOperation({ summary: 'Retry a safely retryable Instagram reply' })
  @ApiCreatedResponse({ schema: conversationMessageOpenApiSchema() })
  retry(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
  ): Promise<ConversationMessage> {
    return this.conversations.retry(principal.tenantId!, principal.userId, id, messageId);
  }
}

function conversationListOpenApiSchema(): OpenApiSchema {
  return {
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'channel', 'participantName', 'participantUsername', 'participantAvatarUrl', 'lastMessagePreview', 'lastMessageAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          channel: { type: 'string', enum: ['INSTAGRAM'] },
          participantName: { type: 'string', nullable: true },
          participantUsername: { type: 'string', nullable: true },
          participantAvatarUrl: { type: 'string', nullable: true },
          lastMessagePreview: { type: 'string', nullable: true },
          lastMessageAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    nextCursor: { type: 'string', nullable: true },
  },
  };
}

function conversationDetailOpenApiSchema(): OpenApiSchema {
  return {
  type: 'object',
  required: ['id', 'channel', 'participantName', 'participantUsername', 'participantAvatarUrl', 'replyCapability', 'messages'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    channel: { type: 'string', enum: ['INSTAGRAM'] },
    participantName: { type: 'string', nullable: true },
    participantUsername: { type: 'string', nullable: true },
    participantAvatarUrl: { type: 'string', nullable: true },
    replyCapability: {
      type: 'object',
      required: ['enabled', 'reason'],
      properties: {
        enabled: { type: 'boolean' },
        reason: { type: 'string', nullable: true, enum: ['NOT_CONNECTED', 'RECONNECT_REQUIRED'] },
      },
    },
    messages: {
      type: 'array',
      items: conversationMessageOpenApiSchema(),
    },
  },
  };
}

function conversationMessageOpenApiSchema(): OpenApiSchema {
  return {
    type: 'object',
    required: ['id', 'direction', 'senderId', 'text', 'sourceTimestamp', 'attachments', 'delivery'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      direction: { type: 'string', enum: ['INBOUND', 'OUTBOUND'] },
      senderId: { type: 'string' },
      text: { type: 'string', nullable: true },
      sourceTimestamp: { type: 'string', format: 'date-time' },
      attachments: { type: 'array', items: { type: 'object' } },
      delivery: {
        type: 'object',
        nullable: true,
        required: ['status', 'attempts', 'errorCode', 'retryAllowed'],
        properties: {
          status: { type: 'string', enum: ['PENDING', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN'] },
          attempts: { type: 'integer' },
          errorCode: { type: 'string', nullable: true },
          retryAllowed: { type: 'boolean' },
        },
      },
    },
  };
}

function zodObjectOpenApiSchema(schema: typeof conversationOrderStateSchema | typeof conversationOrderStartResponseSchema): OpenApiSchema {
  if (schema === conversationOrderStateSchema) {
    return {
      type: 'object', required: ['order'], properties: {
        order: {
          type: 'object', nullable: true, required: ['id', 'status'], properties: {
            id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['AI_PROCESSING', 'AI_FAILED', 'NEEDS_REVIEW', 'AUTO_APPROVED', 'APPROVED', 'CANCELLED'] },
          },
        },
      },
    };
  }
  return {
    type: 'object', required: ['orderId', 'queued'], properties: {
      orderId: { type: 'string', format: 'uuid', nullable: true },
      queued: { type: 'boolean' },
    },
  };
}
