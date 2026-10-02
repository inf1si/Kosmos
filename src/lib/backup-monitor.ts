/** Only timing and success/failure are sent; never manuscript content or error details. */
export function heartbeatUrl(value:string|undefined,event:'start'|'success'|'fail'){
  if(!value)return null;
  const url=new URL(value);
  if(url.origin!=='https://hc-ping.com'||!/^\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(url.pathname)||url.search||url.hash||url.username||url.password)throw new Error('백업 감시 URL을 확인하세요.');
  return `${url.href}${event==='success'?'':`/${event}`}`;
}
export async function pingBackup(event:'start'|'success'|'fail',fetcher:typeof fetch=fetch,value=process.env.BACKUP_HEALTHCHECK_URL){
  try{const url=heartbeatUrl(value,event);if(!url)return false;const response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(3000)});return response.ok;}catch{return false;}
}
