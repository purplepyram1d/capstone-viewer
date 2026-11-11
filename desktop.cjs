const { app, BrowserWindow, Menu, shell, dialog, safeStorage, screen, Notification, Tray, nativeImage, powerMonitor } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
let collector, baseUrl, quitting = false;
app.setName('Capstone Viewer');
app.setAppUserModelId('io.purplepyram1d.capstoneviewer');
const windows = new Set();
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  // Launching again while the app sits in the tray brings a window back.
  app.on('second-instance', () => { const win = [...windows][0]; if (win) { if(win.isMinimized())win.restore();win.show();win.focus(); } else if (baseUrl) showView('ops'); });
  app.whenReady().then(start);
}
function openExternal(url) { try { if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url); } catch {} }
// Each view remembers its last monitor, size and fullscreen state, so a wall layout survives restarts.
// A saved position is used only while it still overlaps a connected display.
const layoutFile = () => path.join(app.getPath('userData'), 'window-layout.json');
function readLayout() { try { const value = JSON.parse(fs.readFileSync(layoutFile(), 'utf8')); return value && typeof value === 'object' ? value : {}; } catch { return {}; } }
function saveLayout(view, win) {
  try { const layout = readLayout(); layout[view] = { bounds: win.getNormalBounds(), fullscreen: win.isFullScreen(), maximized: win.isMaximized() }; fs.writeFileSync(layoutFile() + '.tmp', JSON.stringify(layout)); fs.renameSync(layoutFile() + '.tmp', layoutFile()); } catch (error) { console.error('Could not save window layout', error.message); }
}
function savedPlacement(view) {
  const saved = readLayout()[view], b = saved?.bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
  const visible = screen.getAllDisplays().some(({ workArea: d }) => b.x < d.x + d.width - 80 && b.x + b.width > d.x + 80 && b.y < d.y + d.height - 80 && b.y + b.height > d.y + 40);
  return visible ? saved : null;
}
// Windows only shows toasts from an app with a Start Menu shortcut carrying its AppUserModelID.
// The portable build creates one (or repoints it if the folder moved); nothing else is installed.
const APP_ID = 'io.purplepyram1d.capstoneviewer';
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32') return;
  try {
    const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Capstone Viewer.lnk');
    let current = null; try { current = shell.readShortcutLink(link); } catch {}
    // The shortcut's icon is also the one Windows shows on Capstone's notifications.
    const icon = path.join(app.getAppPath(), 'assets', 'capstone.ico');
    if (current?.target === process.execPath && current?.appUserModelId === APP_ID && current?.icon === icon) return;
    shell.writeShortcutLink(link, current ? 'replace' : 'create', { target: process.execPath, appUserModelId: APP_ID, icon, iconIndex: 0, description: 'Capstone Viewer' });
  } catch (error) { console.error('Could not create Start Menu shortcut for notifications', error.message); }
}
// Only local views used by notifications are allowed as click destinations.
function showToast(message) {
  if (!Notification.isSupported() || typeof message.title !== 'string' || typeof message.body !== 'string') return;
  const route = typeof message.path === 'string' && /^\/(ops|watch|developing)(\?[A-Za-z0-9_=&%.-]*)?$/.test(message.path) ? message.path : '/ops';
  const view = route.slice(1).split('?')[0];
  const toast = new Notification({ title: message.title.slice(0, 120), body: message.body.slice(0, 300), icon: path.join(app.getAppPath(), 'assets', 'capstone.png') });
  toast.on('click', () => {
    const win = [...windows].find(w => { try { return new URL(w.webContents.getURL()).pathname === '/' + view; } catch { return false; } });
    if (!win) { openWindow(view, route.slice(1)); return; }
    void win.loadURL(baseUrl + route); if (win.isMinimized()) win.restore(); win.show(); win.focus();
  });
  toast.show();
}
function openWindow(view = 'ops', route = view) {
  const placement = savedPlacement(view);
  const win = new BrowserWindow({ title: 'Capstone Viewer', width: view === 'wall' ? 1440 : 1560, height: 1000, ...(placement ? placement.bounds : {}), minWidth: 400, minHeight: 500,
    backgroundColor: '#0c0a12', icon: path.join(app.getAppPath(), 'assets', process.platform === 'win32' ? 'capstone.ico' : 'capstone.png'), show: false,
    // The kiosk sounds alert tones on its own, so it may play audio without a click.
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, ...(view === 'kiosk' ? { autoplayPolicy: 'no-user-gesture-required' } : {}) } });
  windows.add(win); win.on('closed', () => windows.delete(win)); win.on('close', () => saveLayout(view, win));
  win.once('ready-to-show', () => { win.show(); if (placement?.maximized) win.maximize(); if (placement?.fullscreen) win.setFullScreen(true); });
  win.webContents.on('did-finish-load',()=>{win.show();console.log(`CAPSTONE_WINDOW_READY ${view} visible=${win.isVisible()}`);});
  win.webContents.on('did-fail-load',(_event,code,description)=>console.error(`CAPSTONE_WINDOW_FAILED ${code} ${description}`));
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith(baseUrl + '/')) { const parsed = new URL(url), target = parsed.pathname.slice(1); if(['ops','wall','sources','feeds','watch','timeline','kiosk','musk','putin','developing'].includes(target))openWindow(target,target+parsed.search+parsed.hash); } else openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event,url) => { if (!url.startsWith(baseUrl + '/')) {event.preventDefault();openExternal(url);} });
  void win.loadURL(`${baseUrl}/${route}`);
  return win;
}
// Lifecycle log (userData/lifecycle.log): every start, close-to-tray, quit, crash, collector death and
// sleep/wake, so a stop is explained after the fact. A kill or power loss cannot write a last line, so a
// 5-minute heartbeat file gives the last time the app was alive, and the next start reports how the
// previous run ended to the server (CAPSTONE_PREVIOUS_RUN) for the offline banner.
const lifecycleFile = () => path.join(app.getPath('userData'), 'lifecycle.log');
const heartbeatFile = () => path.join(app.getPath('userData'), 'heartbeat.json');
function lifecycle(event, detail = '') {
  try {
    const file = lifecycleFile(); try { if (fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.1'); } catch {}
    fs.appendFileSync(file, `${new Date().toISOString()} ${event}${detail ? ' ' + String(detail).replace(/\s+/g, ' ').slice(0, 600) : ''}\n`);
  } catch {}
}
function previousRun() {
  let lastLine = '', lastAlive = null;
  try { lastLine = fs.readFileSync(lifecycleFile(), 'utf8').trim().split('\n').pop() || ''; } catch {}
  try { lastAlive = JSON.parse(fs.readFileSync(heartbeatFile(), 'utf8')).ts || null; } catch {}
  const [at, event, ...rest] = lastLine.split(' ');
  return { known: !!lastLine, clean: event === 'exit-clean', lastEvent: event || null, lastEventAt: at || null, detail: rest.join(' ').slice(0, 300), lastAlive };
}
function heartbeat() { try { fs.writeFileSync(heartbeatFile(), JSON.stringify({ ts: new Date().toISOString(), pid: process.pid })); } catch {} }
async function start() {
  const before = previousRun();
  lifecycle('start', `pid ${process.pid} version ${app.getVersion()}${process.argv.includes('--hidden') ? ' hidden' : ''}; previous run ${before.known ? (before.clean ? 'ended cleanly' : `ended without a clean exit (last event ${before.lastEvent} ${before.lastEventAt}, last heartbeat ${before.lastAlive || 'unknown'})`) : 'unknown'}`);
  heartbeat(); setInterval(heartbeat, 5 * 60000).unref?.();
  const root = app.getAppPath();
  const bundledNode = path.join(root,'runtime-node','node.exe');
  const node = fs.existsSync(bundledNode) ? bundledNode : process.env.CAPSTONE_NODE;
  if (!node) { dialog.showErrorBox('Capstone Viewer', 'Node runtime missing. Run the desktop build script first.'); app.quit(); return; }
  // Keep the server origin stable so favorites, stream lists, and curation survive app restarts.
  // 48179 is dedicated to this app; failures are shown rather than silently moving to a new origin.
  const dataDir = process.env.CAPSTONE_DATA_DIR || path.join(app.getPath('userData'),'feeds');
  collectorConfig = { root, node, dataDir, credentialFiles: {x:path.join(app.getPath('userData'),'x-credential.bin'),radar:path.join(app.getPath('userData'),'radar-credential.bin'),abusech:path.join(app.getPath('userData'),'abusech-credential.bin')} };
  startupTimer = setTimeout(() => {
    if (everReady || quitting) return;
    lifecycle('collector-startup-timeout', 'no ready message after 60 s');
    dialog.showErrorBox('Capstone Viewer', 'The local server did not start within 60 seconds. ' + lastCollectorErrors);
    app.quit();
  }, 60_000);
  spawnCollector(before);
}
// The collector (server.mjs) runs as a child process. If it dies after it has started once, it is restarted with a
// growing delay (reset after 10 minutes of healthy running), so one crash no longer stops collection until someone
// notices. Only a failure before the first start shows a dialog and quits, since that is a setup problem.
let collectorConfig = null, everReady = false, startupTimer = null, restartTimer = null, restartAttempts = 0, lastRestartNotice = 0, lastCollectorErrors = '';
const RESTART_DELAYS = [2000, 5000, 15000, 30000, 60000, 120000, 300000];
function scheduleRestart(ranFor, errors) {
  if (ranFor > 10 * 60000) restartAttempts = 0;
  const delay = RESTART_DELAYS[Math.min(restartAttempts, RESTART_DELAYS.length - 1)]; restartAttempts++;
  lifecycle('collector-restart', `attempt ${restartAttempts} in ${delay / 1000}s after running ${Math.round(ranFor / 1000)}s`);
  trayStatus = `Collector stopped; restarting in ${Math.round(delay / 1000)} s`; updateTray();
  // One toast per 30 minutes, so a crash loop does not spam.
  if (Notification.isSupported() && Date.now() - lastRestartNotice > 30 * 60000) {
    lastRestartNotice = Date.now();
    const reason = errors.trim().split('\n').filter(Boolean).pop() || 'The local feed server exited.';
    new Notification({ title: 'Capstone collector stopped; restarting', body: `${reason.slice(0, 200)}\nRestarting in ${Math.round(delay / 1000)} s. Details are in lifecycle.log.`, icon: path.join(app.getAppPath(), 'assets', 'capstone.png') }).show();
  }
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => { restartTimer = null; if (!quitting) spawnCollector({ known: true, clean: false, lastEvent: 'collector-died', lastEventAt: new Date().toISOString(), detail: errors.slice(-300), lastAlive: new Date().toISOString() }); }, delay);
}
function spawnCollector(previous) {
  const { root, node, dataDir, credentialFiles } = collectorConfig;
  const child = fork(path.join(root,'server.mjs'), [], { execPath: node, cwd: root, env:{...process.env,PORT:'48179',HOST:'127.0.0.1',DATA_DIR:dataDir,CAPSTONE_DESKTOP:'1',CAPSTONE_PREVIOUS_RUN:JSON.stringify(previous)}, stdio:['ignore','pipe','pipe','ipc'] });
  collector = child;
  const spawnedAt = Date.now();
  let started = false, ended = false, errors = '';
  child.stdout.on('data',data=>console.log(String(data).trim()));
  child.stderr.on('data',data=>{errors+=String(data);if(errors.length>4000)errors=errors.slice(-4000);lastCollectorErrors=errors;});
  // 'error' and 'exit' can both fire for one child; handle its end once.
  const end = () => {
    if (ended) return; ended = true; if (collector === child) collector = null;
    if (quitting) return;
    if (!everReady) { clearTimeout(startupTimer); dialog.showErrorBox('Capstone collector stopped', errors || 'The local feed server exited before it was ready.'); app.quit(); return; }
    scheduleRestart(Date.now() - spawnedAt, errors);
  };
  // 'error' also fires for a failed send (EPIPE) to a child that is already exiting; only a spawn failure (no pid) or a
  // child that has exited ends it here, so a stray error can never start a second collector beside a live one.
  child.on('error',error=>{lifecycle('collector-error',error.message);if(!child.pid||child.exitCode!==null||child.signalCode!==null)end();});
  child.on('exit',(code,signal)=>{if(!quitting)lifecycle('collector-died',`code ${code} signal ${signal}; stderr: ${errors.slice(-500)}`);end();});
  child.on('message',async message=>{
    if(message.type==='notify'){showToast(message);return;}
    if(message.type==='tray-status'){if(typeof message.text==='string'){trayStatus=message.text.slice(0,200);updateTray();}return;}
    if(message.type==='credential-request'){
      try{
        if(!await safeStorage.isAsyncEncryptionAvailable())throw new Error('Windows credential encryption is unavailable.');
        const credentialFile=credentialFiles[message.name||'x'];if(!credentialFile)throw new Error('Unknown credential.');
        let value=null;
        if(message.action==='get')value=fs.existsSync(credentialFile)?(await safeStorage.decryptStringAsync(fs.readFileSync(credentialFile))).result:'';
        else if(message.action==='set'){
          if(typeof message.value!=='string'||message.value.length>4096)throw new Error('Invalid credential.');
          const encrypted=await safeStorage.encryptStringAsync(message.value);fs.writeFileSync(credentialFile+'.tmp',encrypted);fs.renameSync(credentialFile+'.tmp',credentialFile);
        }else if(message.action==='clear'){if(fs.existsSync(credentialFile))fs.unlinkSync(credentialFile);}
        else throw new Error('Unknown credential operation.');
        if(child.connected)child.send({type:'credential-response',requestId:message.requestId,value});
      }catch{if(child.connected)child.send({type:'credential-response',requestId:message.requestId,error:'Could not access encrypted desktop credentials. Reconnect '+({radar:'Cloudflare Radar',abusech:'abuse.ch'}[message.name]||'X API access')+'.'});}
      return;
    }
    if(message.type!=='ready'||started||quitting)return;started=true;baseUrl=message.url;lifecycle('ready',baseUrl);
    // A restarted collector: open windows reconnect their live streams by themselves (SSE retry).
    if(everReady){trayStatus='Collecting';updateTray();return;}
    everReady=true;clearTimeout(startupTimer);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label:'Capstone Viewer',submenu:[{label:'Operations window',accelerator:'CmdOrCtrl+1',click:()=>openWindow('ops')},{label:'Live wall window',accelerator:'CmdOrCtrl+2',click:()=>openWindow('wall')},{label:'Sources window',accelerator:'CmdOrCtrl+3',click:()=>openWindow('sources')},{label:'Manage feeds',accelerator:'CmdOrCtrl+4',click:()=>openWindow('feeds')},{label:'Watchlists and alerts',accelerator:'CmdOrCtrl+5',click:()=>openWindow('watch')},{label:'Full event timeline',accelerator:'CmdOrCtrl+6',click:()=>openWindow('timeline')},{label:'Kiosk wall window',accelerator:'CmdOrCtrl+7',click:()=>openWindow('kiosk')},{label:'Elon tracker',accelerator:'CmdOrCtrl+8',click:()=>openWindow('musk')},{label:'Putin tracker',accelerator:'CmdOrCtrl+9',click:()=>openWindow('putin')},{label:'Developing stories',click:()=>openWindow('developing')},{type:'separator'},{role:'quit'}]},
      {label:'View',submenu:[{role:'reload'},{role:'togglefullscreen'},{role:'zoomIn'},{role:'zoomOut'},{role:'resetZoom'},{type:'separator'},{role:'toggleDevTools'}]},
      {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]}
    ]));buildTray();if(!process.argv.includes('--hidden'))openWindow('ops');ensureStartMenuShortcut();
  });
}
// Tray mode: closing every window keeps the collector running, so nothing is missed overnight.
// Quit from the tray menu or the app menu; both set `quitting` through before-quit.
let tray=null,trayStatus='Collecting';
const prefsFile=()=>path.join(app.getPath('userData'),'desktop-prefs.json');
function readPrefs(){try{const value=JSON.parse(fs.readFileSync(prefsFile(),'utf8'));return value&&typeof value==='object'?value:{};}catch{return {};}}
function writePrefs(prefs){try{fs.writeFileSync(prefsFile(),JSON.stringify(prefs));}catch(error){console.error('Could not save desktop preferences',error.message);}}
function showView(view='ops'){
  const win=[...windows].find(w=>{try{return new URL(w.webContents.getURL()).pathname==='/'+view;}catch{return false;}});
  if(!win){openWindow(view);return;}
  if(win.isMinimized())win.restore();win.show();win.focus();
}
function updateTray(){
  if(!tray)return;
  const atLogin=app.getLoginItemSettings({path:process.execPath,args:['--hidden']}).openAtLogin;
  tray.setToolTip(`Capstone Viewer · ${trayStatus}`.slice(0,127));
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:trayStatus.slice(0,90),enabled:false},{type:'separator'},
    {label:'Open Operations',click:()=>showView('ops')},{label:'Developing stories',click:()=>showView('developing')},{label:'Open kiosk wall',click:()=>showView('kiosk')},{label:'Elon tracker',click:()=>showView('musk')},{label:'Putin tracker',click:()=>showView('putin')},
    {label:'Watchlists and alerts',click:()=>showView('watch')},{label:'Manage feeds',click:()=>showView('feeds')},{type:'separator'},
    // Off by default: it changes what runs at login, so it is the user's choice. Starts in the tray, no window.
    {label:'Start with Windows (collect from login)',type:'checkbox',checked:atLogin,click:item=>{app.setLoginItemSettings({openAtLogin:item.checked,path:process.execPath,args:['--hidden']});updateTray();}},
    {type:'separator'},{label:'Quit Capstone Viewer',click:()=>{lifecycle('quit-requested','tray menu');app.quit();}}
  ]));
}
function buildTray(){
  if(tray)return;
  // tray.png is drawn for 16 px; Electron picks tray@2x.png on high-DPI screens.
  tray=new Tray(nativeImage.createFromPath(path.join(app.getAppPath(),'assets','tray.png')));
  tray.on('click',()=>showView('ops'));updateTray();
}
app.on('window-all-closed',()=>{
  if(quitting)return;
  lifecycle('tray','all windows closed; still collecting');
  const prefs=readPrefs();
  if(!prefs.trayNoticeShown&&Notification.isSupported()){
    new Notification({title:'Capstone Viewer is still collecting',body:'Closed windows keep running in the system tray. Click the tray icon to reopen, or right-click it to quit.',icon:path.join(app.getAppPath(),'assets','capstone.png')}).show();
    writePrefs({...prefs,trayNoticeShown:true});
  }
});
// Quit waits for the collector to stop cleanly (IPC 'shutdown': end streams, checkpoint the WAL, close SQLite).
// On Windows kill() terminates outright, so it is only the fallback after 4 seconds.
let collectorStopping=false;
app.on('before-quit',event=>{
  if(!quitting)lifecycle('before-quit');
  quitting=true;clearTimeout(startupTimer);clearTimeout(restartTimer);
  const child=collector;
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  event.preventDefault();
  if(collectorStopping)return;collectorStopping=true;
  const force=setTimeout(()=>{lifecycle('collector-forced','no clean exit within 4 s');child.kill();},4000);
  child.once('exit',()=>{clearTimeout(force);app.quit();});
  try{if(child.connected)child.send({type:'shutdown'});else child.kill();}catch{child.kill();}
});
app.on('quit',(_event,code)=>lifecycle('exit-clean',`code ${code}`));
app.on('render-process-gone',(_event,_contents,details)=>lifecycle('renderer-gone',`reason ${details.reason} exit ${details.exitCode}`));
app.on('child-process-gone',(_event,details)=>lifecycle('child-process-gone',`type ${details.type} reason ${details.reason} exit ${details.exitCode}`));
// Log and keep running: a stray main-process error should not stop collection.
process.on('uncaughtException',error=>{lifecycle('main-exception',error?.stack||String(error));console.error(error);});
app.whenReady().then(()=>{for(const name of ['suspend','resume','lock-screen','unlock-screen','shutdown'])powerMonitor.on(name,()=>lifecycle('power',name));});
