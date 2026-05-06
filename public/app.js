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
};

const els = {
  codexHome: document.getElementById('codex-home'),
  refresh: document.getElementById('refresh-button'),
  count: document.getElementById('session-count'),
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
  rawTab: document.getElementById('raw-tab'),
  timelineTab: document.getElementById('timeline-tab'),
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
}

async function loadSessions() {
  const data = await fetchJson('/api/sessions?limit=200');
  state.sessions = data.sessions || [];
  els.count.textContent = String(state.sessions.length);
  renderSessions();
  if (!state.selectedId && state.sessions.length > 0) {
    selectSession(state.sessions[0].id);
  }
}

function renderSessions() {
  els.sessions.innerHTML = state.sessions.map(session => `
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

async function selectSession(id) {
  state.selectedId = id;
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

  els.stats.innerHTML = [
    ['Events', summary.eventCount],
    ['Timeline', state.timeline.length],
    ['Tokens', formatNumber(session.tokensUsed || 0)],
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
}

function formatNumber(value) {
  if (typeof value === 'number') return value.toLocaleString();
  return String(value ?? '');
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
}

function renderInsights() {
  const summary = state.summary;
  const goal = state.goal;
  const latestUsage = summary.latestTokenInfo?.total_token_usage || summary.latestTokenInfo?.last_token_usage || null;
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

function renderConversation() {
  const filter = els.conversationFilter.value.trim().toLowerCase();
  const showTools = els.conversationTools.checked;
  const showInstructions = els.conversationInstructions.checked;
  const collapseTools = els.conversationCollapse.checked;
  const items = state.conversation.filter(item => {
    if (!showTools && (item.kind === 'tool' || item.kind === 'tool-result')) return false;
    if (!showInstructions && (item.role === 'system' || item.role === 'developer')) return false;
    if (!filter) return true;
    return [
      item.role,
      item.kind,
      item.toolName,
      item.callId,
      item.text,
    ].filter(Boolean).join('\n').toLowerCase().includes(filter);
  });

  if (items.length === 0) {
    els.conversation.innerHTML = '<div class="empty">No conversation items match this view.</div>';
    return;
  }

  els.conversation.innerHTML = items.map(item => {
    if (item.kind === 'tool' || item.kind === 'tool-result') {
      const title = item.kind === 'tool'
        ? `${item.toolName || 'tool'} ${item.callId || ''}`.trim()
        : `result ${item.callId || ''}`.trim();
      return `
        <details class="bubble ${escapeHtml(item.kind)}" ${collapseTools ? '' : 'open'}>
          <summary class="tool-summary">
            <span>${escapeHtml(title)}</span>
            <span>${escapeHtml(fmtDate(item.timestamp))}</span>
          </summary>
          <pre class="tool-body">${escapeHtml(formatToolText(item.text))}</pre>
        </details>
      `;
    }

    return `
      <article class="bubble ${escapeHtml(item.role)}">
        <div class="bubble-meta">
          <span>${escapeHtml(item.role)}${item.phase ? ` / ${escapeHtml(item.phase)}` : ''}</span>
          <span>${escapeHtml(fmtDate(item.timestamp))}</span>
        </div>
        <div class="bubble-text">${escapeHtml(item.text || '')}</div>
      </article>
    `;
  }).join('');
}

function renderTimeline() {
  if (state.timeline.length === 0) {
    els.timeline.innerHTML = '<div class="empty">No conversation events found in this rollout.</div>';
    return;
  }

  els.timeline.innerHTML = state.timeline.map(item => `
    <article class="event">
      <div class="event-head">
        <span><span class="event-role">${escapeHtml(item.role)}</span> ${escapeHtml(item.type)}</span>
        <span>${escapeHtml(fmtDate(item.timestamp))}</span>
      </div>
      <div class="event-body">${escapeHtml(item.preview || '')}</div>
    </article>
  `).join('');
}

function renderLastResponse() {
  const item = state.summary.lastResponse;
  if (!item) {
    els.lastResponseTab.innerHTML = '<div class="empty">No final response found in this rollout.</div>';
    return;
  }
  els.lastResponseTab.innerHTML = `
    <article class="event">
      <div class="event-head">
        <span><span class="event-role">${escapeHtml(item.role)}</span> Last Response</span>
        <span>${escapeHtml(fmtDate(item.timestamp))}</span>
      </div>
      <div class="event-body">${escapeHtml(item.preview || '')}</div>
    </article>
  `;
}

function renderRaw() {
  const filter = els.rawFilter.value.trim().toLowerCase();
  const events = filter
    ? state.events.filter(event => JSON.stringify(event).toLowerCase().includes(filter))
    : state.events;
  els.raw.textContent = events.map(event => JSON.stringify(event, null, 2)).join('\n\n');
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
    state.conversation.push(...entries.flatMap(entryToConversationItems));
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
    if (entry.type === 'response_item' && entry.payload?.type === 'function_call') {
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
  return '';
}

function entryToConversationItems(entry) {
  const payload = entry.payload || {};
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
  if (payload.type === 'function_call') {
    return [{
      id: `${state.events.length}-${payload.call_id || entry.timestamp || ''}`,
      timestamp: entry.timestamp || '',
      kind: 'tool',
      role: 'tool',
      toolName: payload.name || 'unknown',
      callId: payload.call_id || '',
      text: payload.arguments || '',
    }];
  }
  if (payload.type === 'function_call_output') {
    return [{
      id: `${state.events.length}-${payload.call_id || entry.timestamp || ''}`,
      timestamp: entry.timestamp || '',
      kind: 'tool-result',
      role: 'tool-result',
      callId: payload.call_id || '',
      text: payload.output || '',
    }];
  }
  return [];
}

function formatToolText(text) {
  if (typeof text !== 'string') return String(text ?? '');
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
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

els.sessions.addEventListener('click', event => {
  const button = event.target.closest('.session');
  if (button) selectSession(button.dataset.id).catch(showError);
});

els.refresh.addEventListener('click', () => loadSessions().catch(showError));
els.conversationFilter.addEventListener('input', renderConversation);
els.conversationTools.addEventListener('change', renderConversation);
els.conversationInstructions.addEventListener('change', renderConversation);
els.conversationCollapse.addEventListener('change', renderConversation);
els.rawFilter.addEventListener('input', renderRaw);

document.querySelectorAll('.tab').forEach(button => {
  button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
    els.conversationTab.classList.toggle('hidden', state.tab !== 'conversation');
    els.timelineTab.classList.toggle('hidden', state.tab !== 'timeline');
    els.lastResponseTab.classList.toggle('hidden', state.tab !== 'last-response');
    els.rawTab.classList.toggle('hidden', state.tab !== 'raw');
  });
});

function showError(err) {
  console.error(err);
  els.codexHome.textContent = err.message;
}

await loadHealth().catch(showError);
await loadSessions().catch(showError);
