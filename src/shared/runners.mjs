/* ============================================================
 * src/shared/runners.mjs — code runner presets.
 * A course may override any field in course.json → "runners".
 *
 * Template variables (expanded by the app before running):
 *   {main}        main file           {files:.c}  every *.c in the workspace
 *   {exe}         ".exe" on Windows   {bin:main}  ./main  or  .\main.exe
 *   {node}        Node.js (built in)  {python}    detected Python 3
 *   {dir} {page} {course}             absolute folders
 *   {file}        the snippet file (fenced ```lang run blocks)
 * ============================================================ */

export const RUNNERS = {
  node: { label: 'Node.js', main: 'main.js', run: '{node} {main}' },
  typescript: { label: 'TypeScript', main: 'main.ts', run: '{node} {main}' },
  python: { label: 'Python', main: 'main.py', run: '{python} {main}' },
  c: { label: 'C (gcc)', main: 'main.c', build: 'gcc -Wall -std=c11 -g -o main{exe} {files:.c} -lm', run: '{bin:main}' },
  cpp: { label: 'C++ (g++)', main: 'main.cpp', build: 'g++ -Wall -std=c++17 -g -o main{exe} {files:.cpp}', run: '{bin:main}' },
  java: { label: 'Java', main: 'Main.java', build: 'javac {files:.java}', run: 'java Main' },
  go: { label: 'Go', main: 'main.go', run: 'go run {main}' },
  rust: { label: 'Rust', main: 'main.rs', build: 'rustc -o main{exe} {main}', run: '{bin:main}' },
  ruby: { label: 'Ruby', main: 'main.rb', run: 'ruby {main}' },
  bash: { label: 'Bash', main: 'main.sh', run: 'bash {main}' },
  powershell: { label: 'PowerShell', main: 'main.ps1', run: 'powershell -NoProfile -ExecutionPolicy Bypass -File {main}' },
  sql: { label: 'SQLite', main: 'main.sql', run: 'sqlite3 -header -column :memory: < {main}' },
};

export const LANG_TO_RUNNER = {
  js: 'node', javascript: 'node', mjs: 'node', node: 'node',
  ts: 'typescript', typescript: 'typescript',
  py: 'python', python: 'python', python3: 'python',
  c: 'c', h: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', hpp: 'cpp',
  java: 'java', go: 'go', rust: 'rust', rs: 'rust', rb: 'ruby', ruby: 'ruby',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash',
  ps1: 'powershell', powershell: 'powershell', pwsh: 'powershell',
  sql: 'sql', sqlite: 'sql',
};

/* File extension → Monaco language id. */
export const EXT_TO_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
  py: 'python', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', java: 'java', go: 'go', rs: 'rust',
  rb: 'ruby', sh: 'shell', bash: 'shell', ps1: 'powershell', sql: 'sql', json: 'json', md: 'markdown',
  html: 'html', htm: 'html', css: 'css', yaml: 'yaml', yml: 'yaml', xml: 'xml', txt: 'plaintext',
  csv: 'plaintext', toml: 'ini', ini: 'ini', kt: 'kotlin', swift: 'swift', php: 'php', r: 'r', lua: 'lua',
  cs: 'csharp', scala: 'scala', dart: 'dart', makefile: 'shell',
};

export function langOfFile(name) {
  const base = String(name).toLowerCase().split('/').pop();
  if (base === 'makefile') return 'shell';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return EXT_TO_LANG[ext] || 'plaintext';
}

export function runnerFor(name, overrides = {}) {
  const key = LANG_TO_RUNNER[String(name || '').toLowerCase()] || String(name || '').toLowerCase();
  const base = RUNNERS[key];
  const over = overrides[key] || overrides[name];
  if (!base && !over) return null;
  return { id: key, ...(base || {}), ...(over || {}) };
}

/* Splits a command that may be { win, posix } or a plain string. */
export function platformCommand(cmd, platform) {
  if (cmd == null) return '';
  if (typeof cmd === 'object') return platform === 'win32' ? (cmd.win ?? cmd.windows ?? cmd.default ?? '') : (cmd.posix ?? cmd.unix ?? cmd.default ?? '');
  return String(cmd);
}
