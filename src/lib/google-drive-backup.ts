import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readLimitedJson,readLimitedBytes } from './http';
import type { BackupStorage } from './offsite-backup';
type Config={clientId:string;clientSecret:string;refreshToken:string;authorId:string;prefix:string};
const fileSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/),name:z.string().optional()});

/** Uses only drive.file: files and folders created by this OAuth app. No sharing or deletion operations. */
export function googleDriveStorage(config:Config,signal:AbortSignal,fetcher:typeof fetch=fetch):BackupStorage{
  let accessToken:Promise<string>|null=null,folderId:Promise<string>|null=null;const ids=new Map<string,string>();
  const hash=(key:string)=>createHash('sha256').update(key).digest('hex');
  async function token(){return accessToken??=(async()=>{const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken,grant_type:'refresh_token'}),signal});if(!response.ok)throw new Error('Google 백업 연결을 갱신하지 못했습니다.');const data=z.object({access_token:z.string().min(1),scope:z.string().optional()}).parse(await readLimitedJson(response,8192));if(data.scope&&data.scope.split(/\s+/).some(scope=>scope!=='https://www.googleapis.com/auth/drive.file'))throw new Error('Google 연결은 drive.file 권한만 사용해 다시 승인하세요.');return data.access_token;})();}
  async function call(url:string,init:RequestInit={}){const response=await fetcher(url,{...init,headers:{...init.headers,Authorization:`Bearer ${await token()}`},signal});if(!response.ok)throw new Error('Google Drive 백업 요청에 실패했습니다. 저장 공간과 연결 상태를 확인하세요.');return response;}
  async function list(property:string,value:string){const query=new URLSearchParams({q:`trashed = false and appProperties has { key='${property}' and value='${value}' }`,fields:'files(id,name)',pageSize:'10'});const response=await call(`https://www.googleapis.com/drive/v3/files?${query}`);return z.object({files:z.array(fileSchema)}).parse(await readLimitedJson(response,16384)).files;}
  async function folder(){return folderId??=(async()=>{const fingerprint=hash(`${config.prefix}/${config.authorId}`),existing=await list('kosmosFolder',fingerprint);if(existing.length)return existing[0].id;const response=await call('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Kosmos 백업',mimeType:'application/vnd.google-apps.folder',appProperties:{kosmosFolder:fingerprint}})});return fileSchema.parse(await readLimitedJson(response,4096)).id;})();}
  async function find(key:string){if(ids.has(key))return ids.get(key)!;const found=await list('kosmosKey',hash(key));if(!found.length)return null;ids.set(key,found[0].id);return found[0].id;}
  return{
    read:async(key,maxBytes)=>{const id=await find(key);if(!id)return null;const response=await call(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);return readLimitedBytes(response,maxBytes);},
    write:async(key,bytes,type)=>{const existing=await find(key);const metadata=existing?{}:{name:key.split('/').pop()!,parents:[await folder()],appProperties:{kosmosKey:hash(key)}};
      const start=await call(`https://www.googleapis.com/upload/drive/v3/files${existing?`/${existing}`:''}?uploadType=resumable&fields=id`,{method:existing?'PATCH':'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':type,'X-Upload-Content-Length':String(bytes.length)},body:JSON.stringify(metadata)});
      const location=start.headers.get('location');if(!location)throw new Error('Google 업로드 주소를 받지 못했습니다.');const url=new URL(location);if(url.protocol!=='https:'||url.hostname!=='www.googleapis.com'||!url.pathname.startsWith('/upload/drive/v3/files')||url.username||url.password)throw new Error('안전하지 않은 업로드 주소입니다.');
      const done=await call(location,{method:'PUT',headers:{'Content-Type':type},body:Uint8Array.from(bytes).buffer});ids.set(key,fileSchema.parse(await readLimitedJson(done,4096)).id);
    },
  };
}
