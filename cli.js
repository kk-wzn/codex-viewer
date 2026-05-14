#!/usr/bin/env node

import { startServer, VERSION } from './server.js';

const args = process.argv.slice(2);
const portArg = args.find(arg => arg.startsWith('--port='));
const codexHomeArg = args.find(arg => arg.startsWith('--codex-home='));
const hostArg = args.find(arg => arg.startsWith('--host='));

const port = portArg ? Number(portArg.slice('--port='.length)) : undefined;
const codexHome = codexHomeArg ? codexHomeArg.slice('--codex-home='.length) : undefined;
const host = hostArg ? hostArg.slice('--host='.length) : undefined;

if (args.includes('--help') || args.includes('-h')) {
  console.log(`codex-viewer v${VERSION}

Usage:
  codex-viewer [--version] [--port=7088] [--host=127.0.0.1] [--codex-home=/path/to/.codex]

Views Codex local sessions from ~/.codex/state_5.sqlite and ~/.codex/sessions.
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

const server = await startServer({ port, host, codexHome });
console.log(`Codex Viewer v${server.version}`);
console.log(`  Local: http://${server.host}:${server.port}`);
console.log(`  Codex home: ${server.codexHome}`);
