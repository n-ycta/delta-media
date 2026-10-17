import { readFile,writeFile,mkdir,cp,rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { operations } from '../server/media.mjs';
const {version}=JSON.parse(await readFile('package.json','utf8'));
const string={type:'string'}, object={type:'object'}, strings={type:'array',items:{type:'string'}};
const schemas={
providers:{},search:{query:{...string,required:true},providers:strings},resolve:{url:{...string,required:true},provider:string},
library:{item:object,remove:string},play:{url:string,id:string,deviceId:string},pause:{deviceId:string},seek:{position:{type:'number',required:true},deviceId:string},next:{deviceId:string},previous:{deviceId:string},
queue:{items:strings,deviceId:string},playlists:{playlist:object,remove:string},settings:{values:object},stats:{},session:{},
sync:{deviceId:{...string,required:true},name:string,report:object,library:{type:'array'},playlists:{type:'array'},queue:strings,ack:strings}
};
const manifest={id:'media',version,description:'Media library and playback API',capabilities:operations.map(name=>({name,description:'Media '+name,params:schemas[name],admin:['sync','settings','play','pause','seek','next','previous'].includes(name)})),metadata:{ui:{id:'dev.delta.media',name:'Delta Media',version,contract:'^1.4.0',description:'Music, video, radio and connected providers.',publisher:'Delta',icon:'vinyl-record',category:'media',runtime:{targets:['desktop','vps','container'],execution:'process',minAgent:'0.4.3'},dependencies:[{kind:'core',id:'core',version:'>=0.4.3',required:true,features:[]},...['youtube','soundcloud','spotify','downloads'].map(id=>({kind:'plugin',id:'dev.delta.'+id,version:'>=0.2.2',required:false,features:[id==='downloads'?'Offline media cache (Python 3.10+ on the node)':'Media source: '+id]}))],capabilities:['actions','status.read'],metrics:[],actions:[{id:'providers',label:'Connected providers'},{id:'search',label:'Search',inputs:[{key:'query',label:'Query',type:'string',required:true}]},{id:'play',label:'Play',inputs:[{key:'url',label:'URL',type:'string',required:true}]},{id:'pause',label:'Pause'},{id:'stats',label:'Statistics'}]}}};
const stage='release/stage-plugin';await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
await cp('server',stage+'/server',{recursive:true});await cp('dist',stage+'/dist',{recursive:true});await cp('LICENSE',stage+'/LICENSE');
const pkg={name:'delta-media-service',version,type:'module',private:true};
await writeFile(stage+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');await writeFile(stage+'/package.json',JSON.stringify(pkg));await writeFile(stage+'/package-lock.json',JSON.stringify({name:pkg.name,version,lockfileVersion:3,requires:true,packages:{'':pkg}}));
execFileSync('tar',['-czf','release/delta-media.tar.gz','-C',stage,'.']);
const sum=createHash('sha256').update(await readFile('release/delta-media.tar.gz')).digest('hex');
await writeFile('release/SHA256SUMS',(await readFile('release/SHA256SUMS','utf8')).split('\n').filter(x=>x&&!x.endsWith('delta-media.tar.gz')).join('\n')+'\n'+sum+'  delta-media.tar.gz\n');
await writeFile('release/plugin-manifest.json',JSON.stringify(manifest,null,2)+'\n');await rm(stage,{recursive:true,force:true});
