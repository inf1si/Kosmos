'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';
import { countedPath, signedInBrowser } from '@/lib/visit-scope';

function publicVisit(event:BeforeSendEvent){
  try{return countedPath(new URL(event.url).pathname)&&!signedInBrowser()?event:null;}catch{return null;}
}

/** Anonymous visit statistics for the public pages. */
export function SiteAnalytics(){return <Analytics beforeSend={publicVisit}/>;}
