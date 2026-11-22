// After building, point index.html at the new app.js/styles.css so browsers never use an old copy.
const fs = require('fs'); const crypto = require('crypto');
const h = crypto.createHash('sha1').update(fs.readFileSync('app.js')).update(fs.readFileSync('styles.css')).digest('hex').slice(0, 8);
let i = fs.readFileSync('index.html', 'utf8');
i = i.replace(/src="app\.js(\?v=[0-9a-f]+)?"/, `src="app.js?v=${h}"`).replace(/href="styles\.css(\?v=[0-9a-f]+)?"/, `href="styles.css?v=${h}"`);
fs.writeFileSync('index.html', i);
let s = fs.readFileSync('sw.js', 'utf8'); s = s.replace(/const VERSION = '[^']+'/, `const VERSION = 'cruce-${h}'`); fs.writeFileSync('sw.js', s);
console.log('stamp', h);
