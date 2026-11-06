import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=name=>fileURLToPath(new URL(name,import.meta.url));
execFileSync(process.execPath,[script('build.mjs')],{stdio:'inherit'});
execFileSync('python3',['-B',script('package.py')],{stdio:'inherit'});
