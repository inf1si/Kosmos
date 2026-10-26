// Reproduce the book font assets from the pinned npm packages. Never change names or glyphs.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import JSZip from 'jszip';
import fontkit from '@pdf-lib/fontkit';

const packs=[{id:'maruburi',name:'MaruBuri',web:'node_modules/@kfonts/maruburi',pdf:'node_modules/@kfonts/maruburi/src'},{id:'wanted',name:'WantedSans',web:'node_modules/wanted-sans/fonts/webfonts/static/complete/woff2',pdf:'node_modules/wanted-sans/fonts/ttf'}];

await mkdir('public/book-fonts',{recursive:true});

const license=await readFile('public/licenses/fonts.txt'),date=new Date('2000-01-01T00:00:00Z');

for(const pack of packs){
  const zip=new JSZip();

  for(const weight of ['Regular','Bold']){
    const name=`${pack.name}-${weight}`;
    await writeFile(`public/book-fonts/${name}.woff2`,await readFile(`${pack.web}/${name}.woff2`));
    zip.file(`${name}.ttf`,await readFile(`${pack.pdf}/${name}.ttf`),{date});
  }

  zip.file('fonts.txt',license,{date});
  await writeFile(`public/book-fonts/${pack.id}-pdf.zip`,await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:9}}));
}

// PDF fallback for characters the book fonts lack (Hanja, kana, Greek, symbols). Noto KR from a pinned npm
// tarball, verified by its registry integrity, cut to only those characters with HarfBuzz; outlines unchanged.
const fallbacks=[
  {id:'maruburi',name:'NotoSerifKR',primary:'node_modules/@kfonts/maruburi/src',package:'@expo-google-fonts/noto-serif-kr',version:'0.4.4',integrity:'sha512-ny+0SGaH9ovPFKZIdNizvzahhMnzJKZHott7NND0yXQdNFfHrrizo0gPKrO+MndCgX9T62tZnef+kSymMR98wA=='},
  {id:'wanted',name:'NotoSansKR',primary:'node_modules/wanted-sans/fonts/ttf',package:'@expo-google-fonts/noto-sans-kr',version:'0.4.4',integrity:'sha512-zePBzeh74ja/0Jiw3T/9+V6Ie3+eONlIl5o1dQQYsOCmfXjJttMz0rGv1oB2AWlzX/TPiL7J3IP3M9Ga7CBvWA=='},
];

const wasm=await readFile('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'),{instance}=await WebAssembly.instantiate(wasm),hb=instance.exports;

// The studio cuts the fallback again to the characters one book uses, with the same pinned subsetter.
await writeFile('public/book-fonts/harfbuzz-subset.wasm',wasm);

function subset(bytes,codepoints){
  const pointer=hb.malloc(bytes.length);new Uint8Array(hb.memory.buffer).set(bytes,pointer);
  const blob=hb.hb_blob_create(pointer,bytes.length,2,0,0),face=hb.hb_face_create(blob,0),input=hb.hb_subset_input_create_or_fail(),set=hb.hb_subset_input_unicode_set(input);hb.hb_blob_destroy(blob);

  for(const codepoint of codepoints)hb.hb_set_add(set,codepoint);
  const result=hb.hb_subset_or_fail(face,input);

  if(!result)throw new Error('HarfBuzz subset failed');
  const out=hb.hb_face_reference_blob(result),data=hb.hb_blob_get_data(out,0),bytesOut=new Uint8Array(hb.memory.buffer).slice(data,data+hb.hb_blob_get_length(out));
  hb.hb_blob_destroy(out);hb.hb_face_destroy(result);hb.hb_face_destroy(face);hb.hb_subset_input_destroy(input);hb.free(pointer);

  return bytesOut;
}

function untar(bytes){
  const files=new Map();

  for(let offset=0;offset+512<=bytes.length;){
    const header=bytes.subarray(offset,offset+512),name=new TextDecoder().decode(header.subarray(0,100)).replace(/\0.*$/s,'');

    if(!name)break;
    const size=Number.parseInt(new TextDecoder().decode(header.subarray(124,136)).replace(/\0.*$/s,'').trim(),8);
    files.set(name,bytes.subarray(offset+512,offset+512+size));offset+=512+Math.ceil(size/512)*512;
  }

  return files;
}

for(const fallback of fallbacks){
  const tarball=new Uint8Array(await (await fetch(`https://registry.npmjs.org/${fallback.package}/-/${fallback.package.split('/')[1]}-${fallback.version}.tgz`)).arrayBuffer());

  if(`sha512-${createHash('sha512').update(tarball).digest('base64')}`!==fallback.integrity)throw new Error(`${fallback.package} integrity mismatch`);
  const files=untar(gunzipSync(tarball)),zip=new JSZip();

  for(const [weight,source] of [['Regular','400Regular'],['Bold','700Bold']]){
    const original=files.get(`package/${source}/${fallback.name}_${source}.ttf`),primary=fontkit.create(await readFile(`${fallback.primary}/${packs.find(pack=>pack.id===fallback.id).name}-${weight}.ttf`)),font=fontkit.create(Buffer.from(original));
    zip.file(`${fallback.name}-${weight}.ttf`,subset(original,font.characterSet.filter(codepoint=>codepoint>0x20&&!primary.hasGlyphForCodePoint(codepoint))),{date});
  }

  zip.file('fonts.txt',license,{date});
  await writeFile(`public/book-fonts/${fallback.id}-fallback.zip`,await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:9}}));
}
