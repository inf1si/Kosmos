import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace } from '../src/lib/seed';
import type { Workspace } from '../src/lib/model';
import { addNote,newNote } from '../src/lib/personal-notes';
import { trashNote } from '../src/lib/workspace-trash';
import { CloudSaveError } from '../src/lib/cloud';
import { isRejectedLegacyTrashSave,recoverLegacyTrash,TRASH_SAVE_REJECTED } from '../src/lib/sync-recovery';

test('휴지통 호환 복구는 확정된 누락 거절만 처리하고 응답 유실은 재전송한다',()=>{
  const legacy=seedWorkspace();delete legacy.trash;
  assert(isRejectedLegacyTrashSave(new CloudSaveError(TRASH_SAVE_REJECTED,'P0001'),legacy));
  assert(!isRejectedLegacyTrashSave(new Error(TRASH_SAVE_REJECTED),legacy));
  assert(!isRejectedLegacyTrashSave(new CloudSaveError(TRASH_SAVE_REJECTED,'503'),legacy));
  assert(!isRejectedLegacyTrashSave(new CloudSaveError('다른 보호 오류','P0001'),legacy));
  assert(!isRejectedLegacyTrashSave(new CloudSaveError(TRASH_SAVE_REJECTED,'P0001'),{...legacy,trash:[]}));
});
test('빈 서버 휴지통은 최신 기기 편집과 기기의 삭제 의도를 보존해 복구한다',()=>{
  const remote:Workspace={...seedWorkspace(),trash:[]};const local=structuredClone(remote);delete local.trash;
  local.works[0].documents[0].title='전송 대기 중 새 제목';
  const recovered=recoverLegacyTrash(local,remote)!;
  assert.deepEqual(recovered.trash,[]);assert.equal(recovered.works[0].documents[0].title,'전송 대기 중 새 제목');
  const note=newNote();const deleted=trashNote(addNote(local,note),note.id);
  assert.deepEqual(recoverLegacyTrash(deleted,remote),deleted);
  assert.equal(local.trash,undefined);
});
test('비어 있지 않은 서버 휴지통과 다른 기기 자료는 충돌로 남겨 삭제·부활을 막는다',()=>{
  const note=newNote(),local=addNote(seedWorkspace(),note),remote=trashNote(local,note.id);
  assert.equal(recoverLegacyTrash(local,remote),null);
  assert.equal(recoverLegacyTrash({...local,trash:[]},remote),null);
  const matching=structuredClone(remote);matching.works[0].documents[0].title='최신 원고';
  assert.deepEqual(recoverLegacyTrash(matching,remote),matching);
  assert.equal(recoverLegacyTrash(local,seedWorkspace()),null);
});
