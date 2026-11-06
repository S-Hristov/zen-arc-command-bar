#!/usr/bin/env python3
"""Explicit publication whitelist; never walk profiles, .git, or parent backups."""
from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[1]
package=json.loads((ROOT/'package.json').read_text())
fixed=['arc-command-bar.uc.js']+['theme.json','preferences.json','package.json','README.md','LICENSE','.gitignore']
files=[ROOT/f for f in fixed]
for directory,suffixes in [('src',{'.mjs','.js','.css'}),('scripts',{'.mjs','.py'}),('tests',{'.mjs','.js','.py'}),('docs',{'.md','.json'})]:
 for p in (ROOT/directory).iterdir():
  if p.is_file() and p.suffix in suffixes:files.append(p)
files=sorted(files)
for p in files:
 if p.is_symlink() or not p.is_file():raise RuntimeError('Unsafe/missing whitelist path: '+str(p))
checksums=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(ROOT).as_posix()+'\n' for p in files)
(ROOT/'SHA256SUMS').write_text(checksums)
archive=ROOT.parent/(package['name']+'-'+package['version']+'.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in files:
  info=zipfile.ZipInfo(p.relative_to(ROOT).as_posix(),(2026,11,7,0,0,0))
  info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
  z.writestr(info,p.read_bytes())
 z.writestr('SHA256SUMS',checksums)
archive.with_suffix('.zip.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
print(archive)
