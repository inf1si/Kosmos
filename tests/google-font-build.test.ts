import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import googleFontLoader from 'next/dist/compiled/@next/font/dist/google/loader';

test('Google 글꼴 로더는 확장자 없는 파일의 형식을 확인하고 바이트를 그대로 내보낸다',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'kosmos-font-header-')),original=resolve('node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2'),bytes=await readFile(original);
  const oldMock=process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES,oldFont=process.env.KOSMOS_TEST_FONT_FILE;
  process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES=resolve('tests/fixtures/agent-fonts.cjs');

  try{
    for(const name of ['font.woff2','font']){
      const file=join(directory,name);await copyFile(original,file);process.env.KOSMOS_TEST_FONT_FILE=file;

      // The loader intentionally shares one CSS/file result between its server and client invocation.
      for(const isServer of [true,false]){
        let emitted=false;

        const result=await googleFontLoader({functionName:'Gowun_Batang',data:[{weight:'400',preload:false,display:'swap'}],isDev:false,isServer,variableName:'fixture',loaderContext:{},resolve:value=>value,emitFontFile:(content,extension)=>{assert.equal(extension,'woff2');assert.deepEqual(content,bytes);emitted=true;

return '/_next/fixture.woff2';}});

        assert(emitted);assert(result.css.includes('/_next/fixture.woff2'));
      }
    }

    const invalid=join(directory,'invalid');await writeFile(invalid,'not a font');process.env.KOSMOS_TEST_FONT_FILE=invalid;
    await assert.rejects(googleFontLoader({functionName:'Gowun_Batang',data:[{weight:'400',preload:false,display:'optional'}],isDev:false,isServer:true,variableName:'fixture',loaderContext:{},resolve:value=>value,emitFontFile:()=>{assert.fail('invalid font must not be emitted');}}),/Unsupported font file format/);
  }finally{
    if(oldMock===undefined)delete process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES;else process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES=oldMock;

    if(oldFont===undefined)delete process.env.KOSMOS_TEST_FONT_FILE;else process.env.KOSMOS_TEST_FONT_FILE=oldFont;
    await rm(directory,{recursive:true,force:true});
  }
});
