const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron');
const appPath = path.join(__dirname, '..');

const child = spawn(electron, ['--inspect', appPath], {
  stdio: 'inherit',
});

child.on('close', (code) => {
  process.exit(code);
});
