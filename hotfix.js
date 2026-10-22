const { readFileSync } = require('fs');
const { tmpdir } = require('os');

const HOTFIX_FILE = `${__dirname}/hotfix/out/Hotfix.cs`;

const CHARACTER = require('./EN/bin/Character.json');
const HITDAMAGE = require('./EN/bin/HitDamage.json');
const SKILL = require('./EN/bin/Skill.json');
const POTENTIAL = require('./EN/bin/Potential.json');
const ITEM = require('./EN/bin/Item.json');
const LANG_ITEM = require('./EN/language/en_US/Item.json');

const OUTPUT = `${tmpdir()}/areaEffect.json`;
const BULLET_FILE = `${tmpdir()}/bullet.json`;

const ELEMENTS = { WE: 1, FE: 2, SE: 3, AE: 4, LE: 5, DE: 6 };
const ELEMENTS_BY_NAME = { Water: 1, Fire: 2, Land: 3, Earth: 3, Air: 4, Wind: 4, Light: 5, Dark: 6 };
const ELEMENT_NAMES = { 1: 'Aqua', 2: 'Ignis', 3: 'Terra', 4: 'Ventus', 5: 'Lux', 6: 'Umbra' };
const DAMAGE_TYPE_NAMES = { NORMAL: 'Normal attack', SKILL: 'Skill', ULTIMATE: 'Ultimate', PASSIVE: 'Passive' };

const SUMMON_ATTR_TYPE_LABEL = {
    Self: 'Self, uses its own stats',
    Inherit: "Inherit, copies owner's current stats (includes active buffs)",
    InheritByInitialSnapshot: "InheritByInitialSnapshot, copies owner's stats from the start of battle (later buffs excluded)",
};

const ELEMENT_CODES = /(?:\(\s*(?:int|elementType)\s*\)\s*[\w.]*)?elementType(?:\s*\)\s*|\s*[!=]=\s*)([1-6])\b/g;

const HITDAMAGE_DECLS = /(\w*[hH]itDamage\w*)\s*=\s*(\d+)\s*[,;]/g;
const HITDAMAGE_MAPPINGS = /hitDamageIdMapping(_P(\d+))?\s*=\s*new\s+(?:readonly\s+)?Dictionary<int,\s*int>\s*\{([^}]*)\}/g;
const HITDAMAGE_ENTRIES = /\[(\d+)\]\s*=\s*(\d+)/g;
const POTENTIAL_SUFFIX = /_P(\d+)$/;

const NAMESPACE = /^namespace\s+(\S+)/;
const CLASS_DECL = /^\s*(?:(?:public|private|protected|internal|static|sealed|abstract|partial)\s+)*class\s+/;
const CLASS_NAME = /^\s*(?:(?:public|private|protected|internal|static|sealed|abstract|partial)\s+)*class\s+(\w+)/;
const BOSS_TAG_DECL = /^\s*(?:(?:public|private|protected|internal|static|readonly|const)\s+)*string\s+(\w*(?:TagId|EntryId)\w*)\s*=\s*"(\d{6})"\s*;/;
const BOSS_BUFF_DECL = /^\s*(?:(?:public|private|protected|internal|static|readonly|const)\s+)*int\s+(\w+)\s*=\s*(631\d{6})\s*;/;
const JOINT_DRILL_NAMESPACE = /^namespace\s+AIScript\.Monster\._(\d{5})/;
const JOINT_DRILL_BUFF_ID = /\b(\d{9})\b/g;
const JOINT_DRILL_BUFF_FIELD = /\b(buff\w*)\s*=/i;
const JOINT_DRILL_BUFF_LEVEL = /\[(\d+)\]\s*=\s*new\s+List<int>\s*\{([^}]*)\}/;
const JOINT_DRILL_BUFF_LV = /\["Lv(\d+)"\]\s*=\s*(\d{9})/;
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
const CHARACTER_NAMESPACE = /^namespace AIScript\.Character\._(\d{3})01/;
const SUMMON_ATTR_ASSIGN = /summonAttrType\s*=\s*SummonAttrType\.(\w+)/;
const SUMMON_ATTR_PERCENT_ASSIGN = /attrPercent\s*=\s*(\w+|\d+)/;
const SUMMON_CFG_REF = /(\w+)\.summonCfg\w*/;
const INT_DECL = /^\s*(?:(?:public|private|protected|internal)\s+)?(?:static\s+)?(?:readonly\s+)?int\s+(\w+)\s*=\s*(\d+)\s*;/;

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
let analyzerData = null;
let scoreBossBuffs = null;
let jointDrillBuffs = null;

