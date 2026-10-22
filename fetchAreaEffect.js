const { rmSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');

const URL = 'https://raw.githubusercontent.com/AutumnVN/ssassets/main/areaEffect.json';
const OUTPUT = `${tmpdir()}/areaEffect.json`;

const PRECISION = 7;

function round(value) {
    if (typeof value !== 'number' || !isFinite(value)) return value;
    return Math.round(value * 10 ** PRECISION) / 10 ** PRECISION;
}

function getHits(duration, hitDelay, hitInterval) {
    if (hitInterval <= 0) return hitDelay <= duration ? 1 : 0;
    if (duration <= hitDelay) return 0;

    const ratio = Math.round((duration - hitDelay) / hitInterval * 1e9) / 1e9;

    return Math.max(1, Math.ceil(ratio));
}

function clear(entry) {
    if (!entry || typeof entry !== 'object') return entry;

    const duration = entry.duration === undefined ? undefined : round(entry.duration);
    const hitDelay = entry.hitDelay === undefined ? undefined : round(entry.hitDelay);
    const hitInterval = entry.hitInterval === undefined ? undefined : round(entry.hitInterval);

    const timerOnly = entry.copyBattleDataBeforeAttack !== undefined && !(entry.triggers || []).length;
    const hits = timerOnly && duration !== undefined && hitDelay !== undefined && hitInterval !== undefined
        ? getHits(duration, hitDelay, hitInterval)
        : entry.hits;

    return { ...entry, duration, hitDelay, hitInterval, hits };
}

rmSync(OUTPUT, { force: true });

(async () => {
    try {
        const response = await fetch(URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const map = JSON.parse(await response.text());
        const cleared = {};

        for (const [id, entry] of Object.entries(map)) cleared[id] = clear(entry);

        writeFileSync(OUTPUT, JSON.stringify(cleared, null, 2));
    } catch (error) {
        console.error(`areaEffect: failed to load ${URL}: ${error.message}`);
    }
})();
