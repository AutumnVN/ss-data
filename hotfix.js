const { readFileSync } = require('fs');

const HOTFIX_FILE = `${__dirname}/hotfix/out/Hotfix.cs`;

const CHARACTER = require('./EN/bin/Character.json');
const HITDAMAGE = require('./EN/bin/HitDamage.json');
const POTENTIAL = require('./EN/bin/Potential.json');
const ITEM = require('./EN/bin/Item.json');
const LANG_ITEM = require('./EN/language/en_US/Item.json');

const ELEMENTS = { WE: 1, FE: 2, SE: 3, AE: 4, LE: 5, DE: 6 };
const ELEMENTS_BY_NAME = { Water: 1, Fire: 2, Land: 3, Earth: 3, Air: 4, Wind: 4, Light: 5, Dark: 6 };
const ELEMENT_NAMES = { 1: 'Aqua', 2: 'Ignis', 3: 'Terra', 4: 'Ventus', 5: 'Lux', 6: 'Umbra' };

const ELEMENT_CODES = /(?:\(\s*(?:int|elementType)\s*\)\s*[\w.]*)?elementType(?:\s*\)\s*|\s*[!=]=\s*)([1-6])\b/g;

const HITDAMAGE_DECLS = /(\w*[hH]itDamage\w*)\s*=\s*(\d+)\s*[,;]/g;
const HITDAMAGE_MAPPINGS = /hitDamageIdMapping(_P(\d+))?\s*=\s*new\s+(?:readonly\s+)?Dictionary<int,\s*int>\s*\{([^}]*)\}/g;
const HITDAMAGE_ENTRIES = /\[(\d+)\]\s*=\s*(\d+)/g;
const POTENTIAL_SUFFIX = /_P(\d+)$/;

