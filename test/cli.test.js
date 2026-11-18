import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

const absolute = path => fileURLToPath(new URL(path, import.meta.url));
const cli = absolute('../bin/joinwitness.js');
const contract = absolute('../examples/cloudtrail/contract.json');
const baseline = absolute('../examples/cloudtrail/baseline.json');
const records = JSON.parse(readFileSync(baseline, 'utf8')).Records;
const check = ['check', '--contract', contract, '--baseline', baseline, '--candidate', '-', '--json'];
function run(args, input) {
  const result = spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', cwd: tmpdir() });
  if (result.error) throw result.error;
  return result;
}

for (const [scenario, status, observations] of [
  ['constant', 1, ['ambiguous', 'ambiguous', 'ambiguous']],
  ['split', 1, ['no-match', 'no-match', 'correctly-unlinked']],
  ['swapped', 1, ['wrong-origin', 'wrong-origin', 'correctly-unlinked']],
  ['consistent', 0, ['correct', 'correct', 'correctly-unlinked']]
]) {
  test('replay and CI gate: ' + scenario, () => {
    const generated = run(['replay', scenario]);
    assert.equal(generated.status, 0, generated.stderr);
    const result = run(check, generated.stdout);
    assert.equal(result.status, status, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.baseline.passed, 3);
    assert.deepEqual(report.candidate.cases.map(c => c.status), observations);
    assert.doesNotMatch(result.stdout, /fixture-finance-key|example-finance|april\.csv/);
    assert.ok(!result.stdout.includes(JSON.parse(generated.stdout).Records[0].responseElements.credentials.accessKeyId));
  });
}

test('reads gzipped CloudTrail and reordered JSONL from stdin', () => {
  const gzipped = run(check, gzipSync(readFileSync(baseline)));
  assert.equal(gzipped.status, 0, gzipped.stderr);
  const lines = [...records].reverse().map(event => JSON.stringify(event)).join('\r\n\r\n');
  const jsonl = run(check, '\ufeff' + lines);
  assert.equal(jsonl.status, 0, jsonl.stderr);
  assert.deepEqual(JSON.parse(gzipped.stdout), JSON.parse(jsonl.stdout));
});

test('output distinguishes empty candidate from invalid baseline', () => {
  const empty = run(check, '[]');
  assert.equal(empty.status, 1);
  assert.equal(JSON.parse(empty.stdout).candidate.passed, 0);
  const invalid = run(['check', '--contract', contract, '--baseline', '-', '--candidate', baseline, '--json'], '[]');
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).verdict, 'invalid-baseline');
});

test('invalid input returns 2 and diagnostics withhold record contents', () => {
  const result = run(check, '\n{"ok":true}\n{private-content');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /candidate line 3/);
  assert.doesNotMatch(result.stderr, /private-content/);
  assert.equal(result.stdout, '');
  assert.equal(run(check, '{"Records":"wrong"}').status, 2);
  assert.equal(run(check, '[1]').status, 2);
});

test('challenge and demo work from outside the project directory', () => {
  const result = run(['challenge', '--contract', contract, '--baseline', baseline, '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).probes.length, 2);
  const demo = run(['demo']);
  assert.equal(demo.status, 0, demo.stderr);
  assert.match(demo.stdout, /wrong-origin/);
  assert.match(demo.stdout, /Candidate 3\/3 cases correct/);
});

test('help, invalid arguments and multiple uses of stdin have stable exit semantics', () => {
  assert.equal(run(['--help']).status, 0);
  assert.equal(run(['check', '--candidate', '-']).status, 2);
  assert.equal(run(['check', '--contract', contract, '--baseline', '-', '--candidate', '-']).status, 2);
  assert.equal(run(['challenge', '--contract', contract, '--baseline', baseline, '--candidate', baseline]).status, 2);
  assert.equal(run(['replay', 'unknown']).status, 2);
});
