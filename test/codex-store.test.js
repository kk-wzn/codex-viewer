import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getConversationItems, getSessionEvents, getSessionSummary } from '../lib/codex-store.js';

test('reads rollout events and builds a compact timeline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-viewer-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  const rollout = join(dir, 'sessions', 'rollout.jsonl');
  writeFileSync(rollout, [
    JSON.stringify({
      timestamp: '2026-05-06T10:00:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
    }),
    JSON.stringify({
      timestamp: '2026-05-06T10:00:01.000Z',
      type: 'response_item',
      payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"pwd"}' },
    }),
  ].join('\n') + '\n');

  const events = getSessionEvents(rollout);
  const summary = getSessionSummary(events);

  assert.equal(events.length, 2);
  assert.equal(summary.eventCount, 2);
  assert.equal(summary.timeline.length, 2);
  assert.equal(summary.timeline[0].preview, 'hello');
  assert.equal(summary.timeline[1].role, 'tool');
  assert.equal(summary.toolCounts.exec_command, 1);
  assert.equal(summary.roleCounts.user, 1);
  assert.equal(summary.conversation.length, 2);
  assert.equal(summary.conversation[0].kind, 'message');
  assert.equal(summary.conversation[1].kind, 'tool');
});

test('extracts last response and latest token info', () => {
  const events = [
    {
      timestamp: '2026-05-06T10:00:02.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 10,
            cached_input_tokens: 4,
            output_tokens: 5,
            total_tokens: 15,
          },
        },
      },
    },
    {
      timestamp: '2026-05-06T10:00:03.000Z',
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        phase: 'final_answer',
        message: 'done',
      },
    },
  ];

  const summary = getSessionSummary(events);

  assert.equal(summary.latestTokenInfo.total_token_usage.total_tokens, 15);
  assert.equal(summary.lastResponse.preview, 'done');
  assert.equal(summary.lastResponse.role, 'agent_message');
});

test('builds conversation items while filtering environment context', () => {
  const events = [
    {
      timestamp: '2026-05-06T10:00:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>' }] },
    },
    {
      timestamp: '2026-05-06T10:00:01.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'show sessions' }] },
    },
    {
      timestamp: '2026-05-06T10:00:02.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Here are the sessions.' }] },
    },
    {
      timestamp: '2026-05-06T10:00:03.000Z',
      type: 'response_item',
      payload: { type: 'function_call', name: 'exec_command', call_id: 'call-1', arguments: '{"cmd":"pwd"}' },
    },
    {
      timestamp: '2026-05-06T10:00:04.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'call-1', output: '/tmp/project' },
    },
  ];

  const items = getConversationItems(events);

  assert.equal(items.length, 4);
  assert.deepEqual(items.map(item => item.kind), ['message', 'message', 'tool', 'tool-result']);
  assert.equal(items[0].text, 'show sessions');
  assert.equal(items[1].role, 'assistant');
  assert.equal(items[2].toolName, 'exec_command');
  assert.equal(items[3].callId, 'call-1');
});

test('falls back to event messages when response messages are absent', () => {
  const items = getConversationItems([
    {
      timestamp: '2026-05-06T10:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'hello' },
    },
    {
      timestamp: '2026-05-06T10:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'hi there', phase: 'final_answer' },
    },
  ]);

  assert.equal(items.length, 2);
  assert.equal(items[0].role, 'user');
  assert.equal(items[1].role, 'assistant');
  assert.equal(items[1].phase, 'final_answer');
});

test('keeps non-mirrored event messages when response messages are present', () => {
  const items = getConversationItems([
    {
      timestamp: '2026-05-06T10:00:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'developer instructions' }] },
    },
    {
      timestamp: '2026-05-06T10:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'visible user turn' },
    },
    {
      timestamp: '2026-05-06T10:00:02.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'visible assistant turn', phase: 'final_answer' },
    },
  ]);

  assert.equal(items.length, 3);
  assert.equal(items[0].role, 'developer');
  assert.equal(items[1].role, 'user');
  assert.equal(items[1].text, 'visible user turn');
  assert.equal(items[2].role, 'assistant');
});

test('parses custom_tool_call (apply_patch) into conversation tool items', () => {
  const events = [
    {
      timestamp: '2026-05-06T10:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'apply_patch',
        call_id: 'call-patch-1',
        input: '*** Begin Patch\n*** Update File: README.md\n@@\n-old\n+new\n*** End Patch',
      },
    },
    {
      timestamp: '2026-05-06T10:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'call-patch-1',
        output: 'Done!',
      },
    },
  ];

  const items = getConversationItems(events);
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, 'tool');
  assert.equal(items[0].toolName, 'apply_patch');
  assert.equal(items[0].callId, 'call-patch-1');
  assert.ok(items[0].text.startsWith('*** Begin Patch'));
  assert.equal(items[0].custom, true);
  assert.equal(items[1].kind, 'tool-result');
  assert.equal(items[1].text, 'Done!');
  assert.equal(items[1].custom, true);

  const summary = getSessionSummary(events);
  assert.equal(summary.toolCounts.apply_patch, 1);
  assert.equal(summary.roleCounts.tool, 1);
  assert.equal(summary.roleCounts['tool-result'], 1);
  const callTimelineEntry = summary.timeline.find(t => t.role === 'tool');
  assert.ok(callTimelineEntry.preview.startsWith('*** Begin Patch'),
    `expected timeline preview to surface custom tool input, got: ${callTimelineEntry.preview}`);
});

test('deduplicates event message mirrors of response messages', () => {
  const items = getConversationItems([
    {
      timestamp: '2026-05-06T10:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'same user turn' },
    },
    {
      timestamp: '2026-05-06T10:00:00.100Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'same user turn' }] },
    },
    {
      timestamp: '2026-05-06T10:00:01.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'same assistant turn' }] },
    },
    {
      timestamp: '2026-05-06T10:00:01.100Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'same assistant turn', phase: 'final_answer' },
    },
  ]);

  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.text), ['same user turn', 'same assistant turn']);
});
