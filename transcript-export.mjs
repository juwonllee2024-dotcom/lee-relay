const FALLBACK_TITLE = 'Lee Relay Meeting';

function valueOr(value, fallback) {
  return value == null || value === '' ? fallback : String(value);
}

function participantLabel(participant) {
  return valueOr(participant?.label, participant?.provider || 'AI');
}

function speakerLabel(entry, participantsById) {
  if (entry.speakerType === 'USER') return 'You';
  if (entry.speakerType === 'SYSTEM') return 'Lee Relay';
  return participantLabel(participantsById.get(entry.participantId));
}

function status(value) {
  return value ? String(value) : 'n/a';
}

function messageFence(text) {
  const runs = String(text).match(/`+/g) || [];
  const longest = runs.reduce((length, run) => Math.max(length, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function exportParticipants(meeting) {
  return (meeting.participants || []).map((participant) => ({
    id: participant.id ?? null,
    slotIndex: participant.slotIndex ?? null,
    provider: participant.provider ?? null,
    label: participantLabel(participant),
  }));
}

function exportTranscript(meeting) {
  return (meeting.transcript || []).map((entry) => ({
    id: entry.id ?? null,
    meetingId: entry.meetingId ?? meeting.id ?? null,
    turnNumber: Number(entry.turnNumber) || 0,
    speakerType: valueOr(entry.speakerType, 'SYSTEM'),
    participantId: entry.participantId ?? null,
    provider: entry.provider ?? null,
    text: String(entry.text || ''),
    createdAt: entry.createdAt ?? null,
    deliveryStatus: entry.deliveryStatus ?? null,
    responseStatus: entry.responseStatus ?? null,
  }));
}

export function formatMeetingMarkdown(meeting = {}) {
  const title = valueOr(meeting.title?.trim(), FALLBACK_TITLE);
  const participants = exportParticipants(meeting);
  const participantsById = new Map(participants.map((participant) => [participant.id, participant]));
  const transcript = exportTranscript(meeting);
  const lines = [
    `# ${title}`,
    '',
    '> Exported locally by Lee Relay. Provider messages remain subject to each provider\'s policies.',
    '',
    `- Meeting status: ${valueOr(meeting.status, 'READY')}`,
    `- Turns: ${Number(meeting.currentTurn) || 0}`,
    `- Participants: ${participants.map((participant) => participantLabel(participant)).join(', ') || 'none'}`,
    '',
    '## Transcript',
    '',
  ];

  if (!transcript.length) {
    lines.push('_No transcript entries yet._');
    return `${lines.join('\n')}\n`;
  }

  transcript.forEach((entry, index) => {
    const speaker = speakerLabel(entry, participantsById);
    const turn = entry.turnNumber ? `Turn ${entry.turnNumber}` : 'Room';
    const fence = messageFence(entry.text);
    lines.push(
      `### ${index + 1}. ${speaker} · ${turn}`,
      `_${entry.createdAt ? new Date(entry.createdAt).toISOString() : 'time unavailable'} · Delivery: ${status(entry.deliveryStatus)} · Response: ${status(entry.responseStatus)}_`,
      '',
      fence,
      entry.text,
      fence,
      '',
    );
  });

  return `${lines.join('\n')}\n`;
}

export function formatMeetingJson(meeting = {}) {
  return `${JSON.stringify({
    formatVersion: 1,
    product: 'Lee Relay',
    meeting: {
      id: meeting.id ?? null,
      title: valueOr(meeting.title?.trim(), FALLBACK_TITLE),
      status: valueOr(meeting.status, 'READY'),
      createdAt: meeting.createdAt ?? null,
      updatedAt: meeting.updatedAt ?? null,
      currentTurn: Number(meeting.currentTurn) || 0,
      participants: exportParticipants(meeting),
      transcript: exportTranscript(meeting),
    },
  }, null, 2)}\n`;
}

export function safeExportFilename(title, extension) {
  const name = String(title || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9\s_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-|-$/g, '') || 'lee-relay-meeting';
  const suffix = String(extension || 'txt').replace(/[^a-zA-Z0-9]/g, '') || 'txt';
  return `${name}.${suffix.toLowerCase()}`;
}
