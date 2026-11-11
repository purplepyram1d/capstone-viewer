import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require=createRequire(import.meta.url);
const child=spawn(require('electron'),['.'],{stdio:'inherit',env:{...process.env,CAPSTONE_NODE:process.execPath}});
child.on('exit',code=>process.exit(code||0));
