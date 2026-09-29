const { readFileSync } = require('fs');

const HOTFIX_FILE = `${__dirname}/hotfix/out/Hotfix.dec.decompiled.cs`;

const ELEMENTS = { WE: 1, FE: 2, SE: 3, AE: 4, LE: 5, DE: 6 };
const ELEMENTS_BY_NAME = { Water: 1, Fire: 2, Land: 3, Earth: 3, Air: 4, Wind: 4, Light: 5, Dark: 6 };

const ELEMENT_CODES = /(?:\(\s*(?:int|elementType)\s*\)\s*[\w.]*)?elementType(?:\s*\)\s*|\s*[!=]=\s*)([1-6])\b/g;

function parse(block) {
    const elements = new Set();
    for (const [, code] of block.matchAll(/\belementType\.([A-Z]{2})\b/g)) {
        if (ELEMENTS[code]) elements.add(ELEMENTS[code]);
    }
    for (const [, value] of block.matchAll(ELEMENT_CODES)) elements.add(+value);
    for (const [, name] of block.matchAll(/\bCommonDefine\.(Water|Fire|Land|Earth|Wind|Air|Light|Dark)(?![A-Za-z])/g)) {
        elements.add(ELEMENTS_BY_NAME[name]);
    }

    const proc = block.includes('TriggerElementMarkEvent');
    const apply = /[^0-9][1-6]011[^0-9]/.test(block);

    return {
        element: elements.size === 1 ? [...elements][0] : 0,
        class: proc ? (apply ? 2 : 1) : (apply ? 3 : 0),
    };
}

async function getHotfixData() {
    const lines = readFileSync(HOTFIX_FILE, 'utf8').split(/\r?\n/);

    const characters = {};
    let depth = 0, id = 0, start = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/"(?:[^"\\]|\\.)*"/g, '""');
        const namespace = /^namespace AIScript\.Character\._(\d{3})01/.exec(line);
        if (namespace) id = +namespace[1];
        if (depth === 1 && /^\s*(?:public|internal)\s+(?:sealed |abstract |partial )*class ActionScript\b/.test(line)) start = i;
        if (!line.includes('{') && !line.includes('}')) continue;

        for (const char of line) {
            if (char === '{') depth++;
            else if (char === '}' && --depth < 1 && start) {
                if (id) characters[id] = parse(lines.slice(start, i + 1).join('\n'));
                start = 0;
            }
        }
    }

    return characters;
}

module.exports = { getHotfixData };
