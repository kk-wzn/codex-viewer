import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCodexHome,
  getSessions,
  getSession,
  getSessionEvents,
  getSessionGoal,
  getSessionSummary,
  watchSessionEvents,
} from './lib/codex-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 7088;
const DEFAULT_HOST = '127.0.0.1';
const PACKAGE = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
export const VERSION = PACKAGE.version;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function serveStatic(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  if (safePath.includes('..')) {
    sendError(res, 400, 'Invalid path');
    return;
  }

  const filePath = join(__dirname, 'public', safePath);
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      sendError(res, 404, 'Not found');
      return;
    }
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(readFileSync(filePath));
  } catch {
    sendError(res, 404, 'Not found');
  }
}

async function handleRequest(req, res, options) {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;

  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true, codexHome: options.codexHome, version: VERSION });
    return;
  }

  if (pathname === '/api/sessions') {
    try {
      const limit = Math.min(Number(parsed.searchParams.get('limit')) || 100, 500);
      sendJson(res, 200, { sessions: await getSessions({ codexHome: options.codexHome, limit }) });
    } catch (err) {
      sendError(res, 500, err.message);
    }
    return;
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch) {
    try {
      const id = decodeURIComponent(sessionMatch[1]);
      const session = await getSession(id, { codexHome: options.codexHome });
      if (!session) {
        sendError(res, 404, 'Session not found');
        return;
      }
      const events = getSessionEvents(session.rolloutPath);
      const goal = await getSessionGoal(id, { codexHome: options.codexHome });
      sendJson(res, 200, { session, goal, summary: getSessionSummary(events), events });
    } catch (err) {
      sendError(res, 500, err.message);
    }
    return;
  }

  if (pathname === '/events') {
    const id = parsed.searchParams.get('session');
    if (!id) {
      sendError(res, 400, 'Missing session id');
      return;
    }
    const session = await getSession(id, { codexHome: options.codexHome });
    if (!session) {
      sendError(res, 404, 'Session not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('event: ready\ndata: {}\n\n');
    const stop = watchSessionEvents(session.rolloutPath, entries => {
      res.write(`event: entries\ndata: ${JSON.stringify(entries)}\n\n`);
    });
    const ping = setInterval(() => {
      res.write('event: ping\ndata: {}\n\n');
    }, 30000);
    req.on('close', () => {
      clearInterval(ping);
      stop();
    });
    return;
  }

  serveStatic(res, pathname);
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

export async function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, codexHome } = {}) {
  const resolvedCodexHome = getCodexHome(codexHome);
  let actualPort = port;
  const server = createServer((req, res) => {
    handleRequest(req, res, { codexHome: resolvedCodexHome }).catch(err => {
      sendError(res, 500, err.message);
    });
  });

  while (actualPort < port + 50) {
    try {
      await listen(server, host, actualPort);
      return {
        server,
        host,
        port: actualPort,
        codexHome: resolvedCodexHome,
        version: VERSION,
        close: () => new Promise(resolve => server.close(resolve)),
      };
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      actualPort += 1;
    }
  }
  throw new Error(`No available port from ${port} to ${actualPort}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.CODEX_VIEWER_PORT || DEFAULT_PORT);
  const host = process.env.CODEX_VIEWER_HOST || DEFAULT_HOST;
  const codexHome = process.env.CODEX_HOME;
  const started = await startServer({ port, host, codexHome });
  console.log(`Codex Viewer v${started.version} listening at http://${started.host}:${started.port}`);
}
