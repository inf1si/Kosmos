import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE_KEY, preferredPalette, preferredTheme, themeScript, THEME_KEY } from '../src/lib/theme';

function runScript(stored:{theme?:string|null;palette?:string|null},systemDark:boolean,storageFails=false){
  const attributes:Record<string,string>={};
  const values=new Map([[THEME_KEY,stored.theme??null],[PALETTE_KEY,stored.palette??null]]);

  const env={localStorage:{getItem:(key:string)=>{if(storageFails)throw new Error('blocked');

return values.get(key)??null;}},matchMedia:()=>({matches:systemDark}),document:{documentElement:{setAttribute:(name:string,value:string)=>{attributes[name]=value;}}}};

  new Function('localStorage','matchMedia','document',themeScript)(env.localStorage,env.matchMedia,env.document);

  return attributes;
}

test('저장한 밝기를 먼저 쓰고 없으면 기기 설정을 따르며 머리 스크립트도 같은 규칙을 쓴다',()=>{
  for(const theme of ['light','dark',null,'night'])for(const systemDark of [true,false])assert.equal(runScript({theme},systemDark)['data-theme'],preferredTheme(theme,systemDark));
  assert.equal(preferredTheme('dark',false),'dark');assert.equal(preferredTheme(null,true),'dark');assert.equal(preferredTheme('night',false),'light');
  assert.deepEqual(runScript({theme:'dark'},false,true),{});
});

test('색 계열은 저장한 카세트·사이버만 인정하고 나머지는 보라로 시작한다',()=>{
  for(const palette of ['cassette','cyber','violet',null,'orange','Cyber'])assert.equal(runScript({palette},false)['data-palette'],preferredPalette(palette));
  assert.equal(preferredPalette('cassette'),'cassette');assert.equal(preferredPalette('cyber'),'cyber');assert.equal(preferredPalette('orange'),'violet');assert.equal(preferredPalette('Cyber'),'violet');assert.equal(preferredPalette(null),'violet');
  assert.deepEqual(runScript({theme:'light',palette:'cassette'},true),{'data-theme':'light','data-palette':'cassette'});
});
