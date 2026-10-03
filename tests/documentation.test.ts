import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The executable checker is intentionally independent of app/runtime code.
import { checkDocumentation } from '../scripts/check-documentation.mjs';

test('문서 검사는 내부 경로·제목·대소문자·갱신 누락을 잡고 외부 링크·코드 예시는 제외한다',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbis-documentation-'));
  try{
    await mkdir(join(root,'docs'));await writeFile(join(root,'README.md'),'# 안내\n[사용법](docs/guide.md#한글-사용법)\n[외부](https://example.test/missing)\n`[코드](missing.md)`\n');
    await writeFile(join(root,'docs/guide.md'),'# 한글 사용법\n[돌아가기](../README.md)\n');
    assert.equal(checkDocumentation(root).issues.length,0);
    const incomplete=checkDocumentation(root,['src/lib/model.ts']);assert.equal(incomplete.issues.length,4);
    assert.equal(checkDocumentation(root,['src/lib/model.ts','CHANGELOG.md','VERIFICATION.md','docs/status.md','docs/guide.md']).issues.length,0);
    await writeFile(join(root,'README.md'),'[대소문자](docs/Guide.md)\n[제목](docs/guide.md#없는-제목)\n[누락](docs/no.md)\n[밖](../outside.md)');
    const broken=checkDocumentation(root);assert.equal(broken.issues.length,4);assert(broken.issues.some((s:string)=>s.includes('제목 위치 없음')));assert(broken.issues.some((s:string)=>s.includes('저장소 밖')));
  }finally{await rm(root,{recursive:true,force:true});}
});
