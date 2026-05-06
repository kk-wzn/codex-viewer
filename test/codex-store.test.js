import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getSessionEvents, getSessionSummary } from '../lib/codex-store.js';

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
