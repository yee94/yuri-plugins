import { Rpc } from '@opencode/plugin/rpc';

export const PLUGIN_ID = 'opencode-plugin-wecom';

const emptyObjectSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

const anyObjectSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

export const WecomRpc = Rpc.define({
  id: PLUGIN_ID,
  methods: {
    status: {
      input: emptyObjectSchema,
      output: anyObjectSchema,
    },
    startLogin: {
      input: emptyObjectSchema,
      output: {
        type: 'object',
        properties: {
          phase: { type: 'string' },
          authorization_url: { type: 'string' },
        },
        required: ['phase', 'authorization_url'],
      },
    },
    finishLogin: {
      input: {
        type: 'object',
        properties: {
          wait_seconds: { type: 'number' },
        },
        additionalProperties: false,
      },
      output: anyObjectSchema,
    },
    logout: {
      input: emptyObjectSchema,
      output: anyObjectSchema,
    },
    recentReceipts: {
      input: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
        },
        additionalProperties: false,
      },
      output: {
        type: 'object',
        properties: {
          receipts: { type: 'array', items: anyObjectSchema },
        },
        required: ['receipts'],
      },
    },
  },
  events: {
    authChanged: {
      schema: {
        type: 'object',
        properties: {
          phase: { type: 'string' },
          wecom_configured: { type: 'boolean' },
        },
        required: ['phase', 'wecom_configured'],
      },
    },
  },
});
