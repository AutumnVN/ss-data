const { existsSync, readFileSync, writeFileSync } = require('fs');

const NOTE_FILE = `${__dirname}/note.json`;
const HOTFIX_FILE = `${__dirname}/hotfix/out/Hotfix.decompiled.cs`;
const AVATAR_URL = 'https://raw.githubusercontent.com/AutumnVN/ssassets/refs/heads/main/export/assets/assetbundles/icon/datingeventcg/DatingSPCG_156302.webp';
const FIXED_COLOR = 0x66ff99;
const RETURNED_COLOR = 0xff9966;

const CHARACTER = require('./character.json');
const DISC = require('./disc.json');
const EFFECTVALUE = require('./EN/bin/EffectValue.json');
const ONCEADDITIONALATTRIBUTEVALUE = require('./EN/bin/OnceAdditionalAttributeValue.json');

function findPotential(charId, potentialId) {
    const character = CHARACTER[charId];

    for (const group of Object.values(character.potential)) {
        if (!Array.isArray(group)) continue;

        const potential = group.find(p => p.id === potentialId);
        if (potential) return potential;
    }

    throw new Error(`Potential ${potentialId} not found for character ${charId}`);
}

let hotfixSource;

function getHotfix() {
    if (hotfixSource === undefined) {
        hotfixSource = existsSync(HOTFIX_FILE)
            ? readFileSync(HOTFIX_FILE, 'utf8')
            : '';
    }
    return hotfixSource;
}

function extractMethod(source, signature) {
    const start = source.indexOf(signature);
    if (start < 0) return '';

    const open = source.indexOf('{', start);
    if (open < 0) return '';

    let depth = 0;
    let inString = false;
    let inChar = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];

        if (inLineComment) {
            if (ch === '\n') inLineComment = false;
            continue;
        }

        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (inString) {
            if (ch === '\\') {
                i++;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (inChar) {
            if (ch === '\\') {
                i++;
            } else if (ch === "'") {
                inChar = false;
            }
            continue;
        }

        if (ch === '/' && next === '/') {
            inLineComment = true;
            i++;
            continue;
        }

        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === "'") {
            inChar = true;
            continue;
        }

        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }

    return source.slice(start, start + 4000);
}

function getLevelValues(source, prefix) {
    const levels = [];
    for (let id = prefix; id < prefix + 100; id += 10) {
        const value = source[id];
        if (!value) break;
        levels.push(value);
    }
    return levels;
}

function getOnceAdditionalLevels(prefix) {
    return getLevelValues(ONCEADDITIONALATTRIBUTEVALUE, prefix);
}

