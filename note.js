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