const NAMESPACE = /^namespace\s+(\S+)/;
const METHOD = /^\t\t(?:public|private|protected|internal)[\w\s<>\[\],.?]*\s(\w+)\s*\(/;
const DECL_LINE = /^\s*(?:(?:public|private|protected|internal)\s+)?(?:(?:const|static\s+readonly|readonly|static)\s+)?[\w<>\[\].]+\s+(\w+)\s*=\s*(\d+)\s*[;,]\s*$/;
const MAPPING_USAGE = /(\w*hitDamageIdMapping\w*)\.TryGetValue\(/;
const GUARD_PERK = /(?<!!)\bHavePersonalPerk\((?:[^,]+,\s*)?(\d{6})\s*,/g;
const GUARD_PERK_NEGATED = /!\s*(?:CommonUtils\.)?HavePersonalPerk\((?:[^,]+,\s*)?(\d{6})\s*,/g;
const GUARD_ELEMENT = /CheckAllPlayerActorAreSameElement\(\s*\(elementType\)(\d)\s*\)/g;
const GUARD_TAG = /CheckHitByTag\([^,]+,\s*[\w.]*?(\w*[dD]amageTag\w*)\s*\)/;
const GUARD_SUMMON = /IsPlayerSummoned\(/;
const DAMAGE_TAG_DECL = /(\w*[dD]amageTag\w*)\s*=\s*CommonHelper\.StringToHash\("([^"]*)"\)/;
const HITDAMAGE_ID = /\b\d{7,9}\b/g;
const HITDAMAGE_NAME = /hitDame?ge/i;
const DAMAGE_APPLY = /(?:\.HitActor|AreaHit|FanDamage|RectangleDamage|GenerateIceFlower)\s*\(|hitDamageId\s*=\s*\d/;
const NOT_DAMAGE_APPLY = /(?:\.AddFromAttr|\.AddBuff|buffId\s*=\s*\d|SetBuff)/;
const HITDAMAGE_PARAM = /^\s*(?:public|private|protected|internal)[\w\s<>\[\],.?]*\s(\w+)\s*\([^)]*\bint\s+hitDamageId\b/;
const CALL_WITH_ID = /\b(\w+)\s*\(/g;
const NO_DAMAGE_METHOD = 'OnReceiveNoDamage';

const potentialByChar = {};
for (const potential of Object.values(POTENTIAL)) {
    potentialByChar[`${potential.CharId}_${potential.Id % 100}`] = potential.Id;
}

function parse(block) {
    const elements = new Set();
    for (const [, code] of block.matchAll(/\belementType\.([A-Z]{2})\b/g)) {
        if (ELEMENTS[code]) elements.add(ELEMENTS[code]);
    }
    for (const [, value] of block.matchAll(ELEMENT_CODES)) elements.add(+value);
    for (const [, name] of block.matchAll(/\bCommonDefine\.(Water|Fire|Land|Earth|Wind|Air|Light|Dark)(?![A-Za-z])/g)) {
        elements.add(ELEMENTS_BY_NAME[name]);
    }

    const proc = block.includes('TriggerElementMarkEvent');
    const apply = /[^0-9][1-6]011[^0-9]/.test(block);

    return {
        element: elements.size === 1 ? [...elements][0] : 0,
        class: proc ? (apply ? 2 : 1) : (apply ? 3 : 0),
    };
}

function getCharId(hitDamageId) {
    const charId = hitDamageId.slice(0, 3);
    return CHARACTER[charId] ? charId : undefined;
}

function parseHitDamage(src) {
    const potential = {};
    const character = {};

    const add = (bucket, key, id) => {
        const ids = bucket[key] || (bucket[key] = []);
        if (!ids.includes(id)) ids.push(id);
    };

    for (const [, name, id] of src.matchAll(HITDAMAGE_DECLS)) {
        if (!HITDAMAGE[id]) continue;

        const charId = getCharId(id);
        if (!charId) continue;

        const potIndex = name.match(POTENTIAL_SUFFIX);
        const potentialId = potIndex && potentialByChar[`${charId}_${potIndex[1]}`];

        if (potentialId) add(potential, potentialId, id);
        else add(character, charId, id);
    }

    for (const [, , potIndex, body] of src.matchAll(HITDAMAGE_MAPPINGS)) {
        const entries = [...body.matchAll(HITDAMAGE_ENTRIES)].map(([, from, to]) => ({ from, to }));
        const charId = entries.map(entry => getCharId(entry.from) || getCharId(entry.to)).find(Boolean);
        if (!charId) continue;

        const potentialId = potIndex && potentialByChar[`${charId}_${potIndex}`];

        for (const { to } of entries) {
            if (potentialId) add(potential, potentialId, to);
            else add(character, charId, to);
        }
    }

    return { potential, character };
}

let src = null;
let hitDamage = null;
let notes = null;

function getSource() {
    if (!src) src = readFileSync(HOTFIX_FILE, 'utf8');
    return src;
}

async function getHotfixData() {
    const lines = getSource().split(/\r?\n/);

    const characters = {};
    let depth = 0, id = 0, start = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/"(?:[^"\\]|\\.)*"/g, '""');
        const namespace = /^namespace AIScript\.Character\._(\d{3})01/.exec(line);
        if (namespace) id = +namespace[1];
        if (depth === 1 && /^\s*(?:public|internal)\s+(?:sealed |abstract |partial )*class ActionScript\b/.test(line)) start = i;
        if (!line.includes('{') && !line.includes('}')) continue;

        for (const char of line) {
            if (char === '{') depth++;
            else if (char === '}' && --depth < 1 && start) {
                if (id) characters[id] = parse(lines.slice(start, i + 1).join('\n'));
                start = 0;
            }
        }
    }

    return characters;
}

function getHotfixHitDamage() {
    if (!hitDamage) hitDamage = parseHitDamage(getSource());
    return hitDamage;
}

function getHiddenHitDamageIds(potentialId) {
    return getHotfixHitDamage().potential[potentialId] || [];
}

function parseHitDamageNotes(source) {
    const lines = source.split('\n');
    const offsets = [];
    let offset = 0;
    for (const line of lines) {
        offsets.push(offset);
        offset += line.length + 1;
    }

    const lineOf = index => {
        let low = 0, high = offsets.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (offsets[mid] <= index) low = mid;
            else high = mid - 1;
        }
        return low;
    };

    const namespaceAt = new Array(lines.length);
    const methodAt = new Array(lines.length);
    const damageTags = new Map();
    const occurrences = new Map();
    const stack = [];
    const requiredBy = new Map();
    const applyCalls = new Set();
    for (const line of lines) {
        const signature = HITDAMAGE_PARAM.exec(line);
        if (signature) applyCalls.add(signature[1]);
    }

    let namespace = '';
    let method = '';
    let depth = 0;
    let pending = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const ns = NAMESPACE.exec(line);
        if (ns) {
            namespace = ns[1];
            stack.length = 0;
            depth = 0;
            pending = null;
        }

        while (stack.length && stack[stack.length - 1].depth > depth) stack.pop();

        const found = METHOD.exec(line);
        if (found && found[1] !== method) {
            method = found[1];
            requiredBy.clear();
        }

        namespaceAt[i] = namespace;
        methodAt[i] = method;

        const tag = DAMAGE_TAG_DECL.exec(line);
        if (tag) {
            if (!damageTags.has(namespace)) damageTags.set(namespace, new Map());
            damageTags.get(namespace).set(tag[1], tag[2]);
        }

        const declared = DECL_LINE.exec(line);
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;

        GUARD_PERK.lastIndex = 0;
        const perks = [];
        for (const [, perkId] of line.matchAll(GUARD_PERK)) {
            if (POTENTIAL[perkId]) perks.push(+perkId);
        }

        if (/^\s*if\s*\(/.test(line)) {
            GUARD_PERK_NEGATED.lastIndex = 0;
            const negated = [...line.matchAll(GUARD_PERK_NEGATED)].map(([, perkId]) => +perkId).filter(id => POTENTIAL[id]);
            const body = lines.slice(i + 1, i + 4).map(text => text.trim());
            if (negated.length && body[0] === '{' && /^return\b/.test(body[1] || '') && body[2] === '}') {
                const scope = requiredBy.get(depth) || new Set();
                for (const id of negated) scope.add(id);
                requiredBy.set(depth, scope);
            }
        }

        const applied = declared && HITDAMAGE[declared[2]] && HITDAMAGE_NAME.test(declared[1]);
        let ids;
        if (applied) {
            ids = [declared[2]];
        } else if (DAMAGE_APPLY.test(line) && !NOT_DAMAGE_APPLY.test(line)) {
            ids = [...line.matchAll(HITDAMAGE_ID)].map(([id]) => id).filter(id => HITDAMAGE[id]);
        } else if (NOT_DAMAGE_APPLY.test(line)) {
            ids = [];
        } else if (applyCalls.size && [...line.matchAll(CALL_WITH_ID)].some(([, name]) => applyCalls.has(name))) {
            ids = [...line.matchAll(HITDAMAGE_ID)].map(([id]) => id).filter(id => HITDAMAGE[id]);
        } else {
            ids = [];
        }

        for (const id of ids) {
            let list = occurrences.get(id);
            if (!list) occurrences.set(id, list = []);
            const guards = [...stack.filter(entry => entry.perks.length).flatMap(entry => entry.perks), ...perks];
            for (const [level, scope] of requiredBy) {
                if (level <= depth) guards.push(...scope);
            }
            list.push({
                declaration: applied,
                perks: new Set(guards),
            });
        }

        if (perks.length) pending = perks;
        if (opens > closes) {
            for (let k = 0; k < opens - closes; k++) {
                depth++;
                stack.push({ depth, perks: pending || perks });
            }
            pending = null;
        } else if (!perks.length && /;\s*$/.test(line)) pending = null;

        depth -= closes;
        while (stack.length && stack[stack.length - 1].depth > depth) stack.pop();
    }

    const mappings = new Map();
    for (const match of source.matchAll(HITDAMAGE_MAPPINGS)) {
        const [, suffix, potIndex, body] = match;
        const line = lineOf(match.index);
        const name = `hitDamageIdMapping${suffix || ''}`;
        mappings.set(`${namespaceAt[line]}|${name}`, {
            name,
            namespace: namespaceAt[line],
            potIndex,
            entries: [...body.matchAll(HITDAMAGE_ENTRIES)].map(([, from, to]) => ({ from, to })),
        });
    }

    const result = {};
    const add = (id, note) => {
        if (!HITDAMAGE[id]) return;
        const list = result[id] || (result[id] = []);
        if (!list.includes(note)) list.push(note);
    };

    for (let i = 0; i < lines.length; i++) {
        const usage = MAPPING_USAGE.exec(lines[i]);
        if (!usage) continue;

        const mapping = mappings.get(`${namespaceAt[i]}|${usage[1]}`);
        if (!mapping) continue;

        const guard = lines[i].slice(0, usage.index);
        const conditions = [];

        for (const [, perkId] of guard.matchAll(GUARD_PERK)) {
            conditions.push(`requires ${potentialLabel(+perkId)}`);
        }

        GUARD_ELEMENT.lastIndex = 0;
        for (const [, code] of guard.matchAll(GUARD_ELEMENT)) {
            conditions.push(`all ${ELEMENT_NAMES[code]} trekkers`);
        }

        const tag = GUARD_TAG.exec(guard);
        if (tag) {
            const value = damageTags.get(mapping.namespace)?.get(tag[1]);
            conditions.push(value ? `damage tag ${value}` : 'a specific damage tag');
        }

        if (GUARD_SUMMON.test(guard)) conditions.push('own summon only');

        if (methodAt[i] === NO_DAMAGE_METHOD) conditions.push('no damage only');

        const suffix = conditions.length ? ` (${conditions.join(', ')})` : '';

        for (const { from, to } of mapping.entries) {
            add(to, `Can replace ${from}${suffix}`);
            add(from, `Can be replaced by ${to}${suffix}`);
        }
    }

    for (const [id, list] of occurrences) {
        const paths = [];

        for (const entry of list) {
            if (entry.declaration) continue;
            paths.push(entry.perks);
        }

        const unconditional = !paths.length || paths.some(perks => !perks.size);
        if (unconditional) continue;

        const required = paths.reduce((kept, perks) => new Set([...kept].filter(id => perks.has(id))), paths[0]);
        for (const perkId of required) add(id, `Requires ${potentialLabel(perkId)}`);
    }

    return result;
}

function potentialLabel(potentialId) {
    const potential = POTENTIAL[potentialId];
    if (!potential) return `potential ${potentialId}`;
    const name = ITEM[potentialId] && LANG_ITEM[ITEM[potentialId].Title];
    return name ? `${name} (${potentialId})` : `P${potential.Id % 100} (${potentialId})`;
}

function getHitDamageNote(hitDamageId) {
    if (!notes) notes = parseHitDamageNotes(getSource());
    return notes[hitDamageId] || [];
}

module.exports = { getHotfixData, getHotfixHitDamage, getHiddenHitDamageIds, getHitDamageNote, potentialLabel };
