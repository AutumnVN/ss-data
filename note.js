const { existsSync, readFileSync, writeFileSync } = require('fs');
const { execFileSync } = require('child_process');
const { tmpdir } = require('os');

const HIT_SOURCE_FILE = `${tmpdir()}/hitSource.json`;

if (!existsSync(HIT_SOURCE_FILE)) {
    console.error('hitSource.json is missing, running fetchHitSource.js');
    execFileSync(process.execPath, [`${__dirname}/fetchHitSource.js`], { stdio: 'inherit' });
}

const NOTE_FILE = `${__dirname}/note.json`;
const HOTFIX_FILE = `${__dirname}/hotfix/out/Hotfix.decompiled.cs`;
const AVATAR_URL = 'https://raw.githubusercontent.com/AutumnVN/ssassets/refs/heads/main/export/assets/assetbundles/icon/datingeventcg/DatingSPCG_156302.webp';
const ACTIVE_COLOR = 0x66ff99;
const INACTIVE_COLOR = 0xff9966;

const CHARACTER = require('./character.json');
const DISC = require('./disc.json');
const EFFECT = require('./EN/bin/Effect.json');
const EFFECTVALUE = require('./EN/bin/EffectValue.json');
const BUFFVALUE = require('./EN/bin/BuffValue.json');
const ONCEADDITIONALATTRIBUTEVALUE = require('./EN/bin/OnceAdditionalAttributeValue.json');
const SCRIPTPARAMETERVALUE = require('./EN/bin/ScriptParameterValue.json');
const SCRIPTPARAMETER = require('./EN/bin/ScriptParameter.json');
const HITDAMAGE = require('./EN/bin/HitDamage.json');
const SKILL = require('./EN/bin/Skill.json');
const { getHitDamageAreaEffectDetail, getBuffDetail } = require('./hotfix');

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

