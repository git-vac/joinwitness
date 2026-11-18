#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { compileContract } from '../lib/contract.js';
import { challenge, compare } from '../lib/compare.js';
import { readContract, readEvents } from '../lib/input.js';
import { formatReport } from '../lib/report.js';
import { scenarios, transform } from '../examples/cloudtrail/transforms.js';

const usage = `JoinWitness | regression tests for security log attribution

  joinwitness demo
  joinwitness replay <constant|split|swapped|consistent>
  joinwitness check --contract FILE --baseline FILE --candidate FILE [--json]
  joinwitness challenge --contract FILE --baseline FILE [--json]

replay writes the transformed example to stdout. Use - to read one input from stdin.
Exit codes: 0 pass, 1 regression or weak fixture, 2 invalid input or baseline.`;

const example = name => new URL('../examples/cloudtrail/' + name, import.meta.url);

function run(args) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h') {
    console.log(usage);
    return 0;
  }
  if (command === 'demo' || command === 'replay') {
    if (command === 'demo' && rest.length) throw new Error('demo takes no arguments');
    if (command === 'replay' && (rest.length !== 1 || !scenarios.includes(rest[0]))) {
      throw new Error('replay requires one of ' + scenarios.join(', '));
    }
    const events = readEvents(example('baseline.json'), 'example');
    if (command === 'replay') {
      console.log(JSON.stringify({ Records: transform(events, rest[0]) }, null, 2));
      return 0;
    }
    const contract = compileContract(readContract(example('contract.json')));
    for (const scenario of scenarios) {
      const report = compare(contract, events, transform(events, scenario));
      console.log(`[ ${scenario} ]\n${formatReport(report)}\n`);
    }
    return 0;
  }
  if (!['check', 'challenge'].includes(command)) throw new Error('expected demo, replay, check or challenge');
  const inputs = command === 'check' ? ['contract', 'baseline', 'candidate'] : ['contract', 'baseline'];
  const { values } = parseArgs({
    args: rest,
    options: {
      ...Object.fromEntries(inputs.map(name => [name, { type: 'string' }])), json: { type: 'boolean' }
    }
  });
  const paths = inputs.map(name => values[name]);
  if (paths.some(path => !path)) throw new Error(command + ' requires ' + inputs.map(name => '--' + name).join(', '));
  if (paths.filter(path => path === '-').length > 1) throw new Error('only one input may read stdin');
  const contract = compileContract(readContract(values.contract));
  const baseline = readEvents(values.baseline, 'baseline');
  const report = command === 'challenge' ? challenge(contract, baseline) :
    compare(contract, baseline, readEvents(values.candidate, 'candidate'));
  console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
  return { pass: 0, regression: 1, 'weak-fixture': 1, 'invalid-baseline': 2 }[report.verdict];
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  console.error('JoinWitness: ' + error.message);
  process.exitCode = 2;
}
