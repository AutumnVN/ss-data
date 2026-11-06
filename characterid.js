const { writeFileSync } = require('fs');
const { fetchWithRetry } = require('./utils');

const AVGCHARACTER_URL = 'https://github.com/MakoStar/ss-lua/raw/refs/heads/main/Lua/Game/UI/Avg/_en/Preset/AvgCharacter.lua';

const characterId = {};

(async () => {
    let AVGCHARACTER;

    try {
        const response = await fetchWithRetry(AVGCHARACTER_URL);
        AVGCHARACTER = await response.text();
    } catch {
        return;
    }

    AVGCHARACTER.matchAll(/id = "avg1_(\d{3})",\r?\n?.{0,10}name = "([^"]+)"/g).forEach(([, id, name]) => {
        characterId[id] = name;
    });

    if (Object.keys(characterId).length === 0) {
        return;
    }

    writeFileSync('characterid.json', JSON.stringify(characterId, null, 4));
})();
