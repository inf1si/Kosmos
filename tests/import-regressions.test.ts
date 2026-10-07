import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TableMap } from '@tiptap/pm/tables';
import { readInterchange } from '../src/lib/interchange';
import { prepareNoteImport } from '../src/lib/personal-notes';
import { resolveNoteNavigation } from '../src/lib/note-navigation';
import { seedWorkspace } from '../src/lib/seed';
import { isRichDocument, plainText } from '../src/lib/model';

test('행 전체가 세로 병합된 Word 표의 행·열과 마지막 셀 위치를 보존한다', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>병합</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>마지막</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const bundle = await readInterchange([new File([Uint8Array.from(bytes).buffer], 'merged.docx')]);
  const content = bundle.pages[0].content;
  const table = content.content!.find(node => node.type === 'table')!;
  const map = TableMap.get(getSchema([StarterKit, TableKit]).nodeFromJSON(table));

  assert.equal(table.content!.length, 3);
  assert.equal(map.width, 1);
  assert.equal(map.height, 3);
  assert.equal(map.problems, null);
  assert.equal(plainText(table.content![2]), '마지막');
  assert(isRichDocument(content));
  assert.equal(prepareNoteImport(seedWorkspace(), bundle, 'Word').state.notes![0].content.content![0].content!.length, 3);
  assert(!isRichDocument({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [] }] }] }), '병합으로 덮이지 않은 빈 행은 거절한다');
});

test('선택한 보관함의 유일한 하위 폴더도 노트 가져오기에서 보존한다', async () => {
  const files = ['Vault/Characters/A.md', 'Vault/Characters/B.md'].map(path => {
    const file = new File([`# ${path.split('/').pop()!.slice(0, -3)}\n본문`], path.split('/').pop()!);
    Object.defineProperty(file, 'webkitRelativePath', { value: path });

    return file;
  });

  const bundle = await readInterchange(files);
  const imported = prepareNoteImport(seedWorkspace(), bundle, 'Vault');
  const navigation = resolveNoteNavigation(imported.state);
  const folder = navigation.nodes.find(node => node.type === 'folder' && node.title === 'Characters');

  assert(folder);
  assert.equal(folder.parentId, imported.folderId);
  assert.deepEqual(navigation.nodes.filter(node => node.parentId === folder.id).map(node => imported.state.notes!.find(note => note.id === node.id)!.title), ['A', 'B']);
});

test('루트에 scrivx가 있는 ZIP과 함께 선택한 다른 문서를 제외하지 않는다', async () => {
  const zip = new JSZip();
  zip.file('Novel.scrivx', '<ScrivenerProject><Binder><BinderItem UUID="S1" Type="Text"><Title>Scene</Title></BinderItem><BinderItem UUID="T" Type="TrashFolder"><Title>Trash</Title></BinderItem></Binder></ScrivenerProject>');
  zip.file('Files/Data/S1/content.rtf', '{\\rtf1 Scene body}');
  zip.file('Files/search.indexes', 'index');
  zip.file('Settings/ui.xml', '<Settings/>');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const bundle = await readInterchange([new File([Uint8Array.from(bytes).buffer], 'Novel.zip'), new File(['# Other\nOther body'], 'Other.md')]);

  assert.deepEqual(bundle.pages.map(page => page.title), ['Scene', 'Other']);
  assert.deepEqual(bundle.warnings, []);
  assert.equal(plainText(bundle.pages[1].content), 'Other body');
});
