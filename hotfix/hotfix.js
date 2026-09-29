import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

const GAME_DIR = 'C:/YostarGames/StellaSora_EN';
const OPSTABLE = join(HERE, 'opstable.json');
const OUT = join(HERE, 'out');
const KEY_CHECK = 'Hello, HybridCLR';

const input = join(GAME_DIR, 'Persistent_Store', 'Scripts', 'Hotfix.dll');

if (!existsSync(input)) {
    die(`Hotfix.dll not found: ${input}`);
}
if (!existsSync(OPSTABLE)) {
    die(`opcode table not found: ${OPSTABLE}`);
}

const ops = new Map();
for (const [k, v] of Object.entries(JSON.parse(readFileSync(OPSTABLE, 'utf8')))) ops.set(Number(k), v);

function ror8(v, n) {
    n &= 7;
    return ((v >> n) | (v << (8 - n))) & 0xff;
}

function decryptBlock(buf, base, n, opcodes, key) {
    for (const op of opcodes) {
        const entry = ops.get(op);
        if (!entry) throw new Error(`opcode table has no entry for ${op}`);
        const [kind, c1, k, c2] = entry;
        switch (kind) {
            case 'xor':
                buf[base + (c1 % n)] ^= key[k] ^ (c2 & 0xff);
                break;
            case 'xor_direct':
                buf[base + (c1 % n)] ^= key[k];
                break;
            case 'not_xor':
                buf[base + (c1 % n)] = (~buf[base + (c1 % n)] ^ key[k]) & 0xff;
                break;
            case 'combined': {
                const i1 = base + (c1 % n);
                const i2 = base + (((key[k] + c2) >>> 0) % n);
                const t = (buf[i2] - 1) & 0xff;
                buf[i1] = (buf[i1] - t) & 0xff;
                buf[i2] = t;
                break;
            }
            case 'addconst':
                buf[base + (c1 % n)] = (buf[base + (c1 % n)] + ((c2 & 0xff) - key[k])) & 0xff;
                break;
            case 'swap': {
                const i1 = base + (c1 % n);
                const i2 = base + (((key[k] + c2) >>> 0) % n);
                [buf[i1], buf[i2]] = [buf[i2], buf[i1]];
                break;
            }
            case 'ror':
                buf[base + (c1 % n)] = ror8(buf[base + (c1 % n)], key[k] + c2);
                break;
            default:
                throw new Error(`unknown op kind ${kind}`);
        }
    }
}

function decryptRange(buf, start, len, blockLen, opcodes, key) {
    for (let off = 0; off < len; off += blockLen) {
        decryptBlock(buf, start + off, Math.min(blockLen, len - off), opcodes, key);
    }
}

const img = readFileSync(input);

if (img.toString('ascii', 0, 4) !== 'CDPH') die(`not a CDPH file (magic ${img.toString('hex', 0, 4)})`);
const version = img.readUInt32LE(4);
if (version !== 1) die(`unsupported CDPH version ${version}`);

const key = img.subarray(16, 16 + 256);

const instrs = [];
let off = 0x110;
for (let i = 0; i < 8; i++) {
    const len = img.readUInt32LE(off);
    instrs.push(img.subarray(off + 4, off + 4 + len));
    off = (off + 4 + len + 3) & ~3;
}
const cli = off;

const check = Buffer.from(img.subarray(cli, cli + 16));
decryptBlock(check, 0, 16, Uint8Array.from({ length: 256 }, (_, i) => ~i & 0xff), key);
if (check.toString('ascii') !== KEY_CHECK) die(`key check failed: got ${JSON.stringify(check.toString('ascii'))}`);

const entrypoint = img.readUInt32LE(cli + 0x10);
const mdRva = img.readUInt32LE(cli + 0x14);
const mdSize = img.readUInt32LE(cli + 0x18);
const nsec = img.readUInt32LE(cli + 0x1c);

const secs = [];
for (let i = 0, p = cli + 0x28; i < nsec; i++, p += 16) {
    secs.push({ foff: img.readUInt32LE(p), size: img.readUInt32LE(p + 4) });
}

const imageEnd = Math.max(...secs.map((s) => s.foff + s.size));
const image = Buffer.alloc(Math.max(imageEnd, mdRva + mdSize));
for (const s of secs) img.copy(image, s.foff, s.foff, s.foff + s.size);
const meta = Buffer.from(image.subarray(mdRva, mdRva + mdSize));

console.log(`CDPH version ${version}, key check OK`);

