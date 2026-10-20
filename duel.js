const { writeFileSync } = require('fs');
const { MONSTER_EPIC_TYPE, ATTR_TYPE, EFFECT_TYPE, formatEffectType, formatAddAttrType, collectParamsFrom, resolveParam, resolveParamsTooltips } = require('./utils');
const TRAVELERDUELBOSSLEVEL = require('./EN/bin/TravelerDuelBossLevel.json');
const TRAVELERDUELCHALLENGEDIFFICULTY = require('./EN/bin/TravelerDuelChallengeDifficulty.json');
const TRAVELERDUELCHALLENGEAFFIX = require('./EN/bin/TravelerDuelChallengeAffix.json');
const TRAVELERDUELCHALLENGECONTROL = require('./EN/bin/TravelerDuelChallengeControl.json');
const PREVIEWMONSTERGROUP = require('./EN/bin/PreviewMonsterGroup.json');
const MONSTER = require('./EN/bin/Monster.json');
const MONSTERMANUAL = require('./EN/bin/MonsterManual.json');
const MONSTERSKIN = require('./EN/bin/MonsterSkin.json');
const MONSTERVALUETEMPLETE = require('./EN/bin/MonsterValueTemplete.json');
const MONSTERVALUETEMPLETEADJUST = require('./EN/bin/MonsterValueTempleteAdjust.json');
const EFFECTVALUE = require('./EN/bin/EffectValue.json');
const BUFF = require('./EN/bin/Buff.json');
const BUFFVALUE = require('./EN/bin/BuffValue.json');
const LANG_TRAVELERDUELBOSSLEVEL = require('./EN/language/en_US/TravelerDuelBossLevel.json');
const LANG_UITEXT = require('./EN/language/en_US/UIText.json');
const LANG_MONSTERMANUAL = require('./EN/language/en_US/MonsterManual.json');
const LANG_TRAVELERDUELCHALLENGEAFFIX = require('./EN/language/en_US/TravelerDuelChallengeAffix.json');

const duel = {};

for (const id in TRAVELERDUELBOSSLEVEL) {
    if (!MONSTER[PREVIEWMONSTERGROUP[TRAVELERDUELBOSSLEVEL[id].PreviewMonsterGroupId].MonsterIds[0]] || !MONSTERMANUAL[MONSTERSKIN[MONSTER[PREVIEWMONSTERGROUP[TRAVELERDUELBOSSLEVEL[id].PreviewMonsterGroupId].MonsterIds[0]].FAId].MonsterManual]) continue;

    const monsterId = PREVIEWMONSTERGROUP[TRAVELERDUELBOSSLEVEL[id].PreviewMonsterGroupId].MonsterIds[0];
    const monster = MONSTER[monsterId];
    const monsterManual = MONSTERMANUAL[MONSTERSKIN[monster.FAId].MonsterManual];
    const monsterValueTemplateAdjust = MONSTERVALUETEMPLETEADJUST[monster.Templete];
    const monsterValueTemplate = MONSTERVALUETEMPLETE[Object.keys(MONSTERVALUETEMPLETE).filter(key => key === `${monsterValueTemplateAdjust.TemplateId * 1000 + 1 * 10 + 1}`)[0]];

    duel[id] = {
        activityId: Object.values(TRAVELERDUELCHALLENGECONTROL).filter(c => c.BossLevelId === +id)[0].Id,
        name: `[${LANG_TRAVELERDUELBOSSLEVEL[TRAVELERDUELBOSSLEVEL[id].Name]}] ${LANG_MONSTERMANUAL[monsterManual.Name]}`,
        icon: monsterManual.Icon.split('/').pop(),
        type: MONSTER_EPIC_TYPE[monster.EpicLv],
        mechanic: Object.values(TRAVELERDUELCHALLENGECONTROL).filter(c => c.BossLevelId === +id)[0].AffixGroupIds.match(/\d+/g).map(gid => {
            return Object.values(TRAVELERDUELCHALLENGEAFFIX).filter(aff => aff.GroupId === +gid).map(aff => {
                const desc = LANG_TRAVELERDUELCHALLENGEAFFIX[aff.Desc];
                const params = collectParamsFrom(aff);
                const resolvedParams = resolveParam(params);

                return {
                    name: LANG_TRAVELERDUELCHALLENGEAFFIX[aff.Name],
                    desc,
                    params,
                    value: resolvedParams,
                    paramsTooltips: resolveParamsTooltips(params),
                    effectType: getAffixEffectTypes(aff),
                    addAttrType: getAffixAddAttrTypes(aff),
                    buffIcon: getAffixBuffIcons(aff),
                    diff: aff.Difficulty,
                    icon: aff.Icon.split('/').pop(),
                };
            });
        }),
        weakTo: TRAVELERDUELBOSSLEVEL[id].EET?.map(type => LANG_UITEXT[`UIText.T_Element_Attr_${type}.1`]) || ['None'],
        resistTo: LANG_UITEXT[`UIText.T_Element_Attr_${monsterValueTemplateAdjust.EET}.1`],
        stat: {
            'HP': Math.floor(monsterValueTemplate.Hp * (1 + (monsterValueTemplateAdjust.HpRatio / 10000 || 0)) + (monsterValueTemplateAdjust.HpFix || 0)),
            'ATK': Math.floor(monsterValueTemplate.Atk * (1 + (monsterValueTemplateAdjust.AtkRatio / 10000 || 0)) + (monsterValueTemplateAdjust.AtkFix || 0)),
            'DEF': monsterValueTemplate.Def,
            'Hit Rate': monsterValueTemplate.HitRate / 100 + '%',
            'Attack Speed': monsterValueTemplate.AtkSpd / 100 + '%',
            'Aqua DMG': monsterValueTemplate.WEE / 100 + '%',
            'Ignis DMG': monsterValueTemplate.FEE / 100 + '%',
            'Terra DMG': monsterValueTemplate.SEE / 100 + '%',
            'Ventus DMG': monsterValueTemplate.AEE / 100 + '%',
            'Lux DMG': monsterValueTemplate.LEE / 100 + '%',
            'Umbra DMG': monsterValueTemplate.DEE / 100 + '%',
            'Mark DMG Taken': monsterValueTemplate.RCDMARKDMG / 100 + '%',
            'Resilience': Math.floor(monsterValueTemplate.Toughness * (1 + (monsterValueTemplateAdjust.ToughnessRatio / 10000 || 0)) + (monsterValueTemplateAdjust.ToughnessFix || 0)) || undefined,
            'Aqua RES': monsterValueTemplateAdjust.WERFix,
            'Ignis RES': monsterValueTemplateAdjust.FERFix,
            'Terra RES': monsterValueTemplateAdjust.SERFix,
            'Ventus RES': monsterValueTemplateAdjust.AERFix,
            'Lux RES': monsterValueTemplateAdjust.LERFix,
            'Umbra RES': monsterValueTemplateAdjust.DERFix,
        },
        diff: Object.values(TRAVELERDUELCHALLENGEDIFFICULTY).slice(0, 151).map(diff => {
            if (!diff.EffectId) return {};

            const effects = Object.fromEntries(diff.EffectId.filter(effectId => EFFECT_TYPE[EFFECTVALUE[effectId].EffectType] === 'ATTR_FIX').map(effectId => {
                const effect = EFFECTVALUE[effectId];
                return [ATTR_TYPE[effect.EffectTypeFirstSubtype], +effect.EffectTypeParam1];
            }))

            return effects;
        })
    };
}

