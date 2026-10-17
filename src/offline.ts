import type {Media,State} from './model';
import type {Storage} from './storage';
type Host={call:(cap:string,args?:Record<string,unknown>)=>Promise<unknown>};
export class OfflineCache {
  private busy=false;
  readonly progress=new Map<string,number>();
  readonly errors=new Map<string,string>();
  constructor(private host:Host|undefined,private storage:Storage,private state:()=>State,private device:string,private save:()=>Promise<void>,private render:()=>void,private notify:(message:string,error?:boolean)=>void,private t:(ru:string,en:string)=>string,private format:()=>string=()=> 'auto'){}
  available(m:Media){return !!m.fileId&&m.offlineDeviceId===this.device;}
  async toggle(m:Media){
    if(this.available(m))return;
    if(!this.host)throw Error(this.t('Для офлайн-копии подключите Delta.','Connect Delta to make an offline copy.'));
    if(m.offlineJob){const jobId=m.offlineJob;delete m.offlineJob;this.progress.delete(m.id);await this.save();this.render();const job=await this.host.call('downloads.job',{id:jobId}) as {state:string};if(['queued','downloading'].includes(job.state))await this.host.call('downloads.cancel',{id:jobId});return;}
    try{
      const job=await this.host.call('downloads.create',{url:m.feed||m.embed||m.url,kind:this.format()==='audio'?'audio':this.format()==='video'?'video':m.kind==='audio'?'audio':'video'}) as {id:string};
      m.offlineJob=job.id;this.errors.delete(m.id);this.progress.set(m.id,0);await this.save();this.render();
      this.notify(this.t('Готовим офлайн-копию','Preparing offline copy'));
    }catch{throw Error(this.t('Не удалось начать загрузку. Подключите плагин YouTube Offline и проверьте его состояние.','Could not start offline caching. Connect the YouTube Offline plugin and check its status.'));}
  }
  async poll(){
    if(this.busy||!this.host)return;this.busy=true;
    try{for(const m of this.state().media.filter(m=>m.offlineJob&&!this.available(m))){
      const jobId=m.offlineJob;
      try{const job=await this.host.call('downloads.job',{id:jobId}) as {state:string;progress:number;size:number;mime:string;error?:string};
        if(job.state==='failed'||job.state==='cancelled'){this.errors.set(m.id,job.error||this.t('Загрузка отменена','Download cancelled'));delete m.offlineJob;this.progress.delete(m.id);await this.save();this.render();this.notify(this.t('Не удалось подготовить офлайн-копию. Можно повторить.','Could not prepare offline copy. You can retry.'),true);continue;}
        this.progress.set(m.id,Math.round((job.progress||0)*.8));this.render();
        if(job.state!=='ready')continue;
        if(!Number.isFinite(job.size)||job.size<1||job.size>256*1024*1024)throw Error('Offline cache limit');
        const chunks:Uint8Array<ArrayBuffer>[]=[];let offset=0;
        while(offset<job.size){
          if(this.state().media.find(v=>v.id===m.id)?.offlineJob!==jobId)break;
          const part=await this.host.call('downloads.read',{id:m.offlineJob,offset,limit:24576}) as {data:string;next:number};
          if(!Number.isSafeInteger(part.next)||part.next<=offset||part.next>job.size)throw Error('Invalid cache chunk');
          chunks.push(Uint8Array.from(atob(part.data),c=>c.charCodeAt(0)));offset=part.next;this.progress.set(m.id,80+Math.round(offset/job.size*19));
          if(chunks.length%16===0)this.render();
        }
        if(offset!==job.size)continue;
        const id='offline:'+m.id;await this.storage.cache(id,new Blob(chunks,{type:job.mime}));
        // The record may have been removed while bytes were in transit.
        const current=this.state().media.find(v=>v.id===m.id);if(!current||current.offlineJob!==jobId){await this.storage.removeFile(id);continue;}
        delete current.offlineJob;current.fileId=id;current.mime=job.mime;current.offlineDeviceId=this.device;this.progress.delete(m.id);await this.save();this.render();this.notify(this.t('Доступно без интернета','Available offline'));
      }catch{/* Connection loss keeps the pending job; the next poll resumes from the node cache. */}
    }}finally{this.busy=false;}
  }
}