function parseStreams() {
    const vlen = meta.readUInt32LE(12);
    const count = meta.readUInt16LE(16 + vlen + 2);
    let sp = 16 + vlen + 4;
    const out = {};
    for (let i = 0; i < count; i++) {
        const nul = meta.indexOf(0, sp + 8);
        const nameEnd = nul === -1 || nul > sp + 40 ? sp + 40 : nul;
        const name = meta.toString('ascii', sp + 8, nameEnd);
        out[name] = [meta.readUInt32LE(sp), meta.readUInt32LE(sp + 4)];
        sp += 8 + ((name.length + 1 + 3) & ~3);
    }
    return out;
}

const streams = parseStreams();
for (const [name, vec] of [['#~', 5], ['#Strings', 1], ['#US', 3], ['#Blob', 2]]) {
    const [soff, ssize] = streams[name];
    decryptRange(meta, soff, ssize, 0x100, instrs[vec], key);
}

{
    const [soff, ssize] = streams['#US'];
    let i = 0;
    while (i + 1 < ssize) {
        const v = meta[soff + i];
        let i2, ln;
        if (v < 0x80) [i2, ln] = [i + 1, v];
        else if (v < 0xc0) [i2, ln] = [i + 2, ((v & 0x3f) << 8) | meta[soff + i + 1]];
        else [i2, ln] = [i + 4, (((v & 0x1f) << 24) | (meta[soff + i + 1] << 16) | (meta[soff + i + 2] << 8) | meta[soff + i + 3]) >>> 0];
        if (i2 + ln > ssize) break;
        decryptRange(meta, soff + i2, ln, 0x10, instrs[4], key);
        i = i2 + ln;
    }
}

const tOff = streams['#~'][0];

const heapSizes = meta[tOff + 6];
const valid = meta.readBigUInt64LE(tOff + 8);
const rows = {};
let rowbase = 24;
for (let tid = 0; tid < 64; tid++) {
    if (valid >> BigInt(tid) & 1n) {
        rows[tid] = meta.readUInt32LE(tOff + rowbase);
        rowbase += 4;
    }
}

const heapSize = (name) => (heapSizes & { S: 1, G: 2, B: 4 }[name] ? 4 : 2);
const tabIdx = (tid) => ((rows[tid] ?? 0) >= 0x10000 ? 4 : 2);
const coded = (bits, tabs) => (Math.max(...tabs.map((x) => rows[x] ?? 0)) >= 0x10000 >> bits ? 4 : 2);

const rowSizes = {
    0: 2 + heapSize('S') + heapSize('G') + 2 + 2,
    1: coded(2, [0x00, 0x1a, 0x23, 0x01]) + heapSize('S') + heapSize('S'),
    2: 4 + heapSize('S') + heapSize('S') + coded(2, [0x01, 0x02, 0x1b]) + tabIdx(0x04) + tabIdx(0x06),
    4: 2 + heapSize('S') + heapSize('B'),
    6: 4 + 2 + 2 + heapSize('S') + heapSize('B') + tabIdx(0x08),
};

const tableOffsets = {};
for (let pos = rowbase, tid = 0; tid < 64; tid++) {
    if (!(tid in rows)) continue;
    if (tid in rowSizes) tableOffsets[tid] = pos;
    pos += rows[tid] * (rowSizes[tid] ?? 0);
}

{
    const rs = rowSizes[2];
    const base = tableOffsets[2];
    for (let r = 0; r < rows[2]; r++) decryptBlock(meta, tOff + base + r * rs, rs, instrs[6], key);
}

function decryptMethod(rva) {
    if (rva + 1 > imageEnd) return;
    let cs, codeOff;
    if ((image[rva] & 0x03) === 0x02) {
        cs = image[rva] >> 2;
        codeOff = rva + 1;
    } else {
        const headerLen = ((image.readUInt16LE(rva) >> 12) & 0xf) * 4;
        if (rva + headerLen + 4 > imageEnd) return;
        cs = image.readUInt32LE(rva + 4);
        codeOff = rva + headerLen;
    }
    if (codeOff + cs > imageEnd) return;
    decryptRange(image, codeOff, cs, 0x10, instrs[7], key);
}

{
    const mdRs = rowSizes[6];
    const base = tableOffsets[6];
    const seen = new Set();
    for (let r = 0; r < rows[6]; r++) {
        const rva = meta.readUInt32LE(tOff + base + r * mdRs);
        if (rva === 0 || seen.has(rva)) continue;
        seen.add(rva);
        decryptMethod(rva);
    }
}

