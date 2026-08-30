#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMusicwireClient } from './client.js';
import { createMusicwireMcpServer } from './server.js';

const server = createMusicwireMcpServer({ client: createMusicwireClient() });
await server.connect(new StdioServerTransport());
