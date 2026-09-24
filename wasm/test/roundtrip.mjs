// Round-trip test of the WASM core against the reference `pub` CLI.
//
//   scripts/build-wasm.sh && node wasm/test/roundtrip.mjs
//
// Copies a real published company + keystore into a temp dir (the originals
// are never touched), drives every operation through globalThis.keryx, writes
// each Change to the copy, runs `pub validate` after each step, and
// cross-checks `publish` against `pub item sign` + `pub publish`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '../..');
const COMPANY = process.env.COMPANY ?? '/Users/kaladivo/workspace/temp/davefrajer';
const KEYS = process.env.KEYS ?? '/Users/kaladivo/workspace/temp/davefrajer-keys';
const PUB = process.env.PUB ?? '/Users/kaladivo/workspace/temp/keryx/bin/pub';
const REPO_DIR = 'keryx';
const ANCHOR_DIR = '.well-known/keryx';
const CHANNEL = 'news';

// --- wasm bootstrap (Go's wasm_exec_node.js pattern) -----------------------

vm.runInThisContext(fs.readFileSync(path.join(root, 'public/wasm_exec.js'), 'utf8'), {
  filename: 'wasm_exec.js',
});
const go = new Go();
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync(path.join(root, 'public/keryx.wasm')),
  go.importObject,
);
void go.run(instance);
const raw = globalThis.keryx;
assert.ok(raw, 'globalThis.keryx defined');

const unwrap = (r) => {
  if ('error' in r) throw new Error(r.error);
  return r.value;
};
const keryx = Object.fromEntries(
  Object.keys(raw).map((name) => [name, (...args) => unwrap(raw[name](...args))]),
);