function getSource() {
    if (!src) src = readFileSync(HOTFIX_FILE, 'utf8');
    return src;
}

function getAnalyzerData() {
    if (analyzerData) return analyzerData;

    try {
        analyzerData = JSON.parse(readFileSync(`${__dirname}/hotfix.json`, 'utf8'));
    } catch {
        analyzerData = {};
    }

    return analyzerData;
}

function getHotfixScoreBossBuffs() {
    if (scoreBossBuffs) return scoreBossBuffs;

    scoreBossBuffs = {};
    let currentTag = null;

    for (const line of getSource().split(/\r?\n/)) {
        if (CLASS_DECL.test(line)) {
            currentTag = null;
            continue;
        }

        const tag = BOSS_TAG_DECL.exec(line);
        if (tag) {
            currentTag = tag[2];
            continue;
        }

        const buff = BOSS_BUFF_DECL.exec(line);
        if (!buff || !currentTag) continue;

        const ids = scoreBossBuffs[currentTag] || (scoreBossBuffs[currentTag] = []);
        const id = +buff[2];
        if (!ids.includes(id)) ids.push(id);
    }

    return scoreBossBuffs;
}

function getHotfixJointDrillBuffs(prefix) {
    if (!jointDrillBuffs) {
        jointDrillBuffs = {};
        let currentNamespace = null;
        let currentField = '';
        let current = null;

        for (const line of getSource().split(/\r?\n/)) {
            const namespace = JOINT_DRILL_NAMESPACE.exec(line);
            if (namespace) {
                currentNamespace = namespace[1];
                currentField = '';
                current = null;
                continue;
            }

            if (!currentNamespace) continue;

            const field = JOINT_DRILL_BUFF_FIELD.exec(line);
            if (field) currentField = field[1];

            if (!current || current.prefix !== currentNamespace) {
                current = jointDrillBuffs[currentNamespace] || (jointDrillBuffs[currentNamespace] = {
                    prefix: currentNamespace,
                    all: new Set(),
                    levels: [],
                });
            }

            for (const [, id] of line.matchAll(JOINT_DRILL_BUFF_ID)) {
                if (id.startsWith(currentNamespace)) current.all.add(+id);
            }

            const level = JOINT_DRILL_BUFF_LEVEL.exec(line);
            if (level && /buffid/i.test(currentField)) {
                const index = +level[1];
                const ids = current.levels[index] || (current.levels[index] = new Set());
                for (const [, id] of level[2].matchAll(/\b(\d{9})\b/g)) ids.add(+id);
            }

            const lv = JOINT_DRILL_BUFF_LV.exec(line);
            if (lv) {
                const index = +lv[1];
                const ids = current.levels[index] || (current.levels[index] = new Set());
                ids.add(+lv[2]);
            }
        }
    }

    const data = jointDrillBuffs[prefix];
    if (!data) return { all: [], levels: [] };

    return {
        all: [...data.all],
        levels: data.levels.map(ids => ids ? [...ids] : []),
    };
}

async function getHotfixData() {
    const lines = getSource().split(/\r?\n/);

    const characters = {};
    let depth = 0, id = 0, start = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/"(?:[^"\\]|\\.)*"/g, '""');
        const namespace = /^namespace AIScript\.Character\._(\d{3})01/.exec(line);
        if (namespace) id = +namespace[1];
        if (depth === 1 && /^\s*(?:public|internal)\s+(?:sealed |abstract |partial )*class (?:Action|ActionScript)\b/.test(line)) start = i;
        if (!line.includes('{') && !line.includes('}')) continue;

        for (const char of line) {
            if (char === '{') depth++;
            else if (char === '}' && --depth < 1 && start) {
                if (id) {
                    const character = parse(lines.slice(start, i + 1).join('\n'));
                    if (character.element || character.class) characters[id] = character;
                }
                start = 0;
            }
        }
    }

    return characters;
}

