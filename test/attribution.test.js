import assert from 'node:assert/strict';
import test from 'node:test';
import { challenge, compare } from '../lib/compare.js';
import { compileContract } from '../lib/contract.js';

function fixture() {
  const spec = {
    version: 1, question: 'Which session owns the read?', eventId: '/id',
    origin: { where: { '/kind': 'session' }, keys: ['/tenant', '/issued'] },
    activity: { where: { '/kind': 'read' }, keys: ['/tenant', '/used'] },
    cases: [
      { label: 'North read', activity: 'read-n', origin: 'north' },
      { label: 'South read', activity: 'read-s', origin: 'south' },
      { label: 'Outside read', activity: 'read-x', origin: null }
    ]
  };
  const source = [
    { kind: 'session', id: 'north', tenant: 'n', issued: 7 },
    { kind: 'session', id: 'south', tenant: 's', issued: 7 },
    { kind: 'read', id: 'read-n', tenant: 'n', used: 7 },
    { kind: 'read', id: 'read-s', tenant: 's', used: 7 },
    { kind: 'read', id: 'read-x', tenant: 'x', used: 7 }
  ];
  const contract = compileContract(spec);
  const current = structuredClone(source);
  return { spec, contract, source, current, run: () => compare(contract, source, current) };
}

test('composite keys separate tenants, preserve a negative control and ignore input order', () => {
  const { current, run } = fixture();
  current.reverse();
  const result = run();
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(result.candidate.cases.map(c => c.status), ['correct', 'correct', 'correctly-unlinked']);
});

test('constant fields create ambiguity and return deterministic witness IDs', () => {
  const { current, run } = fixture();
  for (const event of current) event.tenant = '[redacted]';
  current.reverse();
  const result = run();
  assert.equal(result.verdict, 'regression');
  for (const item of result.candidate.cases) {
    assert.equal(item.status, 'ambiguous');
    assert.deepEqual(item.matches, ['north', 'south']);
  }
});

test('a unique wrong link fails even when every positive read matches once', () => {
  const { current, run } = fixture();
  [current[0].tenant, current[1].tenant] = [current[1].tenant, current[0].tenant];
  const item = run().candidate.cases[0];
  assert.equal(item.status, 'wrong-origin');
  assert.deepEqual(item.matches, ['south']);
  assert.deepEqual(item.differentFields, [{ activity: '/tenant', origin: '/tenant' }]);
});

test('a negative control rejects one newly attributed session', () => {
  const { current, run } = fixture();
  current[4].tenant = 's';
  assert.equal(run().candidate.cases[2].status, 'wrong-origin');
});

test('type changes and unusable scalar values do not silently match', () => {
  const { current, run } = fixture();
  current[2].used = '7';
  assert.equal(run().candidate.cases[0].status, 'no-match');
  for (const value of [null, false, [], {}, '', ' ', Number.MAX_SAFE_INTEGER + 1]) {
    current[2].used = value;
    const result = run();
    assert.equal(result.verdict, 'regression');
    assert.deepEqual(result.candidate.cases[0].missingActivityFields, ['/used']);
  }
});

test('a negative control loses its evidential value if the activity key is removed', () => {
  const { current, run } = fixture();
  delete current[4].used;
  assert.equal(run().candidate.cases[2].status, 'activity-key-missing');
});

test('filtered or dropped origins and activities are reported separately', () => {
  const { current, run } = fixture();
  current[0].kind = 'irrelevant';
  current.splice(3, 1);
  const result = run().candidate;
  assert.equal(result.cases[0].status, 'origin-missing');
  assert.equal(result.cases[1].status, 'activity-missing');
  assert.deepEqual(result.coverage, [{ origin: 'north', status: 'origin-missing' }]);
});

test('all labeled cases can pass while an unusable distractor prevents a green gate', () => {
  const { source, current, run } = fixture();
  const distractor = { id: 'unlabeled', kind: 'session', issued: 'unused', tenant: 'other' };
  source.push(distractor);
  current.push({ ...distractor, tenant: null });
  const report = run();
  assert.equal(report.candidate.passed, 3);
  assert.equal(report.verdict, 'regression');
  assert.deepEqual(report.candidate.coverage[0].missingFields, ['/tenant']);
  current.pop();
  assert.equal(run().candidate.coverage[0].status, 'origin-missing');
});

test('new eligible origins participate in matching', () => {
  const { current, run } = fixture();
  current.push({ ...current[0], id: 'new-session' });
  assert.equal(run().candidate.cases[0].status, 'ambiguous');
});

test('both sides losing a field cannot create a null-to-null attribution', () => {
  const { current, run } = fixture();
  delete current[0].issued;
  delete current[2].used;
  const result = run().candidate;
  assert.deepEqual(result.cases[0].matches, []);
  assert.deepEqual(result.coverage[0].missingFields, ['/issued']);
});

test('bad ground truth invalidates the baseline before candidate scoring', () => {
  const { contract, source } = fixture();
  contract.cases[0].origin = 'south';
  const report = compare(contract, source, []);
  assert.equal(report.verdict, 'invalid-baseline');
  assert.equal(report.candidate, null);
  assert.equal(challenge(contract, source).verdict, 'invalid-baseline');
});

test('duplicate or unusable event identity is an input error', () => {
  const { current, run } = fixture();
  current[1].id = current[2].id;
  assert.throws(run, /repeats a selected event ID/);
  delete current[1].id;
  assert.throws(run, /stable string event ID/);
});

test('pointer escapes resolve literal field names and inherited fields stay inaccessible', () => {
  const { spec, source } = fixture();
  spec.origin.keys = ['/nested/a~1b~0c'];
  spec.activity.keys = ['/nested/a~1b~0c'];
  for (const record of source) record.nested = { 'a/b~c': record.tenant };
  assert.equal(compare(compileContract(spec), source, source).verdict, 'pass');
  spec.origin.keys = ['/nested/constructor/name'];
  assert.equal(compare(compileContract(spec), source, source).verdict, 'invalid-baseline');
});

test('rejects unknown contract fields, malformed pointers, overlapping selectors and repeated labels', () => {
  const { spec, source } = fixture();
  assert.throws(() => compileContract({ ...spec, typo: 1 }), /contract/);
  assert.throws(() => compileContract({ ...spec, eventId: '/bad~2' }), /JSON Pointer/);
  assert.throws(() => compileContract({ ...spec, cases: [spec.cases[0], spec.cases[0]] }), /unique/);
  assert.throws(() => compileContract({ ...spec, cases: [spec.cases[2]] }), /positive/);
  const overlapping = compileContract({ ...spec, activity: spec.origin });
  assert.throws(() => compare(overlapping, source, source), /both selectors/);
});

test('a positive and two different sessions expose both fixture challenges', () => {
  const { contract, source } = fixture();
  const result = challenge(contract, source);
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(result.probes.map(p => p.status), ['caught', 'caught']);
  assert.equal(compare(contract, source, source).verdict, 'pass');
});

test('one isolated positive would accept a constant mask', () => {
  const { spec, source } = fixture();
  spec.cases = spec.cases.slice(0, 1);
  const report = challenge(compileContract(spec), [source[0], source[2]]);
  assert.equal(report.verdict, 'weak-fixture');
  assert.deepEqual(report.probes.map(p => p.status), ['survived', 'untestable']);
});
