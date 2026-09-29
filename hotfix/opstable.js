import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Decoder, DecoderOptions, FastFormatter } from 'iced-x86';

const HERE = dirname(fileURLToPath(import.meta.url));

const GAME_ASSEMBLY = 'C:/YostarGames/StellaSora_EN/GameAssembly.dll';
const JUMP_TABLE_RVA = 0x5757b8;
const OUT = join(HERE, 'opstable.json');

const buf = readFileSync(GAME_ASSEMBLY);

const pe = buf.readUInt32LE(0x3c);
const opt = pe + 24;
const imageBase = buf.readBigUInt64LE(opt + 24);
const secStart = opt + buf.readUInt16LE(pe + 20);
const secs = [];
for (let i = 0, n = buf.readUInt16LE(pe + 6); i < n; i++) {
    const s = secStart + i * 40;
    secs.push({ vaddr: buf.readUInt32LE(s + 12), vsize: buf.readUInt32LE(s + 8), praw: buf.readUInt32LE(s + 20) });
}

function rva2off(rva) {
    for (const s of secs) {
        if (s.vaddr <= rva && rva < s.vaddr + Math.max(s.vsize, 1)) return s.praw + (rva - s.vaddr);
    }
    return -1;
}

const decoder = new Decoder(64, buf, DecoderOptions.NONE);
const formatter = new FastFormatter(null);
formatter.alwaysShowMemorySize = true;
formatter.useHexPrefix = true;
formatter.uppercaseHex = false;
formatter.spaceAfterOperandSeparator = true;

function disasm(rva) {
    const pos = rva2off(rva);
    if (pos < 0) return [];

    decoder.position = pos;
    decoder.ip = imageBase + BigInt(rva);

    const out = [];
    while (decoder.canDecode && out.length < 64) {
        const ins = decoder.decode();
        const text = formatter.format(ins);
        const space = text.indexOf(' ');
        out.push({ m: text.slice(0, space), o: text.slice(space + 1), target: ins.nearBranchTarget });
        if (ins.isJmpNear || ins.isJmpShort) break;
    }
    return out;
}

const koff = (s) => {
    const m = /\[r8 ?\+ ?(0x[0-9a-f]+|\d+)\]/.exec(s);
    if (m) return Number(m[1]);
    if (s.includes('[r8]')) return 0;
    return null;
};

const iconst = (s) => Number(/, ?(0x[0-9a-f]+|\d+)$/.exec(s)[1]);

function tailDelta(insns, start, end) {
    const { target } = insns[insns.length - 1];
    if (target === undefined) return 0;

    const rva = Number(target - imageBase);
    if (rva >= start && rva < end) return 0;

    const [first] = disasm(rva);
    const m = first && first.m === 'sub' && /^ecx, (0x[0-9a-f]+|\d+)$/.exec(first.o);
    return m ? -Number(m[1]) : 0;
}

function classify(insns, start, end) {
    const first = insns[0];

    if (first.m === 'movzx' && first.o.startsWith('ecx, byte ptr [r8')) {
        let C1 = null, delta = null;

        for (const { m, o } of insns) {
            if (m === 'mov' && o.startsWith('eax, 0x')) C1 = parseInt(o.slice(5), 16);
            else if (m === 'sub' && o.startsWith('ecx, ')) delta = -iconst(o);
            else if (m === 'add' && o.startsWith('ecx, ')) delta = iconst(o);
            else if (m === 'inc' && o === 'ecx') delta = 1;
            else if (m === 'dec' && o === 'ecx') delta = -1;
        }

        const tail = tailDelta(insns, start, end);
        return ['ror', C1, koff(first.o), tail ? tail : (delta ?? 0)];
    }

    const C1 = parseInt(insns[1].o.slice(5), 16);
    const rest = insns.slice(3);
    const fr = rest[0];

    if (fr.m === 'movzx' && fr.o.startsWith('eax, byte ptr [r8')) {
        const K = koff(fr.o);
        const nxt = rest[1];

        if (nxt.m === 'xor' && nxt.o.startsWith('al, byte ptr [rdx')) return ['xor', C1, K, iconst(rest[2].o)];
        if (nxt.m === 'xor' && nxt.o.startsWith('byte ptr [rdx')) return ['xor_direct', C1, K, 0];
        if (nxt.m === 'mov' && nxt.o === 'r9d, edx') {
            return ['combined', C1, K, rest[2].m === 'sub' ? -iconst(rest[2].o) : iconst(rest[2].o)];
        }
        if (nxt.m === 'add' || nxt.m === 'sub') {
            return ['swap', C1, K, nxt.m === 'sub' ? -iconst(nxt.o) : iconst(nxt.o)];
        }
        die(`unknown opcode template: ${insns.map((i) => i.m + ' ' + i.o).join('; ')}`);
    }

    if (fr.m === 'movzx' && fr.o.startsWith('eax, byte ptr [rdx')) {
        if (rest[1].m === 'not') return ['not_xor', C1, koff(rest[2].o), 0];
        return ['xor', C1, koff(rest[1].o), iconst(rest[2].o)];
    }

    if (fr.m === 'mov' && fr.o.startsWith('eax,')) return ['addconst', C1, koff(rest[1].o), iconst(fr.o)];

    die(`unknown opcode template: ${insns.map((i) => i.m + ' ' + i.o).join('; ')}`);
}

const jtOff = rva2off(JUMP_TABLE_RVA);
if (jtOff < 0) die(`jump table RVA 0x${JUMP_TABLE_RVA.toString(16)} is not in any section`);

const entries = [];
for (let i = 0; i < 256; i++) entries.push(buf.readUInt32LE(jtOff + i * 4));

const targets = [...new Set(entries)].sort((a, b) => a - b);

const ops = {};
for (let op = 0; op < 256; op++) {
    const start = entries[op];
    const end = targets.find((t) => t > start) ?? start + 0x40;
    ops[op] = classify(disasm(start), start, end);
}

writeFileSync(OUT, JSON.stringify(ops));
console.log(`extracted ${Object.keys(ops).length} opcodes -> ${OUT}`);

function die(msg) {
    console.error(`opstable: ${msg}`);
    process.exit(1);
}
