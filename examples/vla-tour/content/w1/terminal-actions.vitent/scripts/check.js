// A script stored inside the .vitent. Actions of type "script" run it
// with the built-in Node.js; the working folder is this page.
const os = require('os');
const fs = require('fs');

const who = process.argv.slice(2).join(' ') || 'world';
console.log(`✓ check.js is running — hello, ${who}!`);
console.log(`node ${process.version} on ${os.platform()} (${os.arch()})`);
console.log(`files in this page: ${fs.readdirSync('.').join(', ')}`);
