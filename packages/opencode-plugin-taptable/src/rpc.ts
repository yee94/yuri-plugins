import { Rpc } from '@opencode/plugin/rpc';

export const requestSchema = {
  type: 'object',
  properties: {
    method: { enum: ['GET', 'POST', 'PATCH', 'DELETE'] },
    path: { type: 'string', maxLength: 200 },
    payload: { type: 'object' },
  },
  required: ['method', 'path'],
  additionalProperties: false,
} as const;

export const tapTableRpc = Rpc.define({
  id: 'taptable',
  methods: {
    request: {
      input: requestSchema,
      errors: {},
      output: {
        type: 'object',
        properties: { status: { type: 'integer' }, text: { type: 'string' } },
        required: ['status', 'text'],
        additionalProperties: false,
      },
    },
  },
  events: {},
});

export interface BoardRequest {
  method: string;
  path: string;
  payload?: unknown;
}

export interface BoardReply {
  status: number;
  text: string;
}
