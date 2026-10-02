import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heartbeatUrl,pingBackup } from '../src/lib/backup-monitor';
import { backupHealth } from '../src/lib/backup-status';
test('누락 표시는 오래된 성공과 비정상 시각을 구분하고 감시는 원고를 전송하지 않는다',async()=>{
  const now=Date.parse('2026-10-02T12:00:00Z');assert.equal(backupHealth(null,now),'missing');assert.equal(backupHealth({completedAt:'2026-10-02T04:00:00Z'},now),'recent');assert.equal(backupHealth({completedAt:'2026-09-30T04:00:00Z'},now),'overdue');assert.equal(backupHealth({completedAt:'invalid'},now),'overdue');assert.equal(backupHealth({completedAt:'2026-10-03T04:00:00Z'},now),'overdue');
  const url='https://hc-ping.com/12345678-1234-1234-1234-123456789abc',requests:{url:string;init:RequestInit}[]=[];
  const fetcher=(async(input:RequestInfo|URL,init:RequestInit={})=>{requests.push({url:String(input),init});return new Response('OK');}) as typeof fetch;
  assert.equal(await pingBackup('success',fetcher,url),true);assert.equal(requests[0].url,url);assert.equal(requests[0].init.body,undefined);assert.equal(heartbeatUrl(url,'fail'),`${url}/fail`);assert.throws(()=>heartbeatUrl('https://attacker.example/token','start'));assert.equal(await pingBackup('success',fetcher,'https://attacker.example/token'),false);assert.equal(requests.length,1);
});
