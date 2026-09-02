import {
  conversationQuerySchema,
  type ConversationDetailResponse,
  type ConversationListResponse,
} from '@autosale/contracts/conversations';
import type { AuthPrincipal } from '@autosale/contracts/auth';
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ZodError } from 'zod';

import { CurrentPrincipal, RequireMembership } from '../auth/auth.decorators.js';
import { ConversationsService } from './conversations.service.js';

type OpenApiSchema = {
  type: 'array' | 'object' | 'string';
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
  required: ['id', 'channel', 'participantName', 'participantUsername', 'participantAvatarUrl', 'messages'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    channel: { type: 'string', enum: ['INSTAGRAM'] },
    participantName: { type: 'string', nullable: true },
    participantUsername: { type: 'string', nullable: true },
    participantAvatarUrl: { type: 'string', nullable: true },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          direction: { type: 'string', enum: ['INBOUND', 'OUTBOUND'] },
          senderId: { type: 'string' },
          text: { type: 'string', nullable: true },
          sourceTimestamp: { type: 'string', format: 'date-time' },
          attachments: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
  };
}
