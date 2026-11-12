import { test } from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

async function setupFixture(){
  const folder=await mkdtemp(join(tmpdir(),'orbiter-vertex-')),log=join(folder,'calls.jsonl');
  await writeFile(join(folder,'gcloud'),`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(process.env.VERTEX_SETUP_TEST_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='projects'&&args[1]==='describe')console.log('123456789');
if(args[0]==='billing')console.log(process.env.VERTEX_SETUP_TEST_BILLING||'True');
if(args.includes('describe')&&args[0]==='iam'&&process.env.VERTEX_SETUP_TEST_EXISTS!=='1')process.exit(1);
`,{mode:0o755});

  return {folder,log,run:(patch:Record<string,string>={})=>spawnSync('bash',[resolve('scripts/setup-vertex-gcp.sh')],{encoding:'utf8',env:{...process.env,PATH:folder+':'+process.env.PATH,VERTEX_SETUP_TEST_LOG:log,...patch}}),calls:async()=>String(await readFile(log)).trim().split('\n').map(line=>z.array(z.string()).parse(JSON.parse(line)))};
}

test('GCP 설정은 Production 주체 하나와 Vertex 사용자 역할만 연결하고 키를 만들지 않는다',async()=>{
  const fixture=await setupFixture();

  try{
    const result=fixture.run();assert.equal(result.status,0,result.stderr);assert(result.stdout.includes('GOOGLE_VERTEX_PROJECT=orbiter-ai'));assert(result.stdout.includes('GOOGLE_VERTEX_SERVICE_ACCOUNT=orbiter-vertex@orbiter-ai.iam.gserviceaccount.com'));
    const calls=await fixture.calls(),provider=calls.find(args=>args.includes('create-oidc'))!;
    assert(provider.includes('--issuer-uri=https://oidc.vercel.com/kosmos42'));assert(provider.includes("--attribute-condition=assertion.sub == 'owner:kosmos42:project:kosmos:environment:production'"));assert(provider.includes('--allowed-audiences=https://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/orbiter-vercel/providers/kosmos-production'));
    assert.deepEqual(calls.filter(args=>args.includes('add-iam-policy-binding')).map(args=>args.find(arg=>arg.startsWith('--role='))),['--role=roles/aiplatform.user','--role=roles/iam.workloadIdentityUser']);assert(!calls.some(args=>args.includes('keys')));
    assert.equal(fixture.run({VERTEX_SETUP_TEST_EXISTS:'1'}).status,0);assert((await fixture.calls()).some(args=>args.includes('update-oidc')));
  }finally{await rm(fixture.folder,{recursive:true,force:true});}
});

test('결제가 꺼져 있거나 프로젝트 ID가 잘못되면 GCP 설정을 변경하지 않는다',async()=>{
  const fixture=await setupFixture();

  try{
    assert.equal(fixture.run({VERTEX_SETUP_TEST_BILLING:'False'}).status,1);assert(!(await fixture.calls()).some(args=>args.includes('enable')||args.includes('add-iam-policy-binding')));
    const before=(await fixture.calls()).length;assert.equal(fixture.run({VERTEX_SETUP_PROJECT:'../other'}).status,1);assert.equal((await fixture.calls()).length,before);
  }finally{await rm(fixture.folder,{recursive:true,force:true});}
});
