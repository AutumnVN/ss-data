const { existsSync, readFileSync, writeFileSync } = require('fs');

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
const HITDAMAGE = require('./EN/bin/HitDamage.json');

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
            const active = !ultraHasTag;

            return {
                active,
                text: potential.desc,
                detail: `${extraHit}; Ultimate ${ultraHasTag ? 'has' : 'lacks'} ${triggerTag}`,
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
        heading: 'Donna > Rime Shatterer',
        check() {
            const potential = findPotential('130', 513007);
            const config = getHotfix().slice(getHotfix().indexOf('areaEffectTag_UltraSkill = CommonHelper.StringToHash("130_Ultra_Area")'));
            const tag = config.match(/damageTag_Trigger_P7 = CommonHelper\.StringToHash\("([^"]+)"\)/)[1];
            const hash = crc32(tag);
            const hits = Object.values(HITDAMAGE)
                .filter(hit => Array.isArray(hit.DamageTag) && hit.DamageTag.includes(hash));
            const bonusAttr = getOnceAdditionalLevels(13007011)[0].AttributeType1;
            const active = bonusAttr === 57 && hits.some(hit => hit.DamageType === 1);

            return {
                active,
                text: potential.desc,
                detail: `elite bonus is skill dmg (attr ${bonusAttr}) but ${tag} is only on ${hits.map(hit => `${hit.Id} (damage type ${hit.DamageType})`).join(', ')}`,
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
