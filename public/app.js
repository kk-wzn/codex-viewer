const state = {
  sessions: [],
  selectedId: null,
  selected: null,
  goal: null,
  summary: null,
  events: [],
  timeline: [],
  conversation: [],
  eventSource: null,
  tab: 'conversation',
  tabScroll: {},
  rawLimit: 200,
};

const RAW_PAGE_SIZE = 200;
const BACK_TO_TOP_THRESHOLD = 420;

const els = {
  codexHome: document.getElementById('codex-home'),
  version: document.getElementById('app-version'),
  refresh: document.getElementById('refresh-button'),
  count: document.getElementById('session-count'),
  sessionFilter: document.getElementById('session-filter'),
  sessions: document.getElementById('sessions'),
  empty: document.getElementById('empty'),
  detail: document.getElementById('detail'),
  title: document.getElementById('session-title'),
  meta: document.getElementById('session-meta'),
  live: document.getElementById('live-state'),
  stats: document.getElementById('stats'),
  insights: document.getElementById('insights'),
  conversation: document.getElementById('conversation'),
  conversationTab: document.getElementById('conversation-tab'),
  conversationFilter: document.getElementById('conversation-filter'),
  conversationTools: document.getElementById('conversation-tools'),
  conversationInstructions: document.getElementById('conversation-instructions'),
  conversationCollapse: document.getElementById('conversation-collapse'),
  timeline: document.getElementById('timeline-tab'),
  lastResponseTab: document.getElementById('last-response-tab'),
  raw: document.getElementById('raw-events'),
  rawFilter: document.getElementById('raw-filter'),
  rawSummary: document.getElementById('raw-summary'),
  rawTab: document.getElementById('raw-tab'),
  timelineTab: document.getElementById('timeline-tab'),
  backToTop: document.getElementById('back-to-top'),
};

function fmtDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function sessionName(session) {
  return session.title || session.id;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function loadHealth() {
  const data = await fetchJson('/api/health');
  els.codexHome.textContent = data.codexHome;
  if (data.version) els.version.textContent = `v${data.version}`;
}

async function loadSessions({ refreshSelected = false } = {}) {
  const data = await fetchJson('/api/sessions?limit=200');
  state.sessions = data.sessions || [];
  renderSessions();

  const selectedExists = state.selectedId && state.sessions.some(session => session.id === state.selectedId);
  if (refreshSelected && selectedExists) {
    await loadSelectedSession(state.selectedId, { resetView: false });
  } else if (!state.selectedId && state.sessions.length > 0) {
    await selectSession(state.sessions[0].id);
  }
}

function renderSessions() {
  const filter = els.sessionFilter.value.trim().toLowerCase();
  const sessions = filter
    ? state.sessions.filter(session => sessionSearchText(session).includes(filter))
    : state.sessions;
  els.count.textContent = filter
    ? `${formatNumber(sessions.length)} / ${formatNumber(state.sessions.length)}`
    : String(state.sessions.length);

  if (sessions.length === 0) {
    els.sessions.innerHTML = '<div class="session-empty">No sessions match this search.</div>';
    return;
  }

  els.sessions.innerHTML = sessions.map(session => `
    <button class="session ${session.id === state.selectedId ? 'active' : ''}" data-id="${escapeHtml(session.id)}">
      <span class="session-title">${escapeHtml(sessionName(session))}</span>
      <span class="session-line muted">
        <span>${escapeHtml(session.model || session.modelProvider || 'codex')}</span>
        <span>${escapeHtml(fmtDate(session.updatedAt))}</span>
      </span>
      <span class="session-line muted">
        <span>${escapeHtml(session.cwd || session.rolloutPath || '')}</span>
      </span>
    </button>
  `).join('');
}

function sessionSearchText(session) {
  return [
    session.id,
    sessionName(session),
    session.model,
    session.modelProvider,
    session.cwd,
    session.rolloutPath,
    session.gitBranch,
    session.source,
    fmtDate(session.updatedAt),
    fmtDate(session.createdAt),
  ].filter(Boolean).join('\n').toLowerCase();
}

async function selectSession(id) {
  await loadSelectedSession(id, { resetView: true });
}

async function loadSelectedSession(id, { resetView }) {
  state.selectedId = id;
  if (resetView) {
    state.rawLimit = RAW_PAGE_SIZE;
    state.tabScroll = {};
  }
  renderSessions();
  closeEventSource();
  els.live.textContent = 'loading';
  els.live.classList.remove('live');

  const data = await fetchJson(`/api/sessions/${encodeURIComponent(id)}`);
  state.selected = data.session;
  state.goal = data.goal;
  state.summary = data.summary;
  state.events = data.events;
  state.timeline = data.summary.timeline || [];
  state.conversation = data.summary.conversation || [];
  renderDetail();
  openEventSource(id);
}

function renderDetail() {
  const shouldStick = isNearDetailBottom();
  els.empty.classList.add('hidden');
  els.detail.classList.remove('hidden');

  const session = state.selected;
  const summary = state.summary;
  els.title.textContent = sessionName(session);
  els.meta.textContent = [
    session.id,
    session.cwd,
    session.rolloutPath,
  ].filter(Boolean).join(' | ');

  const latestUsage = latestTokenUsage(summary);
  const tokenCount = latestUsage?.total_tokens ?? session.tokensUsed ?? 0;
  els.stats.innerHTML = [
    ['Events', summary.eventCount],
    ['Timeline', state.timeline.length],
    ['Tokens', formatNumber(tokenCount)],
    ['Model', session.model || session.modelProvider || ''],
  ].map(([label, value]) => `
    <div class="stat">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `).join('');

  renderInsights();
  renderConversation();
  renderTimeline();
  renderLastResponse();
  renderRaw();
  if (shouldStick) requestAnimationFrame(scrollDetailToBottom);
  requestAnimationFrame(updateBackToTop);
}

function formatNumber(value) {
  if (typeof value === 'number') return value.toLocaleString();
  return String(value ?? '');
}

function latestTokenUsage(summary) {
  return summary?.latestTokenInfo?.total_token_usage || summary?.latestTokenInfo?.last_token_usage || null;
}

function isNearDetailBottom() {
  if (els.detail.classList.contains('hidden')) return true;
  const remaining = els.detail.scrollHeight - els.detail.scrollTop - els.detail.clientHeight;
  return remaining < 80;
}

function scrollDetailToBottom() {
  if (state.tab === 'timeline' || state.tab === 'conversation') {
    els.detail.scrollTop = els.detail.scrollHeight;
  }
  updateBackToTop();
}

function updateBackToTop() {
  const detailScroll = els.detail.scrollTop || 0;
  const pageScroll = window.scrollY || document.documentElement.scrollTop || 0;
  const visible = !els.detail.classList.contains('hidden') && Math.max(detailScroll, pageScroll) > BACK_TO_TOP_THRESHOLD;
  els.backToTop.classList.toggle('visible', visible);
  els.backToTop.disabled = !visible;
  els.backToTop.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function scrollDetailToTop() {
  state.tabScroll[state.tab] = 0;
  if (els.detail.scrollHeight > els.detail.clientHeight) {
    els.detail.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  requestAnimationFrame(updateBackToTop);
}

function renderInsights() {
  const summary = state.summary;
  const goal = state.goal;
  const latestUsage = latestTokenUsage(summary);
  const rate = summary.latestTokenInfo?.rate_limits || null;
  const tools = Object.entries(summary.toolCounts || {}).sort((a, b) => b[1] - a[1]);
  const roles = Object.entries(summary.roleCounts || {}).sort((a, b) => b[1] - a[1]);

  const goalHtml = goal ? `
    <section class="insight">
      <h3>Goal</h3>
      <p>${escapeHtml(goal.objective)}</p>
      <div class="chips">
        <span>${escapeHtml(goal.status)}</span>
        <span>${escapeHtml(formatNumber(goal.tokensUsed))}${goal.tokenBudget ? ` / ${escapeHtml(formatNumber(goal.tokenBudget))}` : ''} tokens</span>
      </div>
    </section>
  ` : '';

  const usageHtml = latestUsage ? `
    <section class="insight">
      <h3>Token usage</h3>
      <div class="kv">
        <span>Total</span><strong>${escapeHtml(formatNumber(latestUsage.total_tokens || 0))}</strong>
        <span>Input</span><strong>${escapeHtml(formatNumber(latestUsage.input_tokens || 0))}</strong>
        <span>Cached</span><strong>${escapeHtml(formatNumber(latestUsage.cached_input_tokens || 0))}</strong>
        <span>Output</span><strong>${escapeHtml(formatNumber(latestUsage.output_tokens || 0))}</strong>
      </div>
      ${rate?.primary ? `<p class="muted">Primary limit used: ${escapeHtml(rate.primary.used_percent)}%</p>` : ''}
    </section>
  ` : '';

  const toolHtml = `
    <section class="insight">
      <h3>Tools</h3>
      ${tools.length ? `<div class="chips">${tools.slice(0, 12).map(([name, count]) => `<span>${escapeHtml(name)} ${count}</span>`).join('')}</div>` : '<p class="muted">No tool calls in this session.</p>'}
    </section>
  `;

  const roleHtml = `
    <section class="insight">
      <h3>Event roles</h3>
      <div class="chips">${roles.slice(0, 12).map(([name, count]) => `<span>${escapeHtml(name)} ${count}</span>`).join('')}</div>
    </section>
  `;

  els.insights.innerHTML = [goalHtml, usageHtml, toolHtml, roleHtml].filter(Boolean).join('');
}

// Pair tool calls with the result that shares their call_id.
// Standalone tool-results (no preceding call) keep their own bubble.
function pairConversation(items) {
  const out = [];
  const resultsByCall = new Map();
  const consumed = new Set();
  items.forEach((item, idx) => {
    if (item.kind === 'tool-result' && item.callId) {
      if (!resultsByCall.has(item.callId)) resultsByCall.set(item.callId, []);
      resultsByCall.get(item.callId).push(idx);
    }
  });

  items.forEach((item, idx) => {
    if (consumed.has(idx)) return;
    if (item.kind === 'tool' && item.callId && resultsByCall.has(item.callId)) {
      const candidates = resultsByCall.get(item.callId).filter(i => i > idx && !consumed.has(i));
      if (candidates.length) {
        const resultIdx = candidates[0];
        consumed.add(resultIdx);
        out.push({ ...item, result: items[resultIdx] });
        return;
      }
    }
    if (item.kind === 'tool-result' && item.callId && consumed.has(idx)) return;
    out.push(item);
  });

  return out;
}

function applyConversationFilters(items) {
  const filter = els.conversationFilter.value.trim().toLowerCase();
  const showTools = els.conversationTools.checked;
  const showInstructions = els.conversationInstructions.checked;

  return items.filter(item => {
    if (!showTools && (item.kind === 'tool' || item.kind === 'tool-result')) return false;
    if (!showInstructions && (item.role === 'system' || item.role === 'developer')) return false;
    if (!filter) return true;
    const haystack = [
      item.role,
      item.kind,
      item.toolName,
      item.callId,
      item.text,
      item.result?.text,
    ].filter(Boolean).join('\n').toLowerCase();
    return haystack.includes(filter);
  });
}

function renderConversation() {
  const items = visibleConversationItems();
  const query = els.conversationFilter.value.trim();

  if (items.length === 0) {
    els.conversation.innerHTML = '<div class="empty">No conversation items match this view.</div>';
    return;
  }

  const collapseTools = els.conversationCollapse.checked;
  els.conversation.innerHTML = items.map(item => renderItem(item, collapseTools, query)).join('');
}

function visibleConversationItems() {
  return applyConversationFilters(pairConversation(state.conversation));
}

function renderItem(item, collapseTools, query) {
  if (item.kind === 'tool') return renderToolBubble(item, collapseTools, query);
  if (item.kind === 'tool-result') return renderOrphanResult(item, collapseTools, query);
  return renderMessageBubble(item, query);
}

function renderMessageBubble(item, query) {
  const roleLabel = `${item.role}${item.phase ? ` / ${item.phase}` : ''}`;
  const isAssistantOrUser = item.role === 'user' || item.role === 'assistant';
  const body = isAssistantOrUser
    ? highlightHtml(renderMarkdown(item.text || ''), query)
    : `<pre class="plain-text">${highlightText(item.text || '', query)}</pre>`;
  const key = conversationItemKey(item);
  return `
    <article class="bubble ${escapeHtml(item.role)}" id="conversation-${escapeHtml(key)}" data-conversation-key="${escapeHtml(key)}">
      <div class="bubble-meta">
        <span>${escapeHtml(roleLabel)}</span>
        <span>${escapeHtml(fmtDate(item.timestamp))}</span>
      </div>
      <div class="bubble-text markdown">${body}</div>
    </article>
  `;
}

function renderOrphanResult(item, collapseTools, query) {
  const title = `result ${item.callId || ''}`.trim();
  const meta = toolResultMeta(item);
  return `
    <details class="bubble tool-result tool-${escapeHtml(meta.state)}" ${collapseTools ? '' : 'open'}>
      <summary class="tool-summary">
        <span>${highlightText(title, query)}</span>
        <span class="tool-meta-right">
          ${renderToolResultBadges(meta)}
          <span>${escapeHtml(fmtDate(item.timestamp))}</span>
        </span>
      </summary>
      <div class="tool-body">${renderToolOutput(null, item, query)}</div>
    </details>
  `;
}

function renderToolBubble(item, collapseTools, query) {
  const tool = item.toolName || 'tool';
  const renderer = TOOL_RENDERERS[tool] || renderGenericTool;
  const parsedInput = parseInput(item);
  const head = highlightHtml(renderer.head ? renderer.head(parsedInput, item) : escapeHtml(tool), query);
  const body = highlightHtml(renderer.body ? renderer.body(parsedInput, item) : renderGenericTool.body(parsedInput, item), query);
  const resultBody = renderToolOutput(tool, item.result, query);
  const meta = toolResultMeta(item.result);
  const open = !collapseTools;
  return `
    <details class="bubble tool tool-${escapeHtml(tool)} tool-${escapeHtml(meta.state)}" ${open ? 'open' : ''}>
      <summary class="tool-summary">
        <span class="tool-head">${head}</span>
        <span class="tool-meta-right">
          ${renderToolResultBadges(meta)}
          ${item.callId ? `<span class="tool-callid">${escapeHtml(item.callId.slice(-8))}</span>` : ''}
          <span>${escapeHtml(fmtDate(item.timestamp))}</span>
        </span>
      </summary>
      <div class="tool-body">${body}</div>
      ${item.result ? `
        <div class="tool-result-block">
          <div class="tool-result-head">
            <span>Result</span>
            <span>${escapeHtml(fmtDate(item.result.timestamp))}</span>
          </div>
          <div class="tool-result-body">${resultBody}</div>
        </div>
      ` : ''}
    </details>
  `;
}

function parseInput(item) {
  if (typeof item.text !== 'string' || !item.text) return null;
  if (item.custom) return item.text; // custom_tool_call inputs are raw (e.g. patch text)
  try {
    return JSON.parse(item.text);
  } catch {
    return item.text;
  }
}

const TOOL_RENDERERS = {
  exec_command: {
    head: (input) => {
      const cmd = input?.cmd || '';
      const first = cmd.split('\n')[0].slice(0, 80);
      return `<span class="tool-name">shell</span><span class="tool-summary-cmd">${escapeHtml(first)}</span>`;
    },
    body: (input) => {
      if (!input || typeof input !== 'object') return renderGenericTool.body(input);
      const cmd = input.cmd || '';
      const meta = [];
      if (input.workdir) meta.push(`<span class="path">${escapeHtml(input.workdir)}</span>`);
      if (input.yield_time_ms) meta.push(`<span>${escapeHtml(String(input.yield_time_ms))}ms</span>`);
      if (input.max_output_tokens) meta.push(`<span>${escapeHtml(String(input.max_output_tokens))} tokens max</span>`);
      return `
        <div class="tool-cmd">
          <pre class="code shell">${highlightShell(cmd)}</pre>
          ${meta.length ? `<div class="tool-meta">${meta.join('')}</div>` : ''}
        </div>
      `;
    },
  },
  write_stdin: {
    head: (input) => {
      const sid = input?.session_id != null ? `#${input.session_id}` : '';
      return `<span class="tool-name">write_stdin</span><span class="tool-summary-cmd">${escapeHtml(sid)}</span>`;
    },
    body: (input) => {
      if (!input || typeof input !== 'object') return renderGenericTool.body(input);
      const chars = input.chars ?? '';
      return `<pre class="code">${escapeHtml(chars || '(empty input)')}</pre>`;
    },
  },
  apply_patch: {
    head: (input) => {
      const files = parsePatchFiles(typeof input === 'string' ? input : '');
      const summary = files.length
        ? files.map(f => `${f.op} ${f.path.split('/').pop()}`).join(', ')
        : 'patch';
      return `<span class="tool-name">apply_patch</span><span class="tool-summary-cmd">${escapeHtml(summary)}</span>`;
    },
    body: (input) => {
      const text = typeof input === 'string' ? input : (input && typeof input === 'object' ? JSON.stringify(input, null, 2) : '');
      return renderPatch(text);
    },
  },
  update_plan: {
    head: (input) => {
      const steps = Array.isArray(input?.plan) ? input.plan : [];
      const inProgress = steps.find(s => s?.status === 'in_progress');
      const tail = inProgress ? ` — ${inProgress.step}` : '';
      return `<span class="tool-name">update_plan</span><span class="tool-summary-cmd">${escapeHtml(`${steps.length} steps${tail}`)}</span>`;
    },
    body: (input) => {
      if (!input || typeof input !== 'object') return renderGenericTool.body(input);
      const steps = Array.isArray(input.plan) ? input.plan : [];
      const explanation = input.explanation
        ? `<p class="plan-explanation">${escapeHtml(input.explanation)}</p>`
        : '';
      const list = steps.map(step => {
        const status = step?.status || 'pending';
        const icon = planIcon(status);
        return `<li class="plan-step plan-${escapeHtml(status)}">
          <span class="plan-icon">${icon}</span>
          <span class="plan-text">${escapeHtml(step?.step || '')}</span>
          <span class="plan-status">${escapeHtml(status)}</span>
        </li>`;
      }).join('');
      return `${explanation}<ol class="plan-list">${list}</ol>`;
    },
  },
  update_goal: {
    head: (input) => {
      const status = input?.status || 'update';
      return `<span class="tool-name">update_goal</span><span class="tool-summary-cmd">${escapeHtml(status)}</span>`;
    },
    body: (input) => renderGenericTool.body(input),
  },
  get_goal: {
    head: () => `<span class="tool-name">get_goal</span>`,
    body: () => `<p class="muted">Read the current goal.</p>`,
  },
  view_image: {
    head: (input) => {
      const path = input?.path || '';
      return `<span class="tool-name">view_image</span><span class="tool-summary-cmd">${escapeHtml(path.split('/').pop() || path)}</span>`;
    },
    body: (input) => {
      if (!input || typeof input !== 'object' || !input.path) return renderGenericTool.body(input);
      return `<div class="image-tool"><span class="path">${escapeHtml(input.path)}</span></div>`;
    },
  },
};

const renderGenericTool = {
  head: (input, item) => `<span class="tool-name">${escapeHtml(item.toolName || 'tool')}</span>`,
  body: (input) => {
    if (input == null) return '';
    if (typeof input === 'string') {
      return `<pre class="code">${escapeHtml(input)}</pre>`;
    }
    return `<pre class="code json">${escapeHtml(JSON.stringify(input, null, 2))}</pre>`;
  },
};

function renderToolOutput(toolName, result, query = '') {
  if (!result) return '';
  const text = typeof result.text === 'string' ? result.text : String(result.text ?? '');
  if (toolName === 'exec_command' || toolName === 'write_stdin') {
    return `<pre class="code shell-output">${highlightHtml(highlightExecOutput(text), query)}</pre>`;
  }
  if (toolName === 'apply_patch') {
    const ok = !/failed|error/i.test(text);
    const cls = ok ? 'ok' : 'fail';
    return `<div class="patch-result ${cls}"><pre class="code">${highlightText(text, query)}</pre></div>`;
  }
  if (toolName === 'update_plan' || toolName === 'update_goal' || toolName === 'get_goal') {
    return `<pre class="code">${highlightText(text, query)}</pre>`;
  }
  // Try to detect JSON
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return `<pre class="code json">${highlightText(JSON.stringify(JSON.parse(trimmed), null, 2), query)}</pre>`;
    } catch {}
  }
  return `<pre class="code">${highlightText(text, query)}</pre>`;
}

function toolResultMeta(result) {
  if (!result) return { state: 'pending', badges: ['pending'] };
  const text = typeof result.text === 'string' ? result.text : String(result.text ?? '');
  const exitCodeMatch = /Process exited with code (\d+)/.exec(text);
  const wallTimeMatch = /Wall time:\s*([^\n]+)/.exec(text);
  const outputText = execOutputText(text);
  const outputLines = outputText ? outputText.split('\n').filter(Boolean).length : 0;
  const exitCode = exitCodeMatch ? Number(exitCodeMatch[1]) : null;
  const failed = exitCode != null
    ? exitCode !== 0
    : /timed out|failed|error/i.test(text);
  const state = failed ? 'fail' : 'ok';
  const badges = [];
  if (exitCode != null) badges.push(`exit ${exitCode}`);
  else badges.push(state);
  if (wallTimeMatch) badges.push(wallTimeMatch[1].trim());
  if (outputLines > 0) badges.push(`${formatNumber(outputLines)} lines`);
  return { state, badges };
}

function execOutputText(text) {
  const match = /\nOutput:\n([\s\S]*)$/.exec(text);
  return match ? match[1].trim() : '';
}

function renderToolResultBadges(meta) {
  return meta.badges.map(badge => `
    <span class="tool-result-badge tool-result-${escapeHtml(meta.state)}">${escapeHtml(badge)}</span>
  `).join('');
}

function planIcon(status) {
  if (status === 'completed') return '✓';
  if (status === 'in_progress') return '◐';
  if (status === 'cancelled') return '✗';
  return '○';
}

function conversationItemKey(item) {
  return [
    item.kind,
    item.role,
    item.timestamp,
    item.callId || '',
    hashText(item.text || ''),
  ].join('-').replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function hashText(text) {
  let hash = 0;
  const value = String(text || '');
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function highlightText(text, query) {
  const escaped = escapeHtml(text);
  return highlightHtml(escaped, query);
}

function highlightHtml(html, query) {
  const term = String(query || '').trim();
  if (!term) return html;
  const needle = escapeHtml(term);
  if (!needle) return html;
  const re = new RegExp(escapeRegExp(needle), 'gi');
  return String(html).split(/(<[^>]+>)/g).map(part => {
    if (part.startsWith('<')) return part;
    return part.replace(re, match => `<mark class="search-hit">${match}</mark>`);
  }).join('');
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- apply_patch parsing ----------------------------------------------------

function parsePatchFiles(patch) {
  const files = [];
  if (!patch) return files;
  const lines = patch.split('\n');
  for (const line of lines) {
    const update = /^\*\*\* Update File: (.+)$/.exec(line);
    if (update) { files.push({ op: 'Update', path: update[1].trim() }); continue; }
    const add = /^\*\*\* Add File: (.+)$/.exec(line);
    if (add) { files.push({ op: 'Add', path: add[1].trim() }); continue; }
    const del = /^\*\*\* Delete File: (.+)$/.exec(line);
    if (del) { files.push({ op: 'Delete', path: del[1].trim() }); continue; }
  }
  return files;
}

function renderPatch(patch) {
  if (!patch) return '';
  const blocks = [];
  const lines = patch.split('\n');
  let current = null;
  const flush = () => { if (current) { blocks.push(current); current = null; } };

  for (const line of lines) {
    if (/^\*\*\* Begin Patch$/.test(line)) continue;
    if (/^\*\*\* End Patch$/.test(line)) continue;
    const fileHeader = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (fileHeader) {
      flush();
      current = { op: fileHeader[1], path: fileHeader[2].trim(), hunks: [] };
      continue;
    }
    if (!current) continue;
    if (/^@@/.test(line)) {
      current.hunks.push({ header: line, rows: [] });
      continue;
    }
    if (current.hunks.length === 0) current.hunks.push({ header: '', rows: [] });
    current.hunks[current.hunks.length - 1].rows.push(line);
  }
  flush();

  if (blocks.length === 0) {
    return `<pre class="code">${escapeHtml(patch)}</pre>`;
  }

  return blocks.map(block => `
    <div class="diff">
      <div class="diff-head">
        <span class="diff-op diff-op-${escapeHtml(block.op.toLowerCase())}">${escapeHtml(block.op)}</span>
        <span class="path">${escapeHtml(block.path)}</span>
      </div>
      ${block.hunks.map(hunk => renderHunk(hunk)).join('')}
    </div>
  `).join('');
}

function renderHunk(hunk) {
  const rows = hunk.rows.map(line => {
    const first = line.charAt(0);
    let cls = 'diff-ctx';
    if (first === '+') cls = 'diff-add';
    else if (first === '-') cls = 'diff-del';
    return `<div class="diff-row ${cls}">${escapeHtml(line)}</div>`;
  }).join('');
  const header = hunk.header ? `<div class="diff-hunk-head">${escapeHtml(hunk.header)}</div>` : '';
  return `<div class="diff-hunk">${header}${rows}</div>`;
}

// --- markdown rendering -----------------------------------------------------

function renderMarkdown(text) {
  if (!text) return '';
  // Split by fenced code blocks first, render code blocks separately.
  const parts = splitFences(String(text));
  return parts.map(part => {
    if (part.type === 'code') {
      return `<pre class="code md-code lang-${escapeHtml(part.lang || 'plain')}">${highlightCode(part.code, part.lang)}</pre>`;
    }
    return renderMarkdownBlock(part.text);
  }).join('');
}

function splitFences(text) {
  const out = [];
  const re = /```([\w+\-./]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ type: 'text', text: text.slice(last, m.index) });
    }
    out.push({ type: 'code', lang: m[1] || '', code: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ type: 'text', text: text.slice(last) });
  }
  if (out.length === 0) out.push({ type: 'text', text });
  return out;
}

function renderMarkdownBlock(raw) {
  const lines = raw.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Headings
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level} class="md-h${level}">${renderInline(heading[2])}</h${level}>`);
      i++; continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote class="md-quote">${renderMarkdownBlock(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      out.push(`<ul class="md-ul">${items.map(it => `<li>${renderInline(it)}</li>`).join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push(`<ol class="md-ol">${items.map(it => `<li>${renderInline(it)}</li>`).join('')}</ol>`);
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push('<hr class="md-hr" />');
      i++; continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      i++; continue;
    }

    // Paragraph: gather until blank line or block construct
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p class="md-p">${renderInline(buf.join('\n'))}</p>`);
  }
  return out.join('');
}

function renderInline(text) {
  // Protect code spans first.
  const tokens = [];
  let placeholderIdx = 0;
  let working = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const key = `__CODE${placeholderIdx++}__`;
    tokens.push({ key, html: `<code class="md-code-inline">${escapeHtml(code)}</code>` });
    return key;
  });

  // Escape remaining HTML.
  working = escapeHtml(working);

  // Links: [text](url)
  working = working.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    const safeUrl = /^(https?:|mailto:|file:|\/|\.\.?\/)/i.test(u) ? u : '#';
    return `<a class="md-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">${t}</a>`;
  });

  // Bold (**) and italic (* or _)
  working = working.replace(/\*\*([^*\n][^*]*?)\*\*/g, '<strong>$1</strong>');
  working = working.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  working = working.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');

  // Line breaks
  working = working.replace(/\n/g, '<br />');

  // Restore code spans
  for (const tok of tokens) {
    working = working.replace(tok.key, tok.html);
  }
  return working;
}

