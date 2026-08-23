import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMeetingJson,
  formatMeetingMarkdown,
  formatMeetingText,
  formatRunReportMarkdown,
  formatRunReportText,
  safeExportFilename,
} from '../transcript-export.mjs';

const meeting = {
  id: 'meeting-1',
  title: 'Release / AI sync',
  status: 'FINISHED',
  createdAt: 1700000000000,
  updatedAt: 1700000010000,
  currentTurn: 2,
  participants: [
    { id: 'p1', slotIndex: 0, provider: 'chatgpt', label: 'ChatGPT', tabId: 42, url: 'https://chatgpt.com/c/private' },
    { id: 'p2', slotIndex: 1, provider: 'claude', label: 'Claude', tabId: 43, url: 'https://claude.ai/chat/private' },
  ],
  transcript: [
    {
      id: 'entry-1', meetingId: 'meeting-1', turnNumber: 1, speakerType: 'AI', participantId: 'p1',
      provider: 'chatgpt', text: 'Use `npm test`.\n```js\nconsole.log(1)\n```', createdAt: 1700000001000,
      deliveryStatus: 'DELIVERED', responseStatus: 'COMPLETE', transactionId: 'private-transaction',
    },
    {
      id: 'entry-2', meetingId: 'meeting-1', turnNumber: 2, speakerType: 'USER', participantId: null,
      provider: null, text: 'Keep the change reversible.', createdAt: 1700000002000,
      deliveryStatus: null, responseStatus: null, transactionId: null,
    },
  ],
  activityLog: [{ message: 'private activity that must not leak' }],
};

test('Markdown export preserves meeting turns and verification statuses without live tab data', () => {
  const output = formatMeetingMarkdown(meeting);

  assert.match(output, /^# Release \/ AI sync/m);
  assert.match(output, /ChatGPT/);
  assert.match(output, /Claude/);
  assert.match(output, /Delivery: DELIVERED · Response: COMPLETE/);
  assert.match(output, /Use `npm test`\./);
  assert.match(output, /console\.log\(1\)/);
  assert.match(output, /Keep the change reversible\./);
  assert.doesNotMatch(output, /chatgpt\.com\/c\/private|claude\.ai\/chat\/private|private-transaction|private activity/);
});

test('JSON export is portable and excludes tab bindings, URLs, and activity logs', () => {
  const parsed = JSON.parse(formatMeetingJson(meeting));

  assert.equal(parsed.formatVersion, 1);
  assert.equal(parsed.meeting.id, 'meeting-1');
  assert.equal(parsed.meeting.transcript.length, 2);
  assert.equal(parsed.meeting.transcript[0].deliveryStatus, 'DELIVERED');
  assert.equal(parsed.meeting.transcript[0].responseStatus, 'COMPLETE');
  assert.equal(parsed.meeting.participants[0].label, 'ChatGPT');
  assert.equal('tabId' in parsed.meeting.participants[0], false);
  assert.equal('url' in parsed.meeting.participants[0], false);
  assert.equal('transactionId' in parsed.meeting.transcript[0], false);
  assert.equal('activityLog' in parsed.meeting, false);
});

test('export filename is safe for common desktop filesystems', () => {
  assert.equal(safeExportFilename('Release / AI: sync?', 'md'), 'release-ai-sync.md');
  assert.equal(safeExportFilename('   ', 'json'), 'lee-relay-meeting.json');
});

test('TXT and report exports preserve phases, scorecards, decisions, and actions', () => {
  const report = {
    title: 'Channel review',
    runId: 'run-1',
    summary: 'A concise result.',
    phaseResults: [{ name: 'Concept', turns: [{ speaker: 'Gemini', text: 'Evidence' }] }],
    scorecard: [{ axis: 'Concept', score: 4, evidence: ['Evidence'] }],
    decisions: ['Keep the hook'],
    actionItems: ['Test three openings'],
  };
  assert.match(formatRunReportMarkdown(report), /## 9-axis Scorecard/);
  assert.match(formatRunReportMarkdown(report), /Keep the hook/);
  assert.match(formatRunReportText(report), /Concept: 4\/5/);
  assert.match(formatMeetingText({ ...meeting, title: 'Room' }), /ChatGPT/);
});
