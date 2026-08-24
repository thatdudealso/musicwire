#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createMusicwireClient, MusicwireApiError } from './client.js';

const formats = ['mscz', 'pdf', 'svg', 'png', 'midi', 'mp3'];

const composeGuideSchema = {
  style: z.string().optional(),
  use: z.string().optional(),
  duration: z.string().optional(),
  key: z.string().optional(),
  tempo: z.string().optional(),
  edit: z.boolean().optional(),
};

const constraintsSchema = z
  .object({
    tempo: z.number().finite().positive().optional(),
    duration_seconds: z.number().finite().positive().optional(),
    key_fifths: z.number().int().finite().optional(),
    mode: z.enum(['major', 'minor']).optional(),
  })
  .strict();

const client = createMusicwireClient();
const server = new McpServer({ name: 'musicwire-mcp', version: '0.1.0' });

server.registerTool(
  'musicwire_compose_guide',
  {
    description: "Get Musicwire's free MusicXML authoring guide and quality bar.",
    inputSchema: composeGuideSchema,
  },
  async (input) => invoke(() => client.composeGuide(input)),
);

server.registerTool(
  'musicwire_validate',
  {
    description: 'Pay for deterministic MusicXML validation and detailed diagnostics.',
    inputSchema: {
      musicxml: z.string().min(1).describe('A complete UTF-8 MusicXML document.'),
      idempotency_key: z.string().min(1).max(255).optional(),
    },
  },
  async (input) => invoke(() => client.validate(input)),
);

server.registerTool(
  'musicwire_render',
  {
    description:
      'Pay to submit an asynchronous MusicXML render. Poll musicwire_get_job for artifacts and QC.',
    inputSchema: {
      musicxml: z.string().min(1).describe('A complete UTF-8 MusicXML document.'),
      formats: z
        .array(z.enum(formats))
        .min(1)
        .refine((values) => new Set(values).size === values.length, 'formats must be unique.'),
      constraints_check: constraintsSchema.optional(),
      idempotency_key: z.string().min(1).max(255).optional(),
    },
  },
  async (input) => invoke(() => client.render(input)),
);

server.registerTool(
  'musicwire_get_job',
  {
    description:
      'Get a render job status, receipt, QC result, and signed artifact URLs. Optionally poll until it completes.',
    inputSchema: {
      job_id: z.string().uuid(),
      wait_for_completion: z.boolean().default(false),
      poll_interval_ms: z.number().int().min(10).max(60_000).default(1_000),
      max_wait_ms: z.number().int().min(10).max(300_000).default(60_000),
    },
  },
  async (input) =>
    invoke(async () => {
      const job = await client.getJob(input.job_id);
      if (!input.wait_for_completion || !isInProgress(job.status)) return job;
      const deadline = Date.now() + input.max_wait_ms;
      let current = job;
      while (isInProgress(current.status) && Date.now() < deadline) {
        await wait(input.poll_interval_ms);
        current = await client.getJob(input.job_id);
      }
      return current;
    }),
);

await server.connect(new StdioServerTransport());

async function invoke(action) {
  try {
    return textResult(await action());
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(errorResult(error)),
        },
      ],
    };
  }
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(error) {
  if (error instanceof MusicwireApiError)
    return { status: error.status, ...(error.body ?? { error: { message: error.message } }) };
  return { error: { code: 'musicwire_mcp_error', message: error.message } };
}

function isInProgress(status) {
  return status === 'queued' || status === 'running';
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