meta.copy(image, mdRva);

const SECTION_RVA = 0x400;
const sectionSize = Math.max(imageEnd, mdRva + mdSize) - SECTION_RVA;

const cliHeader = Buffer.alloc(0x48);
cliHeader.writeUInt32LE(0x48, 0x00);
cliHeader.writeUInt16LE(2, 0x04);
cliHeader.writeUInt16LE(5, 0x06);
cliHeader.writeUInt32LE(mdRva, 0x08);
cliHeader.writeUInt32LE(mdSize, 0x0c);
cliHeader.writeUInt32LE(0, 0x10);
cliHeader.writeUInt32LE(entrypoint, 0x14);

const content = Buffer.alloc(Math.max(sectionSize, 0x90 + imageEnd - 0x490));
cliHeader.copy(content, 0);
image.copy(content, 0x90, 0x490, imageEnd);
const rawSize = content.length;

const pe = Buffer.alloc(SECTION_RVA + rawSize);
pe.write('MZ', 0, 'ascii');
pe.writeUInt32LE(0x80, 0x3c);
pe.write('PE\0\0', 0x80, 'latin1');
const coff = 0x84;
pe.writeUInt16LE(0x14c, coff + 0);
pe.writeUInt16LE(1, coff + 2);
pe.writeUInt32LE(0, coff + 4);
pe.writeUInt32LE(0, coff + 8);
pe.writeUInt32LE(0, coff + 12);
pe.writeUInt16LE(0xe0, coff + 16);
pe.writeUInt16LE(0x2102, coff + 18);
const opt = coff + 20;
pe.writeUInt16LE(0x10b, opt + 0);
pe.writeUInt8(0, opt + 2);
pe.writeUInt8(0, opt + 3);
pe.writeUInt32LE(0, opt + 4);
pe.writeUInt32LE(0, opt + 8);
pe.writeUInt32LE(0, opt + 12);
pe.writeUInt32LE(0, opt + 16);
pe.writeUInt32LE(SECTION_RVA, opt + 20);
pe.writeUInt32LE(0x10000000, opt + 24);
pe.writeUInt32LE(0x200, opt + 28);
pe.writeUInt32LE(0x200, opt + 32);
pe.writeUInt16LE(4, opt + 40);
pe.writeUInt16LE(0, opt + 42);
pe.writeUInt16LE(4, opt + 48);
pe.writeUInt16LE(0, opt + 50);
pe.writeUInt32LE(SECTION_RVA + rawSize, opt + 56);
pe.writeUInt32LE(SECTION_RVA, opt + 60);
pe.writeUInt32LE(0, opt + 64);
pe.writeUInt16LE(2, opt + 68);
pe.writeUInt16LE(0x8160, opt + 70);
pe.writeUInt32LE(0, opt + 88);
pe.writeUInt16LE(16, opt + 92);
const dd = opt + 96;
for (let i = 0; i < 16; i++) pe.writeUInt32LE(0, dd + i * 8 + 4);
pe.writeUInt32LE(SECTION_RVA, dd + 14 * 8);
pe.writeUInt32LE(cliHeader.length, dd + 14 * 8 + 4);
const sec = opt + 0xe0;
pe.write('.text\0\0\0', sec, 'latin1');
pe.writeUInt32LE(sectionSize, sec + 8);
pe.writeUInt32LE(SECTION_RVA, sec + 12);
pe.writeUInt32LE(rawSize, sec + 16);
pe.writeUInt32LE(SECTION_RVA, sec + 20);
pe.writeUInt32LE(0, sec + 24);
pe.writeUInt32LE(0, sec + 28);
pe.writeUInt16LE(0, sec + 32);
pe.writeUInt16LE(0, sec + 34);
pe.writeUInt32LE(0x60000020, sec + 36);
content.copy(pe, SECTION_RVA);

mkdirSync(OUT, { recursive: true });
const outDll = join(OUT, 'Hotfix.dec.dll');
writeFileSync(outDll, pe);
console.log(`wrote ${outDll} (${pe.length} bytes)`);

const res = spawnSync('ilspycmd', [outDll, '-o', OUT], { stdio: 'inherit', env: { ...process.env, DOTNET_ROLL_FORWARD: 'Major' } });
if (res.error) die(`cannot run ilspycmd: ${res.error.message}`);
if (res.status !== 0) die(`ilspycmd failed (exit code ${res.status})`);
console.log(`decompiled -> ${OUT}`);

function die(msg) {
    console.error(`hotfix: ${msg}`);
    process.exit(1);
}
