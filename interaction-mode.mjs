import { normalizeTopicText } from './meeting-engine.mjs';

export function canChangeInteractionMode(meeting = {}) {
  return meeting.status === 'READY' || (meeting.status === 'PAUSED' && !meeting.activeTransaction);
}

export function canAcceptUserMessage(meeting = {}) {
  return meeting.interactionMode !== 'autonomous' || meeting.status !== 'LIVE';
}

export function autonomousSeed({ meeting = {}, seedText = '' } = {}) {
  return normalizeTopicText(seedText) || normalizeTopicText(meeting.topicText);
}
