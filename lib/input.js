import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { isRecord } from './contract.js';

function readText(path) {
  let data = readFileSync(path === '-' ? 0 : path);
  if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data);
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}

function parse(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    // Native JSON parse errors can echo the contents of a sensitive event.
    throw new Error(`${label} contains invalid JSON`);
  }
}

export function readContract(path) {
  return parse(readText(path), 'contract');
}

export function readEvents(path, label) {
  const text = readText(path);
  if (!text.trim()) return [];
  // Try a whole document first so pretty-printed CloudTrail exports work on stdin too.
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const records = [];
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (line.trim()) records.push(parse(line, `${label} line ${i + 1}`));
    }
    return records;
  }
  if (Array.isArray(data)) return data;
  if (isRecord(data) && Object.hasOwn(data, 'Records')) {
    if (!Array.isArray(data.Records)) throw new Error(`${label} Records must be an array`);
    return data.Records;
  }
  if (isRecord(data)) return [data];
  throw new Error(`${label} requires event objects, an array or a CloudTrail Records envelope`);
}
