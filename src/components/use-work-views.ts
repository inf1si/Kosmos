'use client';

import { useEffect, useState } from 'react';
import { cloudConfigured, workViews } from '@/lib/cloud';
import type { WorkViews } from '@/lib/work-views';
import { useStudio } from './studio-provider';

const FRESH_MS=60_000;

let shared:{user:string;at:number;totals:Promise<Map<string,WorkViews>|null>}|null=null;

/** The signed-in author's view totals by work, shared by every card on screen; null until read or when the server has none. */
export function useWorkViews(){
  const {user}=useStudio(),[totals,setTotals]=useState<Map<string,WorkViews>|null>(null);

  useEffect(()=>{
    if(!cloudConfigured||!user){setTotals(null);

      return;
    }

    if(shared?.user!==user||Date.now()-shared.at>FRESH_MS)shared={user,at:Date.now(),totals:workViews().catch(()=>null)};

    let current=true;

    void shared.totals.then(value=>{if(current)setTotals(value);});

    return()=>{current=false;};
  },[user]);

  return totals;
}
