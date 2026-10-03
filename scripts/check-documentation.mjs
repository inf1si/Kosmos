import { existsSync,readFileSync,readdirSync } from 'node:fs';
import { dirname,extname,isAbsolute,relative,resolve,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import MarkdownIt from 'markdown-it';

const parser=new MarkdownIt();
const asPosix=p=>p.split(sep).join('/');
function markdownFiles(root){
  const files=['README.md','AGENTS.md','CHANGELOG.md','VERIFICATION.md'].filter(f=>existsSync(resolve(root,f)));
  const visit=dir=>{for(const entry of readdirSync(resolve(root,dir),{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())visit(path);else if(entry.name.endsWith('.md'))files.push(path);}};
  if(existsSync(resolve(root,'docs')))visit('docs');return files;
}
function links(tokens){return tokens.flatMap(t=>[...(t.type==='link_open'?[t.attrGet('href')]:[]),...(t.type==='image'?[t.attrGet('src')]:[]),...links(t.children||[])]).filter(Boolean);}
function anchors(text){
  const found=new Set(),seen=new Map(),tokens=parser.parse(text,{});
  for(let i=0;i<tokens.length;i++)if(tokens[i].type==='heading_open'){
    const label=(tokens[i+1]?.children||[]).map(t=>t.type==='text'||t.type==='code_inline'?t.content:t.type==='image'?t.content:'').join('');
    const slug=label.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu,'').replace(/\s/g,'-'),count=seen.get(slug)||0;seen.set(slug,count+1);found.add(slug+(count?`-${count}`:''));
  }return found;
}
export function checkDocumentation(root,changedFiles=[]){
  const issues=[],files=markdownFiles(root),anchorCache=new Map();let linkCount=0;
  for(const file of files){const text=readFileSync(resolve(root,file),'utf8');for(const href of links(parser.parse(text,{}))){
    if(/^[a-z][a-z0-9+.-]*:/i.test(href)||href.startsWith('//')||href.startsWith('/'))continue;
    linkCount++;const [rawPath,rawAnchor]=href.split('#');let target,anchor;
    try{target=resolve(root,dirname(file),decodeURIComponent((rawPath||'').split('?')[0]));anchor=rawAnchor?decodeURIComponent(rawAnchor):'';}catch{issues.push(`${file}: 잘못된 링크 ${href}`);continue;}
    if(!rawPath)target=resolve(root,file);
    const path=relative(root,target);if(path==='..'||path.startsWith(`..${sep}`)||isAbsolute(path)){issues.push(`${file}: 저장소 밖의 링크 ${href}`);continue;}
    if(!existsSync(target)){issues.push(`${file}: 대상 없음 ${href}`);continue;}
    // Windows accepts a different case; check each path component so local checks match Linux CI.
    let dir=root,caseCorrect=true;for(const part of path.split(sep).filter(Boolean)){if(!readdirSync(dir).includes(part)){caseCorrect=false;break;}dir=resolve(dir,part);}
    if(!caseCorrect){issues.push(`${file}: 파일명 대소문자 불일치 ${href}`);continue;}
    if(anchor&&extname(target)==='.md'){
      if(!anchorCache.has(target))anchorCache.set(target,anchors(readFileSync(target,'utf8')));
      if(!anchorCache.get(target).has(anchor))issues.push(`${file}: 제목 위치 없음 ${href}`);
    }
  }}
  const changed=new Set(changedFiles.map(asPosix));
  const functional=[...changed].some(p=>/^(src\/|supabase\/|scripts\/|\.github\/workflows\/)/.test(p)||p==='package.json'||p==='pnpm-lock.yaml');
  if(functional){
    for(const required of ['CHANGELOG.md','VERIFICATION.md','docs/status.md'])if(!changed.has(required))issues.push(`기능 변경에는 ${required} 갱신이 필요합니다.`);
    if(![...changed].some(p=>p.startsWith('docs/')&&p.endsWith('.md')&&!['docs/status.md','docs/README.md'].includes(p)))issues.push('기능 변경에는 해당 사용법·설계·운영 문서 갱신이 필요합니다.');
  }
  return {files:files.length,links:linkCount,issues};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);let changes=[];
  if(args.length){if(args[0]!=='--base'||!args[1]||! /^[a-f0-9]{40}$/i.test(args[1]))throw new Error('사용법: node scripts/check-documentation.mjs [--base 커밋SHA]');
    if(!/^0{40}$/.test(args[1]))changes=execFileSync('git',['diff','--name-only',args[1],'HEAD'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  }
  const report=checkDocumentation(root,changes);console.log(`문서 ${report.files}개 · 내부 링크 ${report.links}개 확인`);
  if(report.issues.length){console.error(report.issues.join('\n'));process.exitCode=1;}else console.log('문서 검사 통과'+(changes.length?' · 변경 범위 갱신 규칙 포함':''));
}
