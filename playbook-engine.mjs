const MAX_TEXT = 300;

export const BUILTIN_PLAYBOOK_IDS = Object.freeze([
  'freeform',
  'channel-9-axis',
  'debate',
  'planning',
  'final-summary',
]);

const AXES = [
  ['Concept', 'Evaluate the channel idea, promise, audience, and distinct point of view.'],
  ['Narration', 'Evaluate narrative structure, pacing, tension, and clarity.'],
  ['Visual Rhythm', 'Evaluate visual cadence, pattern changes, framing, and attention flow.'],
  ['Message Compression', 'Evaluate how much meaning survives when the message is compressed.'],
  ['Brand Signature', 'Evaluate recognizable voice, recurring devices, and identity.'],
  ['Packaging', 'Evaluate title, thumbnail, opening promise, and the reason to click.'],
  ['Retention', 'Evaluate early drop-off risks, payoff timing, and return reasons.'],
  ['Repeatability', 'Evaluate whether the format can produce 50 to 100 strong episodes.'],
  ['Distribution', 'Evaluate search, recommendations, Shorts, external sharing, and growth loops.'],
];

function clean(value, fallback = '', max = MAX_TEXT) {
  const result = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return result || fallback;
}

function number(value, fallback = 0, max = 1000) {
  if (value === '' || value == null) return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? Math.min(max, Math.max(0, Math.floor(result))) : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function phase(source = {}, index = 0) {
  return {
    id: clean(source.id, `phase-${index + 1}`, 80),
    name: clean(source.name, `Phase ${index + 1}`, 100),
    instruction: clean(source.instruction, 'Discuss the current topic and produce concrete evidence.', MAX_TEXT),
    turnLimit: number(source.turnLimit, 0, 100),
  };
}

const BUILT_INS = {
  freeform: {
    id: 'freeform', name: 'Free discussion', description: 'Open AI discussion with no forced phase changes.',
    phases: [{ id: 'discussion', name: 'Open Discussion', instruction: 'Discuss the topic naturally and build on the latest AI turn.', turnLimit: 0 }],
    output: { summary: true, phaseResults: true, scorecard: false, decisions: true, actionItems: true },
  },
  'channel-9-axis': {
    id: 'channel-9-axis', name: '9-axis channel analysis', description: 'Analyze a channel through nine creative and growth axes.',
    phases: AXES.map(([name, instruction], index) => ({ id: `axis-${index + 1}`, name, instruction: `${instruction} Give evidence, risks, and one improvement to test.`, turnLimit: 2 })),
    output: { summary: true, phaseResults: true, scorecard: true, decisions: true, actionItems: true, scorecardAxes: AXES.map(([name]) => name) },
  },
  debate: {
    id: 'debate', name: 'Debate', description: 'Frame, argue, rebut, and synthesize a decision.',
    phases: [
      { id: 'framing', name: 'Framing', instruction: 'Define the decision, terms, assumptions, and success criteria before arguing.', turnLimit: 2 },
      { id: 'arguments', name: 'Arguments', instruction: 'Present the strongest evidence-backed arguments for and against the proposal.', turnLimit: 2 },
      { id: 'rebuttals', name: 'Rebuttals', instruction: 'Challenge weak assumptions and respond directly to the strongest opposing argument.', turnLimit: 2 },
      { id: 'synthesis', name: 'Synthesis', instruction: 'Synthesize the debate into a clear recommendation, trade-offs, and unresolved questions.', turnLimit: 2 },
    ],
    output: { summary: true, phaseResults: true, scorecard: false, decisions: true, actionItems: true },
  },
  planning: {
    id: 'planning', name: 'Planning review', description: 'Turn a topic into constraints, options, a decision, and next actions.',
    phases: [
      { id: 'objective', name: 'Objective', instruction: 'Define the desired outcome and how it will be measured.', turnLimit: 2 },
      { id: 'constraints', name: 'Constraints', instruction: 'List constraints, dependencies, risks, and non-negotiable requirements.', turnLimit: 2 },
      { id: 'options', name: 'Options', instruction: 'Generate and compare practical options with explicit trade-offs.', turnLimit: 2 },
      { id: 'decision', name: 'Decision', instruction: 'Choose the strongest option and explain why alternatives were rejected.', turnLimit: 2 },
      { id: 'next-actions', name: 'Next Actions', instruction: 'Convert the decision into ordered, testable next actions with owners or checkpoints.', turnLimit: 2 },
    ],
    output: { summary: true, phaseResults: true, scorecard: false, decisions: true, actionItems: true },
  },
  'final-summary': {
    id: 'final-summary', name: 'Final summary', description: 'Compress the conversation into decisions, risks, and next actions.',
    phases: [{ id: 'summary', name: 'Final Summary', instruction: 'Summarize the conversation, decisions, open questions, and concrete next actions.', turnLimit: 0 }],
    output: { summary: true, phaseResults: true, scorecard: false, decisions: true, actionItems: true },
  },
};

export function normalizePlaybook(playbook = {}) {
  const source = playbook && typeof playbook === 'object' ? playbook : {};
  const id = clean(source.id, 'freeform', 80);
  const builtIn = BUILT_INS[id];
  if (!builtIn && !id.startsWith('custom-') && source.builtIn !== false) return normalizePlaybook(BUILT_INS.freeform);
  const rawPhases = Array.isArray(source.phases) && source.phases.length ? source.phases : (builtIn?.phases || BUILT_INS.freeform.phases);
  const phases = rawPhases.slice(0, 12).map((item, index) => phase(item, index));
  const output = {
    summary: source.output?.summary !== false,
    phaseResults: source.output?.phaseResults !== false,
    scorecard: Boolean(source.output?.scorecard),
    decisions: source.output?.decisions !== false,
    actionItems: source.output?.actionItems !== false,
    ...(Array.isArray(source.output?.scorecardAxes) ? { scorecardAxes: source.output.scorecardAxes.map((axis) => clean(axis, '', 80)).filter(Boolean).slice(0, 9) } : {}),
  };
  return {
    id,
    name: clean(source.name, builtIn?.name || 'Custom Playbook', 100),
    description: clean(source.description, builtIn?.description || 'Saved custom workflow.', MAX_TEXT),
    builtIn: Boolean(builtIn && source.builtIn !== false),
    phases,
    output,
  };
}

export function getPlaybook(id = 'freeform') {
  return clone(normalizePlaybook(BUILT_INS[id] || { id }));
}

export function getPlaybooks(customPlaybooks = []) {
  const builtIns = BUILTIN_PLAYBOOK_IDS.map((id) => getPlaybook(id));
  const custom = Array.isArray(customPlaybooks)
    ? customPlaybooks.map((item) => normalizePlaybook({ ...item, builtIn: false })).filter((item) => !BUILTIN_PLAYBOOK_IDS.includes(item.id))
    : [];
  return [...builtIns, ...custom].slice(0, 50);
}

export function createCustomPlaybook(options = {}) {
  const id = clean(options.id, `custom-${Date.now()}`, 80);
  return normalizePlaybook({ ...options, id, builtIn: false });
}
