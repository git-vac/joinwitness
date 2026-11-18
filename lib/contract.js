// A contract is trusted, hand-labeled test data. Event values stay in the evaluator.
export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fields(value, names, label) {
  if (!isRecord(value) || !names.every(name => Object.hasOwn(value, name)) ||
      Object.keys(value).some(name => !names.includes(name))) {
    throw new Error(`${label} must contain exactly ${names.join(', ')}`);
  }
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function keyPart(value) {
  return nonempty(value) || Number.isSafeInteger(value);
}

function pointer(path, label) {
  if (typeof path !== 'string' || !path.startsWith('/') || /~(?:[^01]|$)/.test(path)) {
    throw new Error(`${label} requires a JSON Pointer beginning with /`);
  }
  const parts = path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  return {
    path,
    get(record) {
      let value = record;
      for (const part of parts) {
        if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
        value = value[part];
      }
      return value;
    }
  };
}

function side(value, label) {
  fields(value, ['where', 'keys'], label);
  if (!isRecord(value.where) || !Object.keys(value.where).length) {
    throw new Error(`${label}.where needs at least one selector`);
  }
  const selectors = Object.entries(value.where).map(([path, expected]) => {
    if (!keyPart(expected) && typeof expected !== 'boolean') {
      throw new Error(`${label}.where requires strings, safe integers or booleans`);
    }
    return { field: pointer(path, label), expected };
  });
  if (!Array.isArray(value.keys) || !value.keys.length || new Set(value.keys).size !== value.keys.length) {
    throw new Error(`${label}.keys requires a nonempty list of distinct field paths`);
  }
  return {
    matches: record => selectors.every(({ field, expected }) => field.get(record) === expected),
    keys: value.keys.map(path => pointer(path, label))
  };
}

export function compileContract(value) {
  fields(value, ['version', 'question', 'eventId', 'origin', 'activity', 'cases'], 'contract');
  if (value.version !== 1 || !nonempty(value.question)) throw new Error('expected version 1 and a question');
  const eventId = pointer(value.eventId, 'eventId');
  const origin = side(value.origin, 'origin');
  const activity = side(value.activity, 'activity');
  if (origin.keys.length !== activity.keys.length) throw new Error('both sides need the same number of join fields');
  if (!Array.isArray(value.cases) || !value.cases.length) throw new Error('at least one case is required');
  const activities = new Set();
  const labels = new Set();
  for (const item of value.cases) {
    fields(item, ['label', 'activity', 'origin'], 'case');
    if (!nonempty(item.label) || !nonempty(item.activity) || (item.origin !== null && !nonempty(item.origin))) {
      throw new Error('each case needs a label, activity ID and an origin ID or null');
    }
    if (labels.has(item.label) || activities.has(item.activity)) throw new Error('case labels and activity IDs must be unique');
    labels.add(item.label);
    activities.add(item.activity);
  }
  if (value.cases.every(item => item.origin === null)) throw new Error('include at least one known positive attribution');
  return { question: value.question, eventId, origin, activity, cases: value.cases };
}
