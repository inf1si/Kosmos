/** Pages whose visits are counted: the public library, not the studio or sign-in. */
export function countedPath(pathname:string){
  return !/^\/(studio|auth|api)(\/|$)/.test(pathname);
}

/** True when this browser holds a studio sign-in, so the author's own reading is left out of the counts. */
export function signedInBrowser(read:()=>Pick<Storage,'length'|'key'>=()=>localStorage){
  try{
    const storage=read();

    for(let i=0;i<storage.length;i++)if(/^sb-.+-auth-token$/.test(storage.key(i)||''))return true;
  }catch{}

  return false;
}
