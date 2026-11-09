// Does the asar that is actually installed carry the fixes? Reads the packed files through Electron's own asar reader.
const asar = require('@electron/asar');
const path = require('node:path');
const p = path.join(process.env.LOCALAPPDATA, 'Programs', 'PillCrew Sniper', 'resources', 'app.asar');
const app = asar.extractFile(p, 'renderer/app.js').toString();
const main = asar.extractFile(p, 'main.js').toString();
const pet = asar.extractFile(p, 'src/pet.js').toString();
console.log('chips loop fixed:', app.includes("$$('#chatChips .chip')"));
console.log('look on change:', app.includes('relookNow'));
console.log('applyWindowPrefs at module scope:', /^function applyWindowPrefs/m.test(main));
console.log('edge inset:', pet.includes('PET_EDGE_INSET'));
console.log('pet.html cap:', asar.extractFile(p, 'renderer/pet.html').toString().includes('PET_HEADROOM'));
