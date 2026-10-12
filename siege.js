const { writeFileSync } = require('fs');
const TRACEHUNTCONTROL = require('./EN/bin/TraceHuntControl.json');
const TRACEHUNTBOSS = require('./EN/bin/TraceHuntBoss.json');
const TRACEHUNTFLOORGROUP = require('./EN/bin/TraceHuntFloorGroup.json');
const TRACEHUNTSTAR = require('./EN/bin/TraceHuntStar.json');
const TRACEHUNTSCORESWITCH = require('./EN/bin/TraceHuntScoreSwitch.json');
const MONSTER = require('./EN/bin/Monster.json');
const MONSTERMANUAL = require('./EN/bin/MonsterManual.json');
const MONSTERSKIN = require('./EN/bin/MonsterSkin.json');
const MONSTERVALUETEMPLETE = require('./EN/bin/MonsterValueTemplete.json');
const MONSTERVALUETEMPLETEADJUST = require('./EN/bin/MonsterValueTempleteAdjust.json');
const MONSTERATTRIBUTECONTACT = require('./EN/bin/MonsterAttributeContact.json');
const MONSTERVALUETEMPLETEMODIFY = require('./EN/bin/MonsterValueTempleteModify.json');
const LANG_MONSTERMANUAL = require('./EN/language/en_US/MonsterManual.json');
const LANG_UITEXT = require('./EN/language/en_US/UIText.json');
const { MONSTER_EPIC_TYPE, iHateFloatingPointNumber } = require('./utils');

const DIFFICULTY_LABEL = { 1: 'Normal', 2: 'Hard' };

const siege = {};

