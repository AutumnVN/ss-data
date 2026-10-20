const { writeFileSync } = require('fs');
const ACTIVITY = require('./EN/bin/Activity.json');
const JOINTDRILLAFFIX = require('./EN/bin/JointDrillAffix.json');
const JOINTDRILLCONTROL = require('./EN/bin/JointDrillControl.json');
const JOINTDRILLLEVEL = require('./EN/bin/JointDrillLevel.json');
const JOINTDRILL_2_LEVEL = require('./EN/bin/JointDrill_2_Level.json');
const MONSTER = require('./EN/bin/Monster.json');
const MONSTERMANUAL = require('./EN/bin/MonsterManual.json');
const MONSTERSKIN = require('./EN/bin/MonsterSkin.json');
const MONSTERVALUETEMPLETE = require('./EN/bin/MonsterValueTemplete.json');
const MONSTERVALUETEMPLETEADJUST = require('./EN/bin/MonsterValueTempleteAdjust.json');
const EFFECTVALUE = require('./EN/bin/EffectValue.json');
const BUFF = require('./EN/bin/Buff.json');
const BUFFVALUE = require('./EN/bin/BuffValue.json');
const LANG_JOINTDRILLAFFIX = require('./EN/language/en_US/JointDrillAffix.json');
const LANG_JOINTDRILLLEVEL = require('./EN/language/en_US/JointDrillLevel.json');
const LANG_JOINTDRILL_2_LEVEL = require('./EN/language/en_US/JointDrill_2_Level.json');
const LANG_UITEXT = require('./EN/language/en_US/UIText.json');
const LANG_MONSTERMANUAL = require('./EN/language/en_US/MonsterManual.json');
const { MONSTER_EPIC_TYPE, formatEffectType, ATTR_TYPE } = require('./utils');
const { getHotfixJointDrillBuffs } = require('./hotfix');

const raid = {};

for (const drillId in JOINTDRILLCONTROL) {
    const drillLevelGroupId = JOINTDRILLCONTROL[drillId].DrillLevelGroupId;
    if ([51001].includes(drillLevelGroupId)) continue;
    const drillLevels = [...Object.values(JOINTDRILLLEVEL), ...Object.values(JOINTDRILL_2_LEVEL)].filter(level => level.DrillLevelGroupId === drillLevelGroupId);
    drillLevels.forEach(level => typeof level.BossId === 'number' && (level.BossId = [level.BossId]));
    const season = drillLevelGroupId % 51000;

    if (!MONSTER[drillLevels[0].BossId[0]]) continue;

    const effectLevels = getJointDrillEffects(MONSTER[drillLevels[0].BossId[0]].FCId, drillLevels.length);

    raid[drillLevelGroupId] = {
        id: drillLevelGroupId,
        name: `[${LANG_MONSTERMANUAL[MONSTERMANUAL[MONSTERSKIN[MONSTER[drillLevels[0].BossId[0]].FAId].MonsterManual].Name]}] ${LANG_JOINTDRILLLEVEL[drillLevels[0].SubName] || LANG_JOINTDRILL_2_LEVEL[drillLevels[0].SubName]}`,
        season,
        icon: MONSTERMANUAL[MONSTERSKIN[MONSTER[drillLevels[0].BossId[0]].FAId].MonsterManual].Icon.split('/').pop(),
        icons: drillLevels[0].BossId.length > 1 && drillLevels[0].BossId.map(bossId => MONSTERMANUAL[MONSTERSKIN[MONSTER[bossId].FAId].MonsterManual].Icon.split('/').pop()) || undefined,
        type: MONSTER_EPIC_TYPE[MONSTER[drillLevels[0].BossId[0]].EpicLv],
        effects: mergeEffectLevels(effectLevels),
        mechanic: drillLevels[0].BossAffix.map(affixId => ({
            name: LANG_JOINTDRILLAFFIX[JOINTDRILLAFFIX[affixId].Name],
            desc: LANG_JOINTDRILLAFFIX[JOINTDRILLAFFIX[affixId].Desc],
            icon: JOINTDRILLAFFIX[affixId].Icon.split('/').pop(),
        })),
        weakTo: MONSTERVALUETEMPLETEADJUST[MONSTER[drillLevels[drillLevels.length - 1].BossId[0]].Templete].WeakEET?.length ? MONSTERVALUETEMPLETEADJUST[MONSTER[drillLevels[drillLevels.length - 1].BossId[0]].Templete].WeakEET.map(type => LANG_UITEXT[`UIText.T_Element_Attr_${type}.1`]) : ['None'],
        resistTo: (MONSTERVALUETEMPLETEADJUST[MONSTER[drillLevels[drillLevels.length - 1].BossId[0]].Templete].ResistEET?.length ? MONSTERVALUETEMPLETEADJUST[MONSTER[drillLevels[drillLevels.length - 1].BossId[0]].Templete].ResistEET.map(type => LANG_UITEXT[`UIText.T_Element_Attr_${type}.1`]) : ['None'])[0],
        diff: drillLevels.map((level, index) => {
            return {
                name: LANG_UITEXT[`UIText.JointDrill_Difficulty_Name_${index + 1}.1`],
                stat: level.BossId.map((bossId) => {
                    return [bossId, bossId + 1].filter(bossId => MONSTER[bossId]?.EpicLv === 8).map(bossId => {
                        const monster = MONSTER[bossId];
                        const monsterValueTemplateAdjust = MONSTERVALUETEMPLETEADJUST[monster.Templete];
                        const monsterValueTemplate = Object.values(MONSTERVALUETEMPLETE).filter(templete => templete.TemplateId === monsterValueTemplateAdjust.TemplateId)[index];

                        return {
                            'Type': MONSTER_EPIC_TYPE[monster.EpicLv],
                            'HP': Math.floor(monsterValueTemplate.Hp * (1 + (monsterValueTemplateAdjust.HpRatio / 10000 || 0)) + (monsterValueTemplateAdjust.HpFix || 0)),
                            'HP Bar': level.HpBarNum,
                            'Max Score': level.LevelScore + level.TimeScore + level.BaseHpScore,
                            'Score': `${level.LevelScore} + (${level.TimeScore} - time_in_seconds * ${level.ScorePerSec}) + ${level.BaseHpScore}`,
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
                        };
                    });
                }),
                bookStat: getBookStat(drillLevels[drillLevels.length - 1].BossId[0], index),
            }
        }),
    };
}

