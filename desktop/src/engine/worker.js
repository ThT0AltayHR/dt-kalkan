'use strict';
// Scan worker: holds the signature DB + rule set and analyses files off the main thread.
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const { SignatureDB } = require('./sigformat');
const ruleload = require('./ruleload');
const { scanFile } = require('./analyze');

let ctx = { sigdb: null, rules: null, settings: {}, allow: new Set() };

function loadDB(d) {
  try { ctx.sigdb = new SignatureDB(fs.readFileSync(d.sigPath)); } catch (e) { ctx.sigdb = null; parentPort.postMessage({ type: 'log', level: 'error', msg: 'sigdb: ' + e.message }); }
  try { ctx.rules = ruleload.load(fs.readFileSync(d.rulesPath)); } catch (e) { ctx.rules = null; parentPort.postMessage({ type: 'log', level: 'error', msg: 'rules: ' + e.message }); }
}
loadDB(workerData);
ctx.settings = workerData.settings || {};
ctx.allow = new Set(workerData.allow || []);
parentPort.postMessage({ type: 'ready', sigs: ctx.sigdb ? ctx.sigdb.total : 0, rules: ctx.rules ? ctx.rules.rules.length : 0 });

parentPort.on('message', async (m) => {
  if (m.type === 'scan') {
    const r = await scanFile(m.path, ctx);
    parentPort.postMessage({ type: 'result', id: m.id, result: r });
  } else if (m.type === 'settings') {
    ctx.settings = m.settings || ctx.settings;
    if (m.allow) ctx.allow = new Set(m.allow);
  } else if (m.type === 'reload') {
    loadDB(m);
    parentPort.postMessage({ type: 'reloaded', sigs: ctx.sigdb ? ctx.sigdb.total : 0 });
  }
});
