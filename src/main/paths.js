/* Paths used by the main process. `--user-data=<dir>` overrides the
   profile folder (tests use it to start from a clean library). */
import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';

const arg = process.argv.find(a => a.startsWith('--user-data='));
const dir = arg ? arg.slice('--user-data='.length).trim() : '';
if (dir) app.setPath('userData', path.resolve(dir));

export const isDev = process.argv.includes('--dev');

export const P = {
  get root() { return app.getAppPath(); },
  get data() { return app.getPath('userData'); },
  get library() { return path.join(this.data, 'library'); },
  get index() { return path.join(this.data, 'library.json'); },
  get state() { return path.join(this.data, 'state'); },
  get settings() { return path.join(this.data, 'settings.json'); },
  get temp() { return path.join(this.data, 'tmp'); },
  get bin() { return path.join(this.data, 'bin'); },
  get renderer() { return path.join(this.root, 'dist', 'renderer'); },
  get kit() { return path.join(this.root, 'dist', 'kit'); },
  get examples() {
    return app.isPackaged ? path.join(process.resourcesPath, 'examples') : path.join(this.root, 'examples');
  },
  get defaultWorkDir() { return path.join(app.getPath('documents') || os.homedir(), 'VibeLearn'); },
};
