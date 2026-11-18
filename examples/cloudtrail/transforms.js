import { createHmac } from 'node:crypto';

export const scenarios = ['constant', 'split', 'swapped', 'consistent'];

// These transformations exercise the synthetic fixture. The strings are public test keys.
export function transform(events, scenario) {
  if (!scenarios.includes(scenario)) throw new Error('unknown replay scenario');
  const records = structuredClone(events);
  for (const event of records) {
    const isIssue = event.eventName === 'AssumeRole';
    const holder = isIssue ? event.responseElements.credentials : event.userIdentity;
    const domain = scenario === 'split' ? event.eventSource : 'shared';
    holder.accessKeyId = scenario === 'constant' ? '[redacted]' :
      createHmac('sha256', 'public-test-key/' + domain).update(holder.accessKeyId).digest('hex');
  }
  if (scenario === 'swapped') {
    const finance = records.find(event => event.eventID === 'read-billing').userIdentity;
    const build = records.find(event => event.eventID === 'read-build').userIdentity;
    [finance.accessKeyId, build.accessKeyId] = [build.accessKeyId, finance.accessKeyId];
  }
  return records;
}
