import { z } from 'zod';
/** Device preferences gathered in the settings dialog. Each value replaces a default that used to be fixed in code. */
export const APP_PREFERENCES_KEY='kosmos-app-preferences';

/** Note views keep the keys they were remembered under before the settings dialog. */
export const NOTES_HOME_VIEW_KEY='kosmos-notes-home-view';
export const notesHomeViews=['home','board'] as const;
export const NOTES_LIST_VIEW_KEY='kosmos-notes-list-view';
export const notesListViews=['tree','list'] as const;

export const lineHeights=[1.6,1.8,2,2.2,2.4] as const;
export const paragraphIndents=[0,1,2] as const;
export const paragraphGaps=[0,0.6,1.2,1.8] as const;
export const manuscriptWidths=[560,680,800,960] as const;
export const checkpointIntervals=[5,10,20,30] as const;
export type PlotBoardMode='part'|'status'|'time';
export type GraphScope='all'|'local';
export type StudioStart='home'|'last';

export const defaultAppPreferences={lineHeight:2,paragraphIndent:1,paragraphGap:1.2,manuscriptWidth:680,plotBoardMode:'part',graphScope:'all',graphDepth:1,graphIncludePov:true,aiIncludeManuscript:true,aiAttachLinked:true,checkpointMinutes:10,studioStart:'home'} as const;
const d=defaultAppPreferences;
// Each field falls back on its own, so one unknown or damaged value never resets the rest.
const appPreferencesSchema=z.object({
  /** Manuscript layout in the studio editor; notes keep their own compact layout. */
  lineHeight:z.literal(lineHeights).catch(d.lineHeight),
  paragraphIndent:z.literal(paragraphIndents).catch(d.paragraphIndent),
  paragraphGap:z.literal(paragraphGaps).catch(d.paragraphGap),
  manuscriptWidth:z.literal(manuscriptWidths).catch(d.manuscriptWidth),
  plotBoardMode:z.enum(['part','status','time']).catch(d.plotBoardMode),
  graphScope:z.enum(['all','local']).catch(d.graphScope),
  graphDepth:z.literal([1,2,3]).catch(d.graphDepth),
  graphIncludePov:z.boolean().catch(d.graphIncludePov),
  aiIncludeManuscript:z.boolean().catch(d.aiIncludeManuscript),
  aiAttachLinked:z.boolean().catch(d.aiAttachLinked),
  checkpointMinutes:z.literal(checkpointIntervals).catch(d.checkpointMinutes),
  /** What /studio opens on: the studio home, or straight into the last document on this device. */
  studioStart:z.enum(['home','last']).catch(d.studioStart),
}).catch({...defaultAppPreferences});
export type AppPreferences=z.infer<typeof appPreferencesSchema>;

export function parseAppPreferences(raw:string|null):AppPreferences{
  try{return appPreferencesSchema.parse(JSON.parse(raw||'null'));}catch{return appPreferencesSchema.parse(null);}
}

/** CSS variables read by `.manuscript` rules in studio.css. */
export function manuscriptLayoutStyle(p:AppPreferences){return {'--manuscript-line':String(p.lineHeight),'--manuscript-indent':`${p.paragraphIndent}em`,'--manuscript-gap':`${p.paragraphGap}em`,'--manuscript-width':`${p.manuscriptWidth}px`};}
