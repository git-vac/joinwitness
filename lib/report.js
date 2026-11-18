// Quote all user-defined display strings, including terminal and bidirectional controls.
const quote = value => JSON.stringify(value).replace(/[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,
  char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));

export function formatReport(report) {
  const checked = report.candidate ?? report.baseline;
  const lines = [
    report.verdict.toUpperCase() + '  ' + quote(report.question),
    `Baseline  ${report.baseline.passed}/${report.baseline.total} cases correct`
  ];
  if (report.candidate) lines.push(`Candidate ${checked.passed}/${checked.total} cases correct`);
  for (const item of checked.cases) {
    lines.push(`  ${item.status.padEnd(20)} ${quote(item.label)}`);
    if (item.status === 'correct' || item.status === 'correctly-unlinked') continue;
    lines.push(`    expected ${quote(item.expected)}  matched [${item.matches.map(quote).join(', ')}]`);
    if (item.missingActivityFields.length) lines.push('    unusable activity fields ' + item.missingActivityFields.map(quote).join(', '));
    for (const pair of item.differentFields) {
      lines.push(`    values differ at activity ${quote(pair.activity)} and expected origin ${quote(pair.origin)}`);
    }
  }
  for (const issue of checked.coverage) {
    const suffix = issue.missingFields ? '  ' + issue.missingFields.map(quote).join(', ') : '';
    lines.push(`  origin coverage: ${issue.status} ${quote(issue.origin)}${suffix}`);
  }
  for (const probe of report.probes ?? []) {
    lines.push(`  ${probe.name.padEnd(20)} ${probe.status}`);
    if (probe.caughtBy.length) lines.push('    detected by ' + probe.caughtBy.map(quote).join(', '));
    if (probe.advice) lines.push('    ' + probe.advice);
  }
  return lines.join('\n');
}
