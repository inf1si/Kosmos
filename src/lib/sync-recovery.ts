import { workspaceSchema, type Workspace } from './model';

export const TRASH_SAVE_REJECTED='휴지통을 보호하기 위해 저장을 멈췄습니다. 집필실을 새로고침한 뒤 다시 시도하세요.';

/** Only retire an operation after this definitive database rollback, never a lost acknowledgement. */
export function isRejectedLegacyTrashSave(error:unknown,payload:Workspace){
  return payload.trash===undefined&&error instanceof Error&&
    'code' in error&&error.code==='P0001'&&error.message===TRASH_SAVE_REJECTED;
}

/** A differing nonempty server trash needs the existing two-copy conflict flow. */
export function recoverLegacyTrash(local:Workspace,remote:Workspace):Workspace|null{
  if(remote.trash===undefined)return null;
  if(remote.trash.length&&JSON.stringify(local.trash)!==JSON.stringify(remote.trash))return null;
  const parsed=workspaceSchema.safeParse({...local,trash:local.trash??remote.trash});
  return parsed.success?parsed.data:null;
}
