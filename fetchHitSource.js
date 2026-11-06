const { rmSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { fetchWithRetry } = require('./utils');

const URL = 'https://raw.githubusercontent.com/AutumnVN/ssassets/main/hitSource.json';
const OUTPUT = `${tmpdir()}/hitSource.json`;

rmSync(OUTPUT, { force: true });

(async () => {
    try {
        const response = await fetchWithRetry(URL);
        const text = await response.text();
        JSON.parse(text);
        writeFileSync(OUTPUT, text);
    } catch (error) {
        console.error(`hitSource: failed to load ${URL}: ${error.message}`);
    }
})();
