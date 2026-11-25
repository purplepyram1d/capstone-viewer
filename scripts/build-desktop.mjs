import { cpSync, mkdirSync, writeFileSync, copyFileSync, existsSync, renameSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
const root=process.cwd(), out=path.join(root,'desktop','Capstone Viewer');
const refreshApp=process.argv.includes('--refresh-app');
if(existsSync(out)&&!refreshApp)throw new Error('Desktop output already exists. Use --refresh-app to update its application files, or rename it to keep an older copy.');
mkdirSync(out,{recursive:true});
if(!refreshApp||!existsSync(path.join(out,'Capstone Viewer.exe'))){cpSync('node_modules/electron/dist',out,{recursive:true});renameSync(path.join(out,'electron.exe'),path.join(out,'Capstone Viewer.exe'));}
const target=path.join(out,'resources','app');mkdirSync(target,{recursive:true});
// Refresh the whole asset directory so removed source assets cannot linger in a portable build.
const packagedAssets=path.join(target,'assets');
if (existsSync(packagedAssets)) {
  const expectedAssets=path.join('desktop','Capstone Viewer','resources','app','assets');
  if (path.relative(realpathSync(root),realpathSync(packagedAssets))!==expectedAssets) throw Error('Unexpected portable asset path.');
  rmSync(packagedAssets,{recursive:true,force:true});
}
for(const name of ['assets','config','lib','server.mjs','desktop.cjs','pages','index.html','README.md','THIRD_PARTY.md'])cpSync(path.join(root,name),path.join(target,name),{recursive:true});
const documentation = path.join(target,'docs');
mkdirSync(documentation,{recursive:true});
copyFileSync(path.join(root,'docs','capstone-banner.png'),path.join(documentation,'capstone-banner.png'));
cpSync(path.join(root,'docs','screenshots'),path.join(documentation,'screenshots'),{recursive:true});
copyFileSync(path.join(root,'docs','walkthrough.md'),path.join(documentation,'walkthrough.md'));
writeFileSync(path.join(target,'package.json'),JSON.stringify({name:'capstone-viewer',productName:'Capstone Viewer',version:'0.1.0',main:'desktop.cjs'}));
// Resolve the production dependency closure so Electron itself is never nested inside the app.
const copied=new Set();
function copyDependency(name){if(copied.has(name))return;copied.add(name);const source=path.join(root,'node_modules',name);const pkg=JSON.parse(requireRead(path.join(source,'package.json')));cpSync(source,path.join(target,'node_modules',name),{recursive:true});for(const dep of Object.keys(pkg.dependencies||{}))copyDependency(dep);}
import { readFileSync as requireRead } from 'node:fs';
copyDependency('fast-xml-parser');
copyDependency('cheerio');
copyDependency('teleproto');
copyDependency('qrcode');
mkdirSync(path.join(target,'runtime-node'),{recursive:true});if(!refreshApp||!existsSync(path.join(target,'runtime-node','node.exe')))copyFileSync(process.execPath,path.join(target,'runtime-node','node.exe'));
copyFileSync('assets/vendor/NODE-LICENSE.txt',path.join(target,'runtime-node','LICENSE'));
writeFileSync(path.join(root,'Launch Capstone Viewer.cmd'),'@echo off\r\nstart "" "%~dp0desktop\\Capstone Viewer\\Capstone Viewer.exe"\r\n');
console.log(`Desktop app ready: ${path.join(out,'Capstone Viewer.exe')}`);