function getHotfixHitDamage() {
    if (hitDamage) return hitDamage;

    const hidden = getAnalyzerData().hidden;
    hitDamage = hidden || parseHitDamage(getSource());
    return hitDamage;
}

let interactionData = null;

function joinConditions(items) {
    if (items.length < 2) return items[0] || '';
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function describeInteraction(sets) {
    const alternatives = sets.map(conditions => {
        const perks = conditions
            .filter(condition => condition.type === 'perk' && !condition.negated)
            .map(condition => potentialLabel(Number(condition.value)));

        const uniquePerks = [...new Set(perks)];

        return uniquePerks.length
            ? `only when ${joinConditions(uniquePerks)} ${uniquePerks.length === 1 ? 'is' : 'are'} active`
            : '';
    }).filter(Boolean);

    const conditions = sets[0] || [];
    const element = conditions.find(condition => condition.type === 'element' && !condition.negated);
    const damageType = conditions.find(condition => condition.type === 'damageType' && !condition.negated);
    const elementName = element && ELEMENT_NAMES[ELEMENTS[element.value]];
    const damageTypeName = damageType && DAMAGE_TYPE_NAMES[damageType.value];
    const damage = [elementName, damageTypeName].filter(Boolean).join(' ');
    const unique = [...new Set(alternatives)];

    const details = [
        unique.length && (unique.length > 1 ? unique.join(' or ') : unique[0]),
        damage && `only on ${damage} hits`,
    ].filter(Boolean).join('; ');

    return details ? `Conditional hit damage: ${details}` : '';
}

function getInteractionData() {
    if (interactionData) return interactionData;

    interactionData = { hitDamage: {}, notes: {} };

    const interactions = getAnalyzerData().interactions || [];

    let bullets = {};
    try {
        bullets = JSON.parse(readFileSync(BULLET_FILE, 'utf8'));
    } catch {}

    const key = condition => `${condition.type}:${condition.value}:${condition.negated ? 1 : 0}`;
    const same = (a, b) => key(a) === key(b);
    const lookup = alias => {
        if (bullets[alias] !== undefined) return bullets[alias];

        const base = alias.split('/').pop();
        if (bullets[base] !== undefined) return bullets[base];

        const matches = Object.keys(bullets).filter(name => name.startsWith(base));
        return matches.length === 1 ? bullets[matches[0]] : undefined;
    };

    const groups = new Map();

    const intersectConditions = list => {
        if (!list.length) return [];

        return list[0].filter(condition => list.every(conditions =>
            conditions.some(other => same(other, condition))
        ));
    };

    const idsOf = alias => {
        const bullet = lookup(alias);

        return (Array.isArray(bullet) ? bullet : bullet === undefined ? [] : [bullet])
            .map(String)
            .filter(hitDamageId => {
                const hitDamage = HITDAMAGE[hitDamageId];
                return hitDamage && (hitDamage.LevelData || hitDamage.PerkId || hitDamage.SkillId);
            });
    };

    const usages = new Map();

    for (const interaction of interactions) {
        for (const value of interaction.values || []) {
            const groupKey = `${interaction.class}|${interaction.method}|${value.value}`;
            const list = usages.get(groupKey) || [];
            list.push(value.conditions || []);
            usages.set(groupKey, list);
        }
    }

    const alwaysIds = new Set();

    for (const [groupKey, list] of usages) {
        const alias = groupKey.slice(groupKey.lastIndexOf('|') + 1);
        const perks = list.map(conditions => conditions.filter(condition => condition.type === 'perk'));
        const common = perks[0].filter(condition => perks.every(conditions =>
            conditions.some(other => same(other, condition))
        ));

        if (common.some(condition => !condition.negated)) continue;

        for (const hitDamageId of idsOf(alias)) alwaysIds.add(hitDamageId);
    }

    for (const interaction of interactions) {
        const values = interaction.values || [];
        if (!values.length) continue;

        const shared = values.length < 2
            ? new Set()
            : new Set(
                (values[0].conditions || [])
                    .filter(condition => values.every(value => (value.conditions || []).some(other => same(condition, other))))
                    .map(key)
            );
        const allShared = values.length > 1 &&
            values.every(value => (value.conditions || []).every(condition => shared.has(key(condition))));

        for (const value of values) {
            const ids = idsOf(value.value).filter(hitDamageId => !alwaysIds.has(hitDamageId));
            if (!ids.length) continue;

            const extra = (value.conditions || [])
                .filter(condition => condition.type === 'perk' && !condition.negated && !shared.has(key(condition)));

            const condition = extra[extra.length - 1] || (allShared
                ? [...(value.conditions || [])]
                    .reverse()
                    .find(condition => condition.type === 'perk' && !condition.negated)
                : undefined);
            if (!condition) continue;

            const potentialId = Number(condition.value);
            if (!potentialId) continue;

            for (const hitDamageId of ids) {
                const groupKey = `${hitDamageId}|${potentialId}`;
                let group = groups.get(groupKey);

                if (!group) {
                    group = { hitDamageId, potentialId, conditions: [] };
                    groups.set(groupKey, group);
                }

                group.conditions.push(value.conditions || []);
            }
        }
    }

    const byHitDamage = new Map();

    for (const group of groups.values()) {
        const list = interactionData.hitDamage[group.potentialId] || (interactionData.hitDamage[group.potentialId] = []);
        if (!list.includes(group.hitDamageId)) list.push(group.hitDamageId);

        const conditions = intersectConditions(group.conditions);
        const set = new Set(conditions.map(condition => key(condition)));

        const sets = byHitDamage.get(group.hitDamageId) || [];
        if (!sets.some(other => other.set.size === set.size && [...set].every(item => other.set.has(item)))) {
            sets.push({ set, conditions });
        }
        byHitDamage.set(group.hitDamageId, sets);
    }

    for (const [hitDamageId, sets] of byHitDamage) {
        const kept = sets.filter(({ set }) => !sets.some(other =>
            other.set.size < set.size && [...other.set].every(item => set.has(item))
        ));

        const note = describeInteraction(kept.map(entry => entry.conditions));
        if (!note) continue;

        const notes = interactionData.notes[hitDamageId] || (interactionData.notes[hitDamageId] = []);
        if (!notes.includes(note)) notes.push(note);
    }

    return interactionData;
}

function getInteractionHitDamage(potentialId) {
    return getInteractionData().hitDamage[potentialId] || [];
}

function getInteractionHitDamageNote(hitDamageId) {
    return getInteractionData().notes[hitDamageId] || [];
}

function getHiddenHitDamageIds(potentialId) {
    const ids = [...(getHotfixHitDamage().potential[potentialId] || [])];

    for (const id of getInteractionHitDamage(potentialId)) {
        if (!ids.includes(id)) ids.push(id);
    }

    return ids;
}

let characterSummonInfo = null;
let classSummonInfo = null;

function summarizeSummonInfo(attrs, percents, ints) {
    if (!attrs.size) return;

    const values = [...percents]
        .map(value => ints[value] ?? (/^\d+$/.test(value) ? +value : undefined))
        .filter(value => value !== undefined);

    return {
        summonAttrType: [...attrs].map(attr => SUMMON_ATTR_TYPE_LABEL[attr] || attr).join(' / '),
        attrPercent: values.length && values.every(value => value === values[0]) ? values[0] : undefined,
    };
}

function getSummonInfoData() {
    if (characterSummonInfo) return;

    characterSummonInfo = {};
    classSummonInfo = {};

    let namespace = '';
    let charId = null;
    let className = null;
    let ints = {};
    let current = null;
    let currentClass = null;
    let currentClassRefs = null;

    const classSummonRefs = {};

    const flushClass = () => {
        if (!namespace || !className || !currentClass) return;

        const info = summarizeSummonInfo(currentClass.attrs, currentClass.percents, ints);
        if (info) classSummonInfo[`${namespace}|${className}`] = info;
        currentClass = null;
        currentClassRefs = null;
    };

    const flushCharacter = () => {
        if (!charId || !current) return;

        const info = summarizeSummonInfo(current.attrs, current.percents, ints);
        if (info) characterSummonInfo[charId] = info;
    };

    for (const line of getSource().split(/\r?\n/)) {
        const foundNamespace = /^namespace\s+(\S+)/.exec(line);
        if (foundNamespace) {
            flushClass();
            flushCharacter();
            namespace = foundNamespace[1];
            charId = CHARACTER_NAMESPACE.exec(line)?.[1] || null;
            className = null;
            ints = {};
            current = charId ? { attrs: new Set(), percents: new Set() } : null;
            continue;
        }

        const foundClass = CLASS_NAME.exec(line);
        if (foundClass) {
            flushClass();
            className = foundClass[1];
            currentClass = { attrs: new Set(), percents: new Set() };
            currentClassRefs = new Set();
            classSummonRefs[`${namespace}|${className}`] = currentClassRefs;
        }

        if (!charId) continue;

        const declaration = INT_DECL.exec(line);
        if (declaration) ints[declaration[1]] = +declaration[2];

        const attr = SUMMON_ATTR_ASSIGN.exec(line);
        if (attr) {
            current.attrs.add(attr[1]);
            currentClass?.attrs.add(attr[1]);
        }

        const percent = SUMMON_ATTR_PERCENT_ASSIGN.exec(line);
        if (percent) {
            current.percents.add(percent[1]);
            currentClass?.percents.add(percent[1]);
        }

        const configRef = SUMMON_CFG_REF.exec(line);
        if (configRef) currentClassRefs?.add(configRef[1]);
    }

    flushClass();
    flushCharacter();

    for (const [key, refs] of Object.entries(classSummonRefs)) {
        if (classSummonInfo[key] || !refs.size) continue;

        const keyNamespace = key.slice(0, key.indexOf('|'));
        for (const ref of refs) {
            const info = classSummonInfo[`${keyNamespace}|${ref}`];
            if (info) {
                classSummonInfo[key] = info;
                break;
            }
        }
    }
}

function getCharacterSummonInfo() {
    getSummonInfoData();
    return characterSummonInfo;
}

function getClassSummonInfo(fcPath) {
    getSummonInfoData();
    if (!fcPath) return;

    const index = fcPath.lastIndexOf('.');
    if (index < 0) return;

    return classSummonInfo[`${fcPath.slice(0, index)}|${fcPath.slice(index + 1)}`];
}

let hitDamageSkillIds = null;

function getHitDamageSkillIds() {
    if (hitDamageSkillIds) return hitDamageSkillIds;

    hitDamageSkillIds = {};

    for (const [skillId, skill] of Object.entries(SKILL)) {
        for (let index = 1; index <= 10; index++) {
            const match = new RegExp(`(?:^|,)HitDamage,DamageNum,(\\d+)`).exec(skill[`Param${index}`] || '');
            if (!match) continue;

            (hitDamageSkillIds[match[1]] ||= []).push(+skillId);
        }
    }

    return hitDamageSkillIds;
}

function getHitDamageSummonInfo(hitDamageId) {
    const hitDamage = HITDAMAGE[hitDamageId];
    if (!hitDamage) return;

    const charId = getCharId(String(hitDamageId)) || getCharId(String(hitDamage.SkillId || ''));
    const skillIds = hitDamage.SkillId
        ? [hitDamage.SkillId]
        : getHitDamageSkillIds()[hitDamageId] || Object.keys(SKILL).filter(skillId => String(hitDamageId).startsWith(skillId));
    const classInfos = skillIds
        .map(skillId => getClassSummonInfo(SKILL[skillId]?.FCPath))
        .filter(Boolean);
    const classInfo = classInfos.length && classInfos.every(info => info.summonAttrType === classInfos[0].summonAttrType)
        ? classInfos[0]
        : null;
    const summonInfo = classInfo || (hitDamage.DamageType === 7 && charId && getCharacterSummonInfo()[charId]);

    return {
        summonAttrType: summonInfo?.summonAttrType,
        summonAttrPercent: summonInfo?.attrPercent,
    };
}

let AREA_EFFECT_MAP = {};
try {
    AREA_EFFECT_MAP = JSON.parse(readFileSync(OUTPUT, 'utf8'));
} catch {}

function getHitDamageAreaEffectEntry(hitDamageId) {
    const entry = AREA_EFFECT_MAP[hitDamageId];
    if (entry === undefined) return;

    if (typeof entry === 'boolean') return { copyBattleDataBeforeAttack: entry, legacy: true };

    return entry;
}

function getHitDamageAreaEffectInfo(hitDamageId) {
    const entry = getHitDamageAreaEffectEntry(hitDamageId);
    if (!entry || entry.copyBattleDataBeforeAttack === undefined) return;
    if (!entry.legacy && entry.hits <= 1) return;

    return {
        areaEffect: entry.copyBattleDataBeforeAttack
            ? "AreaEffect-Refresh, refreshes owner's stats before each attack"
            : "AreaEffect-Snapshot, snapshots owner's stats when created",
    };
}

function getHitDamageAreaEffectDetail(hitDamageId) {
    const entry = getHitDamageAreaEffectEntry(hitDamageId);
    if (!entry || entry.hits === undefined) return;

    const seconds = value => Math.round(value * 1e7) / 1e7;

    return {
        duration: entry.duration === undefined ? undefined : seconds(entry.duration),
        hitDelay: entry.hitDelay === undefined ? undefined : seconds(entry.hitDelay),
        hitInterval: entry.hitInterval === undefined ? undefined : seconds(entry.hitInterval),
        hits: entry.hits,
    };
}

function crc32(text) {
    let crc = 0xffffffff;

    for (let i = 0; i < text.length; i++) {
        let c = (crc ^ text.charCodeAt(i)) & 0xff;
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }

    return (crc ^ 0xffffffff) | 0;
}

let damageTagNames = null;

function getDamageTagNames() {
    if (damageTagNames) return damageTagNames;

    damageTagNames = new Map();
    const values = new Set();
    const source = getSource();

    for (const match of source.matchAll(/(\w*[dD]amageTag\w*)\s*=\s*"([^"]+)"/g)) values.add(match[2]);
    for (const match of source.matchAll(/CommonHelper\.StringToHash\("([^"]+)"\)/g)) values.add(match[1]);

    for (const value of values) {
        const hash = crc32(value);
        if (!damageTagNames.has(hash)) damageTagNames.set(hash, value);
    }

    return damageTagNames;
}

function getHitDamageTags(hitDamageId) {
    const hitDamage = HITDAMAGE[hitDamageId];
    if (!hitDamage || !hitDamage.DamageTag) return [];

    const names = getDamageTagNames();

    return hitDamage.DamageTag.map(tag => names.get(tag) || String(tag));
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
            conditions.push(`${potentialLabel(+perkId)} is active`);
        }

        GUARD_ELEMENT.lastIndex = 0;
        for (const [, code] of guard.matchAll(GUARD_ELEMENT)) {
            conditions.push(`all party members are ${ELEMENT_NAMES[code]}`);
        }

        const tag = GUARD_TAG.exec(guard);
        if (tag) {
            const value = damageTags.get(mapping.namespace)?.get(tag[1]);
            conditions.push(value ? `hit has damage tag ${value}` : 'hit has a specific damage tag');
        }

        if (GUARD_SUMMON.test(guard)) conditions.push('hit comes from your own summon');

        if (methodAt[i] === NO_DAMAGE_METHOD) conditions.push('hit deals no damage');

        const suffix = conditions.length ? ` when: ${joinConditions(conditions)}` : '';

        for (const { from, to } of mapping.entries) {
            add(to, `Replaces ${from}${suffix}`);
            add(from, `Replaced by ${to}${suffix}`);
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
        const labels = [...required].map(perkId => potentialLabel(perkId));
        if (labels.length) {
            add(id, `Conditional hit damage: only when ${joinConditions(labels)} ${labels.length === 1 ? 'is' : 'are'} active`);
        }
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
    const interactionNotes = getInteractionHitDamageNote(hitDamageId);
    if (interactionNotes.length) return interactionNotes;

    const analyzedNotes = getAnalyzerData().notes;
    if (analyzedNotes) return analyzedNotes[hitDamageId] || [];

    if (!notes) notes = parseHitDamageNotes(getSource());
    return notes[hitDamageId] || [];
}

module.exports = { getHotfixData, getHotfixHitDamage, getHiddenHitDamageIds, getHitDamageNote, getHitDamageSummonInfo, getHitDamageAreaEffectInfo, getHitDamageAreaEffectDetail, getHitDamageTags, getCharacterSummonInfo, getClassSummonInfo, getHotfixScoreBossBuffs, getHotfixJointDrillBuffs, potentialLabel };
