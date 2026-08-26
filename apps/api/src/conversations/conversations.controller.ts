import {
  conversationQuerySchema,
  type ConversationDetailResponse,
  type ConversationListResponse,
} from '@autosale/contracts/conversations';
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
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface.js';
import { ZodError } from 'zod';

import { ConversationsService } from './conversations.service.js';

@ApiTags('conversations')
@Controller('api/conversations')
export class ConversationsController {
  constructor(
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List manager conversations' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ schema: conversationListOpenApiSchema() })
  async list(@Query() rawQuery: Record<string, unknown>): Promise<ConversationListResponse> {
    try {
      return await this.conversations.list(conversationQuerySchema.parse(rawQuery));
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
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ConversationDetailResponse> {
    return this.conversations.detail(id);
  }
}

function conversationListOpenApiSchema(): SchemaObject {
  return {
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'channel', 'participantName', 'lastMessagePreview', 'lastMessageAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          channel: { type: 'string', enum: ['INSTAGRAM'] },
          participantName: { type: 'string', nullable: true },
          lastMessagePreview: { type: 'string', nullable: true },
          lastMessageAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    nextCursor: { type: 'string', nullable: true },
  },
  };
}

function conversationDetailOpenApiSchema(): SchemaObject {
  return {
  type: 'object',
  required: ['id', 'channel', 'participantName', 'messages'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    channel: { type: 'string', enum: ['INSTAGRAM'] },
    participantName: { type: 'string', nullable: true },
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
