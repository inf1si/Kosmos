import { z } from 'zod';

const VIEWED_PREFIX='kosmos-viewed:';

/** The calendar day in Korea, the same day boundary the server counts by. */
export function seoulDay(now:Date=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}

/** Crawlers, link preview fetchers and automated browsers; their requests are not readers. */
export function automatedAgent(userAgent:string){
  return !userAgent.trim()||/bot|crawl|spider|slurp|preview|scrap|fetch|monitor|headless|lighthouse|facebookexternalhit|whatsapp|kakaotalk-scrap|yeti|daumoa|curl|wget|python|axios|node/i.test(userAgent);
}

type ViewStorage=Pick<Storage,'getItem'|'setItem'>;

/**
 * True the first time this browser opens a work on a given day, and remembers it.
 * A browser that cannot store the mark is counted once per page load.
 */
export function firstViewToday(workId:string,day:string,read:()=>ViewStorage=()=>localStorage){
  try{
    const storage=read(),key=`${VIEWED_PREFIX}${workId}`;

    if(storage.getItem(key)===day)return false;

    storage.setItem(key,day);
  }catch{}

  return true;
}

export const viewRequestSchema=z.object({workId:z.uuid()});

/** Rows of `work_view_totals()`; Postgres sends bigint sums as numbers or numeric strings. */
export const workViewRowsSchema=z.array(z.object({work_id:z.uuid(),total:z.coerce.number().int().nonnegative(),recent:z.coerce.number().int().nonnegative()}));

export type WorkViews={total:number;recent:number};

export function workViewTotals(rows:z.infer<typeof workViewRowsSchema>):Map<string,WorkViews>{
  return new Map(rows.map(row=>[row.work_id,{total:row.total,recent:row.recent}]));
}

/** " · 조회 N" for a published work, with the last seven days when asked; empty until the totals are read. */
export function viewsLabel(totals:Map<string,WorkViews>|null,workId:string,recent=false){
  if(!totals)return '';

  const views=totals.get(workId)||{total:0,recent:0};

  return ` · 조회 ${views.total.toLocaleString('ko-KR')}${recent?` · 최근 7일 ${views.recent.toLocaleString('ko-KR')}`:''}`;
}