// --- fixtures ---------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-editor-'));
const copyCompany = (name) => {
  const dir = path.join(tmp, name);
  fs.cpSync(COMPANY, dir, { recursive: true, filter: (src) => path.basename(src) !== '.git' });
  return dir;
};
const readFiles = (dir) => {
  const files = {};
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(p);
      else files[p] = new Uint8Array(fs.readFileSync(path.join(dir, p)));
    }
  };
  walk('');
  return files;
};
const applyChange = (dir, change) => {
  for (const [p, data] of Object.entries(change.write)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), data);
  }
  for (const p of change.remove) fs.rmSync(path.join(dir, p));
};
const pub = (...args) =>
  execFileSync(PUB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const validate = (dir) => {
  const out = pub('validate', '--repo', `${dir}/${REPO_DIR}`, '--anchor', `${dir}/${ANCHOR_DIR}`);
  assert.match(out, /^OK: /);
  return out;
};
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const keyFiles = fs
  .readdirSync(KEYS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => readJSON(path.join(KEYS, f)));

// --- OLPC canonical JSON + Ed25519, for standalone signature checks ----------

const olpc = (v) => {
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (Array.isArray(v)) return `[${v.map(olpc).join(',')}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${olpc(k)}:${olpc(v[k])}`)
    .join(',')}}`;
};
const ed25519Public = (hex) =>
  crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
const verify = (pub, message, sigB64url) =>
  crypto.verify(null, Buffer.from(message), pub, Buffer.from(sigB64url, 'base64url'));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();
const itemSignaturesValid = (item, pub) => {
  const { sig, ...rest } = item;
  return sig.length > 0 && sig.every((s) => verify(pub, olpc(rest), s.sig));
};

// --- 1. load + company -------------------------------------------------------

const dirA = copyCompany('wasm');
const company = keryx.load({ files: readFiles(dirA), repoDir: REPO_DIR, anchorDir: ANCHOR_DIR, keys: keyFiles });
console.log('company():', JSON.stringify(company, (k, v) => (k === 'content_html' ? `${v.slice(0, 40)}…` : v), 2));
assert.equal(company.name, 'DaveFrajer');
assert.deepEqual(keryx.company(), company);
assert.ok(company.keys.every((k) => !('seed_hex' in k)), 'keys never carry the seed');
const channel = company.channels.find((c) => c.name === CHANNEL);
assert.ok(channel, `channel ${CHANNEL}`);
const dates = channel.items.map((i) => i.date_published);
assert.deepEqual(dates, [...dates].sort().reverse(), 'items newest first');
assert.equal(keryx.validate(), validate(dirA));

const targets = readJSON(path.join(dirA, REPO_DIR, 'targets.json')).signed;
const channelRole = targets.delegations.roles.find((r) => r.name === `channels.${CHANNEL}`);
const channelKeyId = channelRole.keyids[0];
const channelPub = ed25519Public(targets.delegations.keys[channelKeyId].keyval.public);
const before = keryx.versions(CHANNEL);
console.log('versions before:', before);

// --- 2. publish a new draft --------------------------------------------------

const draft = {
  id: 'editor-roundtrip',
  title: 'Editor round-trip',
  content_html: '<p>Published from the WASM core &amp; checked against pub.</p>',
  date_published: '2026-09-24T12:00:00Z',
  tags: ['test'],
  language: 'en',
};
const itemPath = `${REPO_DIR}/channels/${CHANNEL}/${draft.id}.json`;
const publish1 = keryx.publish(CHANNEL, draft);
console.log('publish → write', Object.keys(publish1.write), 'remove', publish1.remove);
assert.deepEqual(
  Object.keys(publish1.write).sort(),
  [itemPath, `${REPO_DIR}/channels.${CHANNEL}.json`, `${REPO_DIR}/snapshot.json`, `${REPO_DIR}/timestamp.json`].sort(),
);
assert.deepEqual(publish1.remove, []);
applyChange(dirA, publish1);
console.log('validate after publish:', validate(dirA));
const published = JSON.parse(Buffer.from(publish1.write[itemPath]).toString());
assert.ok(itemSignaturesValid(published, channelPub), 'item signatures verify with the channel key');
assert.deepEqual(keryx.versions(CHANNEL), {
  timestamp: before.timestamp + 1,
  snapshot: before.snapshot + 1,
  targets: before.targets,
  channel: before.channel + 1,
});

// --- 3. update the same id ---------------------------------------------------

const update = keryx.publish(CHANNEL, { ...draft, title: 'Editor round-trip (edited)', date_modified: '2026-09-24T12:30:00Z' });
applyChange(dirA, update);
console.log('validate after update:', validate(dirA));
const updated = JSON.parse(Buffer.from(update.write[itemPath]).toString());
assert.equal(updated.title, 'Editor round-trip (edited)');
assert.equal(updated.date_published, draft.date_published, 'update keeps the draft date_published');
assert.ok(itemSignaturesValid(updated, channelPub));
assert.equal(keryx.versions(CHANNEL).channel, before.channel + 2);
assert.equal(keryx.company().channels.find((c) => c.name === CHANNEL).items.length, channel.items.length + 1);

// --- 4. unpublish a temp item ------------------------------------------------

const tempDraft = { ...draft, id: 'editor-temp', title: 'Temporary' };
applyChange(dirA, keryx.publish(CHANNEL, tempDraft));
validate(dirA);
const unpublish = keryx.unpublish(CHANNEL, tempDraft.id);
console.log('unpublish → write', Object.keys(unpublish.write), 'remove', unpublish.remove);
assert.deepEqual(unpublish.remove, [`${REPO_DIR}/channels/${CHANNEL}/${tempDraft.id}.json`]);
applyChange(dirA, unpublish);
console.log('validate after unpublish:', validate(dirA));
assert.throws(() => keryx.unpublish(CHANNEL, tempDraft.id), /is not published/);

// --- 5. refresh timestamp ----------------------------------------------------

const v = keryx.versions(CHANNEL);
const refresh = keryx.refreshTimestamp();
assert.deepEqual(Object.keys(refresh.write), [`${REPO_DIR}/timestamp.json`]);
applyChange(dirA, refresh);
console.log('validate after refreshTimestamp:', validate(dirA));
assert.deepEqual(keryx.versions(CHANNEL), { ...v, timestamp: v.timestamp + 1 });

// --- 6. errors are thrown, never fatal --------------------------------------

assert.throws(() => keryx.publish('nope', draft), /unknown channel "nope"/);
assert.throws(() => keryx.publish(CHANNEL, { ...draft, id: 'Bad.Id' }), /must match/);
assert.throws(() => keryx.versions('nope'), /channels\.nope\.json/);
assert.throws(() => keryx.publish(CHANNEL), /draft/);
const onlyOps = keyFiles.filter((k) => k.role === 'ops');
keryx.load({ files: readFiles(dirA), repoDir: REPO_DIR, anchorDir: ANCHOR_DIR, keys: onlyOps });
assert.throws(() => keryx.publish(CHANNEL, draft), /missing key: key ".*" not in the loaded keys/);
keryx.load({ files: readFiles(dirA), repoDir: REPO_DIR, anchorDir: ANCHOR_DIR, keys: keyFiles });

// --- 7. cross-check publish against the CLI ---------------------------------

const dirB = copyCompany('cli');
const draftFile = path.join(tmp, 'draft.json');
fs.writeFileSync(draftFile, JSON.stringify(draft));
pub('item', 'sign', '--file', draftFile, '--channel', CHANNEL, '--keyid', channelKeyId, '--keystore', KEYS);
pub('publish', '--channel', CHANNEL, '--file', draftFile,
  '--repo', `${dirB}/${REPO_DIR}`, '--anchor', `${dirB}/${ANCHOR_DIR}`, '--keystore', KEYS);
validate(dirB);

const cliItem = fs.readFileSync(path.join(dirB, itemPath));
assert.ok(Buffer.from(publish1.write[itemPath]).equals(cliItem), 'item file is byte-identical to the CLI output');

const rolePath = `${REPO_DIR}/channels.${CHANNEL}.json`;
const wasmRole = JSON.parse(Buffer.from(publish1.write[rolePath]).toString());
const cliRole = readJSON(path.join(dirB, rolePath));
const { expires: wasmExpires, ...wasmSigned } = wasmRole.signed;
const { expires: cliExpires, ...cliSigned } = cliRole.signed;
assert.deepEqual(wasmSigned, cliSigned, 'channel role signed content matches the CLI (except expires)');
assert.deepEqual(wasmRole.signatures.map((s) => s.keyid), cliRole.signatures.map((s) => s.keyid));
for (const role of [wasmRole, cliRole]) {
  assert.ok(role.signatures.every((s) => verify(channelPub, olpc(role.signed), Buffer.from(s.sig, 'hex').toString('base64url'))));
}
for (const name of ['snapshot.json', 'timestamp.json']) {
  const wasm = JSON.parse(Buffer.from(publish1.write[`${REPO_DIR}/${name}`]).toString()).signed;
  const cli = readJSON(path.join(dirB, REPO_DIR, name)).signed;
  assert.equal(wasm.version, cli.version, `${name} version`);
  assert.deepEqual(Object.keys(wasm.meta), Object.keys(cli.meta), `${name} meta entries`);
}
console.log(`cross-check: item identical; channel role v${wasmRole.signed.version} identical except expires (${wasmExpires} vs ${cliExpires})`);

// --- 8. signWakeup ----------------------------------------------------------

const seq = 1_700_000_000;
const wakeup = keryx.signWakeup('https://keryx.roguedave.codes', CHANNEL, seq);
console.log('signWakeup:', wakeup);
assert.deepEqual(Object.keys(wakeup), ['v', 'company_id', 'scope_id', 'h', 'seq', 'sig']);
assert.deepEqual(Object.keys(wakeup.sig[0]), ['keyid', 'sig']);
assert.equal(wakeup.v, 1);
assert.equal(wakeup.company_id, 'keryx.roguedave.codes');
assert.equal(wakeup.seq, seq);
assert.equal(wakeup.sig[0].keyid, channelKeyId);
const scopeId = sha256(`keryx/relay/scope/v1|${olpc({ kind: 'public', channel: CHANNEL })}`).toString('hex');
const h = sha256(`${wakeup.company_id}|${CHANNEL}`).toString('hex');
assert.equal(wakeup.scope_id, scopeId);
assert.equal(wakeup.h, h);
const topic = sha256(`keryx/relay/v1|${olpc({ company_id: wakeup.company_id, scope_id: scopeId, h })}`).toString('base64url');
assert.ok(verify(channelPub, `keryx/wakeup/v1|${olpc({ v: 1, t: topic, seq })}`, wakeup.sig[0].sig), 'wake-up signature verifies');
assert.deepEqual(keryx.signWakeup('keryx.roguedave.codes', CHANNEL, seq), wakeup, 'bare company_id gives the same request');

fs.rmSync(tmp, { recursive: true });
console.log('PASS');
process.exit(0);
