// Local integration tests isolate Google Fonts availability; production builds never set this hook.
const {resolve}=require('node:path');


module.exports=new Proxy({}, {get(_target,key){
  const parsed=URL.canParse(String(key))?new URL(String(key)):null;

  if(!parsed)return undefined;
  const font=process.env.KOSMOS_TEST_FONT_FILE||resolve(__dirname,'../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2');
  const family=(parsed.searchParams.get('family')||'Fixture').split(':')[0];

  return `@font-face {font-family:'${family}';font-style:normal;font-weight:100 900;src: url(${font}) format('woff2');}`;
}});
