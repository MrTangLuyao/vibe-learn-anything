/* Bridge between the page and the main process. The page sees only
   window.vla — no Node, no raw ipcRenderer. */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);
const listen = ch => cb => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('vla', {
  app: {
    info: () => invoke('app:info'),
    openExternal: url => invoke('app:openExternal', url),
    openPath: p => invoke('app:openPath', p),
    clipboard: text => invoke('app:clipboard', text),
    titlebar: colors => invoke('app:titlebar', colors),
    fullscreen: on => invoke('app:fullscreen', on),
    onOpenFiles: listen('app:openFiles'),
    pathForFile: file => webUtils.getPathForFile(file),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: patch => invoke('settings:set', patch),
    trusted: () => invoke('settings:trusted'),
    untrust: id => invoke('settings:untrust', id),
  },
  library: {
    list: () => invoke('library:list'),
    import: files => invoke('library:import', files),
    resolveImport: (token, mode) => invoke('library:resolveImport', token, mode),
    export: (id, opts) => invoke('library:export', id, opts),
    remove: id => invoke('library:remove', id),
    setMeta: (id, patch) => invoke('library:setMeta', id, patch),
    reveal: id => invoke('library:reveal', id),
    refresh: id => invoke('library:refresh', id),
  },
  course: {
    get: id => invoke('course:get', id),
    readText: (id, rel) => invoke('course:readText', id, rel),
    readBinary: (id, rel) => invoke('course:readBinary', id, rel),
    exists: (id, rel) => invoke('course:exists', id, rel),
    savePage: (id, src, text) => invoke('course:savePage', id, src, text),
    saveAnnotations: (id, data) => invoke('course:saveAnnotations', id, data),
    saveProgress: (id, data) => invoke('course:saveProgress', id, data),
    saveState: (id, state) => invoke('course:saveState', id, state),
    openFile: (id, rel) => invoke('course:openFile', id, rel),
    revealFile: (id, rel) => invoke('course:revealFile', id, rel),
    saveFileAs: (id, rel) => invoke('course:saveFileAs', id, rel),
  },
  ws: {
    init: (id, page, ws, starter) => invoke('ws:init', id, page, ws, starter),
    reset: (id, page, ws, starter) => invoke('ws:reset', id, page, ws, starter),
    list: (id, page, ws) => invoke('ws:list', id, page, ws),
    read: (id, page, ws, rel) => invoke('ws:read', id, page, ws, rel),
    write: (id, page, ws, rel, content) => invoke('ws:write', id, page, ws, rel, content),
    remove: (id, page, ws, rel) => invoke('ws:delete', id, page, ws, rel),
    rename: (id, page, ws, from, to) => invoke('ws:rename', id, page, ws, from, to),
    reveal: (id, page, ws) => invoke('ws:reveal', id, page, ws),
  },
  exec: {
    check: names => invoke('exec:check', names),
    python: () => invoke('exec:python'),
    run: spec => invoke('exec:run', spec),
    snippet: spec => invoke('exec:snippet', spec),
    cancel: key => invoke('exec:cancel', key),
    expand: spec => invoke('exec:expand', spec),
  },
  pty: {
    start: spec => invoke('pty:start', spec),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: id => ipcRenderer.send('pty:kill', id),
    onData: listen('pty:data'),
    onExit: listen('pty:exit'),
  },
  http: {
    request: spec => invoke('http:request', spec),
  },
  ai: {
    status: () => invoke('ai:status'),
    chat: req => invoke('ai:chat', req),
    agent: req => invoke('ai:agent', req),
    abort: id => invoke('ai:abort', id),
    onChunk: listen('ai:chunk'),
    onLog: listen('ai:log'),
  },
  kit: {
    prepare: () => invoke('kit:prepare'),
    open: () => invoke('kit:open'),
    watch: () => invoke('kit:watch'),
    onVla: listen('kit:vla'),
  },
});
