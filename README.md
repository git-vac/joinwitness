# JoinWitness

**Would the logs you keep still point an investigator to the right session?**

JoinWitness is a local CI test for changes to security logging pipelines. Give it a small labeled replay and the same events after redaction, normalization or enrichment. It runs the investigator’s lookup on both datasets and checks which event IDs actually match.

In the included AWS example, two sessions read two S3 objects. A faulty enrichment exchanges their identifiers. Both reads still match exactly one session. An alert count, field-presence check or join-success metric would look healthy. JoinWitness reports the reversal.

```text
REGRESSION  "Which role session issued the credentials used for each S3 read?"
Baseline  3/3 cases correct
Candidate 1/3 cases correct
  wrong-origin         "Billing export"
    expected "session-finance"  matched ["session-build"]
```

## Run the replay

From this directory, with Node.js 22 or newer, run the following. The CLI uses only Node built-ins.

```sh
node bin/joinwitness.js demo
```

The demo transforms five synthetic CloudTrail-shaped records. Two reads have known issuing sessions. A third read uses credentials issued outside the replay and should match neither session.

| Change applied to the replay | What an investigator sees | Cases correct |
| --- | --- | --- |
| Replace every credential identifier with one mask | Each read points to both sessions, including the outside read | 0/3 |
| Tokenize independently in each service | Both known links disappear | 1/3 |
| Exchange the identifiers on the two known reads | Each read points to the other session | 1/3 |
| Apply consistent tokens across both services | Both links and the outside control survive | 3/3 |

To exercise the CI exit code directly, pipe an example through the checker. This command exits **1**. Change `swapped` to `consistent` for a passing run. Append `--json` to the checker for the structured report.

```sh
node bin/joinwitness.js replay swapped | node bin/joinwitness.js check --contract examples/cloudtrail/contract.json --baseline examples/cloudtrail/baseline.json --candidate -
```

The example joins the temporary access key ID returned by STS `AssumeRole` to the access key ID recorded under the later event’s `userIdentity`. The fixtures contain invented identifiers. [AWS STS events in CloudTrail](https://docs.aws.amazon.com/IAM/latest/UserGuide/cloudtrail-integration.html) · [CloudTrail identity fields](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html)

## Test a pipeline change

1. Capture a bounded replay with known relationships. Include distinct sessions and, where possible, an activity whose origin is outside the replay. Keep a stable, unique event ID through both pipeline versions.
2. Write the expected links from an independent source such as a test harness that knows which session performed each action. Inferring the labels from the lookup under test can bake an attribution error into the baseline.
3. Run the same input through the current and proposed pipelines. Save their outputs as UTF-8 JSONL, a JSON array or a CloudTrail `Records` envelope. Gzip input is detected automatically. The CLI also accepts one input from standard input as `-`.
4. Run the two commands below in CI. Substitute your contract and exported file paths.

```sh
node bin/joinwitness.js challenge --contract contract.json --baseline before.jsonl
node bin/joinwitness.js check --contract contract.json --baseline before.jsonl --candidate after.jsonl --json
```

`challenge` checks whether your labels would catch two deliberate changes. It collapses every usable join key to one value, then independently tries exchanging the keys of two distinct origins. A replay with one session and one positive read would accept the constant mask. The command identifies the surviving change and suggests a control to add.

`check` first verifies the baseline against the labels. It compares each candidate activity to **every eligible origin**, including unlabeled distractors and newly added origins. A positive case passes with exactly the expected match. A negative case passes with a usable activity key and zero matches. Removing a baseline origin or invalidating an origin key also fails the overall gate, even if every labeled read still gives the expected answer.

| Exit | Meaning |
| --- | --- |
| 0 | All checks for the selected command passed |
| 1 | Candidate regression or weak fixture |
| 2 | Invalid input, invocation or labeled baseline |

The JSON report includes fixture labels, event IDs, field paths and observed matches. Raw event bodies and join values stay out of the report. Use opaque event IDs and case labels suitable for your CI logs.

## Write a contract

Start with the [CloudTrail contract](examples/cloudtrail/contract.json) and [input replay](examples/cloudtrail/baseline.json). The contract has six fields.

| Field | Meaning |
| --- | --- |
| `version` | Contract format version, currently `1` |
| `question` | Investigation question displayed in the report |
| `eventId` | JSON Pointer to the stable string ID used for scoring |
| `origin` | Selector and ordered join fields for possible issuers |
| `activity` | Selector and corresponding join fields for observed actions |
| `cases` | One label, activity ID and expected origin ID per assertion. Use `null` for an outside origin |

Each side has a `where` object of JSON Pointer/value pairs that must all match, and a `keys` array of JSON Pointers. Pair keys by position. For a tenant-scoped session ID, use both tenant and session fields on each side. A join requires exact equality on every component. Strings and safe integers retain their types. Missing fields, whitespace-only strings, nulls, objects, arrays and booleans are unusable as join values. Duplicate selected event IDs or overlapping selectors make an input invalid.

The file defines the lookup window. Scope it to the time and population you want to test. Version 1 evaluates equality joins in memory. Each result applies to the supplied records and labels. A pipeline that changes the event IDs themselves needs a stable replay identifier added before comparison.

## Related work

Vector tests assertions on transform outputs. Panther tests correlation detections. LogTotal Sanitizer can produce consistent HMAC tokens for correlation. JoinWitness checks exported data against independent labels for each action’s origin. That lets it catch a unique match to the wrong session. [Vector unit tests](https://vector.dev/docs/reference/configuration/unit-tests/) · [Panther correlation rules](https://docs.panther.com/detections/correlation-rules) · [LogTotal Sanitizer](https://github.com/socprime/logtotal-sanitizer)

## Run the tests

```sh
node --test
```
