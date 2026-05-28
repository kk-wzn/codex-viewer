import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, watchFile, unwatchFile } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function getCodexHome(explicit) {
  return explicit || process.env.CODEX_HOME || join(homedir(), '.codex');
}

function stateDb(codexHome) {
  return join(codexHome, 'state_5.sqlite');
}

function sessionIndex(codexHome) {
  return join(codexHome, 'session_index.jsonl');
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function querySqliteJson(dbPath, sql) {
  if (!existsSync(dbPath)) return null;
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-json', dbPath, sql], {
      timeout: 5000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(stdout || '[]');
  } catch {
    return null;
  }
}

async function queryOneSqliteJson(dbPath, sql) {
  const rows = await querySqliteJson(dbPath, sql);
  return rows && rows.length > 0 ? rows[0] : null;
}

function readIndexSessions(codexHome) {
  const file = sessionIndex(codexHome);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean)
    .map(item => ({
      id: item.id,
      title: item.thread_name || '',
      cwd: '',
      rolloutPath: findRolloutPath(codexHome, item.id) || '',
      updatedAt: item.updated_at || '',
      createdAt: '',
      source: 'session_index',
      model: '',
      tokensUsed: 0,
    }));
}

function findRolloutPath(codexHome, id) {
  if (!id) return '';
  const root = join(codexHome, 'sessions');
  if (!existsSync(root)) return '';
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.includes(id) && entry.name.endsWith('.jsonl')) {
        return fullPath;
      }
    }
  }
  return '';
}

function normalizeThread(row) {
  return {
    id: row.id,
    title: row.title || row.first_user_message || '',
    cwd: row.cwd || '',
    rolloutPath: row.rollout_path || '',
    createdAt: row.created_at_ms ? new Date(Number(row.created_at_ms)).toISOString() : '',
    updatedAt: row.updated_at_ms ? new Date(Number(row.updated_at_ms)).toISOString() : '',
    source: row.source || '',
    model: row.model || '',
    modelProvider: row.model_provider || '',
    tokensUsed: Number(row.tokens_used || 0),
    archived: !!row.archived,
    gitBranch: row.git_branch || '',
  };
}

export async function getSessions({ codexHome = getCodexHome(), limit = 100 } = {}) {
  const rows = await querySqliteJson(stateDb(codexHome), `
    select id, title, first_user_message, cwd, rollout_path, created_at_ms, updated_at_ms,
           source, model, model_provider, tokens_used, archived, git_branch
    from threads
    order by updated_at_ms desc, id desc
    limit ${Number(limit) || 100}
  `);
  if (rows) return rows.map(normalizeThread);

  return readIndexSessions(codexHome).slice(0, limit);
}

export async function getSession(id, { codexHome = getCodexHome() } = {}) {
  const escaped = String(id).replaceAll("'", "''");
  const rows = await querySqliteJson(stateDb(codexHome), `
    select id, title, first_user_message, cwd, rollout_path, created_at_ms, updated_at_ms,
           source, model, model_provider, tokens_used, archived, git_branch
    from threads
    where id = '${escaped}'
    limit 1
  `);
  if (rows && rows.length > 0) return normalizeThread(rows[0]);
  return readIndexSessions(codexHome).find(s => s.id === id) || null;
}

export async function getSessionGoal(id, { codexHome = getCodexHome() } = {}) {
  const escaped = String(id).replaceAll("'", "''");
  const row = await queryOneSqliteJson(stateDb(codexHome), `
    select thread_id, goal_id, objective, status, token_budget, tokens_used,
           time_used_seconds, created_at_ms, updated_at_ms
    from thread_goals
    where thread_id = '${escaped}'
    limit 1
  `);
  if (!row) return null;
  return {
    threadId: row.thread_id,
    goalId: row.goal_id,
    objective: row.objective,
    status: row.status,
    tokenBudget: row.token_budget,
    tokensUsed: Number(row.tokens_used || 0),
    timeUsedSeconds: Number(row.time_used_seconds || 0),
    createdAt: row.created_at_ms ? new Date(Number(row.created_at_ms)).toISOString() : '',
    updatedAt: row.updated_at_ms ? new Date(Number(row.updated_at_ms)).toISOString() : '',
  };
}

export function getSessionEvents(rolloutPath) {
  if (!rolloutPath || !existsSync(rolloutPath)) return [];
  return readFileSync(rolloutPath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean);
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(item => {
    if (!item || typeof item !== 'object') return '';
    return item.text || item.input_text || item.output_text || item.message || '';
  }).filter(Boolean).join('\n');
}

function messageText(payload) {
  if (!payload) return '';
  if (typeof payload.message === 'string') return payload.message;
  if (payload.message?.content) return textFromContent(payload.message.content);
  if (payload.content) return textFromContent(payload.content);
  if (payload.text) return payload.text;
  if (payload.output) return String(payload.output);
  if (payload.arguments) return payload.arguments;
  if (typeof payload.input === 'string') return payload.input;
  return '';
}

function roleForEvent(event) {
  const payload = event.payload || {};
  if (event.type === 'response_item') {
    if (payload.type === 'message') return payload.role || 'message';
    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') return 'tool';
    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') return 'tool-result';
    return payload.type || 'response';
  }
  if (event.type === 'event_msg') return payload.type || 'event';
  return event.type || 'event';
}

