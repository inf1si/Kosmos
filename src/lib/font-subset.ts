// HarfBuzz subsetter (harfbuzzjs harfbuzz-subset.wasm, copied to /book-fonts by scripts/package-book-fonts.mjs).
// pdf-lib's own subsetter breaks these CJK glyphs, so book fallback fonts are cut here before embedding.
type Subsetter={memory:WebAssembly.Memory;malloc:(size:number)=>number;free:(pointer:number)=>void;hb_blob_create:(data:number,length:number,mode:number,user:number,destroy:number)=>number;hb_blob_destroy:(blob:number)=>void;hb_blob_get_data:(blob:number,length:number)=>number;hb_blob_get_length:(blob:number)=>number;hb_face_create:(blob:number,index:number)=>number;hb_face_destroy:(face:number)=>void;hb_face_reference_blob:(face:number)=>number;hb_set_add:(set:number,codepoint:number)=>void;hb_subset_input_create_or_fail:()=>number;hb_subset_input_destroy:(input:number)=>void;hb_subset_input_unicode_set:(input:number)=>number;hb_subset_or_fail:(face:number,input:number)=>number};

let pending:Promise<Subsetter>|null=null;

// SAFETY: the module is the pinned harfbuzz-subset.wasm build, whose exports are these C functions and its memory.
const subsetter=(instance:WebAssembly.Instance)=>instance.exports as Subsetter;

export function loadSubsetter(wasm?:Uint8Array){
  if(wasm)return WebAssembly.instantiate(new Uint8Array(wasm)).then(({instance})=>subsetter(instance));

  if(!pending){
    pending=(async()=>{
      const response=await fetch('/book-fonts/harfbuzz-subset.wasm');

      if(!response.ok)throw new Error('책 글꼴을 내려받지 못했습니다. 다시 시도하세요.');
      const {instance}=await WebAssembly.instantiate(await response.arrayBuffer());

      return subsetter(instance);
    })();
    pending.catch(()=>{pending=null;});
  }

  return pending;
}

/** Keeps only the given codepoints; glyph outlines and metrics are unchanged. */
export function subsetFont(hb:Subsetter,bytes:Uint8Array,codepoints:Iterable<number>){
  const pointer=hb.malloc(bytes.length);new Uint8Array(hb.memory.buffer).set(bytes,pointer);
  const blob=hb.hb_blob_create(pointer,bytes.length,2,0,0),face=hb.hb_face_create(blob,0),input=hb.hb_subset_input_create_or_fail(),set=hb.hb_subset_input_unicode_set(input);hb.hb_blob_destroy(blob);

  try{
    for(const codepoint of codepoints)hb.hb_set_add(set,codepoint);
    const result=hb.hb_subset_or_fail(face,input);

    if(!result)throw new Error('책 글꼴을 만들지 못했습니다.');
    const out=hb.hb_face_reference_blob(result),data=hb.hb_blob_get_data(out,0),subset=new Uint8Array(hb.memory.buffer).slice(data,data+hb.hb_blob_get_length(out));
    hb.hb_blob_destroy(out);hb.hb_face_destroy(result);

    return subset;
  }finally{hb.hb_face_destroy(face);hb.hb_subset_input_destroy(input);hb.free(pointer);}
}
