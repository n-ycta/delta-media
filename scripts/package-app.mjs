import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,relative} from 'node:path';
const manifest=JSON.parse(await readFile('app.manifest.json','utf8'));
const files=[];
async function visit(dir){for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(dir,e.name);if(e.isDirectory())await visit(p);else if(e.isFile()){const b=await readFile(p);files.push({path:relative('dist',p).replaceAll('\\','/'),sha256:createHash('sha256').update(b).digest('hex'),data:b.toString('base64')});}else throw Error('Special file is not allowed')}}
await visit('dist');await mkdir('release',{recursive:true});
const bytes=Buffer.from(JSON.stringify({format:'delta-app-v1',manifest,files}));
const name='delta-media.delta-app';await writeFile('release/'+name,bytes);
await writeFile('release/SHA256SUMS',createHash('sha256').update(bytes).digest('hex')+'  '+name+'\n');
console.log(`Packaged ${files.length} assets, ${bytes.length} bytes`);