// --- light syntax highlighting ---------------------------------------------

function highlightCode(code, lang) {
  const language = (lang || '').toLowerCase();
  if (!language || language === 'text' || language === 'plain') return escapeHtml(code);
  if (['js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx'].includes(language)) {
    return highlightJsLike(code);
  }
  if (['py', 'python'].includes(language)) return highlightPython(code);
  if (['sh', 'bash', 'shell', 'zsh'].includes(language)) return highlightShell(code);
  if (['json', 'jsonc'].includes(language)) return highlightJson(code);
  if (['css', 'scss', 'less'].includes(language)) return highlightCss(code);
  if (['html', 'xml'].includes(language)) return highlightXml(code);
  return escapeHtml(code);
}

const JS_KEYWORDS = new Set([
  'await','async','break','case','catch','class','const','continue','debugger','default',
  'delete','do','else','export','extends','finally','for','from','function','if','import',
  'in','instanceof','let','new','of','return','static','super','switch','this','throw',
  'try','typeof','var','void','while','with','yield','true','false','null','undefined',
  'as','interface','type','enum','public','private','protected','readonly','implements',
]);

const PY_KEYWORDS = new Set([
  'False','None','True','and','as','assert','async','await','break','class','continue',
  'def','del','elif','else','except','finally','for','from','global','if','import','in',
  'is','lambda','nonlocal','not','or','pass','raise','return','try','while','with','yield','match','case',
]);

