'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const hostPath = path.join(__dirname, '..', '..', 'native-host', 'host.cjs');

function encodeFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function decodeFrame(buf) {
  assert.ok(Buffer.isBuffer(buf) && buf.length >= 4, 'stdout deve conter cabeçalho de 4 bytes');
  const len = buf.readUInt32LE(0);
  assert.equal(buf.length, 4 + len, 'tamanho do frame de resposta deve bater com o cabeçalho');
  return JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
}

function validSnapshot() {
  return {
    schema_version: 1,
    provider: 'gemini_web',
    origin: 'visible_ui',
    collection: 'dom_on_authorized_usage',
    model: null,
    status: 'observed',
    observed_at_ms: 1776000000000,
    windows: [
      {
        id: 'current',
        status: 'observed',
        used_percent: 48,
        remaining_percent: 52,
        reset: {
          day: null,
          month: null,
          year: null,
          hour: 17,
          minute: 6,
          timezone: null,
          epoch_ms: null,
          needs_confirmation: true,
        },
        issues: [],
      },
      {
        id: 'weekly',
        status: 'observed',
        used_percent: 12,
        remaining_percent: 88,
        reset: {
          day: 21,
          month: 4,
          year: null,
          hour: 15,
          minute: 24,
          timezone: null,
          epoch_ms: null,
          needs_confirmation: true,
        },
        issues: [],
      },
    ],
    issues: [],
  };
}

test('host nativo grava arquivo JSON sanitizado, responde {"ok":true} e sai com código 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codenotch-gemini-native-'));
  const stateFile = path.join(tmpDir, 'gemini-web-state.json');
  try {
    const snap = validSnapshot();
    const res = spawnSync(process.execPath, [hostPath], {
      input: encodeFrame(snap),
      env: { ...process.env, CODENOTCH_GEMINI_WEB_STATE: stateFile },
    });
    assert.equal(res.status, 0);
    const reply = decodeFrame(res.stdout);
    assert.deepEqual(reply, { ok: true });
    assert.equal(fs.existsSync(stateFile), true);
    assert.equal(fs.existsSync(`${stateFile}.tmp`), false);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.provider, 'gemini_web');
    assert.equal(saved.observed_at_ms, 1776000000000);
    assert.equal(saved.windows.length, 2);
    assert.equal(saved.windows[0].id, 'current');
    assert.equal(saved.windows[0].used_percent, 48);
    assert.equal(Number.isInteger(saved.windows[0].reset.epoch_ms) && saved.windows[0].reset.epoch_ms > 0, true);
    assert.equal(saved.windows[1].id, 'weekly');
    assert.equal(saved.windows[1].used_percent, 12);
    assert.equal(Number.isInteger(saved.windows[1].reset.epoch_ms) && saved.windows[1].reset.epoch_ms > 0, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('host nativo rejeita provider inválido, percentual fora de 0..100, campo desconhecido ou frame corrompido sem gravar arquivo', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codenotch-gemini-native-reject-'));
  const stateFile = path.join(tmpDir, 'gemini-web-state.json');
  try {
    const wrongProvider = validSnapshot();
    wrongProvider.provider = 'other_provider';

    const outOfRange = validSnapshot();
    outOfRange.windows[0].used_percent = 105;

    const unknownField = { ...validSnapshot(), email: 'secret@example.com' };

    const corruptedFrame = Buffer.from([100, 0, 0, 0, 123, 34]); // declara 100 bytes mas envia 2

    for (const input of [
      encodeFrame(wrongProvider),
      encodeFrame(outOfRange),
      encodeFrame(unknownField),
      corruptedFrame,
    ]) {
      const res = spawnSync(process.execPath, [hostPath], {
        input,
        env: { ...process.env, CODENOTCH_GEMINI_WEB_STATE: stateFile },
      });
      assert.notEqual(res.status, 0);
      const reply = decodeFrame(res.stdout);
      assert.equal(reply.ok, false);
      assert.equal(fs.existsSync(stateFile), false);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('wrapper host.cmd encaminha frame válido para host.cjs no Windows', () => {
  const hostCmdPath = path.join(__dirname, '..', '..', 'native-host', 'host.cmd');
  assert.equal(fs.existsSync(hostCmdPath), true);
  const content = fs.readFileSync(hostCmdPath, 'utf8');
  assert.match(content, /@echo off/i);
  assert.match(content, /"%~dp0host\.cjs"/);
  if (process.platform === 'win32') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codenotch-gemini-cmd-'));
    const stateFile = path.join(tmpDir, 'gemini-web-state.json');
    try {
      const res = spawnSync('cmd.exe', ['/d', '/s', '/c', hostCmdPath], {
        input: encodeFrame(validSnapshot()),
        env: { ...process.env, CODENOTCH_GEMINI_WEB_STATE: stateFile },
      });
      assert.equal(res.status, 0);
      assert.deepEqual(decodeFrame(res.stdout), { ok: true });
      assert.equal(fs.existsSync(stateFile), true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
});

test('host nativo zera automaticamente janela cujo horário de reset já passou (observed_at_ms < reset.epoch_ms <= now)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codenotch-gemini-reset-'));
  const stateFile = path.join(tmpDir, 'gemini-web-state.json');
  try {
    const now = Date.now();
    const observedAt = now - 3 * 3600 * 1000; // 3h atrás
    const pastResetEpoch = now - 3600 * 1000; // 1h atrás (já venceu!)
    const snap = validSnapshot();
    snap.observed_at_ms = observedAt;
    snap.windows[0].used_percent = 100;
    snap.windows[0].remaining_percent = 0;
    snap.windows[0].reset.epoch_ms = pastResetEpoch;
    const res = spawnSync(process.execPath, [hostPath], {
      input: encodeFrame(snap),
      env: { ...process.env, CODENOTCH_GEMINI_WEB_STATE: stateFile },
    });
    assert.equal(res.status, 0);
    assert.deepEqual(decodeFrame(res.stdout), { ok: true });
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.windows[0].used_percent, 0);
    assert.equal(saved.windows[0].remaining_percent, 100);
    assert.equal(saved.windows[0].reset.epoch_ms, pastResetEpoch + 5 * 3600 * 1000);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

