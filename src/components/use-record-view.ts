'use client';

import { useEffect } from 'react';
import { signedInBrowser } from '@/lib/visit-scope';
import { firstViewToday, seoulDay } from '@/lib/work-views';

/** Counts this opening of a published work once per browser per day, leaving out the author's own signed-in browser. */
export function useRecordView(workId:string|undefined,enabled:boolean){
  useEffect(()=>{
    if(!workId||!enabled)return;

    const record=()=>{
      if(document.visibilityState!=='visible')return;

      document.removeEventListener('visibilitychange',record);

      if(signedInBrowser()||!firstViewToday(workId,seoulDay()))return;

      void fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workId}),keepalive:true}).catch(()=>{});
    };

    // A page opened in a background tab is counted when it is first shown.
    document.addEventListener('visibilitychange',record);
    record();

    return()=>document.removeEventListener('visibilitychange',record);
  },[workId,enabled]);
}
