import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MusicwireApiError } from './client.js';

const formats = ['mp3', 'midi'];
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const homepageUrl = packageInfo.homepage.endsWith('/')
  ? packageInfo.homepage
  : `${packageInfo.homepage}/`;
const docsUrl = new URL('docs', homepageUrl).href;
const iconUrl = new URL('musicwire-mark.svg', homepageUrl).href;

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const paidWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export const musicwireMcpConfigSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Musicwire MCP session config',
  description:
    'No user configuration. The hosted Streamable HTTP endpoint needs no Smithery session fields. Paid tools quote x402 Exact USDC and retry with Payment-Signature. Stdio may set MUSICWIRE_API_URL and MUSICWIRE_X402_PRIVATE_KEY in the process environment, not in this schema.',
  type: 'object',
  properties: {},
  additionalProperties: false,
};

export const musicwireMcpServerInfo = {
  name: packageInfo.name,
  version: packageInfo.version,
  title: 'Musicwire',
  description:
    'Pay-per-call MusicXML validation, MuseScore rendering, automated QC, and signed provenance. Musicwire does not compose music.',
  websiteUrl: docsUrl,
  icons: [{ src: iconUrl, mimeType: 'image/svg+xml', sizes: ['any'] }],
};

export const musicwireMcpInstructions = [
  'Musicwire exposes tools only. resources/list and prompts/list return empty arrays; there are no resource URIs or prompt templates.',
  'Hosted clients connect to POST https://musicwire.5432wire.com/mcp with no session config. musicwire_validate and musicwire_render return HTTP 402 with an x402 Exact USDC quote until the identical tools/call is retried with Payment-Signature.',
  'Stdio clients run `npx -y musicwire-mcp`. Optional MUSICWIRE_API_URL defaults to http://127.0.0.1:8787. Paid stdio calls auto-pay a 402 when MUSICWIRE_X402_PRIVATE_KEY is in the process environment.',
  'Typical order: musicwire_compose_guide, musicwire_validate, musicwire_render, then poll musicwire_get_job. Request mp3 to listen and midi to edit. musicwire_compose_guide, musicwire_get_job, and musicwire_verify_provenance are free.',
].join('\n');

const composeGuideSchema = {
  style: z
    .string()
    .optional()
    .describe('Optional style for the prompt, for example waltz or jazz combo.'),
  use: z
    .string()
    .optional()
    .describe('Optional intended use, for example restaurant background or study.'),
  duration: z
    .string()
    .optional()
    .describe('Optional target duration in plain language, for example 45-60 seconds.'),
  key: z.string().optional().describe('Optional concert key, for example F major.'),
  tempo: z.string().optional().describe('Optional tempo marking or BPM, for example 84.'),
  edit: z
    .boolean()
    .optional()
    .describe(
      'When true, the prompt asks to edit supplied MusicXML conservatively instead of composing from scratch.',
    ),
};

const constraintsSchema = z
  .object({
    tempo: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe('Expected score tempo in BPM for the QC constraints check.'),
    duration_seconds: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe('Expected written duration in seconds for the QC constraints check.'),
    key_fifths: z
      .number()
      .int()
      .finite()
      .optional()
      .describe('Expected key signature fifths, MusicXML circle-of-fifths integer.'),
    mode: z
      .enum(['major', 'minor'])
      .optional()
      .describe('Expected mode for the QC constraints check.'),
  })
  .strict();

const musicXmlInput = z.string().min(1).describe('A complete UTF-8 MusicXML document.');
const idempotencyKeyInput = z
  .string()
  .min(1)
  .max(255)
  .optional()
  .describe(
    'Reuse when retrying the same paid request so Musicwire replays the original outcome instead of authorizing another payment.',
  );

