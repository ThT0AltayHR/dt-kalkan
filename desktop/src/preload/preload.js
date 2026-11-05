'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const roleArg = process.argv.find(a => a.startsWith('--dt-role='));
const role = roleArg ? roleArg.split('=')[1] : 'main';
const listeners = new Map();
ipcRenderer.on('evt', (_e, name, data) => {
  const set = listeners.get(name);
  if (set) for (const cb of set) { try { cb(data); } catch (err) { console.error(err); } }
  const any = listeners.get('*');
  if (any) for (const cb of any) { try { cb(name, data); } catch { } }
});
contextBridge.exposeInMainWorld('dt', {
  role,
  platform: process.platform,
  core: (method, ...args) => ipcRenderer.invoke('core', method, args),
  ui: (action, payload) => ipcRenderer.invoke('ui', action, payload),
  uiSync: (action, payload) => ipcRenderer.sendSync('ui-sync', action, payload),
  on: (name, cb) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); return () => listeners.get(name).delete(cb); },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  startDrag: (filePath) => ipcRenderer.send('drag-start', filePath),
});