function isEnvironmentContext(text) {
  return typeof text === 'string' && text.trim().startsWith('<environment_context>');
}

export function eventPreview(event) {
  const payload = event.payload || {};
  const text = messageText(payload);
  if (text) return text.slice(0, 2000);
  if (payload.name) return payload.name;
  if (payload.call_id) return payload.call_id;
  return JSON.stringify(payload).slice(0, 2000);
}

export function getConversationItems(events) {
  const responseMessageKeys = new Set(events
    .filter(event => event.type === 'response_item' && event.payload?.type === 'message')
    .map(event => {
      const text = messageText(event.payload);
      if (!text) return '';
      const role = event.payload.role || 'message';
      return `${role}\0${text}`;
    })
    .filter(Boolean));

  const items = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const payload = event.payload || {};

    if (event.type === 'response_item' && payload.type === 'message') {
      const text = messageText(payload);
      if (!text || isEnvironmentContext(text)) continue;
      items.push({
        id: `${i}-${event.timestamp || ''}`,
        timestamp: event.timestamp || '',
        kind: 'message',
        role: payload.role || 'message',
        phase: payload.phase || '',
        text,
      });
      continue;
    }

    if (event.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call')) {
      const isCustom = payload.type === 'custom_tool_call';
      items.push({
        id: `${i}-${payload.call_id || event.timestamp || ''}`,
        timestamp: event.timestamp || '',
        kind: 'tool',
        role: 'tool',
        toolName: payload.name || 'unknown',
        callId: payload.call_id || '',
        text: isCustom ? (payload.input || '') : (payload.arguments || ''),
        custom: isCustom,
      });
      continue;
    }

    if (event.type === 'response_item' && (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output')) {
      items.push({
        id: `${i}-${payload.call_id || event.timestamp || ''}`,
        timestamp: event.timestamp || '',
        kind: 'tool-result',
        role: 'tool-result',
        callId: payload.call_id || '',
        text: payload.output || '',
        custom: payload.type === 'custom_tool_call_output',
      });
      continue;
    }

    // Some Codex sources only write event_msg entries. Other sources mirror
    // user/agent messages as response_item entries, so skip exact mirrors only.
    if (event.type === 'event_msg' && (payload.type === 'user_message' || payload.type === 'agent_message')) {
      const text = messageText(payload);
      if (!text || isEnvironmentContext(text)) continue;
      const role = payload.type === 'user_message' ? 'user' : 'assistant';
      if (responseMessageKeys.has(`${role}\0${text}`)) continue;
      items.push({
        id: `${i}-${event.timestamp || ''}`,
        timestamp: event.timestamp || '',
        kind: 'message',
        role,
        phase: payload.phase || '',
        text,
      });
    }
  }
  return items;
}

export function getSessionSummary(events) {
  const counts = {};
  const roleCounts = {};
  const toolCounts = {};
  const timeline = [];
  let firstTs = '';
  let lastTs = '';
  let lastResponse = null;
  let latestTokenInfo = null;
  const conversation = getConversationItems(events);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    counts[event.type] = (counts[event.type] || 0) + 1;
    firstTs ||= event.timestamp || '';
    lastTs = event.timestamp || lastTs;
    const role = roleForEvent(event);
    roleCounts[role] = (roleCounts[role] || 0) + 1;

    const payload = event.payload || {};
    if (event.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call')) {
      const name = payload.name || 'unknown';
      toolCounts[name] = (toolCounts[name] || 0) + 1;
    }
    if (event.type === 'event_msg' && payload.type === 'token_count') {
      latestTokenInfo = payload.info || null;
    }

    if (role === 'user' || role === 'assistant' || role === 'tool' || role === 'tool-result' || role === 'agent_message' || role === 'user_message') {
      const preview = eventPreview(event);
      timeline.push({
        index: i,
        timestamp: event.timestamp || '',
        type: event.type,
        role,
        preview,
        payload,
      });
      const isAssistantResponse = role === 'assistant' || role === 'agent_message';
      if (isAssistantResponse && preview && payload.phase === 'final_answer') {
        lastResponse = {
          index: i,
          timestamp: event.timestamp || '',
          role,
          preview,
          payload,
        };
      }
    }
  }

  return {
    eventCount: events.length,
    counts,
    roleCounts,
    toolCounts,
    latestTokenInfo,
    lastResponse,
    firstTs,
    lastTs,
    timeline,
    conversation,
  };
}

export function watchSessionEvents(rolloutPath, onEntries) {
  let offset = 0;
  try {
    offset = statSync(rolloutPath).size;
  } catch {
    offset = 0;
  }
  let pending = '';

  const listener = () => {
    let stat;
    try {
      stat = statSync(rolloutPath);
    } catch {
      return;
    }
    if (stat.size < offset) {
      offset = 0;
      pending = '';
    }
    if (stat.size <= offset) return;

    const raw = readFileSync(rolloutPath, 'utf-8').slice(offset);
    offset = stat.size;
    const parts = (pending + raw).split('\n');
    pending = parts.pop() || '';
    const entries = parts.map(line => line.trim()).filter(Boolean).map(parseJsonLine).filter(Boolean);
    if (entries.length > 0) onEntries(entries);
  };

  watchFile(rolloutPath, { interval: 800 }, listener);
  return () => unwatchFile(rolloutPath, listener);
}

export function sessionDisplayName(session) {
  return session.title || basename(session.rolloutPath || '') || session.id;
}
