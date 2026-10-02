import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferredTheme, themeScript, THEME_KEY } from '../src/lib/theme';
function runScript(stored:string|null,systemDark:boolean,storageFails=false){
  let theme:string|null=null;
  const env={localStorage:{getItem:(key:string)=>{if(storageFails)throw new Error('blocked');return key===THEME_KEY?stored:null;}},matchMedia:()=>({matches:systemDark}),document:{documentElement:{setAttribute:(name:string,value:string)=>{if(name==='data-theme')theme=value;}}}};
  new Function('localStorage','matchMedia','document',themeScript)(env.localStorage,env.matchMedia,env.document);
  return theme;
}
test('저장한 테마를 먼저 쓰고 없으면 기기 설정을 따르며 머리 스크립트도 같은 규칙을 쓴다',()=>{
  for(const stored of ['light','dark',null,'night'])for(const systemDark of [true,false])assert.equal(runScript(stored,systemDark),preferredTheme(stored,systemDark));
  assert.equal(preferredTheme('dark',false),'dark');assert.equal(preferredTheme(null,true),'dark');assert.equal(preferredTheme('night',false),'light');
  assert.equal(runScript('dark',false,true),null);
});