writeFileSync('./raid.json', JSON.stringify(raid, null, 4));

function getJointDrillEffects(fcId, count) {
    const prefix = String(fcId || '').slice(0, 5);
    const { all, levels } = getHotfixJointDrillBuffs(prefix);

    if (!all.length) return Array.from({ length: count }, () => []);

    const levelMapped = new Set(levels.flat().filter(Boolean));
    const constants = all.filter(id => !levelMapped.has(id));
    const hasLevels = levels.some(ids => ids && ids.length);

    return Array.from({ length: count }, (_, index) => {
        const ids = new Set(constants);
        const levelIds = levels[index + 1] || [];

        if (levelIds.length) {
            levelIds.forEach(id => ids.add(id));
        } else if (!hasLevels) {
            all.forEach(id => ids.add(id));
        }

        const effects = [...ids].flatMap(getBuffEffects);
        const seen = new Set();

        return effects.filter(effect => {
            const key = `${effect.type}|${effect.value}|${effect.icon}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    });
}

function getBuffEffects(buffId) {
    const buff = BUFF[buffId];
    const buffValue = BUFFVALUE[buffId];
    const effectIds = buffValue?.Effects?.length ? buffValue.Effects : EFFECTVALUE[buffId] ? [buffId] : [];
    const icon = buff?.Icon ? buff.Icon.split('/').pop() : undefined;

    return effectIds.flatMap(effectId => {
        const effect = EFFECTVALUE[effectId];
        if (!effect) return [];

        let type = effect.EffectTypeFirstSubtype;
        if (!type) type = EFFECTVALUE[effect.EffectTypeParam1]?.EffectTypeFirstSubtype;
        const paramType = effect.EffectTypeSecondSubtype;
        const assignment = effect.EffectType === 46;
        let effectType = formatEffectType(effectId, type, paramType);

        if (assignment) {
            effectType = ATTR_TYPE[type] || effectType;
        }

        effectType = effectType.replace(/^HITTED_ADDITIONAL_*:/, '');

        const number = Number(effect.EffectTypeParam1);

        return [{
            type: effectType,
            value: formatEffectValue(effect.EffectTypeParam1),
            number: Number.isFinite(number) ? number : undefined,
            icon,
        }];
    });
}

function formatEffectValue(value) {
    if (value === undefined || value === null || value === '') return undefined;

    const number = Number(value);
    if (!Number.isFinite(number)) return undefined;

    const isRate = Math.abs(number) <= 1;
    const scaled = isRate ? number * 100 : number;
    const formatted = Number(scaled.toFixed(2)).toString();

    return `${formatted}${isRate ? '%' : ''}`;
}

function mergeEffectLevels(effectLevels) {
    const merged = new Map();

    effectLevels.forEach((effects, index) => {
        const groups = new Map();

        effects.forEach(effect => {
            const groupKey = `${effect.type}|${effect.icon}|${Math.sign(effect.number) || 0}`;
            const group = groups.get(groupKey) || [];
            group.push(effect);
            groups.set(groupKey, group);
        });

        for (const [groupKey, group] of groups) {
            group.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

            group.forEach((effect, slot) => {
                const key = `${groupKey}|${slot}`;
                const entry = merged.get(key) || {
                    type: effect.type,
                    icon: effect.icon,
                    values: Array(effectLevels.length).fill('-'),
                };

                entry.values[index] = effect.value ?? '-';
                merged.set(key, entry);
            });
        }
    });

    return [...merged.values()].map(entry => ({
        type: entry.type,
        value: entry.values.join('/'),
        icon: entry.icon,
    }));
}

function getBookStartId(lastDiffBossId) {
    for (let i = lastDiffBossId + 1; i <= lastDiffBossId + 20; i++) {
        const monster = MONSTER[i];
        const skin = monster && MONSTERSKIN[monster.FAId];

        if (skin?.Model?.includes('Book_')) {
            return i;
        }
    }

    return;
}

function getBookStat(lastDiffBossId, index) {
    const bookStartId = getBookStartId(lastDiffBossId);
    if (!bookStartId) return;

    const monster = MONSTER[bookStartId];
    const monsterValueTemplateAdjust = MONSTERVALUETEMPLETEADJUST[monster.Templete];
    const monsterValueTemplate = Object.values(MONSTERVALUETEMPLETE).filter(templete => templete.TemplateId === monsterValueTemplateAdjust.TemplateId)[index];

    return {
        'Type': MONSTER_EPIC_TYPE[monster.EpicLv],
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
        'Aqua RES': monsterValueTemplateAdjust.WERFix,
        'Ignis RES': monsterValueTemplateAdjust.FERFix,
        'Terra RES': monsterValueTemplateAdjust.SERFix,
        'Ventus RES': monsterValueTemplateAdjust.AERFix,
        'Lux RES': monsterValueTemplateAdjust.LERFix,
        'Umbra RES': monsterValueTemplateAdjust.DERFix,
    };
}
