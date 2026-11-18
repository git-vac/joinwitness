import { isRecord, keyPart } from './contract.js';

function readKey(record, fields) {
  const values = fields.map(field => field.get(record));
  const missing = fields.filter((_, i) => !keyPart(values[i])).map(field => field.path);
  // JSON tuples preserve component boundaries and distinguish strings from integers.
  return { key: missing.length ? null : JSON.stringify(values), missing, values };
}

function snapshot(origins, activities) {
  const byKey = new Map();
  for (const [id, entry] of origins) {
    if (entry.key === null) continue;
    if (!byKey.has(entry.key)) byKey.set(entry.key, []);
    byKey.get(entry.key).push(id);
  }
  for (const ids of byKey.values()) ids.sort();
  return { origins, activities, byKey };
}

function index(records, contract, label) {
  const origins = new Map();
  const activities = new Map();
  for (const [i, record] of records.entries()) {
    if (!isRecord(record)) throw new Error(`${label} record ${i + 1} must be an object`);
    const origin = contract.origin.matches(record);
    const activity = contract.activity.matches(record);
    if (!origin && !activity) continue;
    if (origin && activity) throw new Error(`${label} record ${i + 1} matches both selectors`);
    const id = contract.eventId.get(record);
    if (typeof id !== 'string' || !id.trim()) throw new Error(`${label} record ${i + 1} needs a stable string event ID`);
    if (origins.has(id) || activities.has(id)) throw new Error(`${label} record ${i + 1} repeats a selected event ID`);
    const entry = readKey(record, origin ? contract.origin.keys : contract.activity.keys);
    const selected = origin ? origins : activities;
    selected.set(id, entry);
  }
  return snapshot(origins, activities);
}

function inspectCase(item, snapshot, contract) {
  const activity = snapshot.activities.get(item.activity);
  const matches = activity?.key != null ? (snapshot.byKey.get(activity.key) ?? []) : [];
  const expected = snapshot.origins.get(item.origin);
  let status;
  if (!activity) status = 'activity-missing';
  else if (activity.missing.length) status = 'activity-key-missing';
  else if (matches.length > 1) status = 'ambiguous';
  else if (matches.length === 1 && matches[0] !== item.origin) status = 'wrong-origin';
  else if (matches.length === 1) status = 'correct';
  else if (item.origin === null) status = 'correctly-unlinked';
  else if (!expected) status = 'origin-missing';
  else if (expected.missing.length) status = 'origin-key-missing';
  else status = 'no-match';
  const differentFields = [];
  if (activity && expected) {
    for (const [i, value] of activity.values.entries()) {
      if (keyPart(value) && keyPart(expected.values[i]) && value !== expected.values[i]) {
        differentFields.push({ activity: contract.activity.keys[i].path, origin: contract.origin.keys[i].path });
      }
    }
  }
  return {
    label: item.label, activity: item.activity, expected: item.origin, status,
    matches,
    missingActivityFields: activity?.missing ?? [], differentFields
  };
}

const passing = result => ['correct', 'correctly-unlinked'].includes(result.status);

function inspect(snapshot, contract, referenceOrigins) {
  const cases = contract.cases.map(item => inspectCase(item, snapshot, contract));
  const coverage = [];
  for (const id of referenceOrigins.keys()) {
    if (!snapshot.origins.has(id)) coverage.push({ origin: id, status: 'origin-missing' });
  }
  for (const [id, entry] of snapshot.origins) {
    if (entry.missing.length) coverage.push({ origin: id, status: 'origin-key-missing', missingFields: entry.missing });
  }
  coverage.sort((a, b) => a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0);
  return { passed: cases.filter(passing).length, total: cases.length, originCount: snapshot.origins.size, coverage, cases };
}

function healthy(report) {
  return report.passed === report.total && report.coverage.length === 0;
}

export function compare(contract, baseline, candidate) {
  const reference = index(baseline, contract, 'baseline');
  const before = inspect(reference, contract, reference.origins);
  const common = { version: 1, question: contract.question, baseline: before };
  if (!healthy(before)) return { ...common, verdict: 'invalid-baseline', candidate: null };
  const current = index(candidate, contract, 'candidate');
  const after = inspect(current, contract, reference.origins);
  return { ...common, verdict: healthy(after) ? 'pass' : 'regression', candidate: after };
}

// Challenge the labeled fixture at the join boundary. The original events stay intact.
export function challenge(contract, baseline) {
  const reference = index(baseline, contract, 'baseline');
  const before = inspect(reference, contract, reference.origins);
  const report = { version: 1, question: contract.question, baseline: before, probes: [] };
  if (!healthy(before)) return { ...report, verdict: 'invalid-baseline' };

  function probe(name, changed, advice) {
    if (!changed) {
      report.probes.push({ name, status: 'untestable', caughtBy: [], advice });
      return;
    }
    const results = inspect(changed, contract, reference.origins);
    const caughtBy = results.cases.filter(item => !passing(item)).map(item => item.label);
    report.probes.push({ name, status: caughtBy.length ? 'caught' : 'survived', caughtBy,
      advice: caughtBy.length ? null : advice });
  }

  function constantMask(entries) {
    return new Map(Array.from(entries, ([id, entry]) => {
      if (entry.key === null) return [id, entry];
      const values = entry.values.map(() => '[masked]');
      return [id, { values, key: JSON.stringify(values), missing: [] }];
    }));
  }
  probe('constant-mask', snapshot(constantMask(reference.origins), constantMask(reference.activities)),
    'Add another session with a different key or a read known to have no origin in the replay.');

  const firstId = contract.cases.find(item => item.origin !== null).origin;
  const first = reference.origins.get(firstId);
  const secondId = [...reference.origins.keys()].sort().find(id => reference.origins.get(id).key !== first.key);
  let swapped = null;
  if (secondId !== undefined) {
    const origins = new Map(reference.origins);
    origins.set(firstId, origins.get(secondId));
    origins.set(secondId, first);
    swapped = snapshot(origins, reference.activities);
  }
  probe('swapped-origins', swapped, 'Include a second origin with a distinct key so two issuers can be exchanged.');
  return { ...report, verdict: report.probes.every(p => p.status === 'caught') ? 'pass' : 'weak-fixture' };
}