const musicwireTools = [
  {
    name: 'musicwire_compose_guide',
    title: 'Compose guide',
    description:
      "Return Musicwire's free MusicXML authoring prompt and quality bar. Use this first, before validate or render, to learn what the QC gate accepts. Does not compose music, does not charge, and needs no Payment-Signature. Optional style, use, duration, key, tempo, and edit flags only shape the prompt text.",
    inputSchema: composeGuideSchema,
    annotations: readOnlyAnnotations,
    call: (input, _extra, { client }) => client.composeGuide(input),
  },
  {
    name: 'musicwire_validate',
    title: 'Validate MusicXML',
    paid: true,
    description:
      "Pay for deterministic MusicXML validation and diagnostics against Musicwire's quality bar. Hosted clients receive HTTP 402 with an x402 Exact USDC quote until they retry the identical tools/call with Payment-Signature; stdio auto-pays when MUSICWIRE_X402_PRIVATE_KEY is set. Does not render audio. Reuse idempotency_key when retrying the same document.",
    inputSchema: {
      musicxml: musicXmlInput,
      idempotency_key: idempotencyKeyInput,
    },
    annotations: paidWriteAnnotations,
    call: (input, _extra, { client }) => client.validate(input),
  },
  {
    name: 'musicwire_render',
    title: 'Render MusicXML',
    paid: true,
    description:
      'Pay to queue an asynchronous MusicXML render. Request mp3 for listening and/or midi for editing. Hosted clients receive HTTP 402 until they retry with Payment-Signature. Poll musicwire_get_job for artifacts and QC. Musicwire does not compose. Completed jobs also include the source MusicXML, NOTICE.txt, and receipt.json. Reuse idempotency_key when retrying.',
    inputSchema: {
      musicxml: musicXmlInput,
      formats: z
        .array(z.enum(formats))
        .min(1)
        .refine((values) => new Set(values).size === values.length, 'formats must be unique.')
        .describe('Unique render outputs: mp3 for listening, midi for editing.'),
      constraints_check: constraintsSchema
        .optional()
        .describe('Optional expected tempo, duration, key, and mode checked during QC.'),
      idempotency_key: idempotencyKeyInput,
    },
    annotations: paidWriteAnnotations,
    call: (input, _extra, { client }) => client.render(input),
  },
  {
    name: 'musicwire_get_job',
    title: 'Get render job',
    description:
      'Free status check for a render job_id: receipt, QC result, and signed artifact URLs. Set wait_for_completion to poll while the job is queued or running. On the hosted HTTP endpoint prefer repeated short calls; gateways time out around 29 seconds while the job keeps running.',
    inputSchema: {
      job_id: z.string().uuid().describe('Render job UUID returned by musicwire_render.'),
      wait_for_completion: z
        .boolean()
        .default(false)
        .describe(
          'When true, poll this job until it leaves queued/running or max_wait_ms elapses.',
        ),
      poll_interval_ms: z
        .number()
        .int()
        .min(10)
        .max(60_000)
        .default(1_000)
        .describe('Delay between status polls when wait_for_completion is true.'),
      max_wait_ms: z
        .number()
        .int()
        .min(10)
        .max(300_000)
        .default(60_000)
        .describe('Maximum time to poll when wait_for_completion is true.'),
    },
    annotations: readOnlyAnnotations,
    call: async (input, extra, { client, pollSignal }) => {
      const signal = anySignal(pollSignal, extra?.signal);
      const job = await client.getJob(input.job_id);
      if (!input.wait_for_completion || !isInProgress(job.status)) return job;
      const deadline = Date.now() + input.max_wait_ms;
      let current = job;
      while (isInProgress(current.status) && Date.now() < deadline && !signal.aborted) {
        await wait(input.poll_interval_ms, signal);
        if (signal.aborted) break;
        current = await client.getJob(input.job_id);
      }
      return current;
    },
  },
  {
    name: 'musicwire_verify_provenance',
    title: 'Verify provenance',
    description:
      "Free check of an unmodified artifact SHA-256 against Musicwire's signed render receipts. A match means Musicwire rendered that exact file; any edit changes the hash. Does not download the file.",
    inputSchema: {
      sha256: z
        .string()
        .regex(/^[a-fA-F0-9]{64}$/, 'sha256 must be a 64-character hexadecimal hash.')
        .describe('SHA-256 of the unmodified artifact file.'),
    },
    annotations: readOnlyAnnotations,
    call: (input, _extra, { client }) => client.verifyProvenance(input),
  },
];

export const paidMusicwireToolNames = new Set(
  musicwireTools.filter((tool) => tool.paid).map((tool) => tool.name),
);

export function musicwireMcpToolCatalog() {
  return musicwireTools.map(({ name, title, description, annotations }) => ({
    name,
    title,
    description,
    annotations,
  }));
}

export function musicwireMcpServerCard() {
  return {
    serverInfo: musicwireMcpServerInfo,
    authentication: {
      required: false,
      schemes: [],
    },
    configSchema: musicwireMcpConfigSchema,
    tools: musicwireMcpToolCatalog(),
    resources: [],
    prompts: [],
  };
}

export function createMusicwireMcpServer({ client, pollSignal }) {
  const server = new McpServer(musicwireMcpServerInfo, {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
    instructions: musicwireMcpInstructions,
  });
  advertiseEmptyCatalogs(server);
  const context = { client, pollSignal };
  for (const tool of musicwireTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (input, extra) => invoke(() => tool.call(input, extra, context)),
    );
  }
  return server;
}

export function paidToolApiRequest(name, arguments_ = {}) {
  if (name === 'musicwire_validate')
    return {
      path: 'v1/validate',
      body: { musicxml: arguments_.musicxml },
    };
  if (name === 'musicwire_render')
    return {
      path: 'v1/render',
      body: {
        musicxml: arguments_.musicxml,
        formats: arguments_.formats,
        ...(arguments_.constraints_check === undefined
          ? {}
          : { constraints_check: arguments_.constraints_check }),
      },
    };
  return null;
}

function advertiseEmptyCatalogs(mcp) {
  mcp.server.registerCapabilities({ resources: {}, prompts: {} });
  mcp.server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [] }));
  mcp.server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
    resourceTemplates: [],
  }));
  mcp.server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    throw new McpError(ErrorCode.InvalidParams, `Resource ${request.params.uri} not found`);
  });
  mcp.server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: [] }));
  mcp.server.setRequestHandler(GetPromptRequestSchema, (request) => {
    throw new McpError(ErrorCode.InvalidParams, `Prompt ${request.params.name} not found`);
  });
}

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

function anySignal(...signals) {
  return AbortSignal.any(signals.filter(Boolean));
}

function wait(milliseconds, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