function highlightJsLike(code) {
  return tokenize(code, [
    [/\/\/[^\n]*/, 'tok-comment'],
    [/\/\*[\s\S]*?\*\//, 'tok-comment'],
    [/`(?:[^`\\]|\\[\s\S])*`/, 'tok-string'],
    [/"(?:[^"\\]|\\[\s\S])*"/, 'tok-string'],
    [/'(?:[^'\\]|\\[\s\S])*'/, 'tok-string'],
    [/\b\d+(\.\d+)?\b/, 'tok-num'],
    [/\b[A-Za-z_$][\w$]*\b/, m => JS_KEYWORDS.has(m) ? 'tok-kw' : null],
  ]);
}

function highlightPython(code) {
  return tokenize(code, [
    [/#[^\n]*/, 'tok-comment'],
    [/"""[\s\S]*?"""/, 'tok-string'],
    [/'''[\s\S]*?'''/, 'tok-string'],
    [/"(?:[^"\\]|\\[\s\S])*"/, 'tok-string'],
    [/'(?:[^'\\]|\\[\s\S])*'/, 'tok-string'],
    [/\b\d+(\.\d+)?\b/, 'tok-num'],
    [/\b[A-Za-z_][\w]*\b/, m => PY_KEYWORDS.has(m) ? 'tok-kw' : null],
  ]);
}

function highlightShell(code) {
  return tokenize(code, [
    [/#[^\n]*/, 'tok-comment'],
    [/"(?:[^"\\]|\\[\s\S])*"/, 'tok-string'],
    [/'[^']*'/, 'tok-string'],
    [/\$\{[^}]+\}|\$[A-Za-z_][\w]*/, 'tok-var'],
    [/(?:^|(?<=[\n;|&]))\s*([A-Za-z_][\w./-]*)/, 'tok-kw'],
    [/(?:^|\s)-{1,2}[A-Za-z][\w-]*/, 'tok-flag'],
  ]);
}

function highlightJson(code) {
  return tokenize(code, [
    [/"(?:[^"\\]|\\[\s\S])*"(?=\s*:)/, 'tok-key'],
    [/"(?:[^"\\]|\\[\s\S])*"/, 'tok-string'],
    [/\b(true|false|null)\b/, 'tok-kw'],
    [/-?\b\d+(\.\d+)?\b/, 'tok-num'],
  ]);
}

function highlightCss(code) {
  return tokenize(code, [
    [/\/\*[\s\S]*?\*\//, 'tok-comment'],
    [/"(?:[^"\\]|\\[\s\S])*"/, 'tok-string'],
    [/'(?:[^'\\]|\\[\s\S])*'/, 'tok-string'],
    [/[a-z-]+(?=\s*:)/, 'tok-key'],
    [/#[0-9a-fA-F]{3,8}\b/, 'tok-num'],
    [/\b\d+(\.\d+)?(px|em|rem|%|vh|vw|s|ms)?\b/, 'tok-num'],
  ]);
}

function highlightXml(code) {
  return tokenize(code, [
    [/<!--[\s\S]*?-->/, 'tok-comment'],
    [/"(?:[^"\\]|\\[\s\S])*"/, 'tok-string'],
    [/<\/?[\w:-]+/, 'tok-kw'],
    [/[\w:-]+(?==)/, 'tok-key'],
  ]);
}

// Tokenize text using a list of [regex, classOrFn]. Returns escaped html with
// matched tokens wrapped. Uses sticky regex + lastIndex so each position is
// O(rules) instead of O(remaining-length); also bails out on very large blocks.
const TOKENIZE_MAX_LENGTH = 200_000;

function tokenize(code, rules) {
  if (code.length > TOKENIZE_MAX_LENGTH) return escapeHtml(code);

  const stickyRules = rules.map(([re, cls]) => {
    let flags = re.flags;
    if (!flags.includes('y')) flags += 'y';
    if (!flags.includes('m')) flags += 'm';
    return [new RegExp(re.source, flags), cls];
  });

  const out = [];
  let i = 0;
  outer: while (i < code.length) {
    for (const [re, cls] of stickyRules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m.index === i && m[0].length > 0) {
        const matched = m[0];
        const klass = typeof cls === 'function' ? cls(matched) : cls;
        if (klass) {
          out.push(`<span class="${klass}">${escapeHtml(matched)}</span>`);
        } else {
          out.push(escapeHtml(matched));
        }
        i += matched.length;
        continue outer;
      }
    }
    out.push(escapeHtml(code[i]));
    i++;
  }
  return out.join('');
}

function highlightExecOutput(text) {
  // Codex exec output starts with metadata lines like "Command:", "Wall time:",
  // "Process exited with code N". Highlight those for readability.
  return escapeHtml(text)
    .replace(/^(Command:.*)$/m, '<span class="tok-key">$1</span>')
    .replace(/^(Chunk ID:.*)$/m, '<span class="tok-comment">$1</span>')
    .replace(/^(Wall time:.*)$/m, '<span class="tok-comment">$1</span>')
    .replace(/^(Original token count:.*)$/m, '<span class="tok-comment">$1</span>')
    .replace(/^Process exited with code (\d+)$/m, (_, code) => {
      const cls = code === '0' ? 'tok-ok' : 'tok-err';
      return `<span class="${cls}">Process exited with code ${code}</span>`;
    });
}

// ---------------------------------------------------------------------------

function renderTimeline() {
  if (state.timeline.length === 0) {
    els.timeline.innerHTML = '<div class="empty">No conversation events found in this rollout.</div>';
    return;
  }

  const blocks = [];
  let currentGroup = '';
  for (const item of state.timeline) {
    const group = timelineGroup(item.timestamp);
    if (group !== currentGroup) {
      currentGroup = group;
      blocks.push(`<div class="timeline-group">${escapeHtml(group)}</div>`);
    }
    const kind = timelineKind(item);
    blocks.push(`
    <article class="event timeline-event timeline-${escapeHtml(kind.id)}">
      <div class="event-head">
        <span>
          <span class="event-role">${escapeHtml(item.role)}</span>
          ${escapeHtml(item.type)}
          <span class="timeline-badge">${escapeHtml(kind.label)}</span>
        </span>
        <span>${escapeHtml(fmtDate(item.timestamp))}</span>
      </div>
      <div class="event-body">${escapeHtml(item.preview || '')}</div>
    </article>
    `);
  }
  els.timeline.innerHTML = blocks.join('');
}

function renderLastResponse() {
  const item = state.summary.lastResponse;
  if (!item) {
    els.lastResponseTab.innerHTML = '<div class="empty">No final response found in this rollout.</div>';
    return;
  }
  const key = lastResponseConversationKey();
  els.lastResponseTab.innerHTML = `
    <div class="last-response-actions">
      <button type="button" data-copy-last-response>Copy response</button>
      <button type="button" data-jump-last-response ${key ? '' : 'disabled'}>Jump to conversation</button>
    </div>
    <article class="event">
      <div class="event-head">
        <span><span class="event-role">${escapeHtml(item.role)}</span> Last Response</span>
        <span>${escapeHtml(fmtDate(item.timestamp))}</span>
      </div>
      <div class="event-body markdown">${renderMarkdown(item.preview || '')}</div>
    </article>
  `;
}

function timelineGroup(timestamp) {
  if (!timestamp) return 'Unknown time';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  return date.toLocaleDateString();
}

function timelineKind(item) {
  const payload = item.payload || {};
  const preview = item.preview || '';
  const role = String(item.role || '').toLowerCase();
  const toolName = payload.name || '';
  if (role === 'user' || role === 'user_message') return { id: 'user', label: 'User prompt' };
  if ((role === 'assistant' || role === 'agent_message') && payload.phase === 'final_answer') {
    return { id: 'final', label: 'Final answer' };
  }
  if ((role === 'tool-result' || payload.type === 'function_call_output') && /Process exited with code [1-9]|timed out|failed|error/i.test(preview)) {
    return { id: 'tool-error', label: 'Tool error' };
  }
  if (toolName === 'apply_patch') return { id: 'patch', label: 'Patch' };
  if (toolName === 'exec_command') {
    return /\bgit\s+push\b/.test(preview) ? { id: 'git-push', label: 'Git push' } : { id: 'shell', label: 'Shell' };
  }
  if (role === 'tool') return { id: 'tool', label: toolName || 'Tool call' };
  if (role === 'tool-result') return { id: 'tool-result', label: 'Tool result' };
  return { id: 'event', label: payload.phase || payload.type || 'Event' };
}

function lastResponseConversationKey() {
  const item = state.summary?.lastResponse;
  if (!item) return '';
  const visibleItems = visibleConversationItems();
  for (let i = visibleItems.length - 1; i >= 0; i--) {
    const candidate = visibleItems[i];
    if (candidate.kind !== 'message') continue;
    const assistantRole = candidate.role === 'assistant' || candidate.role === 'agent_message';
    if (!assistantRole) continue;
    if (sameResponseText(candidate.text, item.preview)) {
      return conversationItemKey(candidate);
    }
  }
  return '';
}

function sameResponseText(a, b) {
  const left = comparableText(a);
  const right = comparableText(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function comparableText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function renderRaw() {
  const rawFilter = parseRawFilter(els.rawFilter.value);
  const rawEvents = state.events.map(createRawEventItem);
  const events = rawFilter.active
    ? rawEvents.filter(item => rawMatchesFilter(item, rawFilter))
    : rawEvents;
  const visibleEvents = events.slice(0, state.rawLimit);

  els.rawSummary.innerHTML = renderRawSummary(events, rawEvents.length, rawFilter, visibleEvents.length);
  if (events.length === 0) {
    els.raw.innerHTML = '<div class="empty">No raw events match this filter.</div>';
    return;
  }

  const autoOpen = visibleEvents.length <= 3;
  const moreCount = events.length - visibleEvents.length;
  const moreHtml = moreCount > 0 ? `
    <div class="raw-more">
      <button class="raw-more-button" type="button" data-raw-more>
        Show next ${escapeHtml(formatNumber(Math.min(RAW_PAGE_SIZE, moreCount)))} events
      </button>
      <span class="muted">${escapeHtml(formatNumber(moreCount))} still hidden for performance</span>
    </div>
  ` : '';
  els.raw.innerHTML = `${visibleEvents.map(item => renderRawEvent(item, autoOpen)).join('')}${moreHtml}`;
}

function createRawEventItem(event, index) {
  const role = rawEventRole(event);
  const sender = rawEventSender(event, role);
  const label = rawEventLabel(event);
  const preview = rawEventPreview(event);
  const payload = event.payload || {};
  const directPreview = previewEvent(event);
  const json = JSON.stringify(event);
  const search = [
    String(index + 1),
    event.timestamp,
    event.type,
    role,
    sender.id,
    sender.label,
    payload.type,
    payload.phase,
    payload.name,
    payload.call_id,
    label,
    directPreview,
  ].filter(Boolean).join('\n').toLowerCase();
  return {
    event,
    index,
    role,
    sender,
    label,
    preview,
    search,
    json: json.toLowerCase(),
  };
}

function renderRawSummary(events, total, rawFilter, visibleCount) {
  const counts = new Map();
  const senderCounts = new Map();
  for (const item of events) {
    const type = item.event.type || 'event';
    counts.set(type, (counts.get(type) || 0) + 1);
    const current = senderCounts.get(item.sender.id) || { label: item.sender.label, count: 0 };
    current.count += 1;
    senderCounts.set(item.sender.id, current);
  }
  const senderChips = [...senderCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
    .map(([id, item]) => renderRawFilterButton(
      `sender:${id}`,
      `${item.label} ${formatNumber(item.count)}`,
      `raw-sender-summary raw-sender-${safeClass(id)}`,
      rawFilter,
    ))
    .join('');
  const typeChips = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([type, count]) => renderRawFilterButton(
      `type:${type}`,
      `${type} ${formatNumber(count)}`,
      'raw-type-summary',
      rawFilter,
    ))
    .join('');
  const matchingText = rawFilter.active
    ? `matching "${rawFilter.tokens.join(' ')}"`
    : 'total';
  const renderedText = visibleCount < events.length
    ? `Rendered ${formatNumber(visibleCount)} of ${formatNumber(events.length)}`
    : `Showing ${formatNumber(events.length)}`;
  return `
    <div class="raw-summary-count">
      <strong>${escapeHtml(renderedText)}</strong> events
      <span class="muted">${escapeHtml(matchingText)} from ${escapeHtml(formatNumber(total))} raw events</span>
      ${rawFilter.active ? '<button class="raw-clear-filter" type="button" data-raw-clear>Clear</button>' : ''}
    </div>
    <div class="raw-summary-groups">
      ${senderChips ? `<div class="raw-summary-senders">${senderChips}</div>` : ''}
      ${typeChips ? `<div class="raw-summary-types">${typeChips}</div>` : ''}
    </div>
  `;
}

function renderRawFilterButton(token, label, className, rawFilter) {
  const active = rawFilter.tokenSet.has(token.toLowerCase());
  return `
    <button
      class="${escapeHtml(className)} ${active ? 'active' : ''}"
      type="button"
      data-raw-filter="${escapeHtml(token)}"
      title="Toggle ${escapeHtml(token)}"
    >${escapeHtml(label)}</button>
  `;
}

function parseRawFilter(value) {
  const tokens = splitFilterTokens(value);
  const fields = [];
  const terms = [];

  for (const token of tokens) {
    const fieldMatch = /^([a-zA-Z][\w-]*):(.*)$/.exec(token);
    if (fieldMatch) {
      const field = normalizeRawFilterField(fieldMatch[1]);
      const fieldValue = fieldMatch[2].trim().toLowerCase();
      if (field && fieldValue) {
        fields.push({ field, value: fieldValue });
        continue;
      }
    }
    const term = token.trim().toLowerCase();
    if (term) terms.push(term);
  }

  return {
    active: fields.length > 0 || terms.length > 0,
    fields,
    terms,
    tokens,
    tokenSet: new Set(tokens.map(token => token.toLowerCase())),
  };
}

function splitFilterTokens(value) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(value || ''))) !== null) {
    const token = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

function normalizeRawFilterField(field) {
  const key = String(field || '').toLowerCase().replaceAll('-', '_');
  const aliases = {
    call: 'call_id',
    callid: 'call_id',
    event: 'type',
    event_type: 'type',
    from: 'sender',
    message: 'text',
    name: 'tool',
    payload_type: 'payload',
    preview: 'text',
    q: 'text',
    source: 'sender',
    tool_name: 'tool',
  };
  const normalized = aliases[key] || key;
  return [
    'call_id',
    'index',
    'json',
    'label',
    'payload',
    'phase',
    'role',
    'sender',
    'text',
    'tool',
    'type',
  ].includes(normalized) ? normalized : null;
}

function rawMatchesFilter(item, rawFilter) {
  return rawFilter.terms.every(term => item.search.includes(term)) &&
    rawFilter.fields.every(({ field, value }) => rawFieldMatches(item, field, value));
}

function rawFieldMatches(item, field, value) {
  if (field === 'json') return item.json.includes(value);
  const payload = item.event.payload || {};
  const values = {
    call_id: [payload.call_id],
    index: [String(item.index + 1)],
    label: [item.label],
    payload: [payload.type],
    phase: [payload.phase],
    role: [item.role],
    sender: [item.sender.id, safeClass(item.sender.label)],
    text: [previewEvent(item.event), item.preview],
    tool: [payload.name],
    type: [item.event.type],
  }[field] || [];

  if (['payload', 'role', 'sender', 'type'].includes(field)) {
    return values.some(itemValue => String(itemValue || '').toLowerCase() === value);
  }
  return values.some(itemValue => String(itemValue || '').toLowerCase().includes(value));
}

function toggleRawFilterToken(token) {
  const tokens = splitFilterTokens(els.rawFilter.value);
  const normalized = token.toLowerCase();
  const index = tokens.findIndex(item => item.toLowerCase() === normalized);
  if (index >= 0) {
    tokens.splice(index, 1);
  } else {
    tokens.push(token);
  }
  els.rawFilter.value = tokens.join(' ');
  state.rawLimit = RAW_PAGE_SIZE;
  renderRaw();
}

function renderRawEvent(item, open) {
  const { event, index, role, sender, label, preview } = item;
  const payload = event.payload || {};
  const timestamp = fmtDate(event.timestamp) || event.timestamp || '';
  const json = JSON.stringify(event, null, 2);
  const senderClass = safeClass(sender.id);
  return `
    <details class="raw-event raw-sender-${senderClass}" ${open ? 'open' : ''}>
      <summary class="raw-event-head">
        <span class="raw-event-main">
          <span class="raw-index">#${escapeHtml(index + 1)}</span>
          <span class="raw-event-tags">
            <span class="raw-sender">${escapeHtml(sender.label)}</span>
            <span class="raw-event-type">${escapeHtml(event.type || 'event')}</span>
            ${label ? `<span class="raw-chip">${escapeHtml(label)}</span>` : ''}
          </span>
          <span class="raw-event-preview">${escapeHtml(preview || '(no preview)')}</span>
        </span>
        <span class="raw-event-time">${escapeHtml(timestamp)}</span>
      </summary>
      <div class="raw-event-detail">
        ${renderRawMeta(event, role)}
        <div class="raw-actions">
          <button type="button" data-copy-raw="${escapeHtml(index)}">Copy JSON</button>
          ${payload.call_id ? `<button type="button" data-copy-call-id="${escapeHtml(index)}">Copy call_id</button>` : ''}
          <button type="button" data-raw-expand>Expand full</button>
        </div>
        <pre class="code json raw-json">${highlightJson(json)}</pre>
      </div>
    </details>
  `;
}

function renderRawMeta(event, role) {
  const payload = event.payload || {};
  const sender = rawEventSender(event, role);
  const rows = [
    ['timestamp', fmtDate(event.timestamp) || event.timestamp],
    ['sender', sender.label],
    ['event', event.type],
    ['role', role],
    ['payload', payload.type],
    ['phase', payload.phase],
    ['tool', payload.name],
    ['call id', payload.call_id],
  ].filter(([, value]) => value);

  if (rows.length === 0) return '';
  return `<dl class="raw-meta">
    ${rows.map(([key, value]) => `
      <div>
        <dt>${escapeHtml(key)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `).join('')}
  </dl>`;
}

function rawEventRole(event) {
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

function rawEventSender(event, role) {
  const payload = event.payload || {};
  const normalized = String(role || payload.role || payload.type || event.type || '').toLowerCase();

  if (payload.role === 'user' || payload.type === 'user_message' || normalized === 'user') {
    return { id: 'user', label: 'User' };
  }
  if (payload.role === 'assistant' || payload.type === 'agent_message' || normalized === 'assistant' || normalized === 'agent_message') {
    return { id: 'assistant', label: 'Assistant' };
  }
  if (payload.role === 'developer' || payload.type === 'developer_message' || normalized === 'developer' || normalized === 'developer_message') {
    return { id: 'developer', label: 'Developer' };
  }
  if (payload.role === 'system' || payload.type === 'system_message' || normalized === 'system' || normalized === 'system_message') {
    return { id: 'system', label: 'System' };
  }
  if (normalized === 'tool' || payload.type === 'function_call' || payload.type === 'custom_tool_call') {
    return { id: 'tool', label: 'Tool' };
  }
  if (normalized === 'tool-result' || payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
    return { id: 'tool-result', label: 'Tool result' };
  }
  if (event.type === 'response_item') {
    return { id: 'response', label: 'Response' };
  }
  return { id: 'event', label: 'Event' };
}

function rawEventLabel(event) {
  const payload = event.payload || {};
  if (payload.name) return payload.name;
  if (payload.phase) return payload.phase;
  if (payload.type) return payload.type;
  if (payload.role) return payload.role;
  return '';
}

function rawEventPreview(event) {
  const preview = previewEvent(event);
  if (preview) return compactText(preview, 260);
  const payload = event.payload || {};
  const fallback = Object.keys(payload).length ? JSON.stringify(payload) : JSON.stringify(event);
  return compactText(fallback, 260);
}

function compactText(text, limit) {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit - 1)}…`;
}

function safeClass(value) {
  return String(value || 'event').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function closeEventSource() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function openEventSource(id) {
  const es = new EventSource(`/events?session=${encodeURIComponent(id)}`);
  state.eventSource = es;
  els.live.textContent = 'live';
  els.live.classList.add('live');

  es.addEventListener('entries', event => {
    const entries = JSON.parse(event.data);
    state.events.push(...entries);
    appendConversationItems(entries.flatMap(entryToConversationItems));
    const timelineEntries = entries.map(entry => ({
      timestamp: entry.timestamp || '',
      type: entry.type,
      role: entry.payload?.role || entry.payload?.type || entry.type,
      preview: previewEvent(entry),
      payload: entry.payload || {},
    })).filter(item => item.preview);
    state.timeline.push(...timelineEntries);
    state.summary.eventCount = state.events.length;
    state.summary.toolCounts = mergeToolCounts(state.summary.toolCounts || {}, entries);
    state.summary.roleCounts = mergeRoleCounts(state.summary.roleCounts || {}, entries);
    const latestTokenEvent = [...entries].reverse().find(entry => entry.type === 'event_msg' && entry.payload?.type === 'token_count');
    if (latestTokenEvent) state.summary.latestTokenInfo = latestTokenEvent.payload.info || null;
    const latestResponse = [...timelineEntries].reverse().find(item => {
      return (item.role === 'assistant' || item.role === 'agent_message') && item.payload?.phase === 'final_answer';
    });
    if (latestResponse) state.summary.lastResponse = latestResponse;
    renderDetail();
  });

  es.onerror = () => {
    els.live.textContent = 'reconnecting';
    els.live.classList.remove('live');
  };
}

function mergeToolCounts(current, entries) {
  const next = { ...current };
  for (const entry of entries) {
    if (entry.type === 'response_item' && (entry.payload?.type === 'function_call' || entry.payload?.type === 'custom_tool_call')) {
      const name = entry.payload.name || 'unknown';
      next[name] = (next[name] || 0) + 1;
    }
  }
  return next;
}

function mergeRoleCounts(current, entries) {
  const next = { ...current };
  for (const entry of entries) {
    const role = entry.payload?.role || entry.payload?.type || entry.type;
    next[role] = (next[role] || 0) + 1;
  }
  return next;
}

function previewEvent(event) {
  const payload = event.payload || {};
  if (typeof payload.message === 'string') return payload.message;
  if (payload.message?.content) return textContent(payload.message.content);
  if (payload.content) return textContent(payload.content);
  if (payload.text) return payload.text;
  if (payload.output) return payload.output;
  if (payload.arguments) return payload.arguments;
  if (payload.input && typeof payload.input === 'string') return payload.input;
  return '';
}

function entryToConversationItems(entry) {
  const payload = entry.payload || {};
  if (entry.type === 'event_msg' && (payload.type === 'user_message' || payload.type === 'agent_message')) {
    const text = previewEvent(entry);
    if (!text || isEnvironmentContext(text)) return [];
    return [{
      id: `${state.events.length}-${entry.timestamp || ''}`,
      timestamp: entry.timestamp || '',
      kind: 'message',
      role: payload.type === 'user_message' ? 'user' : 'assistant',
      phase: payload.phase || '',
      text,
    }];
  }
  if (entry.type !== 'response_item') return [];
  if (payload.type === 'message') {
    const text = previewEvent(entry);
    if (!text || isEnvironmentContext(text)) return [];
    return [{
      id: `${state.events.length}-${entry.timestamp || ''}`,
      timestamp: entry.timestamp || '',
      kind: 'message',
      role: payload.role || 'message',
      phase: payload.phase || '',
      text,
    }];
  }
  if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
    const isCustom = payload.type === 'custom_tool_call';
    return [{
      id: `${state.events.length}-${payload.call_id || entry.timestamp || ''}`,
      timestamp: entry.timestamp || '',
      kind: 'tool',
      role: 'tool',
      toolName: payload.name || 'unknown',
      callId: payload.call_id || '',
      text: isCustom ? (payload.input || '') : (payload.arguments || ''),
      custom: isCustom,
    }];
  }
  if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
    return [{
      id: `${state.events.length}-${payload.call_id || entry.timestamp || ''}`,
      timestamp: entry.timestamp || '',
      kind: 'tool-result',
      role: 'tool-result',
      callId: payload.call_id || '',
      text: payload.output || '',
      custom: payload.type === 'custom_tool_call_output',
    }];
  }
  return [];
}

function appendConversationItems(items) {
  for (const item of items) {
    const duplicate = state.conversation.some(existing => {
      if (existing.kind !== item.kind || existing.role !== item.role || existing.text !== item.text) return false;
      if (item.kind === 'tool' || item.kind === 'tool-result') {
        return existing.callId && existing.callId === item.callId;
      }
      return true;
    });
    if (!duplicate) state.conversation.push(item);
  }
}

function isEnvironmentContext(text) {
  return typeof text === 'string' && text.trim().startsWith('<environment_context>');
}

function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(item => item?.text || item?.input_text || item?.output_text || '').filter(Boolean).join('\n');
}

