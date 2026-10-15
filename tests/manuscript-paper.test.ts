import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paperRows, paperSheets } from '../src/lib/manuscript-paper';
import type { RichNode } from '../src/lib/model';

const doc=(...content:RichNode[]):RichNode=>({type:'doc',content});

const p=(...content:RichNode[]):RichNode=>({type:'paragraph',content});

const t=(text:string):RichNode=>({type:'text',text});

const texts=(rows:ReturnType<typeof paperRows>)=>rows.map(row=>row.map(cell=>cell.text||'_').join('|'));

test('a paragraph opens a row with one blank cell and each space takes a cell', ()=>{
  assert.deepEqual(texts(paperRows(doc(p(t('가 나')),p(t('다'))))),['_|가|_|나','_|다']);
});

test('a full stop or comma sits low and takes the following space', ()=>{
  const [row]=paperRows(doc(p(t('가, 나.'))));

  assert.deepEqual(row.map(cell=>cell.text),['','가',',','나','.']);
  assert.equal(row[2].low,true);
});

test('a space at a row start is dropped and a closing mark joins the last cell', ()=>{
  assert.deepEqual(texts(paperRows(doc(p(t('가나다 라마.”'))),4)),['_|가|나|다','라|마|.”']);
  assert.deepEqual(texts(paperRows(doc(p(t('가나다.'))),4)),['_|가|나|다.']);
  assert.deepEqual(texts(paperRows(doc(p(t('“씨?”'))))),['_|“|씨|?”']);
});

test('lowercase letters and digits pair up, capitals take a cell each', ()=>{
  assert.deepEqual(texts(paperRows(doc(p(t('2026 OK ab'))))),['_|20|26|_|O|K|_|ab']);
});

test('hard breaks start a new row without indent; footnotes are skipped; rules leave an empty row', ()=>{
  const rows=paperRows(doc(p(t('가'),{type:'hardBreak'},t('나'),{type:'footnote',attrs:{},content:[p(t('주석'))]}),{type:'horizontalRule'},{type:'blockquote',content:[p(t('다'))]}));

  assert.deepEqual(texts(rows),['_|가','나','','_|다']);
});

test('rows split into sheets of ten rows, at least one sheet', ()=>{
  assert.equal(paperSheets(doc(...Array.from({length:21},()=>p(t('가'))))).length,3);
  assert.deepEqual(paperSheets(doc()),[[]]);
});
