#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
require('../prototype-edge/auto-core.js');

const core = globalThis.GeminiAutoCore;

const ALLOWED_ROOT_KEYS = new Set([
  'schema_version',
  'provider',
  'origin',
  'collection',
  'model',
  'status',
  'observed_at_ms',
  'windows',
  'issues',
]);

const ALLOWED_WINDOW_KEYS = new Set([
  'id',
  'status',
  'used_percent',
  'remaining_percent',
  'reset',
  'issues',
]);

const ALLOWED_RESET_KEYS = new Set([
  'day',
  'month',
  'year',
  'hour',
  'minute',
  'timezone',
  'epoch_ms',
  'needs_confirmation',
]);

function hasOnlyAllowedKeys(obj, allowed) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.keys(obj).every(k => allowed.has(k));
}

function computeResetEpochMs(r, observedAtMs) {
  if (r.epoch_ms !== null && Number.isInteger(r.epoch_ms)) return r.epoch_ms;
  const now = new Date(observedAtMs);
  if (r.day !== null && r.month !== null) {
    let dt = new Date(now.getFullYear(), r.month - 1, r.day, r.hour, r.minute, 0, 0);
    if (observedAtMs - dt.getTime() > 30 * 86400000) {
      dt = new Date(now.getFullYear() + 1, r.month - 1, r.day, r.hour, r.minute, 0, 0);
    }
    return dt.getTime();
  }
  const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), r.hour, r.minute, 0, 0);
  if (dt.getTime() <= observedAtMs - 60000) {
    dt.setDate(dt.getDate() + 1);
  }
  return dt.getTime();
}

function validateSnapshot(raw) {
  if (!hasOnlyAllowedKeys(raw, ALLOWED_ROOT_KEYS)) return null;
  if (!Number.isFinite(raw.observed_at_ms) || raw.observed_at_ms <= 0) return null;
  if (!Array.isArray(raw.windows) || raw.windows.length !== 2) return null;
  for (const w of raw.windows) {
    if (!hasOnlyAllowedKeys(w, ALLOWED_WINDOW_KEYS)) return null;
    if (!hasOnlyAllowedKeys(w.reset, ALLOWED_RESET_KEYS)) return null;
  }
  const min = core.minimal(raw, raw.observed_at_ms);
  if (!min) return null;
  for (const w of min.windows) {
    if (w.reset && w.reset.epoch_ms === null && Number.isInteger(w.reset.hour) && Number.isInteger(w.reset.minute)) {
      w.reset.epoch_ms = computeResetEpochMs(w.reset, min.observed_at_ms);
    }
  }
  return typeof core.applyClockResetIfExpired === 'function'
    ? core.applyClockResetIfExpired(min, Date.now())
    : min;
}

function readBytes(fd, length) {
  const buf = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(fd, buf, offset, length - offset, null);
    } catch (err) {
      if (err && err.code === 'EAGAIN') continue;
      return null;
    }
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset === length ? buf : null;
}

function writeFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  fs.writeSync(1, Buffer.concat([header, payload]));
}

function resolveStatePath() {
  const override = process.env.CODENOTCH_GEMINI_WEB_STATE;
  if (override && override.trim()) return override.trim();
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'codenotch', 'gemini-web-state.json');
  }
  return null;
}

function main() {
  const header = readBytes(0, 4);
  if (!header) {
    writeFrame({ ok: false, error: 'missing_header' });
    process.exit(1);
  }
  const length = header.readUInt32LE(0);
  if (length < 1 || length > 8192) {
    writeFrame({ ok: false, error: 'invalid_length' });
    process.exit(1);
  }
  const body = readBytes(0, length);
  if (!body) {
    writeFrame({ ok: false, error: 'truncated_frame' });
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    writeFrame({ ok: false, error: 'invalid_json' });
    process.exit(1);
  }
  const snapshot = validateSnapshot(parsed);
  if (!snapshot) {
    writeFrame({ ok: false, error: 'invalid_snapshot' });
    process.exit(1);
  }
  const targetPath = resolveStatePath();
  if (!targetPath) {
    writeFrame({ ok: false, error: 'missing_state_path' });
    process.exit(1);
  }
  const dir = path.dirname(targetPath);
  const tmpPath = `${targetPath}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, targetPath);
  } catch {
    try { fs.unlinkSync(tmpPath); } catch {}
    writeFrame({ ok: false, error: 'write_failed' });
    process.exit(1);
  }
  writeFrame({ ok: true });
  process.exit(0);
}

main();
