const { writeFileSync } = require('fs');
const { MONSTER_EPIC_TYPE } = require('./utils');
const VAMPIRESURVIVOR = require('./EN/bin/VampireSurvivor.json');
const VAMPIREFLOOR = require('./EN/bin/VampireFloor.json');
const VAMPIREENEMYPOOL = require('./EN/bin/VampireEnemyPool.json');
const PREVIEWMONSTERGROUP = require('./EN/bin/PreviewMonsterGroup.json');
const MONSTER = require('./EN/bin/Monster.json');
const MONSTERMANUAL = require('./EN/bin/MonsterManual.json');
const MONSTERSKIN = require('./EN/bin/MonsterSkin.json');
const MONSTERVALUETEMPLETE = require('./EN/bin/MonsterValueTemplete.json');
const MONSTERVALUETEMPLETEADJUST = require('./EN/bin/MonsterValueTempleteAdjust.json');
const LANG_VAMPIRESURVIVOR = require('./EN/language/en_US/VampireSurvivor.json');
const LANG_UITEXT = require('./EN/language/en_US/UIText.json');
const LANG_MONSTERMANUAL = require('./EN/language/en_US/MonsterManual.json');

const bossLevelByPool = {};

for (const pool of Object.values(VAMPIREENEMYPOOL)) {
    if (pool.PoolType === 2 && bossLevelByPool[pool.PoolId] === undefined) {
        bossLevelByPool[pool.PoolId] = pool.MonsterLevel;
    }
}

const cata = {};

for (const survivorId in VAMPIRESURVIVOR) {
    const survivor = VAMPIRESURVIVOR[survivorId];
    const floor = VAMPIREFLOOR[survivor.FloorId];

    if (!cata[survivor.Type]) {
        cata[survivor.Type] = {
            name: LANG_UITEXT[`UIText.Vampire_Hard${survivor.Type}.1`],
            icon: survivor.CoverEpisode.split('/').pop(),
            diff: {},
        };
    }

    cata[survivor.Type].diff[survivorId] = {
        name: LANG_VAMPIRESURVIVOR[survivor.Name],
        icon: survivor.CoverEpisode.split('/').pop(),
        weakTo: survivor.EET?.map(type => LANG_UITEXT[`UIText.T_Element_Attr_${type}.1`]) || ['None'],
        resistTo: survivor.NotEET?.map(type => LANG_UITEXT[`UIText.T_Element_Attr_${type}.1`]) || ['None'],
        zone: {
            '1': getZone(floor.FirstHalfPoolId, survivor.FHPreviewMonsterGroupId, floor.FHBossId, survivor.EETScore1, survivor.Name1, 1),
            ...(survivor.Mode === 2 ? { '2': getZone(floor.SecondHalfPoolId, survivor.SHPreviewMonsterGroupId, floor.SHBossId, survivor.EETScore2, survivor.Name2, 2) } : {}),
        },
    };
}

writeFileSync('./cata.json', JSON.stringify(cata, null, 4));

function getZone(poolId, previewMonsterGroupId, bossId, weakTo, nameKey, index) {
    const monsterIds = PREVIEWMONSTERGROUP[previewMonsterGroupId]?.MonsterIds ? [...PREVIEWMONSTERGROUP[previewMonsterGroupId].MonsterIds] : [];

    if (bossId && !monsterIds.includes(bossId)) {
        monsterIds.push(bossId);
    }

    monsterIds.sort((a, b) => {
        const epicDiff = MONSTER[a].EpicLv - MONSTER[b].EpicLv;
        return epicDiff !== 0 ? epicDiff : a - b;
    });

    const monster = {};

    for (const monsterId of monsterIds) {
        monster[monsterId] = getMonster(monsterId, bossLevelByPool[poolId], monsterId === bossId);
    }

    return {
        name: LANG_VAMPIRESURVIVOR[nameKey] || `Zone ${index}`,
        weakTo: weakTo?.map(type => LANG_UITEXT[`UIText.T_Element_Attr_${type}.1`]) || undefined,
        monster,
    };
}

function getMonster(monsterId, monsterLv, boss) {
    const monster = MONSTER[monsterId];
    const monsterManual = MONSTERMANUAL[MONSTERSKIN[monster.FAId].MonsterManual];
    const monsterValueTemplateAdjust = MONSTERVALUETEMPLETEADJUST[monster.Templete];
    let monsterValueTemplate;

    for (let stage = 1; stage < 7; stage++) {
        monsterValueTemplate = MONSTERVALUETEMPLETE[monsterValueTemplateAdjust.TemplateId * 1000 + monsterLv * 10 + stage];
        if (monsterValueTemplate) {
            break;
        }
    }

    return {
        name: LANG_MONSTERMANUAL[monsterManual.Name],
        icon: monsterManual.Icon.split('/').pop(),
        type: MONSTER_EPIC_TYPE[monster.EpicLv],
        boss,
        weakTo: monsterValueTemplateAdjust.WeakEET?.map(type => LANG_UITEXT[`UIText.T_Element_Attr_${type}.1`]) || ['None'],
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
    };
}