function crc32(text) {
    let crc = -1;
    for (const byte of Buffer.from(text)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc | 0;
}

function getOnceAdditionalLevels(prefix) {
    return getLevelValues(ONCEADDITIONALATTRIBUTEVALUE, prefix);
}

const checks = [
    {
        heading: 'Amber > Greed Gunfire',
        check() {
            const potential = findPotential('103', 510305);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._10301');
            const main = extractMethod(namespace, 'public class Parallel_B1 : Parallel');
            const onCrit = extractMethod(main, 'public override void OnCrit(AdventureActorReceiveCritDamageEvent evt)');
            const countParam = +main.match(/private int paramId_5_Count = (\d+)/)[1];
            const required = +SCRIPTPARAMETERVALUE[countParam].CommonData / 10000;
            const textCrits = +potential.params[3];
            const incrementsFirst = onCrit.indexOf('curCrit++') < onCrit.indexOf('curCrit > num');
            const active = incrementsFirst && /curCrit > num/.test(onCrit) && required === textCrits;

            return {
                active,
                text: potential.desc,
                detail: `the counter is incremented before the check (curCrit++ then curCrit > ${required}), so it triggers on the ${required + 1}th crit while the text says ${textCrits}`,
            };
        },
    },
    {
        heading: 'Amber > Overloaded Spark',
        check() {
            const potential = findPotential('103', 510342);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._10301');
            const main = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const onCastEnd = extractMethod(main, 'public virtual void OnCastEndSkill(AdventureActorCastSkillEndEvent evt)');
            const buffId = +main.match(/private int buffId_2 = (\d+)/)[1];
            const windowParam = +main.match(/private int paramId_2_time = (\d+)/)[1];
            const buff = getBuffDetail(buffId);
            const textSeconds = +potential.params[0];
            const windowSeconds = +SCRIPTPARAMETERVALUE[windowParam + 10].CommonData / 10000;
            const parameter = SCRIPTPARAMETER[windowParam];
            const active = /case HotfixEnum\.skillSlotType\.D:[\s\S]*AddBuff\(buffId_2/.test(onCastEnd)
                && parameter.levelTypeData === 1
                && parameter.LevelData === 510342
                && windowSeconds === textSeconds
                && buff.duration !== textSeconds;

            return {
                active,
                text: potential.desc,
                detail: `buff ${buffId} lasts ${buff.duration}s while the text says ${textSeconds}s, and the ${windowSeconds}s window only gates the skill cooldown cut`,
            };
        },
    },
    {
        heading: 'Tilia > Ultimate: Glorious Smite',
        check() {
            const sphere = CHARACTER['107'].ultimate.paramsTooltips[1];
            const active = sphere.damageType.includes('from Skill')
                && (sphere.damageTag || []).includes('107_Main_Skill');

            return {
                active,
                text: CHARACTER['107'].ultimate.desc,
                detail: `${sphere.damageType}; tags: ${(sphere.damageTag || []).join(', ') || 'none'}`,
            };
        },
    },
    {
        heading: 'Tilia > Aegis Blessing',
        check() {
            const potential = findPotential('107', 510708);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._10701');
            const parallel = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const onReceive = extractMethod(parallel, 'private void OnReceiveDamage(');
            const mainTag = parallel.match(/atk_skillTag = CommonHelper\.StringToHash\("([^"]+)"\)/)[1];
            const usesTag = onReceive.includes('CheckHitByTag(adventureActorReceiveDamageEvent.hitDamageTag, atk_skillTag)')
                && onReceive.includes('AddBufftoGroup(10708011');
            const sphere = CHARACTER['107'].ultimate.paramsTooltips
                .filter(tooltip => tooltip.hitDamageId)
                .find(tooltip => (tooltip.damageTag || []).includes(mainTag));
            const active = usesTag && Boolean(sphere);

            return {
                active,
                text: potential.desc,
                detail: `the buff rolls on hits tagged ${mainTag}; the ultimate sphere ${sphere ? 'has' : 'lacks'} that tag`,
            };
        },
    },
    {
        heading: 'Tilia > Holy Inscription',
        check() {
            const potential = findPotential('107', 510721);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._10701');
            const onShieldHit = extractMethod(namespace, 'protected void OnShieldHit(IEvent evt)');
            const onePerEnemy = onShieldHit.includes('!dicArea_p21.ContainsKey(monsterAdventureActor.Id)')
                && onShieldHit.includes('dicArea_p21.Add(monsterAdventureActor.Id');
            const noCap = !/dicArea_p21\.Count/.test(onShieldHit);
            const textCap = +potential.desc.match(/up to (\d+) Lux spheres/)[1];
            const active = onePerEnemy && noCap && textCap === 4;

            return {
                active,
                text: potential.desc,
                detail: `spheres are tracked per enemy id (${onePerEnemy}) with no count cap (${noCap}); text caps them at ${textCap}`,
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
            const active = spiralBuff === flawBuff && spiralHit.hitDamageId === flawHit.hitDamageId;

            return {
                active,
                text: spiral.desc,
                detail: `hit ${spiralHit.hitDamageId} vs ${flawHit.hitDamageId}; buff ${spiralBuff} vs ${flawBuff}`,
            };
        },
    },
    {
        heading: "Tilia > Knight's Seal",
        check() {
            const potential = findPotential('107', 510727);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._10701');
            const onMark = extractMethod(namespace, 'private void OnElementMarkTrigger(IEvent evt)');
            const cooldown = +SCRIPTPARAMETERVALUE['10727012'].CommonData / 10000;
            const usesCooldown = onMark.includes('GetPerk(perk_27, CommonUtils.GetScriptValue(_actor, 10727012))');
            const active = usesCooldown && cooldown > 0 && !potential.desc.includes('once every');

            return {
                active,
                text: potential.desc,
                detail: `the mark trigger is gated by spv 10727012 = ${cooldown}s, and the text has no cooldown`,
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
            const active = spiralBuff === flawBuff && spiralHit.hitDamageId === flawHit.hitDamageId;

            return {
                active,
                text: flaw.desc,
                detail: `hit ${flawHit.hitDamageId} vs ${spiralHit.hitDamageId}; buff ${flawBuff} vs ${spiralBuff}`,
            };
        },
    },
    {
        heading: 'Kasimira > Heated Battle',
        check() {
            const potential = findPotential('108', 510821);
            const hit = potential.paramsTooltips[0];
            const area = getHitDamageAreaEffectDetail(hit.hitDamageId);
            const interval = +potential.desc.match(/every <color=[^>]+>([\d.]+)<\/color>s/)[1];
            const duration = +potential.desc.match(/total of ([\d.]+)s/)[1];
            const active = interval === 0.5 && area.hitInterval === 1
                && area.duration === duration && area.hits === 7;

            return {
                active,
                text: potential.desc,
                detail: `the crater hits every ${area.hitInterval}s for ${area.hits} hits over ${area.duration}s, and the text says every ${interval}s for ${duration}s`,
            };
        },
    },
    {
        heading: 'Kasimira > Gradual Heat-Up',
        check() {
            const potential = findPotential('108', 510831);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._10801');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onSelfAttacked = extractMethod(support, 'protected override void OnSelfAttacked(AdventureActorReceiveAttackEvent attackEvent)');
            const cooldown = +support.match(/private readonly FP cd_31 = FP\.op_Implicit\(([\d.]+)\)/)[1];
            const gated = onSelfAttacked.includes('_lastTriggerTime_31')
                && onSelfAttacked.includes('_actor.LogicTime - _lastTriggerTime_31 > cd_31')
                && onSelfAttacked.includes('AddBuff(1011');
            const active = gated && cooldown === 1 && !potential.desc.includes('cooldown');

            return {
                active,
                text: potential.desc,
                detail: `the ignis mark from ultimate dmg is gated by ${cooldown}s since the last infliction (${gated}), and the text has no cooldown`,
            };
        },
    },
    {
        heading: 'Firenze > High Risk',
        check() {
            const potential = findPotential('110', 511005);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11001');
            const parallel = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const onEnable = extractMethod(parallel, 'public override void OnEnable(');
            const onReceive = extractMethod(parallel, 'private void OnReceiveDamage(');
            const squadBonus = onEnable.includes('de_All = true') && onEnable.includes('de_All = false');
            const usesSquad = onReceive.includes('de_All ?');
            const usesBothChances = onReceive.includes('11005012') && onReceive.includes('11005011');
            const chances = [SCRIPTPARAMETERVALUE['11005011'].CommonData, SCRIPTPARAMETERVALUE['11005012'].CommonData].map(value => `${value / 10000}%`);
            const checksBurn = onReceive.includes('11090000');
            const textBurn = potential.desc.includes('Umbra Burn');
            const active = squadBonus && usesSquad && usesBothChances && !checksBurn && textBurn;

            return {
                active,
                text: potential.desc,
                detail: `the boosted chance uses de_All (whole squad Umbra) = ${usesSquad}; chances 11005011/11005012 = ${chances.join(' / ')}; the target's Dark Burn buff 11090000 is never checked = ${!checksBurn}; text says ${potential.params[1]} -> ${potential.params[2]} vs Umbra Burn = ${textBurn}`,
            };
        },
    },
    {
        heading: 'Iris > Vector: Shatter',
        check() {
            const potential = findPotential('111', 511102);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11101');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onBulletBorn = extractMethod(main, 'private void OnBulletBorn(IEvent evt)');
            const onBulletFinish = extractMethod(main, 'private void OnBulletFinish(IEvent evt)');
            const onHitPre = extractMethod(main, 'public override void OnHitPre(');
            const cooldown = +main.match(/interval_2 = FP\.op_Implicit\((\d+)\)/)[1];
            const gatePerBullet = onBulletBorn.includes('hit_2 = true')
                && onBulletFinish.includes('hit_2 = false')
                && onHitPre.includes('GetPerkLv(511102') && onHitPre.includes('hit_2');
            const gatePerHit = onHitPre.includes('CheckCd(511102');
            const bothHits = onHitPre.includes('aoe_2_small') && onHitPre.includes('aoe_2_big');
            const pierces = CHARACTER['111'].skill.paramsTooltips
                .some(tooltip => (tooltip.hitSources || []).some(source => source.includes('pierce')));
            const active = gatePerBullet && !gatePerHit && bothHits && pierces && cooldown === 12;

            return {
                active,
                text: potential.desc,
                detail: `the ${cooldown}s gate is set once when the greatarrow is born and cleared when it finishes (${gatePerBullet}), there is no per-hit cooldown (${gatePerHit}), both extra aoe dmg hits are behind the same gate (${bothHits}), and the greatarrow pierces (${pierces})`,
            };
        },
    },
    {
        heading: 'Iris > Oops I Did It Again',
        check() {
            const potential = findPotential('111', 511105);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11101');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onBeforeHit = extractMethod(main, 'public override void OnBeforeHit(');
            const levels = getOnceAdditionalLevels(11150511);
            const attr = levels[0].AttributeType1;
            const meleeHasNormal = (HITDAMAGE['111100005'].DamageTag || []).includes(crc32('Normal'));
            const onNormal = onBeforeHit.includes('bool num = CommonUtils.CheckHitByTag(evt.hitDamageTag, hitTag_Normal)')
                && onBeforeHit.includes('if (GetPerkLv(511105')
                && onBeforeHit.includes('AddFromAttr(11150501');
            const active = onNormal && attr === 56 && meleeHasNormal;

            return {
                active,
                text: potential.desc,
                detail: `the ${levels[0].Value1 / 100}% auto attack dmg bonus is applied to every hit tagged Normal (${onNormal}), and the school bag melee hit 111100005 also has that tag (${meleeHasNormal})`,
            };
        },
    },
    {
        heading: 'Iris > Cold Snap',
        check() {
            const potential = findPotential('111', 511110);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11101');
            const parallel = extractMethod(namespace, 'public class ParallelScript : ParallelBase');
            const triggerMask = extractMethod(parallel, 'public virtual bool TriggerMask(');
            const cooldown = +SCRIPTPARAMETERVALUE['11151011'].CommonData / 10000;
            const buff = BUFFVALUE['11151011'].Time / 10000;
            const noGate = triggerMask.includes('GetPerkLv(511110')
                && !triggerMask.includes('CheckCd(511110');
            const reducesCd = triggerMask.includes('ModifyResumeTimeAbs(-CommonUtils.GetScriptValue(_actor, 11151011)');
            const active = noGate && reducesCd && cooldown === 1 && buff === 6;

            return {
                active,
                text: potential.desc,
                detail: `the chill to frozen branch has no 12s CheckCd (${noGate}), so every conversion cuts the main skill cooldown by ${cooldown}s and refreshes the ${buff}s buff`,
            };
        },
    },
    {
        heading: 'Iris > Keep Strangers at Bay',
        check() {
            const potential = findPotential('111', 511111);
            const parameter = SCRIPTPARAMETER['11151101'];
            const levelCount = potential.params[0].split('/').length;
            const cooldowns = Array.from({ length: levelCount }, (_, index) =>
                +SCRIPTPARAMETERVALUE[11151101 + (index + 1) * 10].CommonData / 10000);
            const levelScaled = parameter.levelTypeData === 1 && parameter.LevelData === 511111;
            const active = levelScaled
                && cooldowns[0] === 12
                && cooldowns[levelCount - 1] === 8
                && potential.params[2] === cooldowns[0];

            return {
                active,
                text: potential.desc,
                detail: `the cooldown resolves through ScriptParameter 11151101 at perk level, so it goes ${cooldowns.join('s, ')}s over levels 1-${levelCount}, while text Param3 is fixed at the level 1 value of ${potential.params[2]}s`,
            };
        },
    },
    {
        heading: 'Iris > Prolonged Winter',
        check() {
            const potential = findPotential('111', 511126);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11101');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onBeforeHit = extractMethod(support, 'public override void OnBeforeHit(');
            const triggerTag = support.match(/hitTag_6 = CommonHelper\.StringToHash\("([^"]+)"\)/)[1];
            const usesTag = onBeforeHit.includes('hitTag_6')
                && onBeforeHit.includes('AddFromAttr(11152601');
            const hits = CHARACTER['111'].supportSkill.paramsTooltips.filter(hit => hit.hitDamageId);
            const tagged = hits.filter(hit => (HITDAMAGE[hit.hitDamageId].DamageTag || []).includes(crc32(triggerTag)));
            const active = usesTag && tagged.length === 0;

            return {
                active,
                text: potential.desc,
                detail: `the skill dmg bonus only checks hits tagged ${triggerTag} (${crc32(triggerTag)}), and ${tagged.length}/${hits.length} glacier array hits have that tag`,
            };
        },
    },
    {
        heading: 'Iris > Gleaming Snow',
        check() {
            const potential = findPotential('111', 511142);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11101');
            const parallel = extractMethod(namespace, 'public class ParallelScript : ParallelBase');
            const onHitPost = extractMethod(parallel, 'public virtual void OnHitPost(');
            const onAreaEffectFinish = extractMethod(parallel, 'public virtual void OnAreaEffectFinish(');
            const cap = +parallel.match(/maxCount_2 = (\d+)/)[1];
            const countsAnyKill = onHitPost.includes('GetPerkLv(511142')
                && onHitPost.includes('evt.isKill')
                && onHitPost.includes('curCount_2++');
            const noAreaCheck = !onHitPost.includes('areaEntity_A');
            const resetOnFinish = onAreaEffectFinish.includes('curCount_2 = 0')
                && onAreaEffectFinish.includes('areaEntity_A');
            const active = countsAnyKill && noAreaCheck && resetOnFinish && cap === 10;

            return {
                active,
                text: potential.desc,
                detail: `kills are counted on any hit while the pot is active (${countsAnyKill}) with no ultimate area check (${noAreaCheck}), and the counter is only reset when the ultimate area finishes (${resetOnFinish}), up to ${cap} stacks`,
            };
        },
    },
    {
        heading: 'Noya > Wind Glaive',
        check() {
            const potential = findPotential('112', 511226);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11201');
            const parallel = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const onBeforeHit = extractMethod(parallel, 'private void OnBeforeHit(');
            const perk = extractMethod(onBeforeHit, 'if (GetPerk(personalPerkId_26))');
            const sibling = extractMethod(onBeforeHit, 'if (GetPerk(personalPerkId_27) &&');
            const noTagCheck = perk.includes('AdventureActor.AddFromAttr(11252601')
                && !perk.includes('CheckHitByTag');
            const siblingChecksTag = sibling.includes('daFenrHitTag');
            const active = noTagCheck && siblingChecksTag;

            return {
                active,
                text: potential.desc,
                detail: `the perk adds once attribute 11252601 on every hit with no HeavyWBlade tag check (${noTagCheck}), while the next major sword aura pot checks daFenrHitTag (${siblingChecksTag})`,
            };
        },
    },
    {
        heading: 'Noya > Leaf Barrier',
        check() {
            const potential = findPotential('112', 511227);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11201');
            const parallel = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const onReceiveDamage = extractMethod(parallel, 'private void OnReceiveDamage(');
            const perk = extractMethod(onReceiveDamage, 'if (GetPerk(personalPerkId_27) &&');
            const cd = +parallel.match(/cd_27 = FP\.op_Implicit\(([\d.]+)\)/)[1];
            const hits = +parallel.match(/hitCount_27 = (\d+)/)[1];
            const slow = EFFECTVALUE[11252711];
            const comparesBeforeIncrease = perk.indexOf('perk27_Dic.Add(monsterAdventureActor2.Id, 1)')
                < perk.indexOf('if (value >= hitCount_27)');
            const isSlow = slow.EffectTypeFirstSubtype === 46 && slow.EffectTypeParam1.startsWith('-');
            const active = cd === 0 && hits === 1 && comparesBeforeIncrease && isSlow;

            return {
                active,
                text: potential.desc,
                detail: `cd_27 is ${cd}s and hitCount_27 is ${hits}, so the per-target counter is reset on every hit and always compared at 0, meaning the movement spd buff (${isSlow}) is never added`,
            };
        },
    },
    {
        heading: 'Noya > Cyclone Blades',
        check() {
            const potential = findPotential('112', 511231);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11201');
            const parallel = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const onElementMarkTrigger = extractMethod(parallel, 'private void OnElementMarkTrigger(');
            const perk = extractMethod(onElementMarkTrigger, 'if (GetPerk(personalPerkId_31))');
            const talentChecksTrigger = onElementMarkTrigger.includes('triggerActor.Id == _actor.Id');
            const addsBuff = perk.includes('AddBuff(buff_31, _actor)');
            const active = talentChecksTrigger && addsBuff && !perk.includes('triggerActor');

            return {
                active,
                text: potential.desc,
                detail: `the talent block checks triggerActor.Id == _actor.Id (${talentChecksTrigger}) but the perk block just adds buff_31 (${addsBuff}), so any actor's WindMark1 trigger grants the atk buff`,
            };
        },
    },
    {
        heading: 'Shimiao > Cascade Glow',
        check() {
            const potential = findPotential('113', 511307);
            const params = potential.params.slice(1, 9).map(param => param.split('/').map(parseFloat));
            const active = params.every(levels => levels[8] < levels[7]);
            const detail = params
                .map((levels, index) => `P${index + 2}: L8 ${levels[7]}% -> L9 ${levels[8]}%`)
                .join('; ');

            return { active, text: potential.desc, detail };
        },
    },
    {
        heading: 'Shimiao > Rain Whisper: Light',
        check() {
            const potential = findPotential('113', 511324);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11301');
            const normalAttack = extractMethod(namespace, 'public class SkillScript_Support_NormalAttack');
            const interval = +normalAttack.match(/cd_24 = FP\.op_Implicit\(([\d.]+)\)/)[1];
            const textInterval = +potential.desc.match(/every ([\d.]+)s/)[1];
            const active = interval < textInterval && normalAttack.includes('GetPerkLv(511324');

            return {
                active,
                text: potential.desc,
                detail: `the bonus is applied on the next shot after cd_24 = ${interval}s, while the text says every ${textInterval}s`,
            };
        },
    },
    {
        heading: 'Shimiao > Full Preparation',
        check() {
            const potential = findPotential('113', 511326);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11301');
            const parallel = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const required = +parallel.match(/count_26 = (\d+)/)[1];
            const textTargets = +potential.desc.match(/(\d+) or more/)[1];
            const active = required !== textTargets;

            return {
                active,
                text: potential.desc,
                detail: `the slowed-target check needs ${required} slowed targets, the text says ${textTargets} or more`,
            };
        },
    },
    {
        heading: 'Shimiao > Wave Rider',
        check() {
            const potential = findPotential('113', 511342);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11301');
            const parallel = extractMethod(namespace, 'public class ParallelScript : ParallelBase');
            const dict = extractMethod(parallel, 'private Dictionary<int, int> dicOnce_42');
            const topBracket = +dict.match(/\[0\] = (\d+)/)[1];
            const brackets = Array.from({ length: 9 }, (_, index) => ONCEADDITIONALATTRIBUTEVALUE[11342011 + index].Value1 / 100);
            const active = topBracket === 0 && !potential.params[0].startsWith('0%');

            return {
                active,
                text: potential.desc,
                detail: `dicOnce_42 maps the hp bracket above 90% to ${topBracket}, so nothing is added there, while brackets 1-9 give ${brackets.join('%/')}% and text Param1 is ${potential.params[0]}`,
            };
        },
    },
    {
        heading: 'Chaton > Efficient Use',
        check() {
            const potential = findPotential('114', 511406);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11401');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onCustomEvent = extractMethod(main, 'public override void OnCustomEvent(');
            const addsBuff = /if \(evt\.intParam == 1\)[\s\S]*?AddBuff\(buff_6_dmg/.test(onCustomEvent);
            const spanIndex = onCustomEvent.indexOf('CheckBuffByBuffID(buff_6)');
            const bombNeedsSpark = spanIndex >= 0 && spanIndex < onCustomEvent.indexOf('buff_6_dmg');
            const duration = BUFFVALUE['11406012'].Time / 10000;
            const active = addsBuff && bombNeedsSpark && duration === +potential.params[3];

            return {
                active,
                text: potential.desc,
                detail: `the skill crit dmg buff 11406012 is added on every hold event = ${addsBuff}; the explosive bomb is the only part that needs the spark buff 11406011 = ${bombNeedsSpark}; buff lasts ${duration}s (text Param4 ${potential.params[3]}s)`,
            };
        },
    },
    {
        heading: 'Chaton > Energy Overflow',
        check() {
            const potential = findPotential('114', 511431);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11401');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const energyChange = extractMethod(support, 'private void OnActorEnergyChange(');
            const castEnd = extractMethod(support, 'public override void OnCastEndSkill(');
            const addsAtFull = energyChange.includes('currentEnergy >= adventureActorEnergyChangeEvent.totalEnergy')
                && energyChange.includes('AddBuff(buff_31');
            const removesOnSkillCast = castEnd.includes('skillSlotType.B')
                && castEnd.includes('RemoveBuffByBuffId(buff_31)');
            const duration = BUFFVALUE['11431011'].Time / 10000;
            const active = addsAtFull && removesOnSkillCast && duration === +potential.params[2];

            return {
                active,
                text: potential.desc,
                detail: `buff 11431011 lasts ${duration}s (text Param3 ${potential.params[2]}s) and is added only on the energy change event at full energy = ${addsAtFull}, but removed at the end of every support skill cast = ${removesOnSkillCast}`,
            };
        },
    },
    {
        heading: 'Firefly > Flash Resonance',
        check() {
            const potential = findPotential('115', 511510);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11501');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onSelfDamaged = extractMethod(main, 'protected override void OnSelfDamaged(');
            const onCastSkill = extractMethod(main, 'protected override void OnSelfCastSkill(');
            const perMonster = onSelfDamaged.includes('_triggerSet_P10.Add(monster.Id)')
                && onSelfDamaged.includes('if (!_triggerSet_P10.Add(monster.Id))');
            const clearsOnMain = onCastSkill.includes('skillSlotType.B')
                && onCastSkill.includes('_triggerSet_P10?.Clear()');
            const stacks = BUFFVALUE['11510011'].LaminatedNum;
            const textStacks = +potential.params[2];
            const active = perMonster && clearsOnMain && stacks === textStacks;

            return {
                active,
                text: potential.desc,
                detail: `only the first 115_Main_Laser hit per monster grants a stack = ${perMonster}; the set is cleared only on slot B cast = ${clearsOnMain}; buff 11510011 stacks up to ${stacks} (text Param3 ${textStacks})`,
            };
        },
    },
    {
        heading: 'Firefly > Lightforged Blade',
        check() {
            const potential = findPotential('115', 511525);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11501');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onBeforeHit = extractMethod(support, 'protected override void OnBeforeSelfHit(');
            const action = extractMethod(namespace, 'public class ActionScript_Support : ActionScript');
            const onCastSkill = extractMethod(action, 'protected override void OnCastSkill(');
            const glowValues = getOnceAdditionalLevels(11525011);
            const haloValues = getOnceAdditionalLevels(11525012);
            const glowAttr = glowValues[0].AttributeType1;
            const haloAttr = haloValues[0].AttributeType1;
            const glowBonus = +glowValues[0].Value1 / 100;
            const haloBonus = +haloValues[0].Value1 / 100;
            const textGlow = potential.params[2];
            const textHalo = potential.params[5];
            const converts = onCastSkill.includes('AddBuffNum(11525013')
                && onCastSkill.includes('RemoveBuffByBuffId(11525011)')
                && onCastSkill.includes('AddBuffNum(11525015')
                && onCastSkill.includes('RemoveBuffByBuffId(11525014)');
            const wiring = /GetBuffNumByID\(11525013\)[\s\S]*?AddFromAttr\(11525001/.test(onBeforeHit)
                && /GetBuffNumByID\(11525015\)[\s\S]*?AddFromAttr\(11525002/.test(onBeforeHit);
            const active = converts && wiring
                && glowAttr === 57 && haloAttr === 71
                && textGlow === 'Skill Crit Rate' && textHalo === 'Skill DMG';

            return {
                active,
                text: potential.desc,
                detail: `glow stacks (11525013) give attr ${glowAttr} = ${glowBonus}% per stack; halo stacks (11525015) give attr ${haloAttr} = ${haloBonus}% per stack; text says glow gives ${textGlow} and halo gives ${textHalo}`,
            };
        },
    },
    {
        heading: 'Ridge > Hardened Cone',
        check() {
            const potential = findPotential('116', 511609);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11601');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onBeforeSelfHit = extractMethod(main, 'protected override void OnBeforeSelfHit(');
            const triggerTag = namespace.match(/damageTag_Trigger_P9 = CommonHelper\.StringToHash\("([^"]+)"\)/)[1];
            const usesTag = onBeforeSelfHit.includes('damageTag_Trigger_P9')
                && onBeforeSelfHit.includes('AddFromAttr(11609001');
            const hits = CHARACTER['116'].normalAtk.paramsTooltips.filter(hit => hit.hitDamageId);
            const tagged = hits.filter(hit => (HITDAMAGE[hit.hitDamageId].DamageTag || []).includes(crc32(triggerTag)));
            const active = usesTag && tagged.length === 0 && potential.params[3].startsWith('30%');

            return {
                active,
                text: potential.desc,
                detail: `the resilience break efficiency bonus only checks hits tagged ${triggerTag} (${crc32(triggerTag)}), and ${tagged.length}/${hits.length} auto attack hits have that tag`,
            };
        },
    },
    {
        heading: 'Ridge > Power Slide',
        check() {
            const potential = findPotential('116', 511611);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11601');
            const dodge = extractMethod(namespace, 'public class SkillScript_Dodge : SkillAdvancedBase');
            const onEnable = extractMethod(dodge, 'protected override void OnSkillEnable()');
            const cooldown = +SCRIPTPARAMETERVALUE['11611011'].CommonData / 10000;
            const gated = onEnable.includes('LastTriggerTime_P11')
                && onEnable.includes('GetScriptValue(_actor, 11611011)')
                && onEnable.includes('AddBuff(11611011');
            const active = gated && cooldown === 8 && !potential.desc.includes('cooldown');

            return {
                active,
                text: potential.desc,
                detail: `the buff is only re-applied when 11611011 = ${cooldown}s have passed since the last trigger, and the text has no cooldown`,
            };
        },
    },
    {
        heading: 'Ridge > Hasty Growth',
        check() {
            const potential = findPotential('116', 511623);
            const base = BUFFVALUE['11691011'].Time / 10000;
            const upgraded = BUFFVALUE['11623011'].Time / 10000;
            const active = base === 3 && upgraded === base * 2 && potential.desc.includes('50%');

            return {
                active,
                text: potential.desc,
                detail: `the seed orb buff lasts ${base}s normally and ${upgraded}s with the pot, a ${(upgraded / base - 1) * 100}% increase, and the text says 50%`,
            };
        },
    },
    {
        heading: 'Ridge > Needle Seed',
        check() {
            const potential = findPotential('116', 511625);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11601');
            const support = extractMethod(namespace, 'public class SkillScript_Skill_Support : SkillAdvancedBase');
            const onEnable = extractMethod(support, 'protected override void OnSkillEnable()');
            const onDisable = extractMethod(support, 'protected override void OnSkillDisable()');
            const clearsOnCast = onEnable.includes('RemoveBuffByBuffId(11625011)');
            const clearsOnEnd = onDisable.includes('11625011');
            const duration = BUFFVALUE['11625011'].Time / 10000;
            const active = clearsOnCast && !clearsOnEnd && duration === 10 && potential.desc.includes('skill ends');

            return {
                active,
                text: potential.desc,
                detail: `buff 11625011 is only removed when the next support skill starts (${clearsOnCast}) and not when the skill ends (${clearsOnEnd}); it lasts ${duration}s after the last stack`,
            };
        },
    },
    {
        heading: 'Ridge > Cone Bomb',
        check() {
            const potential = findPotential('116', 511630);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11601');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const explosion = extractMethod(support, 'private bool TriggerSeedExplosion(');
            const config = extractMethod(namespace, 'public class Config_Support');
            const radius = +config.match(/searchRadius_P30 = FP\.op_Implicit\((\d+)\)/)[1];
            const picksRandom = explosion.includes('list[TSRandom.Range(0, list.Count)]');
            const searchesRange = explosion.includes('SearchByRangeAndPosition');
            const active = picksRandom && searchesRange && potential.desc.includes('nearest target');

            return {
                active,
                text: potential.desc,
                detail: `the extra seed picks a random entity within ${radius}m (${picksRandom}) instead of the nearest one (${searchesRange})`,
            };
        },
    },
    {
        heading: 'Jinglin > Energy Storage: Bind',
        check() {
            const potential = findPotential('117', 511701);
            const value = EFFECTVALUE['11701011'];
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11701');
            const parallel = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const cdAmend = extractMethod(getHotfix(), 'public class SkillCDMaxAmend : AdventureEffectBase');
            const addsBuff = parallel.includes('AddBuff(buff_p1, _actor)');
            const allSlots = cdAmend.includes('slots.Add(ActionKey.A)')
                && cdAmend.includes('slots.Add(ActionKey.B)')
                && cdAmend.includes('slots.Add(ActionKey.D)');
            const active = addsBuff
                && value.EffectType === 3
                && value.EffectTypeFirstSubtype === 5
                && +value.EffectTypeParam1 === -2
                && allSlots
                && potential.desc.includes('(Main Skill)');

            return {
                active,
                text: potential.desc,
                detail: `buff 11701011 applies effect value 11701011 = ${value.EffectTypeParam1}s with slot group ${value.EffectTypeFirstSubtype}, which amends the dodge, skill and ultimate cooldowns = ${allSlots}; the text only names the main skill`,
            };
        },
    },
    {
        heading: 'Jinglin > Energy Storage: Knot',
        check() {
            const potential = findPotential('117', 511702);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11701');
            const parallel = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const onBeforeHit = extractMethod(parallel, 'protected virtual void OnBeforeHit(');
            const mainSkill = extractMethod(namespace, 'public class SkillScript_MainControl_Skill : SkillAdvancedBase');
            const perStack = +getOnceAdditionalLevels(11702011)[0].Value1 / 100;
            const cycle = +onBeforeHit.match(/\(mainSkill_index - 1\) % (\d+)/)[1];
            const countsShots = mainSkill.includes('Parallel.mainSkill_index++');
            const textStacks = +potential.desc.match(/up to (\d+) stacks/)[1];
            const active = countsShots && cycle === 4 && perStack === 32 && textStacks === 3;

            return {
                active,
                text: potential.desc,
                detail: `the multiplier is ${perStack}% x ((mainSkill_index - 1) % ${cycle} + 1), so it cycles 1..${cycle} stacks = up to ${perStack * cycle}% per shot, and nothing clears it at ${textStacks} stacks; the text caps it at ${textStacks}`,
            };
        },
    },
    {
        heading: 'Jinglin > Thunderbolt: Character',
        check() {
            const potential = findPotential('117', 511723);
            const stun = BUFFVALUE['11723011'];
            const seconds = stun.Time / 10000;
            const textSeconds = +potential.desc.match(/them for (\d+)s/)[1];
            const active = potential.buffs[0].id === 11723011 && seconds === 2 && textSeconds === 1;

            return {
                active,
                text: potential.desc,
                detail: `buff 11723011 (the stun) lasts ${seconds}s, and the text says ${textSeconds}s`,
            };
        },
    },
    {
        heading: 'Coronis > Spiritual Tome',
        check() {
            const potential = findPotential('118', 511825);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11801');
            const support = extractMethod(namespace, 'public class SkillScript_Support : SkillAdvancedBase');
            const onReceiveDamage = extractMethod(support, 'private new void OnReceiveDamage(');
            const onPhase2Finish = extractMethod(support, 'private void OnPhase2Finish(');
            const countsPerHit = onReceiveDamage.includes('_hitTag_1_hitCount++');
            const needsExactlyOne = onPhase2Finish.includes('_hitTag_1_hitCount == 1');
            const active = countsPerHit && needsExactlyOne;

            return {
                active,
                text: potential.desc,
                detail: `_hitTag_1_hitCount is incremented once per 118_Sup_HengZhan_Hit_1 damage event = ${countsPerHit}, but the second sweep is only started when the count is exactly 1 = ${needsExactlyOne}`,
            };
        },
    },
    {
        heading: 'Nanoha > Growth Tempest',
        check() {
            const potential = findPotential('119', 511901);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11901');
            const base = extractMethod(namespace, 'public class ParallelScript : ParallelBase');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const hitTag = base.match(/hitTag_Normal = CommonHelper\.StringToHash\("([^"]+)"\)/)[1];
            const hits = CHARACTER['119'].normalAtk.paramsTooltips.filter(hit => hit.hitDamageId);
            const taggedHits = hits.filter(hit => (HITDAMAGE[hit.hitDamageId].DamageTag || []).includes(crc32(hitTag)));
            const count = +main.match(/private int count_1 = (\d+);/)[1];
            const textCount = +potential.desc.match(/Auto Attacks <color=[^>]+>(\d+)<\/color>/)[1];
            const active = count !== textCount && taggedHits.length === hits.length;

            return {
                active,
                text: potential.desc,
                detail: `aoe needs ${count} ${hitTag} hits on one target; text says ${textCount}; auto attack hits with the tag = ${taggedHits.length}/${hits.length}`,
            };
        },
    },
    {
        heading: 'Nanoha > Sun Chaser',
        check() {
            const potential = findPotential('119', 511907);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11901');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onCrit = extractMethod(main, 'public override void OnCrit(');
            const onBeforeHit = extractMethod(main, 'public override void OnBeforeHit(');
            const onHitPost = extractMethod(main, 'public override void OnHitPost(');
            const buff = '11950711';
            const addedOnCrit = onCrit.includes(`AddBuff(${buff}`);
            const addedOnHit = onBeforeHit.includes(buff) || onHitPost.includes(buff);
            const saysAnyDamage = potential.desc.startsWith('When Nanoha deals DMG');
            const active = addedOnCrit && !addedOnHit && saysAnyDamage;

            return {
                active,
                text: potential.desc,
                detail: `buff ${buff} added only in OnCrit = ${addedOnCrit}; added on normal hit paths = ${addedOnHit}; text says any dmg = ${saysAnyDamage}`,
            };
        },
    },
    {
        heading: 'Nanoha > Splendid Vortex',
        check() {
            const potential = findPotential('119', 511909);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11901');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onHitPost = extractMethod(main, 'public override void OnHitPost(');
            const onElementMarkTrigger = extractMethod(main, 'private void OnElementMarkTrigger(');
            const checksTagAndMark = onHitPost.includes('CheckHitByTag(evt.hitDamageTag, windHitTag)')
                && onHitPost.includes('CheckElementMark(CommonDefine.Wind, monster)')
                && onHitPost.includes('AddBuff(11950911');
            const usesTriggerEvent = onElementMarkTrigger.includes('11950911');
            const stacks = BUFFVALUE['11950911'].LaminatedNum;
            const active = checksTagAndMark && !usesTriggerEvent && stacks === +potential.params[2];

            return {
                active,
                text: potential.desc,
                detail: `the stack needs a windHitTag hit on a target that already has a ventus mark = ${checksTagAndMark}; wired to the real mark trigger event = ${usesTriggerEvent}; buff stacks up to ${stacks} (text Param3 ${potential.params[2]})`,
            };
        },
    },
    {
        heading: 'Nanoha > Blooming Flowers',
        check() {
            const potential = findPotential('119', 511912);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11901');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const handler = extractMethod(main, 'private void OnElementMarkTrigger(');
            const checksActor = /triggerActor|fromActor/.test(handler);
            const stacks = BUFFVALUE['11951211'].LaminatedNum;
            const active = handler.includes('elementType.AE') && handler.includes('AddBuff(11951211')
                && !checksActor && stacks === +potential.params[3];

            return {
                active,
                text: potential.desc,
                detail: `any AE mark event adds 11951211; checks the triggering actor = ${checksActor}; buff stacks up to ${stacks} (text Param4 ${potential.params[3]})`,
            };
        },
    },
    {
        heading: 'Nanoha > Unfulfilled Enthusiasm',
        check() {
            const potential = findPotential('119', 511924);
            const buff = BUFFVALUE['11952411'];
            const textStacks = +potential.desc.match(/stacking up to <color=[^>]+>(\d+)<\/color>/)[1];
            const detonation = ONCEADDITIONALATTRIBUTEVALUE['11924001'];
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._11901');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onceId = +support.match(/private int once_24 = (\d+);/)[1];
            const scaledByStacks = support.includes('AddFromAttr(once_24, _actor, buffNumByID2)');
            const active = buff.LaminatedNum !== textStacks && onceId === 11924001 && scaledByStacks;

            return {
                active,
                text: potential.desc,
                detail: `buff 11952411 stacks up to ${buff.LaminatedNum}; text says ${textStacks}; detonation adds ${detonation.Value1 / 100}% skill dmg per stack = ${scaledByStacks}`,
            };
        },
    },
    {
        heading: 'Nanoha > Blossom Rhyme',
        check() {
            const potential = findPotential('119', 511941);
            const levels = getOnceAdditionalLevels(11954111);
            const active = levels.length > 0 && levels.every(value => value.ParameterType1 === 1);
            const level6 = levels[5];

            return {
                active,
                text: potential.desc,
                detail: `L1 ${levels[0].Value1} type ${levels[0].ParameterType1}; L6 ${level6.Value1} type ${level6.ParameterType1}`,
            };
        },
    },
    {
        heading: 'Nanoha > Rejuvenating Spring',
        check() {
            const talent = CHARACTER['119'].talent
                .find(entry => entry.name === 'Rejuvenating Spring').boost[0];
            const main = extractMethod(getHotfix(), 'namespace AIScript.Character._11901');
            const base = extractMethod(main, 'public class ParallelScript : ParallelBase');
            const mainTrigger = extractMethod(base, 'public void TriggerWindMark(AdventureActor target)');
            const clone = extractMethod(getHotfix(), 'namespace AIScript.Monster._11901111Hanahara');
            const cloneTrigger = extractMethod(clone, 'public void TriggerWindMark(AdventureActor target)');
            const ultHits = CHARACTER['119'].ultimate.paramsTooltips
                .filter(hit => (hit.damageTag || []).includes('WindTag1Boom'));
            const addsInMain = mainTrigger.includes('CheckTalentLevel(2)')
                && mainTrigger.includes('AddBuff(buffId_F2');
            const cloneTriggersMark = cloneTrigger.includes('CheckTriggerElementMarkCD(summoner')
                && cloneTrigger.includes('TriggerElementMarkEvent') && cloneTrigger.includes('summoner');
            const active = talent.buffs[0].id === 11996211 && addsInMain && cloneTriggersMark
                && !cloneTrigger.includes('AddBuff') && ultHits.length > 0;

            return {
                active,
                text: talent.desc,
                detail: `talent buff 11996211 added in the main TriggerWindMark = ${addsInMain}; the clone TriggerWindMark dispatches the mark event as nanoha = ${cloneTriggersMark} but adds the buff = ${cloneTrigger.includes('AddBuff')}; ult hits tagged WindTag1Boom = ${ultHits.length}`,
            };
        },
    },
    {
        heading: 'Canace > Erratic Weather',
        check() {
            const potential = findPotential('120', 512003);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._12001');
            const parallel = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const onWeaponBorn = extractMethod(parallel, 'protected void OnWeaponBorn(IEvent evt)');
            const roll = +onWeaponBorn.match(/TSRandom\.Range\(0, 100\) < (\d+)/)[1];
            const textChance = +potential.desc.match(/(\d+)% chance/)[1];
            const active = roll === 20 && textChance === 25;

            return {
                active,
                text: potential.desc,
                detail: `the extra bullet roll is ${roll}% while the text says ${textChance}%`,
            };
        },
    },
    {
        heading: "Ann > Wind's Breath",
        check() {
            const potential = findPotential('123', 512301);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._12301');
            const parallel = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const onTriggerWindArea = extractMethod(parallel, 'private void OnTriggerWindArea(');
            const nrmTag = parallel.match(/nrmAtkTag = CommonHelper\.StringToHash\("([^"]+)"\)/)[1];
            const cooldown = +parallel.match(/trigger_area_cd = FP\.op_Implicit\((\d+)\)/)[1];
            const gatedOnNormal = /CheckHitByTag\(hitDamageTag, nrmAtkTag\)[\s\S]*?GetPerk\(512301/.test(onTriggerWindArea);
            const tagged = tooltip => (HITDAMAGE[tooltip.hitDamageId].DamageTag || []).includes(crc32(nrmTag));
            const normalHits = CHARACTER['123'].normalAtk.paramsTooltips.filter(tooltip => tooltip.hitDamageId);
            const otherHits = ['skill', 'supportSkill', 'ultimate']
                .flatMap(key => CHARACTER['123'][key].paramsTooltips.filter(tooltip => tooltip.hitDamageId));
            const otherTagged = otherHits.filter(tagged).length;
            const active = gatedOnNormal && normalHits.every(tagged) && otherTagged === 0;

            return {
                active,
                text: potential.desc,
                detail: `wind's breath needs a hit tagged ${nrmTag}, which ${normalHits.length}/${normalHits.length} auto attacks have and ${otherTagged}/${otherHits.length} skill and ultimate hits lack; hidden cooldown ${cooldown}s`,
            };
        },
    },
    {
        heading: 'Ann > Grand Debut',
        check() {
            const potential = findPotential('123', 512304);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Monster._12301111FengTun');
            const parallel = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const onEnable = extractMethod(parallel, 'public override void OnEnable()');
            const buff = parallel.match(/buff_p4 = (\d+);/)[1];
            const value = EFFECTVALUE[BUFFVALUE[buff].Effects[0]];
            const readyAssistsOnly = /GetPerk\(perkId_p4\)[\s\S]*?isAssist && playerAdventureActor\.CheckSkillReady\(\)[\s\S]*?AddBuff\(buff_p4/.test(onEnable);
            const squadWide = onEnable.includes('AddBufftoGroup(buff_p4');
            const active = readyAssistsOnly && !squadWide;

            return {
                active,
                text: potential.desc,
                detail: `buff ${buff} (subtype ${value.EffectTypeFirstSubtype}, ${value.EffectTypeParam1}, ${BUFFVALUE[buff].Time / 10000}s) is only added to assists whose support skill is ready at summon; squad wide add = ${squadWide}`,
            };
        },
    },
    {
        heading: "Ann > Wind's Track",
        check() {
            const potential = findPotential('123', 512312);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._12301');
            const dodge = extractMethod(namespace, 'public class SkillScript_Dodge : SkillAdvancedBase');
            const onStart = extractMethod(dodge, 'public void OnStart()');
            const buffsGroup = onStart.includes('AddBufftoGroup(12312011');
            const buffsSelf = onStart.includes('buffComponent.AddBuff(12312011');
            const active = buffsGroup && !buffsSelf && potential.desc.includes('all other friendly units');

            return {
                active,
                text: potential.desc,
                detail: `the skill dmg buff is applied with AddBufftoGroup, which loops every squad actor including ann = ${buffsGroup}; a self only add = ${buffsSelf}`,
            };
        },
    },
    {
        heading: 'Freesia > Doomsday Blessing',
        check() {
            const potential = findPotential('125', 512505);
            const levels = getLevelValues(EFFECTVALUE, 12505011);
            const active = levels[0].EffectTypeFirstSubtype === 1
                && levels.slice(1).every(value => value.EffectTypeFirstSubtype === 56);

            return {
                active,
                text: potential.desc,
                detail: `L1 subtype ${levels[0].EffectTypeFirstSubtype}; L2 subtype ${levels[1].EffectTypeFirstSubtype}; L9 subtype ${levels[8].EffectTypeFirstSubtype}`,
            };
        },
    },
    {
        heading: 'Freesia > Elemental Sublimation',
        check() {
            const potential = findPotential('125', 512506);
            const source = getHotfix();
            const ultBonus = ONCEADDITIONALATTRIBUTEVALUE['12506011'];
            const stacks = BUFFVALUE['12506011'].LaminatedNum;
            const addedPerCast = source.includes('_actor.buffComponent?.AddBuff(12506011, _actor)');
            const removedOnUlt = source.includes('_actor.buffComponent?.RemoveBuffByBuffId(12506011)');
            const scaledByStacks = source.includes('AdventureActor.AddFromAttr(12506001, _actor, buffNumByID)');
            const active = addedPerCast && removedOnUlt && scaledByStacks
                && stacks > 1 && ultBonus.AttributeType1 === 58;

            return {
                active,
                text: potential.desc,
                detail: `ult bonus ${ultBonus.Value1 / 100}% (attr ${ultBonus.AttributeType1}) is applied with count = buff stacks (max ${stacks}); buff added per main skill cast = ${addedPerCast}, removed on ult end = ${removedOnUlt}`,
            };
        },
    },
    {
        heading: 'Freesia > Frost Gift',
        check() {
            const potential = findPotential('125', 512508);
            const source = getHotfix();
            const namespaceStart = source.indexOf('namespace AIScript.Character._12501');
            const tag = source.slice(namespaceStart, namespaceStart + 200000)
                .match(/damageTag_Trigger_P8 = CommonHelper\.StringToHash\("([^"]+)"\)/)[1];
            const autoHits = CHARACTER['125'].normalAtk.paramsTooltips
                .filter(hit => (hit.damageTag || []).includes(tag));
            const ultraHits = CHARACTER['125'].ultimate.paramsTooltips
                .filter(hit => (hit.damageTag || []).includes(tag));
            const active = tag === '125_Main_Skill_Damage'
                && autoHits.length === 0 && ultraHits.length === 0;

            return {
                active,
                text: potential.desc,
                detail: `elite bonus needs hits tagged ${tag}; auto attack hits with it = ${autoHits.length}, ultimate hits with it = ${ultraHits.length}`,
            };
        },
    },
    {
        heading: 'Freesia > Desperate Counterattack',
        check() {
            const potential = findPotential('125', 512513);
            const used = SCRIPTPARAMETERVALUE['12513012'].CommonData / 10000;
            const shown = SCRIPTPARAMETERVALUE['12513011'].CommonData / 10000;
            const usesUndisplayed = getHotfix().includes('GetScriptValue(_actor, 12513012)');
            const active = usesUndisplayed && used !== shown && +potential.params[1] === shown;

            return {
                active,
                text: potential.desc,
                detail: `cooldown uses 12513012 = ${used}s; text Param2 uses 12513011 = ${shown}s`,
            };
        },
    },
    {
        heading: 'Freesia > Frost Warning',
        check() {
            const potential = findPotential('125', 512524);
            const extraHit = potential.paramsTooltips[0].hitDamageId;
            const triggerTag = '125_P24';
            const ultraHits = CHARACTER['125'].ultimate.paramsTooltips.filter(hit => hit.damageTag);
            const ultraHasTag = ultraHits.some(hit => hit.damageTag.includes(triggerTag));
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._12501');
            const config = extractMethod(namespace, 'public class Config_Support');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onSelfAttacked = extractMethod(support, 'protected override void OnSelfAttacked(AdventureActorReceiveAttackEvent attackEvent)');
            const cooldown = +/triggerCD_P24 = FP\.op_Implicit\(([\d.]+)f?\)/.exec(config)[1];
            const gated = onSelfAttacked.includes('_lastTriggerTime_P24')
                && onSelfAttacked.includes('Config_Support.triggerCD_P24');
            const active = !ultraHasTag && gated && cooldown === 1;

            return {
                active,
                text: potential.desc,
                detail: `${extraHit}; Ultimate ${ultraHasTag ? 'has' : 'lacks'} ${triggerTag}, and the extra hit is gated by triggerCD_P24 = ${cooldown}s (${gated})`,
            };
        },
    },
    {
        heading: 'Freesia > Ocean of Law',
        check() {
            const potential = findPotential('125', 512528);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._12501');
            const config = extractMethod(namespace, 'public class Config_Support');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onSelfAttacked = extractMethod(support, 'protected override void OnSelfAttacked(AdventureActorReceiveAttackEvent attackEvent)');
            const cooldown = +/triggerCD_P28 = FP\.op_Implicit\(([\d.]+)f?\)/.exec(config)[1];
            const gated = onSelfAttacked.includes('_lastTriggerTime_P28')
                && onSelfAttacked.includes('Config_Support.triggerCD_P28');
            const active = gated && cooldown === 1 && !potential.desc.includes('cooldown');

            return {
                active,
                text: potential.desc,
                detail: `the atk buff is gated by triggerCD_P28 = ${cooldown}s since the last trigger (${gated}), and the text has no cooldown`,
            };
        },
    },
    {
        heading: 'Flora > Perfect Acting',
        check() {
            const potential = findPotential('126', 512627);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._12601');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onCrit = extractMethod(support, 'protected override void OnCrit(');
            const countsMainCrit = onCrit.includes('mainCtrActor.Id == _evt.from.Id');
            const countsSelfCrit = onCrit.includes('_actor.Id == _evt.from.Id');
            const spawnsButterfly = onCrit.includes('bullut_flameButter_Prek27');
            const active = countsMainCrit && countsSelfCrit && spawnsButterfly
                && potential.desc.includes('main Trekker lands a Crit Hit');

            return {
                active,
                text: potential.desc,
                detail: `the crit branch spawns the scorched butterfly for the main trekker = ${countsMainCrit} and for flora's own crits = ${countsSelfCrit}`,
            };
        },
    },
    {
        heading: 'Teresa > Muddy Engulf',
        check() {
            const potential = findPotential('127', 512706);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._12701');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onHitPost = extractMethod(main, 'public override void OnHitPost(');
            const eliteGetsHigher = /monster\.monsterInfo\.epicType == HotfixEnum\.monsterEpicType\.ELITE \|\| monster\.IsBossMonster\(\)[\s\S]*?AddBuff\(12750612/.test(onHitPost);
            const normalGetsBase = /else[\s\S]*?AddBuff\(12750611/.test(onHitPost);
            const base = +EFFECTVALUE['12750611'].EffectTypeParam1;
            const higher = +EFFECTVALUE['12750612'].EffectTypeParam1;
            const checksBroken = /Broken|broken|resilience/.test(onHitPost);
            const active = eliteGetsHigher && normalGetsBase && higher > base && !checksBroken;

            return {
                active,
                text: potential.desc,
                detail: `elite and boss targets get buff 12750612 (${higher}), everyone else gets 12750611 (${base}), and nothing checks broken resilience = ${!checksBroken}`,
            };
        },
    },
    {
        heading: 'Teresa > Hold On!',
        check() {
            const potential = findPotential('127', 512726);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._12701');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onOtherHurt = extractMethod(support, 'public override void OnOtherHurt(');
            const onOtherHitPost = extractMethod(support, 'public override void OnOtherHitPost(');
            const reducesOnHurt = onOtherHurt.includes('ModifyResumeTimeAbs(-cdReduce_26, ActionKey.B)');
            const reducesOnHit = onOtherHitPost.includes('ModifyResumeTimeAbs(-cdReduce_26, ActionKey.B)');
            const shieldOnHit = /GetPerkLv\(512726[\s\S]{0,120}?CheckShieldByTag/.test(onOtherHitPost);
            const active = reducesOnHurt && reducesOnHit && !shieldOnHit;

            return {
                active,
                text: potential.desc,
                detail: `support skill cd is reduced when she is attacked = ${reducesOnHurt} and when the main trekker deals damage = ${reducesOnHit}; the damage branch needs the surging shield = ${shieldOnHit}`,
            };
        },
    },
    {
        heading: 'Teresa > How About This!',
        check() {
            const potential = findPotential('127', 512730);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._12701');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onOtherHitPost = extractMethod(support, 'public override void OnOtherHitPost(');
            const playsGeyser = onOtherHitPost.includes('PlayAreaEffect(_actor, areaEffect_30');
            const checksAqua = onOtherHitPost.includes('elementType.WE');
            const hasCd = onOtherHitPost.includes('CheckCd(512730, cd_30)');
            const cdSeconds = /private FP cd_30 = FP\.op_Implicit\((\d+(?:\.\d+)?)\);/.exec(support)?.[1];
            const active = playsGeyser && !checksAqua && hasCd && +cdSeconds === 1 && potential.desc.includes('main Aqua Trekker');

            return {
                active,
                text: potential.desc,
                detail: `the geyser branch plays areaEffect_30 = ${playsGeyser}, with no aqua element check on the main trekker = ${!checksAqua}, and a hidden ${cdSeconds}s cooldown = ${hasCd}`,
            };
        },
    },
    {
        heading: 'Donna > Condensation Orbs',
        check() {
            const potential = findPotential('130', 513001);
            const source = getHotfix();
            const setIndex = source.indexOf('ToggleLogicTag("TriggerPerk_P1", value: true)');
            const setOnSkillEnd = setIndex >= 0
                && source.slice(Math.max(0, setIndex - 300), setIndex).includes('OnSkillDisable()');
            const firesOnShoot = source.includes('GetLogicTagToggle("TriggerPerk_P1")');
            const saysAgileEnd = potential.desc.includes('##Agile#2015# State ends');
            const active = setOnSkillEnd && firesOnShoot && saysAgileEnd;

            return {
                active,
                text: potential.desc,
                detail: `orbs fire when TriggerPerk_P1 is set = ${firesOnShoot}; flag set in the main skill's OnSkillDisable = ${setOnSkillEnd}; text says Agile ends = ${saysAgileEnd}`,
            };
        },
    },
    {
        heading: 'Donna > Freezing Stasis',
        check() {
            const potential = findPotential('130', 513043);
            const condition = getHotfix().match(/if \(to\.isFrozen[^)]*\)/)[0];
            const saysChill = potential.desc.includes('##Chill#1027#');
            const active = saysChill && !/Cold/.test(condition);

            return {
                active,
                text: potential.desc,
                detail: `trigger condition "${condition}" only checks frozen; text says Frozen and Chill = ${saysChill}`,
            };
        },
    },
    {
        heading: 'Minova > Skill: Syou: Pulsar Streak',
        check() {
            const method = extractMethod(getHotfix(), 'public class SkillScript_Skill_Stage2_MainControl');
            const cap = Number(method.match(/maxDurationTime_Loop\s*=\s*FP\.op_Implicit\(([\d.]+)\)/)[1]);
            const textMatch = CHARACTER['132'].skill.desc.match(/every\s+([\d.]+)s\s+for a total of\s+([\d.]+)s/i);
            const interval = Number(textMatch[1]);
            const total = Number(textMatch[2]);
            const active = cap < total;
            const hits = Math.ceil(cap / interval);

            return {
                active,
                text: CHARACTER['132'].skill.desc,
                detail: `hold cap ${cap}s vs text ${total}s at ${interval}s intervals (${hits} hits)`,
            };
        },
    },
    {
        heading: 'Minova > Unyielding Strength',
        check() {
            const potential = findPotential('132', 513206);
            const source = getHotfix();
            const oncePerSequence = source.includes('!_isHit && CommonUtils.CheckHitByTag(adventureActorReceiveAttackEvent.hitDamageTag, damageTag_NormalAttack)');
            const addsOnNormalHit = source.includes('if (adventureActorCustomEvent.eventHashCode == EventHashCode_NormalAttackHit)')
                && source.includes('AddBuff(13206011, _actor)');
            const removesOnSkillFinish = source.includes('RemoveBuffByBuffId(13206011)');
            const active = oncePerSequence && addsOnNormalHit && removesOnSkillFinish;

            return {
                active,
                text: potential.desc,
                detail: `buff 13206011 added once per AA sequence and removed on skill finish = ${active}`,
            };
        },
    },
    {
        heading: 'Minova > Board Tricks',
        check() {
            const potential = findPotential('132', 513203);
            const source = getHotfix();
            const stage1Tag = source.includes('return "132_Main_Skill_S1_P03";');
            const addsOnP3 = source.includes('GetPersonalPerkLevel(_actor.dataID, 513203, out perkLevel) && CommonUtils.CheckHitByTag(beforeHitEvent.hitDamageTag, damageTag_Trigger_P3)')
                && source.includes('AdventureActor.AddFromAttr(13203011, _actor)');
            const active = stage1Tag && addsOnP3;

            return {
                active,
                text: potential.desc,
                detail: `DMG multiplier 13203011 added only on 132_P3 hits; stage 1 action tag changes to 132_Main_Skill_S1_P03 = ${active}`,
            };
        },
    },
    {
        heading: 'Minova > Oath Satellite',
        check() {
            const potential = findPotential('132', 513223);
            const source = getHotfix();
            const meteorPickup = source.includes('GetPersonalPerkLevel(_actor.dataID, 513224, out perkLevel)')
                && source.includes('string.Equals(adventureDropFinishEvent.dropTag, "132_Item_P24")');
            const addsShield = source.includes('GetPersonalPerkLevel(_actor.dataID, 513223, out perkLevel)')
                && source.includes('AddShield(13223011, _actor)');
            const active = meteorPickup && addsShield;

            return {
                active,
                text: potential.desc,
                detail: `Oath Satellite shield also added on 132_Item_P24 meteor pickup = ${active}`,
            };
        },
    },
    {
        heading: 'Minova > Optimal Hit Zone',
        check() {
            const potential = findPotential('132', 513225);
            const source = getHotfix();
            const countsTriggerSet = source.includes('GetPersonalPerkLevel(_actor.dataID, 513225, out perkLevel)')
                && source.includes('_inTriggerSet.Contains(monsterAdventureActor.Id)')
                && source.includes('AdventureActor.AddFromAttr(13225001, _actor, num)');
            const active = countsTriggerSet;

            return {
                active,
                text: potential.desc,
                detail: `Optimal Hit Zone adds +1 hex from _inTriggerSet while astral hex dmg is active = ${countsTriggerSet}`,
            };
        },
    },
    {
        heading: 'Minova > Shutout Desire',
        check() {
            const potential = findPotential('132', 513226);
            const textLevels = getLevelValues(SCRIPTPARAMETERVALUE, 13226011)
                .map(row => row.CommonData / 10000);
            const hitLevels = HITDAMAGE['132526001'].SkillPercentAmend
                .slice(0, textLevels.length)
                .map(value => value / 10000);
            const active = textLevels.some((value, index) => value !== hitLevels[index]);

            return {
                active,
                text: potential.desc,
                detail: `extra hit deals ${hitLevels[0]}% to ${hitLevels.at(-1)}% of ATK (HiddenParam1 132526001) vs ${textLevels[0]}% to ${textLevels.at(-1)}% shown (Param1 SPV 13226001)`,
            };
        },
    },
    {
        heading: 'Nazuka > Youth: Annihilation',
        check() {
            const potential = findPotential('133', 513326);
            const chance = Number(getHotfix().match(/per_26 = FP\.op_Implicit\(([\d.]+)\)/)[1]);
            const textChance = Number(potential.desc.match(/(\d+)% chance/)[1]);
            const active = chance !== textChance;

            return {
                active,
                text: potential.desc,
                detail: `petal execute chance is ${chance}% in the code vs ${textChance}% in the text`,
            };
        },
    },
    {
        heading: 'Nazuka > Flower Formation: Convergence',
        check() {
            const potential = findPotential('133', 513328);
            const source = getHotfix();
            const required = Number(source.match(/num_28 = (\d+)/)[1]);
            const textTargets = Number(potential.desc.match(/(\d+) or more targets/)[1]);
            const active = required !== textTargets;

            return {
                active,
                text: potential.desc,
                detail: `extra DMG needs list_p24.Count >= ${required}, text says ${textTargets} or more targets`,
            };
        },
    },
    {
        heading: 'Mistique > Abominable Fester',
        check() {
            const potential = findPotential('135', 513508);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Monster._13500010BigHeadGhost');
            const parallel = extractMethod(namespace, 'public class Parallel : ParallelBase');
            const onBeforeHit = extractMethod(parallel, 'private void OnBeforeHit(IEvent _evt)');
            const gated = onBeforeHit.includes('CheckCd(513508, cd_8)');
            const cooldown = +/private FP cd_8 = FP\.op_Implicit\(([\d.]+)f?\)/.exec(parallel)[1];
            const active = gated && cooldown === 1.5 && !potential.desc.includes('cooldown');

            return {
                active,
                text: potential.desc,
                detail: `the phantom's dmg buff and stun are gated by CheckCd(513508, ${cooldown}s), and the text has no cooldown`,
            };
        },
    },
    {
        heading: 'Eleanor > Flicker Sequence',
        check() {
            const potential = findPotential('137', 513712);
            const percent = SCRIPTPARAMETERVALUE['13712011'].CommonData / 10000;
            const applied = getHotfix().includes('ModifySectionResumeTimePercentAmend(100 - num, ActionKey.A)');
            const active = applied && percent !== 25;

            return {
                active,
                text: potential.desc,
                detail: `13712011 = ${percent}, so ActionKey.A resume time is set to ${100 - percent}% (${percent}% less cooldown), text says 25%`,
            };
        },
    },
    {
        heading: 'Eleanor > Chain Detonation',
        check() {
            const potential = findPotential('137', 513721);
            const source = getHotfix();
            const usesJumpIndex = source.includes('int loops = (int)(long)logicTagValue2;')
                && source.includes('logicTagValue2 >= FP.op_Implicit(1)')
                && source.includes('_actor.logicVariable.SetLogicTagValue("JumpAtkJumpIndex", FP.op_Implicit(_loopTimes));');
            const saysOneEach = potential.desc.includes('explosions of each jump slam by 1');
            const active = usesJumpIndex && saysOneEach;

            return {
                active,
                text: potential.desc,
                detail: `extra explodes loop JumpAtkJumpIndex times, so slam 1 gets 0 and each later slam 1 more than the previous = ${usesJumpIndex}, which is better than the text overall (36 extras instead of 9); en text says +1 for each = ${saysOneEach}`,
            };
        },
    },
    {
        heading: 'Eleanor > Precision Calibration',
        check() {
            const potential = findPotential('137', 513730);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._13701');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onMainBeforeHit = extractMethod(support, 'protected override void OnMainBeforeHit(AdventureActorReceiveDamageBeforeHitEvent beforeHit, PlayerAdventureActor main)');
            const whirlwind = findPotential('143', 514301).paramsTooltips.find(tooltip => tooltip.hitDamageId);
            const hit = HITDAMAGE[whirlwind.hitDamageId];
            const normalSlotOnly = onMainBeforeHit.includes('beforeHit.skillSlotType == HotfixEnum.skillSlotType.NORMAL')
                && onMainBeforeHit.includes('AddFromAttr(13730002, main)');
            const active = normalSlotOnly && hit.DamageType === 1 && hit.SkillSlotType !== 5;

            return {
                active,
                text: potential.desc,
                detail: `13730002 (ventus normal dmg) is only added on hits whose skillSlotType is NORMAL, while wraith's whirlwind hit ${whirlwind.hitDamageId} is skill slot ${hit.SkillSlotType} with damageType ${hit.DamageType} (normal), so the buff is skipped`,
            };
        },
    },
    {
        heading: 'Sparkla > Ticking Aftershock',
        check() {
            const potential = findPotential('140', 514009);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._14001');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onBulletFinish = extractMethod(main, 'private void OnBulletFinish(IEvent evt)');
            const cooldown = +SCRIPTPARAMETERVALUE[14009011].CommonData / 10000;
            const gated = onBulletFinish.includes('_lastTriggerTime_P9')
                && onBulletFinish.includes('GetScriptValue(_actor, 14009011)');
            const active = gated && cooldown === 2 && !potential.desc.includes('cooldown');

            return {
                active,
                text: potential.desc,
                detail: `the booby trap drop is gated by 14009011 = ${cooldown}s since the last trigger, and the text has no cooldown`,
            };
        },
    },
    {
        heading: 'Chixia > Flame-Stained Ink',
        check() {
            const potential = findPotential('141', 514103);
            const effect = EFFECTVALUE['14103012'];
            const source = getHotfix();
            const addsAtkSpeed = source.includes('monster.buffComponent.GetBuffNum(0, 0, Config.buffTag_Ink) >= 4')
                && source.includes('_actor.buffComponent.AddBuff(14103012, _actor)');
            const mentioned = /attack speed/i.test(potential.desc);
            const active = addsAtkSpeed
                && effect.EffectType === 12
                && effect.EffectTypeFirstSubtype === 47
                && effect.EffectTypeSecondSubtype === 1
                && !mentioned;

            return {
                active,
                text: potential.desc,
                detail: `burn on a 4-ink target adds buff 14103012 (+${effect.EffectTypeParam1 * 100}% attack speed, ${BUFFVALUE['14103012'].Time / 10000}s) = ${addsAtkSpeed}; text mentions attack speed = ${mentioned}`,
            };
        },
    },
    {
        heading: 'Chixia > Blazing Rainbow Array',
        check() {
            const potential = findPotential('141', 514104);
            const perStack = ONCEADDITIONALATTRIBUTEVALUE['14104011'];
            const advertised = ONCEADDITIONALATTRIBUTEVALUE['14104012'];
            const maxStacks = BUFFVALUE['14104011'].LaminatedNum;
            const hits = getHotfix().includes('AdventureActor.AddFromAttr(14104011, _actor, buffNumByID)');
            const active = hits && perStack.Value1 * maxStacks < advertised.Value1;

            return {
                active,
                text: potential.desc,
                detail: `14104011 adds ${perStack.Value1 / 100}% per stack, max ${maxStacks} stacks = ${perStack.Value1 * maxStacks / 100}%, text advertises ${advertised.Value1 / 100}%`,
            };
        },
    },
    {
        heading: 'Cosette > Nightscar Trace',
        check() {
            const potential = findPotential('142', 514202);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._14201');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const cooldown = +main.match(/private FP cd_2 = FP\.op_Implicit\(([\d.]+)\)/)[1];
            const gated = main.includes('CheckCd(514202, cd_2)');
            const active = gated && cooldown === 0.5 && potential.desc.includes('5 times per Skill cast');

            return {
                active,
                text: potential.desc,
                detail: `the claw marks are gated by CheckCd(514202, ${cooldown}s) = ${gated}, and the text only says 5 times per cast`,
            };
        },
    },
    {
        heading: 'Cosette > Nocturn Mark',
        check() {
            const potential = findPotential('142', 514204);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._14201');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const triggerMask = extractMethod(main, 'private void TriggerMask(');
            const sharedCounter = triggerMask.includes('++curCount_4 >= count_4') && triggerMask.includes('CheckCd(perkId_4, cd_4)');
            const perTarget = /curCount_4\s*\[|Dictionary<[^>]*curCount_4/.test(main);
            const cdField = main.match(/private FP cd_4 = FP\.op_Implicit\(([\d.]+)\)/);
            const cdSeconds = cdField ? +cdField[1] : NaN;
            const sameTarget = potential.desc.includes('on the same target for the 3rd time');
            const oncePerSecond = potential.desc.includes('once per second');
            const active = sharedCounter && !perTarget && cdSeconds < 1 && sameTarget && oncePerSecond;

            return {
                active,
                text: potential.desc,
                detail: `the 3rd-mark counter is one field shared by every target = ${sharedCounter} (per-target storage = ${perTarget}); text counts the 3rd mark on the same target = ${sameTarget}; the internal cooldown is ${cdSeconds}s while the text says once per second = ${oncePerSecond}`,
            };
        },
    },
    {
        heading: 'Cosette > Dark: Hallucination',
        check() {
            const potential = findPotential('142', 514228);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._14201');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onHitPost = extractMethod(support, 'public override void OnHitPost(');
            const rolls = onHitPost.includes('GetPerkLv(514228') && onHitPost.includes('paramId_28_pro');
            const cooldown = onHitPost.includes('CheckCd(514228');
            const text = potential.desc.includes('once every 0.5s');
            const active = rolls && !cooldown && text;

            return {
                active,
                text: potential.desc,
                detail: `the 30% roll uses 14228011 on every support-skill hit = ${rolls}; there is no CheckCd(514228) = ${!cooldown}; text limits it to once every 0.5s = ${text}`,
            };
        },
    },
    {
        heading: 'Cosette > Dark: Form Breaker',
        check() {
            const potential = findPotential('142', 514229);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._14201');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onHitPost = extractMethod(support, 'public override void OnHitPost(');
            const reduces = onHitPost.includes('DamageToToughness');
            const cdField = support.match(/private FP cd_29 = FP\.op_Implicit\(([\d.]+)\)/);
            const cdSeconds = cdField ? +cdField[1] : NaN;
            const text = potential.desc.includes('once every 0.5s');
            const active = reduces && cdSeconds > 0.5 && text;

            return {
                active,
                text: potential.desc,
                detail: `the toughness reduction uses the level-scaled 14229002 percentage = ${reduces}; the internal cooldown is ${cdSeconds}s while the text says 0.5s = ${text}`,
            };
        },
    },
    {
        heading: 'Cosette > Phantom Shelter',
        check() {
            const potential = findPotential('142', 514232);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._14201');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onCastSkill = extractMethod(support, 'public override void OnCastSkill(');
            const onSupportSkill = /skillSlotType\.B[\s\S]*?AddBuff\(buff_32/.test(onCastSkill);
            const onUltimate = /skillSlotType\.D[\s\S]*?AddBuff\(buff_32/.test(onCastSkill);
            const text = potential.desc.includes('casting the Support Skill');
            const active = onSupportSkill && onUltimate && text;

            return {
                active,
                text: potential.desc,
                detail: `buff 14232011 is added on the support skill cast = ${onSupportSkill} and also on the ultimate cast = ${onUltimate}; text only names the support skill = ${text}`,
            };
        },
    },
    {
        heading: 'Wraith > Ominous Vibe',
        check() {
            const potential = findPotential('143', 514325);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._14301');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onDamaged = extractMethod(support, 'protected override void OnSelfDamaged(AdventureActorReceiveDamageEvent damageEvent)');
            const cooldown = +SCRIPTPARAMETERVALUE[14325012].CommonData / 10000;
            const gated = onDamaged.includes('_lastTriggerTime_P25')
                && onDamaged.includes('GetScriptValue(_actor, 14325012)');
            const active = gated && cooldown === 1 && !potential.desc.includes('cooldown');

            return {
                active,
                text: potential.desc,
                detail: `the laser proc is gated by 14325012 = ${cooldown}s since the last trigger, and the text has no cooldown`,
            };
        },
    },
    {
        heading: 'Chitose > Aqueous Phantasm',
        check() {
            const potential = findPotential('144', 514407);
            const mirrorHit = findPotential('144', 514401).paramsTooltips[1];
            const checksTag = getHotfix().includes('damageTag_Trigger_P7 = CommonHelper.StringToHash("144_SnakeAtk_07")');
            const hasTag = (mirrorHit.damageTag || []).includes('144_SnakeAtk_07');
            const active = checksTag && !hasTag;

            return {
                active,
                text: potential.desc,
                detail: `Mirror Image hit ${mirrorHit.hitDamageId} ${hasTag ? 'has' : 'lacks'} 144_SnakeAtk_07; Aqueous Phantasm checks it = ${checksTag}`,
            };
        },
    },
    {
        heading: 'Chitose > Dance of Elegance',
        check() {
            const potential = findPotential('144', 514406);
            const source = getHotfix();
            const checksMirrorTag = source.includes('damageTag_TriggerAddDamage_P2_P6 = CommonHelper.StringToHash("144_Atk6_Shadow")');
            const addsBuff = source.includes('CommonUtils.HavePersonalPerk(_actor.dataID, 514406, out perkLevel)')
                && source.includes('AdventureActor.AddFromAttr(14406001, _actor, num)');
            const active = checksMirrorTag && addsBuff;

            return {
                active,
                text: potential.desc,
                detail: `Dance of Elegance checks 144_Atk6_Shadow and adds 14406001 = ${active}`,
            };
        },
    },
    {
        heading: 'Caramel > Rhythm Pulse',
        check() {
            const potential = findPotential('147', 514703);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._14701');
            const parallel = extractMethod(namespace, 'public class ParallelScript : ParallelBase');
            const onHitPost = extractMethod(parallel, 'public virtual void OnHitPost(');
            const triggerTag = parallel.match(/hitTag_Dark = CommonHelper\.StringToHash\("([^"]+)"\)/)[1];
            const waveHit = potential.paramsTooltips.find(tooltip => tooltip.hitDamageId).hitDamageId;
            const tags = HITDAMAGE[waveHit].DamageTag || [];
            const markNeedsTag = onHitPost.includes('CheckHitByTag(evt.hitDamageTag, hitTag_Dark)')
                && onHitPost.includes('TriggerMask(evt, monster)');
            const active = markNeedsTag && tags.length === 0;

            return {
                active,
                text: potential.desc,
                detail: `the extra waves use hit ${waveHit} with ${tags.length} damage tags, while the gloom trigger only fires on hits tagged ${triggerTag} (${crc32(triggerTag)})`,
            };
        },
    },
    {
        heading: 'Caramel > Fallen Duet',
        check() {
            const potential = findPotential('147', 514708);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._14701');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onCustomEvent = extractMethod(main, 'public override void OnCustomEvent(');
            const performance = getHitDamageAreaEffectDetail('147300004');
            const extra = performance.areaEffectVariants[0];
            const linkedGate = onCustomEvent.includes('areaEffect_8_2')
                && onCustomEvent.includes('isInLink');
            const textHits = +potential.desc.match(/x(\d+)/)[1];
            const active = performance.hits !== textHits && linkedGate;

            return {
                active,
                text: potential.desc,
                detail: `the performance ae ticks ${performance.hits} times at ${performance.hitInterval}s intervals over ${performance.duration}s and the second ${extra.hits}-hit ae only needs isInLink (${linkedGate}), while the text says x${textHits}`,
            };
        },
    },
    {
        heading: "Gerie > Samsara's Judgment",
        check() {
            const potential = findPotential('149', 514943);
            const mark = CHARACTER['149'].skill.paramsTooltips[5];
            const triggerTag = '149_Gray';
            const hasTag = (mark.damageTag || []).includes(triggerTag);
            const active = !hasTag;

            return {
                active,
                text: potential.desc,
                detail: `mark hit ${mark.hitDamageId} ${hasTag ? 'has' : 'lacks'} ${triggerTag}; damage tags: ${(mark.damageTag || []).join(', ') || 'none'}`,
            };
        },
    },
    {
        heading: 'Laru > Arc Chain Laser',
        check() {
            const potential = findPotential('150', 515002);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._15001');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onBuffRemove = extractMethod(main, 'private void OnBuffRemove(IEvent evt)');
            const onActorDied = extractMethod(main, 'private void OnActorDied(IEvent evt)');
            const explosion = extractMethod(main, 'private bool TryTriggerElectricityExplosion_P2(MonsterAdventureActor monster, bool onlyCheckStrength = false)');
            const textHits = +potential.desc.match(/(\d+)(?:st|nd|rd|th) hit/)[1];
            const textPct = potential.params[2].split('/').map(value => +value.replace('%', ''));
            const bigPct = HITDAMAGE[150310203].SkillPercentAmend.map(value => value / 10000);
            const hidden = potential.hiddenParamsTooltips.find(tooltip => tooltip.hitDamageId === '150310202');
            const explodesOnRemove = onBuffRemove.includes('buffId == 15002011')
                && onBuffRemove.includes('TryTriggerElectricityExplosion_P2');
            const explodesOnDeath = onActorDied.includes('TryTriggerElectricityExplosion_P2');
            const picksByStacks = explosion.includes('buffNumByID >= 20')
                && explosion.includes('Boom_Big')
                && explosion.includes('Boom_Small');
            const active = explodesOnRemove && explodesOnDeath && picksByStacks
                && bigPct.join('/') === textPct.join('/')
                && hidden !== undefined;

            return {
                active,
                text: potential.desc,
                detail: `removing shock 15002011 (expiry included) and the target dying both call TryTriggerElectricityExplosion_P2, so the explosion is not limited to the ${textHits}th hit; below 20 stacks it uses hiddenparam1 (150310202) instead of 150310203 (${bigPct.join('/')}%)`,
            };
        },
    },
    {
        heading: 'Laru > Piercing Sting',
        check() {
            const potential = findPotential('150', 515007);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._15001');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onSelfDamaged = extractMethod(main, 'protected override void OnSelfDamaged(AdventureActorReceiveDamageEvent damageEvent)');
            const triggerTag = namespace.match(/damageTag_Trigger_P7 = CommonHelper\.StringToHash\("([^"]+)"\)/)[1];
            const addsOnTag = onSelfDamaged.includes('AddBuff(15007011')
                && onSelfDamaged.includes('CheckHitByTag(damageEvent.hitDamageTag, Config_MainControl.damageTag_Trigger_P7)');
            const tagged = Object.values(HITDAMAGE)
                .filter(hit => (hit.DamageTag || []).includes(crc32(triggerTag)))
                .map(hit => hit.Id);
            const mainHits = CHARACTER['150'].skill.paramsTooltips
                .filter(tooltip => tooltip.hitDamageId)
                .map(tooltip => +tooltip.hitDamageId);
            const otherHits = tagged.filter(id => !mainHits.includes(id));
            const active = addsOnTag
                && potential.params[0] === 'Thunderflare Strike'
                && otherHits.length > 0;

            return {
                active,
                text: potential.desc,
                detail: `the buff 15007011 is added by any hit tagged ${triggerTag} (${addsOnTag}), and ${otherHits.length} of the ${tagged.length} tagged hits come from other skills, so it is not limited to ${potential.params[0]}`,
            };
        },
    },
    {
        heading: 'Laru > Electric Chain',
        check() {
            const potential = findPotential('150', 515009);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._15001');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onTrigger = extractMethod(main, 'protected override void OnTriggerLightMark(');
            const perkLogic = extractMethod(main, 'private IEnumerator PerkLogic_P9(');
            const reset = extractMethod(main, 'private IEnumerator ResetTriggerCount_P9(');
            const config = extractMethod(namespace, 'public class Config_MainControl');
            const triggerTag = config.match(/damageTag_Trigger_P9 = CommonHelper\.StringToHash\("([^"]+)"\)/)[1];
            const chainHit = +config.match(/hitdamageId_P9 = (\d+)/)[1];
            const firstDelay = +config.match(/firstHitDelay_P9 = FP\.op_Implicit\(([\d.]+)\)/)[1];
            const linkInterval = +config.match(/linkInterval_P9 = FP\.op_Implicit\(([\d.]+)\)/)[1];
            const requiresTag = onTrigger.includes('CheckHitByTag(hitDamageTag, Config_MainControl.damageTag_Trigger_P9)');
            const cap = onTrigger.includes('_triggerCount_P9 < 3');
            const resetsAfter = reset.includes('WaitForSeconds(FP.op_Implicit(1))')
                && reset.includes('_triggerCount_P9 = 0');
            const delays = perkLogic.includes('firstHitDelay_P9')
                && perkLogic.includes('linkInterval_P9');
            const mainHits = [
                CHARACTER['150'].skill.paramsTooltips,
                findPotential('150', 515001).paramsTooltips,
                findPotential('150', 515002).paramsTooltips,
                findPotential('150', 515003).paramsTooltips,
                findPotential('150', 515004).paramsTooltips,
                findPotential('150', 515006).paramsTooltips,
            ].flat().filter(tooltip => tooltip.hitDamageId
                && (tooltip.damageTag || []).includes('150_LightMark_Trigger')
                && !(tooltip.damageTag || []).includes(triggerTag));
            const active = requiresTag && cap && resetsAfter && delays && mainHits.length > 0;

            return {
                active,
                text: potential.desc,
                detail: `chain hit ${chainHit} needs the ${triggerTag} tag (${requiresTag}), but Main Skill mark triggers ${mainHits.map(hit => hit.hitDamageId).join('/')} lack it, and the first hit lands ${firstDelay}s after the trigger with links every ${linkInterval}s and 3 procs per 1s reset from the first proc (${cap} ${resetsAfter})`,
            };
        },
    },
    {
        heading: 'Laru > Radiant Ascent',
        check() {
            const potential = findPotential('150', 515027);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._15001');
            const support = extractMethod(namespace, 'public class ParallelScript_Support : ParallelScript');
            const onBeforeSelfHit = extractMethod(support, 'protected override void OnBeforeSelfHit');
            const usesLostControl = onBeforeSelfHit.includes('monsterAdventureActor.isLostControl');
            const active = usesLostControl && potential.desc.includes('airborne');

            return {
                active,
                text: potential.desc,
                detail: `the bonus is gated on isLostControl (${usesLostControl}), so stunned and frozen targets count too, not only airborne ones`,
            };
        },
    },
    {
        heading: 'Laru > Lancefall: Electro Bind',
        check() {
            const potential = findPotential('150', 515042);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._15001');
            const parallel = extractMethod(namespace, 'public class ParallelScript : ParallelBase');
            const onReceiveDamage = extractMethod(parallel, 'private void OnReceiveDamage(IEvent evt)');
            const cooldown = +SCRIPTPARAMETERVALUE['15042012'].CommonData / 10000;
            const gated = onReceiveDamage.includes('_lastTriggerTime_P42')
                && onReceiveDamage.includes('GetScriptValue(_actor, 15042012)')
                && onReceiveDamage.includes('AddEnergy(');
            const triggerTag = namespace.match(/damageTag_Trigger_P42 = CommonHelper\.StringToHash\("([^"]+)"\)/)[1];
            const tagged = Object.values(HITDAMAGE)
                .filter(hit => (hit.DamageTag || []).includes(crc32(triggerTag)))
                .map(hit => +hit.Id);
            const ultimateHits = CHARACTER['150'].ultimate.paramsTooltips
                .filter(tooltip => tooltip.hitDamageId)
                .map(tooltip => +tooltip.hitDamageId);
            const lance = +findPotential('150', 515041).paramsTooltips
                .find(tooltip => tooltip.hitDamageId).hitDamageId;
            const onlyUltimate = tagged.every(id => ultimateHits.includes(id)) && !tagged.includes(lance);
            const active = gated
                && cooldown > 0
                && !potential.desc.includes('cooldown')
                && onlyUltimate;

            return {
                active,
                text: potential.desc,
                detail: `the energy gain is gated by 15042012 = ${cooldown}s since the last grant (${gated}), and only hits tagged ${triggerTag} trigger it, which excludes the light realm lance ${lance} (${onlyUltimate})`,
            };
        },
    },
    {
        heading: 'Laru > Lancefall: Thunder Surge',
        check() {
            const potential = findPotential('150', 515043);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._15001');
            const parallel = extractMethod(namespace, 'public class ParallelScript : ParallelBase');
            const onReceiveAttack = extractMethod(parallel, 'private void OnReceiveAttack(IEvent evt)');
            const addsOnEveryHit = onReceiveAttack.includes('AddBuff(15043011');
            const tracksTargets = /HashSet|\.Add\(|\.Contains\(/.test(onReceiveAttack);
            const lance = findPotential('150', 515041).paramsTooltips.find(tooltip => tooltip.hitDamageId).hitDamageId;
            const ticks = getHitDamageAreaEffectDetail(lance).hits;
            const active = addsOnEveryHit && !tracksTargets;

            return {
                active,
                text: potential.desc,
                detail: `buff 15043011 is added on every ultimate hit with no different-target tracking (${!tracksTargets}), and lance hit ${lance} ticks ${ticks} times`,
            };
        },
    },
    {
        heading: 'Shia > Kick the Wave',
        check() {
            const potential = findPotential('155', 515529);
            const once = ONCEADDITIONALATTRIBUTEVALUE['15529011'];
            const source = getHotfix();
            const buffOnAttacker = source.includes('adventureActor.buffComponent.AddBuff(buff_29, adventureActor)');
            const active = buffOnAttacker
                && once.AttributeType1 === 57
                && potential.desc.includes('Skill DMG taken');

            return {
                active,
                text: potential.desc,
                detail: `buff 15529011 is added to the attacker and OA 15529011 subtype = ${once.AttributeType1} (57 = Skill DMG), text says the target takes more surfing skill dmg`,
            };
        },
    },
    {
        heading: 'Nazuna > Clean Sweep',
        check() {
            const potential = findPotential('156', 515608);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._15601');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onDamaged = extractMethod(main, 'protected override void OnSelfDamaged(AdventureActorReceiveDamageEvent damageEvent)');
            const cooldown = +SCRIPTPARAMETERVALUE[15608012].CommonData / 10000;
            const gated = onDamaged.includes('_lastTriggerTime_P8')
                && onDamaged.includes('GetScriptValue(_actor, 15608012)');
            const stampsOnThrow = /TSRandom[\s\S]*_lastTriggerTime_P8 = _actor\.LogicTime/.test(onDamaged);
            const active = gated && stampsOnThrow && cooldown === 1 && !potential.desc.includes('cooldown');

            return {
                active,
                text: potential.desc,
                detail: `the 15608012 = ${cooldown}s gate wraps the 20% roll and _lastTriggerTime_P8 is stamped only on a throw (${stampsOnThrow}), so auto attacks inside the window never roll and the text has no cooldown`,
            };
        },
    },
    {
        heading: 'Suntide Willow > Skill: Luminous Leaper',
        check() {
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._16001');
            const config = extractMethod(namespace, 'public class Config_MainControl');
            const cooldown = +config.match(/triggerCD_AddBuff_Summoned = FP\.op_Implicit\(([\d.]+)\)/)[1];
            const buffId = +config.match(/buffId_ForPlayer_Summoned = (\d+)/)[1];
            const onSelfDamaged = extractMethod(namespace, 'protected override void OnSelfDamaged(');
            const gated = onSelfDamaged.includes('_lastTriggerTime_AddBuff_Summoned')
                && onSelfDamaged.includes('Config_MainControl.triggerCD_AddBuff_Summoned');
            const addsBuff = onSelfDamaged.includes('AddBuff(Config_MainControl.buffId_ForPlayer_Summoned');
            const buff = BUFFVALUE[buffId];
            const tooltip = CHARACTER['160'].skill.paramsTooltips.find(item => item.buffId === buffId);
            const active = cooldown === 1
                && gated
                && addsBuff
                && buff.LaminatedNum === 5
                && tooltip.effectType === 'ATK (%)';

            return {
                active,
                text: CHARACTER['160'].skill.desc,
                detail: `buff ${buffId} is gated by triggerCD_AddBuff_Summoned = ${cooldown}s, so one aoe impact can only add one stack per second`,
            };
        },
    },
    {
        heading: 'Suntide Willow > Foam Echo',
        check() {
            const potential = findPotential('160', 516008);
            const method = extractMethod(getHotfix(), 'private void OnSummonedSpawn(IEvent evt)');
            const removesBuff = method.includes('516008')
                && method.includes('16008011')
                && method.includes('RemoveBuffByBuffId');
            const active = removesBuff;

            return {
                active,
                text: potential.desc,
                detail: `new Bubble Frog removes 16008011 from Willow when 516008 is active = ${removesBuff}`,
            };
        },
    },
    {
        heading: 'Firstlight Noya > Dawnflare',
        check() {
            const potential = findPotential('162', 516202);
            const namespace = extractMethod(getHotfix(), 'namespace AIScript.Character._16201');
            const main = extractMethod(namespace, 'public class ParallelScript_MainControl : ParallelScript');
            const onCast = extractMethod(main, 'protected override void OnSelfCastSkill(AdventureActorCastSkillEvent castSkillEvent)');
            const bind = extractMethod(main, 'private IEnumerator BindExtraSkillLogic_P2()');
            const rebind = extractMethod(main, 'private IEnumerator RebindSkillLogic_P2()');
            const cooldown = +SCRIPTPARAMETERVALUE[16202011].CommonData / 10000;
            const useWindow = +SKILL[16231002].UseTimeHint / 10000;
            const setsTime = onCast.includes('_lastTriggerTime_P2 = _actor.LogicTime');
            const waits = bind.includes('_lastTriggerTime_P2')
                && bind.includes('GetScriptValue(_actor, 16202011)');
            const expires = rebind.includes('GetSkillUseTimeHint(currentBindSkillId)')
                && rebind.includes('RemoveBuffByBuffId(16202011)')
                && rebind.includes('BindSkillIdToButton(ActionKey.B, 16231000)');
            const active = setsTime && waits && cooldown === 8
                && expires && useWindow === 10 && !potential.desc.includes('cooldown');

            return {
                active,
                text: potential.desc,
                detail: `the special main skill is rebound only after 16202011 = ${cooldown}s since the last cast, and an unused one is taken away after 16231002.UseTimeHint = ${useWindow}s with 16202011 removed and 16231000 rebound (${expires}), and the text has no cooldown or duration`,
            };
        },
    },
    {
        heading: 'Steam Syndrome > Aromatic Steam',
        check() {
            const skill = DISC['213010'].mainSkill;
            const effect = EFFECT['3010021'];
            const aquaOnly = effect.TriggerCondition1 === 10
                && effect.TriggerParam1 === '1'
                && effect.TargetCondition1 === 10
                && effect.TargetParam1 === '1';
            const missingCondition = skill.desc.includes('If the main Trekker')
                && !skill.desc.includes('when any Aqua Trekker deals Skill DMG');
            const active = aquaOnly && missingCondition;

            return {
                active,
                text: skill.desc,
                detail: `effect 3010021 only boosts aqua trekkers' skill hits (trigger ${effect.TriggerCondition1}/${effect.TriggerParam1}, target ${effect.TargetCondition1}/${effect.TargetParam1}), but the english text only says "this hit"`,
            };
        },
    },
    {
        heading: 'Soaring Blue > Horn of Departure',
        check() {
            const skill = DISC['214008'].secondarySkill2;
            const classSource = extractMethod(getHotfix(), 'public class Disc_214008 : DiscScriptBase');
            const beforeHit = extractMethod(classSource, 'protected override void OnBeforeHit(AdventureActorReceiveDamageBeforeHitEvent damageEvent)');
            const aquaSource = beforeHit.includes('playerAdventureActor.actorElementInfo.elementType == HotfixEnum.elementType.WE');
            const active = skill.desc.includes('Aqua Trekkers')
                && !aquaSource;

            return {
                active,
                text: skill.desc,
                detail: `OnBeforeHit checks the damage source element = ${aquaSource}`,
            };
        },
    },
    {
        heading: 'New Star Prelude > Starlit Winds',
        check() {
            const skill = DISC['214009'].secondarySkill1;
            const effect = EFFECT['4009101'];
            const checksOwnerIsMain = effect.TriggerTarget === 1
                && effect.TriggerCondition2 === 41;
            const active = skill.desc.includes('Ventus Main Trekker gains a shield')
                && !checksOwnerIsMain;

            return {
                active,
                text: skill.desc,
                detail: `effect 4009101 trigger target = ${effect.TriggerTarget} (6 = main), trigger condition 2 = ${effect.TriggerCondition2 ?? 'none'} (41 = self is main)`,
            };
        },
    },
    {
        heading: 'Fireworks > Fireworks',
        check() {
            const skill = DISC['214017'].mainSkill;
            const value = EFFECTVALUE['4017021'];
            const generic = value.EffectType === 12 && value.EffectTypeFirstSubtype === 60;
            const active = skill.desc.includes('Ignis Auto Attack DMG')
                && generic;

            return {
                active,
                text: skill.desc,
                detail: `buff 4017021 effectType = ${value.EffectType}, subtype = ${value.EffectTypeFirstSubtype} (generic auto dmg taken)`,
            };
        },
    },
    {
        heading: 'United by Fate > Moment of Unity',
        check() {
            const skill = DISC['214021'].secondarySkill2;
            const classSource = extractMethod(getHotfix(), 'public class Disc_214021 : DiscScriptBase');
            const receive = extractMethod(classSource, 'protected override void OnReceiveDamage(AdventureActorReceiveDamageEvent evt)');
            const resets = receive.includes('RemoveBuffByBuffId(buff_s3_extra[stage_3])')
                && receive.includes('AddBuff(buff_s3_extra[stage_3]')
                && !receive.includes('AddBuffNum(buff_s3_extra[stage_3]');
            const maxStacks = BUFFVALUE['4021240'].LaminatedNum;
            const active = skill.desc.includes('stacking up to {4} times')
                && resets
                && maxStacks === 10;

            return {
                active,
                text: skill.desc,
                detail: `OnReceiveDamage resets buff_s3_extra to 1 stack = ${resets}; buff 4021240 max stacks = ${maxStacks}`,
            };
        },
    },
    {
        heading: 'Meowing Cat God > Cat God\'s Penalty',
        check() {
            const skill = DISC['214001'].secondarySkill1;
            const effect = EFFECT['4001106'];
            const active = skill.desc.includes('elite or higher-tier')
                && effect.TakeEffectCondition1 === 28
                && effect.TakeEffectParam1 === '2,3,4';

            return {
                active,
                text: skill.desc,
                detail: `TakeEffectCondition1=${effect.TakeEffectCondition1}, param="${effect.TakeEffectParam1}" = LORD(2)/LEADER(3)/ELITE(4); BOSSRUSH(7) and JOINTDRILLBOSS(8) excluded`,
            };
        },
    },
    {
        heading: 'Summer Afternoon Rain > Dancing Waters',
        check() {
            const skill = DISC['214011'].secondarySkill2;
            const effect = EFFECT['4011221'];
            const active = skill.desc.includes('elite or higher-tier')
                && effect.TakeEffectCondition1 === 28
                && effect.TakeEffectParam1 === '2,3,4';

            return {
                active,
                text: skill.desc,
                detail: `TakeEffectCondition1=${effect.TakeEffectCondition1}, param="${effect.TakeEffectParam1}" = LORD(2)/LEADER(3)/ELITE(4); BOSSRUSH(7) and JOINTDRILLBOSS(8) excluded`,
            };
        },
    },
    {
        heading: 'Colors Pierce the Grey > Street Spirit',
        check() {
            const skill = DISC['214023'].secondarySkill1;
            const active = skill.effectType.includes('Aqua DMG Taken (base)');

            return {
                active,
                text: skill.desc,
                detail: skill.effectType.join(', '),
            };
        },
    },
    {
        heading: 'Sword Against Stream > Splashing Moves',
        check() {
            const skill = DISC['214026'].secondarySkill1;
            const classSource = extractMethod(getHotfix(), 'public class Disc_214026 : DiscScriptBase');
            const damaged = extractMethod(classSource, 'protected override void OnMainPlayerActorDamaged(PlayerAdventureActor actor, MonsterAdventureActor target, AdventureActorReceiveDamageEvent damageEvent)');
            const hasCooldown = damaged.includes('LogicTime')
                || damaged.includes('cd_')
                || damaged.includes('Cd');
            const buff = BUFFVALUE['4026101'];
            const duration = buff.Time / 10000;
            const active = skill.desc.includes('once every {4}s')
                && !hasCooldown
                && duration === 10;

            return {
                active,
                text: skill.desc,
                detail: `OnMainPlayerActorDamaged has cooldown = ${hasCooldown}; buff 4026101 duration = ${duration}s; text says once every 15s`,
            };
        },
    },
    {
        heading: 'Sword Against Stream > Water Mirror',
        check() {
            const skill = DISC['214026'].secondarySkill2;
            const effect = EFFECT['4026201'];
            const active = skill.desc.includes('elite or higher-tier')
                && effect.TriggerCondition1 === 28
                && effect.TriggerParam1 === '2,3,4';

            return {
                active,
                text: skill.desc,
                detail: `TriggerCondition1=${effect.TriggerCondition1}, param="${effect.TriggerParam1}" = LORD(2)/LEADER(3)/ELITE(4); BOSSRUSH(7) and JOINTDRILLBOSS(8) excluded`,
            };
        },
    },
    {
        heading: 'Daylight Garden > Swaying Petals',
        check() {
            const skill = DISC['214028'].secondarySkill2;
            const classSource = extractMethod(getHotfix(), 'public class Disc_214028 : DiscScriptBase');
            const damaged = extractMethod(classSource, 'protected override void OnPlayerActorDamaged(PlayerAdventureActor actor, MonsterAdventureActor monster, AdventureActorReceiveDamageEvent damageEvent)');
            const checksMain = damaged.includes('isAssist')
                || damaged.includes('actorElementInfo')
                || damaged.includes('actor == _actor')
                || damaged.includes('CheckActorIs');
            const active = skill.desc.includes('main Ventus Trekker deals DMG to the same target')
                && !checksMain;

            return {
                active,
                text: skill.desc,
                detail: `OnPlayerActorDamaged checks main ventus = ${checksMain}; text says only the main ventus trekker's damage counts`,
            };
        },
    },
    {
        heading: 'The Clash of Blade and Axe > Surging Slash',
        check() {
            const skill = DISC['214031'].secondarySkill1;
            const effect = EFFECT['4031106'];
            const active = skill.desc.includes('elite or higher-tier')
                && effect.TriggerCondition1 === 28
                && effect.TriggerParam1 === '2,3,4';

            return {
                active,
                text: skill.desc,
                detail: `TriggerCondition1=${effect.TriggerCondition1}, param="${effect.TriggerParam1}" = LORD(2)/LEADER(3)/ELITE(4); BOSSRUSH(7) and JOINTDRILLBOSS(8) excluded`,
            };
        },
    },
    {
        heading: 'Dream Factory of ☆Truth > Dream Factory of ☆Truth',
        check() {
            const skill = DISC['214032'].mainSkill;
            const effect = EFFECT['4032021'];
            const buff = BUFFVALUE['4032021'];
            const active = buff.Effects.includes(4032021)
                && effect.Trigger === 1
                && effect.Target1 === 2;

            return {
                active,
                text: skill.desc,
                detail: `effect 4032021 Trigger = ${effect.Trigger}; Target1 = ${effect.Target1}`,
            };
        },
    },
    {
        heading: 'Dancing with the Bones > Buried Past',
        check() {
            const skill = DISC['214033'].secondarySkill2;
            const active = skill.desc.includes('ATK')
                && skill.effectType.includes('Skill DMG (base)');

            return {
                active,
                text: skill.desc,
                detail: `text says ATK; effectType = ${skill.effectType.join(', ')}`,
            };
        },
    },
    {
        heading: "Veiled Dawn of Spring > Blossom's Requiring",
        check() {
            const skill = DISC['214044'].secondarySkill2;
            const classSource = extractMethod(getHotfix(), 'public class Disc_214044 : DiscScriptBase');
            const damaged = extractMethod(classSource, 'protected override void OnPlayerActorDamaged(PlayerAdventureActor actor, MonsterAdventureActor target, AdventureActorReceiveDamageEvent damageEvent)');
            const skillOnly = damaged.includes('damageType != HotfixEnum.damageType.SKILL');
            const active = skillOnly && skill.desc.includes('deals DMG');

            return {
                active,
                text: skill.desc,
                detail: `hit counter requires damageType.SKILL = ${skillOnly}; en text says DMG, jp/kr/tw/cn text all say skill damage`,
            };
        },
    },
    {
        heading: 'Petals of Blooming Mirage > Lunar Mirage',
        check() {
            const skill = DISC['214045'].secondarySkill2;
            const effect = EFFECTVALUE['4045221'];
            const active = effect.EffectTypeFirstSubtype === 78
                && skill.desc.includes('Auto Attack Crit DMG');

            return {
                active,
                text: skill.desc,
                detail: `Dark Shackles buff 4045221 subtype = ${effect.EffectTypeFirstSubtype} (78 = Skill Crit DMG); en text says Auto Attack Crit DMG, jp/kr/tw/cn text all say Skill Crit DMG`,
            };
        },
    },
    {
        heading: 'Phantom of the Banquet > Umbral Harmony',
        check() {
            const skill = DISC['214050'].secondarySkill1;
            const buff = BUFFVALUE['4050124'];
            const broken = buff.Effects.includes(4051044);
            const missing = EFFECT['4051044'] === undefined
                && EFFECTVALUE['4051044'] === undefined;
            const correct = EFFECTVALUE['4050144'];
            const active = broken && missing && correct !== undefined;

            return {
                active,
                text: skill.desc,
                detail: `stage 4 buff 4050124 effects: ${buff.Effects.join(', ')}; 4051044 exists = ${!missing}; correct 4050144 = ${correct ? correct.EffectTypeParam1 : 'missing'}`,
            };
        },
    },
    {
        heading: 'Touch of Miracle > Touch of Miracle',
        check() {
            const skill = DISC['214052'].mainSkill;
            const classSource = extractMethod(getHotfix(), 'public class Disc_214052 : DiscScriptBase');
            const castSkill = extractMethod(classSource, 'protected override void OnPlayerActorCastSkill(PlayerAdventureActor actor, AdventureActorCastSkillEvent castSkillEvent)');
            const atkBuff = BUFFVALUE['4052021'];
            const addsAtkBuff = castSkill.includes('buffId_1_atk[stage_s1]')
                && castSkill.includes('GetBuffNumByID(_activeKlaBuffId) >= 2');
            const removesAtkBuff = classSource.includes('RemoveBuffByBuffId')
                || classSource.includes('OnRemoveBuff');
            const permanent = atkBuff.Time === -10000;
            const active = skill.desc.includes('2 stacks of Assembly')
                && addsAtkBuff
                && permanent
                && !removesAtkBuff;

            return {
                active,
                text: skill.desc,
                detail: `atk buff 4052021 added at 2 stacks = ${addsAtkBuff}; permanent = ${permanent}; removed when Assembly drops = ${removesAtkBuff}`,
            };
        },
    },
    {
        heading: 'Little Paradise > Symphony Box',
        check() {
            const skill = DISC['214054'].secondarySkill2;
            const classSource = extractMethod(getHotfix(), 'public class Disc_214054 : DiscScriptBase');
            const castSkill = extractMethod(classSource, 'protected override void OnPlayerActorCastSkillEnd(PlayerAdventureActor actor, AdventureActorCastSkillEndEvent castSkillEvent)');
            const atkBuff = BUFFVALUE['4054201'];
            const addsAtkBuff = castSkill.includes('buffId_3_atk[stage_s3]')
                && castSkill.includes('GetBuffNumByID(_activeSpaBuffId) >= 3');
            const removesAtkBuff = classSource.includes('RemoveBuffByBuffId')
                || classSource.includes('OnRemoveBuff');
            const permanent = atkBuff.Time === -10000;
            const active = skill.desc.includes('3 stacks of Loaded')
                && addsAtkBuff
                && permanent
                && !removesAtkBuff;

            return {
                active,
                text: skill.desc,
                detail: `atk buff 4054201 added at 3 stacks = ${addsAtkBuff}; permanent = ${permanent}; removed when Loaded drops = ${removesAtkBuff}`,
            };
        },
    },
    {
        heading: 'Eternal Brilliance > Light of Humanity',
        check() {
            const skill = DISC['214067'].secondarySkill2;
            const classSource = extractMethod(getHotfix(), 'public class Disc_214067 : DiscScriptBase');
            const addEternal = extractMethod(classSource, 'private void AddEternal()');
            const removeBuff = extractMethod(classSource, 'private void OnRemoveBuff(IEvent evt)');
            const maxBuff = BUFFVALUE['4067201'];
            const addsMaxBuff = addEternal.includes('buffId_3_full[stage_s3]')
                && addEternal.includes('HaveBuffNumMax(_eternalBuffId)');
            const removesMaxBuff = removeBuff.includes('buffId_3_full[stage_s3]');
            const permanent = maxBuff.Time === -10000;
            const active = skill.desc.includes('When Eternity is at max stacks')
                && addsMaxBuff
                && permanent
                && !removesMaxBuff;

            return {
                active,
                text: skill.desc,
                detail: `max-stack buff 4067201 added = ${addsMaxBuff}; permanent = ${permanent}; removed when Eternity drops = ${removesMaxBuff}`,
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

function clipText(text, max = 400) {
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatDiscordPayload(notifications) {
    const hasActive = notifications.some(item => item.active);

    return {
        content: '<@393694671383166998>',
        username: 'stelladb',
        avatar_url: AVATAR_URL,
        embeds: [{
            title: 'stelladb',
            color: hasActive ? ACTIVE_COLOR : INACTIVE_COLOR,
            fields: notifications.map(item => {
                const label = item.type === 'text'
                    ? 'Text change'
                    : 'Behavior change';

                return {
                    name: `${label}: ${item.heading}`,
                    value: item.detail.slice(0, 1024),
                };
            }),
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

        const previousNote = previous[check.heading];
        const was = previousNote?.active;
        const previousText = previousNote?.text;
        const active = current.active;
        const text = current.text;
        const textChanged = previousText !== undefined && text !== undefined && previousText !== text;

        if (textChanged) {
            notifications.push({
                type: 'text',
                heading: check.heading,
                active,
                detail: `Behavior: still ${active ? 'active' : 'inactive'}\nOld: ${clipText(previousText)}\nNew: ${clipText(text)}`,
            });
        } else if (was === undefined ? !active : was !== active) {
            notifications.push({
                type: 'behavior',
                heading: check.heading,
                active,
                detail: `Behavior: now ${active ? 'active' : 'inactive'}\n${current.detail}`,
            });
        }

        notes[check.heading] = { active, text };

        const status = active ? 'ACTIVE' : 'INACTIVE';
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