for (const id in TRACEHUNTBOSS) {
    const traceHuntBoss = TRACEHUNTBOSS[id];

    const monster = MONSTER[traceHuntBoss.MonsterId];
    const monsterManual = MONSTERMANUAL[MONSTERSKIN[monster?.FAId]?.MonsterManual];
    const monsterValueTemplateAdjust = MONSTERVALUETEMPLETEADJUST[monster?.Templete];
    const monsterValueTemplate = Object.values(MONSTERVALUETEMPLETE).filter(templete => templete.TemplateId === monsterValueTemplateAdjust?.TemplateId)?.[0];
    const monsterAttributeContact = MONSTERATTRIBUTECONTACT[traceHuntBoss.MonsterId];
    const monsterValueTemplateModify = Object.values(MONSTERVALUETEMPLETEMODIFY).filter(modify => modify.GroupId === monsterAttributeContact?.GroupId);
    const seasons = Object.values(TRACEHUNTCONTROL).filter(season => season.BossList.includes(+id)).map(season => season.Id);
    const floorGroups = Object.values(TRACEHUNTFLOORGROUP).filter(floorGroup => floorGroup.GroupId === traceHuntBoss.FloorGroup);

    siege[id] = {
        id: traceHuntBoss.MonsterId,
        name: LANG_MONSTERMANUAL[monsterManual?.Name] || `${traceHuntBoss.MonsterId}`,
        seasons,
        icon: traceHuntBoss.TargetIcon.split('/').pop(),
        type: MONSTER_EPIC_TYPE[monster?.EpicLv],
        weakTo: monsterValueTemplateAdjust?.WeakEET?.map(type => LANG_UITEXT[`UIText.T_Element_Attr_${type}.1`]) || ['None'],
        resistTo: LANG_UITEXT[`UIText.T_Element_Attr_${monsterValueTemplateAdjust?.EET}.1`] || 'None',
        stat: monsterValueTemplate && monsterValueTemplateAdjust && monsterValueTemplateModify.map((modify, index) => {
            const cumulativeHpFix = monsterValueTemplateModify.slice(0, index + 1).reduce((sum, curr) => sum + (+curr.HpFix || 0), 0);
            const cumulativeAtkFix = monsterValueTemplateModify.slice(0, index + 1).reduce((sum, curr) => sum + (+curr.AtkFix || 0), 0);
            const cumulativeDefFix = monsterValueTemplateModify.slice(0, index + 1).reduce((sum, curr) => sum + (+curr.DefFix || 0), 0);
            const cumulativeToughnessFix = monsterValueTemplateModify.slice(0, index + 1).reduce((sum, curr) => sum + (+curr.ToughnessFix || 0), 0);
            const cumulativeEnvAmendFix = monsterValueTemplateModify.slice(0, index + 1).reduce((sum, curr) => iHateFloatingPointNumber(sum, '+', (+curr.ENVAMENDFix || 0)), 0);

            function cumulativeHp(index) {
                let index2 = 0;
                let totalHp = 0;
                while (index2 <= index) {
                    const cumulativeHpFixOfThisIndex = monsterValueTemplateModify.slice(0, index2 + 1).reduce((sum, curr) => sum + (+curr.HpFix || 0), 0);
                    totalHp += Math.floor((monsterValueTemplate.Hp * (1 + (monsterValueTemplateAdjust.HpRatio / 10000 || 0)) + (cumulativeHpFixOfThisIndex || 0) + (monsterValueTemplateAdjust.HpFix || 0)));
                    index2++;
                }
                return totalHp;
            }

            return {
                'Level': modify.Lv,
                'HP': Math.floor((monsterValueTemplate.Hp * (1 + (monsterValueTemplateAdjust.HpRatio / 10000 || 0)) + (cumulativeHpFix || 0) + (monsterValueTemplateAdjust.HpFix || 0))),
                'Cumulative HP': cumulativeHp(index),
                'Estimated Score Damage': formatByDifficulty(floorGroups, floorGroup => {
                    const rate = getScoreSwitch(floorGroup, modify.Lv) || 0;
                    const high = Math.floor(cumulativeHp(index) / rate);
                    return `${[Math.floor(cumulativeHp(index - 1) / rate), high].map(value => value.toLocaleString()).join(' - ')} (${getStar(floorGroup, high)}*)`;
                }),
                'Damage Per Score': formatByDifficulty(floorGroups, floorGroup => (getScoreSwitch(floorGroup, modify.Lv) || 0).toLocaleString()),
                'ATK': monsterValueTemplate.Atk === undefined ? undefined : Math.floor(monsterValueTemplate.Atk * (1 + (monsterValueTemplateAdjust.AtkRatio / 10000 || 0)) + (cumulativeAtkFix || 0) + (monsterValueTemplateAdjust.AtkFix || 0)),
                'DEF': Math.floor(monsterValueTemplate.Def * (1 + (monsterValueTemplateAdjust.DefRatio || 0)) + (cumulativeDefFix || 0) + (monsterValueTemplateAdjust.DefFix || 0)),
                'Environment Adjustment': iHateFloatingPointNumber(iHateFloatingPointNumber(1, '+', (cumulativeEnvAmendFix || 0)), '*', 100) + '%',
                'Hit Rate': monsterValueTemplate.HitRate / 100 + '%',
                'Attack Speed': monsterValueTemplate.AtkSpd / 100 + '%',
                'Aqua DMG': monsterValueTemplate.WEE / 100 + '%',
                'Ignis DMG': monsterValueTemplate.FEE / 100 + '%',
                'Terra DMG': monsterValueTemplate.SEE / 100 + '%',
                'Ventus DMG': monsterValueTemplate.AEE / 100 + '%',
                'Lux DMG': monsterValueTemplate.LEE / 100 + '%',
                'Umbra DMG': monsterValueTemplate.DEE / 100 + '%',
                'Mark DMG Taken': monsterValueTemplate.RCDMARKDMG / 100 + '%',
                'Resilience': Math.floor(monsterValueTemplate.Toughness * (1 + (monsterValueTemplateAdjust.ToughnessRatio / 10000 || 0)) + (cumulativeToughnessFix || 0) + (monsterValueTemplateAdjust.ToughnessFix || 0)) || undefined,
                'Aqua RES': monsterValueTemplateAdjust.WERFix,
                'Ignis RES': monsterValueTemplateAdjust.FERFix,
                'Terra RES': monsterValueTemplateAdjust.SERFix,
                'Ventus RES': monsterValueTemplateAdjust.AERFix,
                'Lux RES': monsterValueTemplateAdjust.LERFix,
                'Umbra RES': monsterValueTemplateAdjust.DERFix,
            }
        }),
    }
}

writeFileSync('./siege.json', JSON.stringify(siege, null, 4));

function formatByDifficulty(floorGroups, valueFn) {
    const sorted = [...floorGroups].sort((a, b) => a.Difficult - b.Difficult);
    if (sorted.length <= 1) return sorted.map(valueFn).join(' / ');
    return sorted.map(floorGroup => `${DIFFICULTY_LABEL[floorGroup.Difficult]}: ${valueFn(floorGroup)}`).join(' / ');
}

function getStar(floorGroup, score) {
    const stars = Object.values(TRACEHUNTSTAR).filter(star => star.Difficulty === floorGroup.Difficult).sort((a, b) => b.ScoreNeed - a.ScoreNeed);
    return stars.find(star => score >= star.ScoreNeed)?.Star || 0;
}

function getScoreSwitch(floorGroup, level) {
    return TRACEHUNTSCORESWITCH[`${floorGroup.ScoreGetSwitchGroup}${String(level).padStart(3, '0')}`]?.SwitchRate;
}
