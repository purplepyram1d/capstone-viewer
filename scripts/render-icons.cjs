// Renders the app's bitmap icons from the small Eye of Providence SVG with Chromium (canvas keeps transparency).
// Run with Electron after editing assets/eye-of-providence-small.svg:
//   node_modules\electron\dist\electron.exe scripts\render-icons.cjs
// Writes assets/capstone.png (256 px window and notification icon), assets/tray.png and tray@2x.png (16/32 px),
// and assets/capstone.ico (16 to 256 px, PNG entries) for the Start Menu shortcut, which Windows also uses to
// label notifications.
const { app, BrowserWindow } = require('electron'); const fs = require('node:fs'); const path = require('node:path');
const assets = path.join(__dirname, '..', 'assets');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const svg = fs.readFileSync(path.join(assets, 'eye-of-providence-small.svg'), 'utf8');
  const render = async size => Buffer.from((await win.webContents.executeJavaScript(`(async()=>{const i=new Image();i.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(${JSON.stringify(svg)});await i.decode();const c=document.createElement('canvas');c.width=c.height=${size};c.getContext('2d').drawImage(i,0,0,${size},${size});return c.toDataURL('image/png');})()`)).split(',')[1], 'base64');
  fs.writeFileSync(path.join(assets, 'capstone.png'), await render(256));
  fs.writeFileSync(path.join(assets, 'tray.png'), await render(16));
  fs.writeFileSync(path.join(assets, 'tray@2x.png'), await render(32));
  const sizes = [16, 24, 32, 48, 64, 256], images = [];
  for (const size of sizes) images.push(await render(size));
  // ICO: 6-byte header, a 16-byte directory entry per image, then the PNG data (supported since Windows Vista).
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length; const entries = sizes.map((size, i) => {
    const e = Buffer.alloc(16); e.writeUInt8(size === 256 ? 0 : size, 0); e.writeUInt8(size === 256 ? 0 : size, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12); offset += images[i].length; return e;
  });
  fs.writeFileSync(path.join(assets, 'capstone.ico'), Buffer.concat([header, ...entries, ...images]));
  console.log('Icons written to', assets); app.quit();
});
