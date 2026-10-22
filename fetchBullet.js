const { rmSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');

const URL = 'https://raw.githubusercontent.com/AutumnVN/ssassets/main/bullet.json';
const OUTPUT = `${tmpdir()}/bullet.json`;

rmSync(OUTPUT, { force: true });

(async () => {
    try {
        const response = await fetch(URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        writeFileSync(OUTPUT, await response.text());
    } catch (error) {
        console.error(`bullet: failed to load ${URL}: ${error.message}`);
    }
})();
