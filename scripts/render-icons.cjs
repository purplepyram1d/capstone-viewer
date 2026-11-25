// Run with Electron after replacing assets/capstone-icon.png:
//   node_modules\electron\dist\electron.exe scripts\render-icons.cjs
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'assets');

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(path.join(assets, 'capstone-icon.png'));
  const { width, height } = source.getSize();
  if (source.isEmpty() || width !== height || width < 256) {
    throw new Error('Use a square icon PNG at least 256 pixels wide.');
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = new Map(sizes.map(size => [
    size, source.resize({ width: size, height: size, quality: 'best' }).toPNG()
  ]));

  fs.writeFileSync(path.join(assets, 'capstone.png'), images.get(256));
  fs.writeFileSync(path.join(assets, 'tray.png'), images.get(16));
  fs.writeFileSync(path.join(assets, 'tray@2x.png'), images.get(32));

  // ICO stores a directory followed by one PNG per size. Zero encodes 256 pixels.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length + 16 * sizes.length;
  const entries = sizes.map(size => {
    const image = images.get(size);
    const entry = Buffer.alloc(16);
    entry[0] = entry[1] = size % 256;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.length;
    return entry;
  });

  fs.writeFileSync(path.join(assets, 'capstone.ico'), Buffer.concat([header, ...entries, ...images.values()]));
  console.log('Icons written to', assets);
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
});
