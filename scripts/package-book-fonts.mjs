// Reproduce the book font assets from the pinned npm packages. Never change names or glyphs.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import JSZip from 'jszip';

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