function saveTabScroll() {
  state.tabScroll[state.tab] = els.detail.scrollTop;
}

function switchTab(nextTab) {
  if (!nextTab || nextTab === state.tab) return;
  saveTabScroll();
  state.tab = nextTab;
  document.querySelectorAll('.tab').forEach(tab => {
    const active = tab.dataset.tab === state.tab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  els.conversationTab.classList.toggle('hidden', state.tab !== 'conversation');
  els.timelineTab.classList.toggle('hidden', state.tab !== 'timeline');
  els.lastResponseTab.classList.toggle('hidden', state.tab !== 'last-response');
  els.rawTab.classList.toggle('hidden', state.tab !== 'raw');
  requestAnimationFrame(() => {
    els.detail.scrollTop = state.tabScroll[state.tab] || 0;
    updateBackToTop();
  });
}

els.sessions.addEventListener('click', event => {
  const button = event.target.closest('.session');
  if (button) selectSession(button.dataset.id).catch(showError);
});

els.sessionFilter.addEventListener('input', renderSessions);
els.refresh.addEventListener('click', () => loadSessions({ refreshSelected: true }).catch(showError));
els.detail.addEventListener('scroll', updateBackToTop);
window.addEventListener('scroll', updateBackToTop, { passive: true });
els.backToTop.addEventListener('click', scrollDetailToTop);
els.conversationFilter.addEventListener('input', renderConversation);
els.conversationTools.addEventListener('change', renderConversation);
els.conversationInstructions.addEventListener('change', renderConversation);
els.conversationCollapse.addEventListener('change', renderConversation);
els.rawFilter.addEventListener('input', () => {
  state.rawLimit = RAW_PAGE_SIZE;
  renderRaw();
});
els.rawSummary.addEventListener('click', event => {
  const filterButton = event.target.closest('[data-raw-filter]');
  if (filterButton) {
    toggleRawFilterToken(filterButton.dataset.rawFilter);
    return;
  }
  const clearButton = event.target.closest('[data-raw-clear]');
  if (clearButton) {
    els.rawFilter.value = '';
    state.rawLimit = RAW_PAGE_SIZE;
    renderRaw();
  }
});
els.raw.addEventListener('click', event => {
  const copyRawButton = event.target.closest('[data-copy-raw]');
  if (copyRawButton) {
    const rawEvent = state.events[Number(copyRawButton.dataset.copyRaw)];
    if (rawEvent) {
      copyText(JSON.stringify(rawEvent, null, 2)).then(() => showButtonFeedback(copyRawButton, 'Copied'));
    }
    return;
  }
  const copyCallIdButton = event.target.closest('[data-copy-call-id]');
  if (copyCallIdButton) {
    const rawEvent = state.events[Number(copyCallIdButton.dataset.copyCallId)];
    const callId = rawEvent?.payload?.call_id;
    if (callId) {
      copyText(callId).then(() => showButtonFeedback(copyCallIdButton, 'Copied'));
    }
    return;
  }
  const expandButton = event.target.closest('[data-raw-expand]');
  if (expandButton) {
    const card = expandButton.closest('.raw-event');
    const expanded = !card.classList.contains('raw-expanded');
    card.classList.toggle('raw-expanded', expanded);
    expandButton.textContent = expanded ? 'Collapse JSON' : 'Expand full';
    return;
  }
  if (!event.target.closest('[data-raw-more]')) return;
  state.rawLimit += RAW_PAGE_SIZE;
  renderRaw();
});

els.lastResponseTab.addEventListener('click', event => {
  const copyButton = event.target.closest('[data-copy-last-response]');
  if (copyButton) {
    const text = state.summary?.lastResponse?.preview || '';
    copyText(text).then(() => showButtonFeedback(copyButton, 'Copied'));
    return;
  }
  if (event.target.closest('[data-jump-last-response]')) {
    jumpToLastResponse();
  }
});

document.querySelectorAll('.tab').forEach(button => {
  button.addEventListener('click', () => {
    switchTab(button.dataset.tab);
  });
});

function showError(err) {
  console.error(err);
  els.codexHome.textContent = err.message;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(String(text ?? ''));
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = String(text ?? '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function showButtonFeedback(button, label) {
  const previous = button.textContent;
  button.textContent = label;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = previous;
    button.disabled = false;
  }, 1000);
}

function jumpToLastResponse() {
  const key = lastResponseConversationKey();
  if (!key) return;
  switchTab('conversation');
  requestAnimationFrame(() => {
    const target = document.getElementById(`conversation-${key}`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('conversation-target');
    setTimeout(() => target.classList.remove('conversation-target'), 1800);
  });
}

await loadHealth().catch(showError);
await loadSessions().catch(showError);