const checks = [
    {
        heading: 'Tilia > Ultimate: Glorious Smite',
        check() {
            const sphere = CHARACTER['107'].ultimate.paramsTooltips[1];
            const bug = sphere.damageType.includes('from Skill')
                && (sphere.damageTag || []).includes('107_Main_Skill');

            return {
                bug,
                detail: `${sphere.damageType}; tags: ${(sphere.damageTag || []).join(', ') || 'none'}`,
            };
        },
    },
    {
        heading: 'Tilia > Perfect Spiral',
        check() {
            const spiral = findPotential('107', 510723);
            const flaw = findPotential('107', 510730);
            const spiralHit = spiral.paramsTooltips[1];
            const flawHit = flaw.paramsTooltips[2];
            const spiralBuff = spiral.buffs[0]?.id;
            const flawBuff = flaw.buffs[0]?.id;
            const bug = spiralBuff === flawBuff && spiralHit.hitDamageId === flawHit.hitDamageId;

            return {
                bug,
                detail: `hit ${spiralHit.hitDamageId} vs ${flawHit.hitDamageId}; buff ${spiralBuff} vs ${flawBuff}`,
            };
        },
    },
    {
        heading: 'Tilia > Revealed Flaw',
        check() {
            const spiral = findPotential('107', 510723);
            const flaw = findPotential('107', 510730);
            const spiralHit = spiral.paramsTooltips[1];
            const flawHit = flaw.paramsTooltips[2];
            const spiralBuff = spiral.buffs[0]?.id;
            const flawBuff = flaw.buffs[0]?.id;
            const bug = spiralBuff === flawBuff && spiralHit.hitDamageId === flawHit.hitDamageId;

            return {
                bug,
                detail: `hit ${flawHit.hitDamageId} vs ${spiralHit.hitDamageId}; buff ${flawBuff} vs ${spiralBuff}`,
            };
        },
    },
    {
        heading: 'Shimiao > Cascade Glow',
        check() {
            const potential = findPotential('113', 511307);
            const params = potential.params.slice(1, 9).map(param => param.split('/').map(parseFloat));
            const bug = params.every(levels => levels[8] < levels[7]);
            const detail = params
                .map((levels, index) => `P${index + 2}: L8 ${levels[7]}% -> L9 ${levels[8]}%`)
                .join('; ');

            return { bug, detail };
        },
    },
    {
        heading: 'Nanoha > Blossom Rhyme',
        check() {
            const levels = getOnceAdditionalLevels(11954111);
            const bug = levels.length > 0 && levels.every(value => value.ParameterType1 === 1);
            const level6 = levels[5];

            return {
                bug,
                detail: `L1 ${levels[0].Value1} type ${levels[0].ParameterType1}; L6 ${level6.Value1} type ${level6.ParameterType1}`,
            };
        },
    },
    {
        heading: 'Freesia > Doomsday Blessing',
        check() {
            const levels = getLevelValues(EFFECTVALUE, 12505011);
            const bug = levels[0].EffectTypeFirstSubtype === 1
                && levels.slice(1).every(value => value.EffectTypeFirstSubtype === 56);

            return {
                bug,
                detail: `L1 subtype ${levels[0].EffectTypeFirstSubtype}; L2 subtype ${levels[1].EffectTypeFirstSubtype}; L9 subtype ${levels[8].EffectTypeFirstSubtype}`,
            };
        },
    },
    {
        heading: "Gerie > Samsara's Judgment",
        check() {
            const mark = CHARACTER['149'].skill.paramsTooltips[5];
            const bug = !mark.damageTag || mark.damageTag.length === 0;

            return {
                bug,
                detail: `mark hit ${mark.hitDamageId}; damage tags: ${(mark.damageTag || []).join(', ') || 'none'}`,
            };
        },
    },
    {
        heading: 'Leafia > Terra DMG Etching',
        check() {
            const source = getHotfix();
            const radiusMatch = source.match(/private\s+FP\s+radius_25\s*=\s*FP\.op_Implicit\((\d+)\);/);
            const radius = radiusMatch ? Number(radiusMatch[1]) : null;
            const method = extractMethod(source, 'private void ApplyDebuffInFWBRange()');
            const usesFwb = method.includes('_fwbList') && method.includes('radius_25');
            const usesMapping = /CeHui|_ceHui|areaEffect/i.test(method);
            const bug = radius === 6 && usesFwb && !usesMapping;

            return {
                bug,
                detail: `radius_25 = ${radius}; uses _fwbList = ${usesFwb}; references Tactical Mapping = ${usesMapping}`,
            };
        },
    },
    {
        heading: 'Colors Pierce the Grey > Street Spirit',
        check() {
            const skill = DISC['214023'].secondarySkill1;
            const bug = skill.effectType.includes('Aqua DMG Taken (base)');

            return {
                bug,
                detail: skill.effectType.join(', '),
            };
        },
    },
];

function readState() {
    if (!existsSync(NOTE_FILE)) return {};
    return JSON.parse(readFileSync(NOTE_FILE, 'utf8'));
}

function writeState(notes) {
    writeFileSync(NOTE_FILE, `${JSON.stringify(notes, null, 2)}\n`);
}

function formatDiscordPayload(notifications) {
    const bugReturned = notifications.some(item => item.bug);

    return {
        username: 'stelladb',
        avatar_url: AVATAR_URL,
        embeds: [{
            title: 'stelladb',
            color: bugReturned ? RETURNED_COLOR : FIXED_COLOR,
            fields: notifications.map(item => ({
                name: `${item.bug ? 'Bug is back' : 'Bug fixed (maybe)'}: ${item.heading}`,
                value: item.detail.slice(0, 1024),
            })),
            timestamp: new Date().toISOString(),
        }],
    };
}

async function sendDiscord(payload) {
    await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

async function main() {
    const previous = readState();
    const notes = {};
    const notifications = [];

    for (const check of checks) {
        let current;

        try {
            current = check.check();
        } catch (error) {
            console.error(`ERROR    ${check.heading} - ${error.message}`);
            if (previous[check.heading] !== undefined) notes[check.heading] = previous[check.heading];
            process.exitCode = 1;
            continue;
        }

        const was = previous[check.heading];
        const bug = current.bug;

        if (was === undefined ? !bug : was !== bug) {
            notifications.push({
                heading: check.heading,
                bug,
                detail: current.detail,
            });
        }

        notes[check.heading] = bug;

        const status = bug ? 'ACTIVE' : 'FIXED';
        console.log(`${status.padEnd(8)} ${check.heading} - ${current.detail}`);
    }

    if (notifications.length) {
        const payload = formatDiscordPayload(notifications);
        console.log(JSON.stringify(payload, null, 2));
        await sendDiscord(payload);
    }

    writeState(notes);
    console.log(`Updated ${NOTE_FILE}`);
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