function getAffixEffectTypes(aff) {
    const effectTypes = [];

    for (const skillId of aff.SkillId || []) {
        for (const effectId of getLeafEffectIds(skillId)) {
            const effect = EFFECTVALUE[effectId];
            if (effect.EffectType === 46) continue;

            let type = effect.EffectTypeFirstSubtype;
            if (!type) type = EFFECTVALUE[effect.EffectTypeParam1]?.EffectTypeFirstSubtype;
            if (type === undefined || type === null) continue;

            effectTypes.push(formatEffectType(effectId, type, effect.EffectTypeSecondSubtype).replace(/^HITTED_ADDITIONAL_*:/, ''));
        }
    }

    return [...new Set(effectTypes)];
}

function getAffixAddAttrTypes(aff) {
    const addAttrTypes = [];

    for (const skillId of aff.SkillId || []) {
        for (const effectId of getLeafEffectIds(skillId)) {
            const effect = EFFECTVALUE[effectId];
            const effectType = EFFECT_TYPE[effect.EffectType] || '';
            if (!effectType.includes('ATTR_FIX') && effect.EffectType !== 46) continue;

            const type = effect.EffectTypeFirstSubtype;
            const paramType = effect.EffectTypeSecondSubtype;
            if (type === undefined || type === null) continue;

            let addAttrType = formatAddAttrType(type, paramType);
            if (effect.EffectType === 46) addAttrType = ATTR_TYPE[type] || addAttrType;

            addAttrTypes.push(addAttrType);
        }
    }

    return [...new Set(addAttrTypes)];
}

function getLeafEffectIds(effectId, seen = new Set()) {
    if (seen.has(effectId)) return [];
    seen.add(effectId);

    const effect = EFFECTVALUE[effectId];
    if (!effect) return [];

    if (effect.EffectType === 6) {
        const nested = (BUFFVALUE[effect.EffectTypeParam1]?.Effects || [])
            .flatMap(id => getLeafEffectIds(id, seen));

        if (nested.length) return nested;
    }

    return [effectId];
}

function getAffixBuffIcons(aff) {
    const buffIcons = [];

    for (const skillId of aff.SkillId || []) {
        const effect = EFFECTVALUE[skillId];
        if (!effect) continue;

        const buffIds = [skillId];
        if (effect.EffectType === 6 || effect.EffectType === 9) {
            const paramId = +effect.EffectTypeParam1;
            if (Number.isFinite(paramId)) buffIds.push(paramId);
        }

        for (const buffId of buffIds) {
            if (!BUFF[buffId]) continue;

            buffIcons.push(BUFF[buffId].Icon ? BUFF[buffId].Icon.split('/').pop() : 'No Icon');
        }
    }

    return [...new Set(buffIcons)];
}

writeFileSync('./duel.json', JSON.stringify(duel, null, 4));
