import type {RichNode} from './model';
import {cellSpan} from './manuscript-format';
import {bookPapers,bookSpans,type BookOptions,type BookSource,type BookSpan} from './book-content';

export const mm=72/25.4;

export type BookMetrics={width:(text:string,size:number,bold:boolean)=>number};

export type BookText=BookSpan&{kind:'text';x:number;y:number;size:number;width:number;tracking:number};

export type BookLine={kind:'line';x:number;y:number;x2:number;y2:number;width:number};

export type BookRect={kind:'rect';x:number;y:number;width:number;height:number;fill:boolean};

export type BookCommand=BookText|BookLine|BookRect;

export type BookAnchor={page:number;x:number;y:number};

export type BookPage={commands:BookCommand[];anchors:{id:string;x:number;y:number}[];cover?:boolean};

export type BookLayout={width:number;height:number;pages:BookPage[];anchors:Record<string,BookAnchor>};

type Glyph=BookSpan&{width:number};

type Align='left'|'right'|'center'|'justify';

const segmenter=new Intl.Segmenter('ko',{granularity:'grapheme'}),closing=/^[,.;:!?，。、）\])}〉》」』’”]/u,opening=/[([{〈《「『‘“]$/u;

export function wrapBookText(spans:BookSpan[],size:number,width:number,metrics:BookMetrics,firstWidth=width){
  const glyphs=spans.flatMap(span=>Array.from(segmenter.segment(span.text.replace(/\r\n?/g,'\n').replace(/\t/g,'    ')),part=>({...span,text:part.segment,width:metrics.width(part.segment==='\n'?'':part.segment,size*(span.scale||1),!!span.bold)})));
  const lines:Glyph[][]=[];let line:Glyph[]=[],used=0,lastBreak=-1;
  const flush=()=>{while(line.at(-1)?.text===' ')line.pop();lines.push(line);line=[];used=0;lastBreak=-1;};

  for(const glyph of glyphs){
    if(glyph.text==='\n'){flush();continue;}

    if(line.length&&used+glyph.width>(lines.length?width:firstWidth)){
      const split=closing.test(glyph.text)&&line.length>1&&(lastBreak===line.length||lastBreak<0)?line.length-1:lastBreak>0?lastBreak:line.length;
      const rest=line.splice(split);flush();line=rest;used=line.reduce((sum,g)=>sum+g.width,0);

      while(line[0]?.text===' '){used-=line.shift()!.width;}
    }

    line.push(glyph);used+=glyph.width;

    if(!opening.test(glyph.text)&&(/\s/u.test(glyph.text)||/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}-]/u.test(glyph.text)))lastBreak=line.length;
  }

  if(line.length||!lines.length)flush();

  return lines;
}

/** One pagination result drives both PDF and the standalone paged HTML. Coordinates are points from the top. */
export function layoutBook(source:BookSource,options:BookOptions,metrics:BookMetrics):BookLayout{
  const paper=bookPapers[options.paper],width=(options.orientation==='landscape'?paper.height:paper.width)*mm,height=(options.orientation==='landscape'?paper.width:paper.height)*mm;
  const margin=options.margin*mm,gap=8*mm,columnWidth=(width-margin*2-gap*(options.columns-1))/options.columns,bottom=height-margin;

  if(columnWidth<50||bottom-margin<80)throw new Error('용지에 비해 여백이나 단수가 너무 큽니다.');
  const pages:BookPage[]=[],chapterAnchors:Record<string,BookAnchor>={};
  let page:BookPage={commands:[],anchors:[]},column=0,y=margin;
  const pageNew=(cover=false)=>{if(pages.length>=5000)throw new Error('책이 너무 깁니다. 원고를 나누어서 내보내세요.');page={commands:[],anchors:[],cover};pages.push(page);column=0;y=margin;};

  const next=()=>{if(column+1<options.columns){column++;y=margin;}else pageNew();};

  const x=()=>margin+column*(columnWidth+gap);

  function anchor(id:string){page.anchors.push({id,x:x(),y});chapterAnchors[id]={page:pages.length-1,x:x(),y};}

  function drawLine(glyphs:Glyph[],left:number,top:number,lineWidth:number,size:number,align:Align,last:boolean){
    const baseline=top+size*Math.max(1,...glyphs.map(g=>g.scale||1));
    const actual=glyphs.reduce((sum,g)=>sum+g.width,0),spaceCount=glyphs.filter(g=>g.text===' ').length;
    const extra=align==='justify'&&!last?Math.max(0,lineWidth-actual):0,tracking=extra&&!spaceCount&&glyphs.length>1?extra/(glyphs.length-1):0;
    let at=left+(align==='center'?(lineWidth-actual)/2:align==='right'?lineWidth-actual:0),run:Glyph[]=[];

    const emit=()=>{
      if(!run.length)return;
      const first=run[0],text=run.map(g=>g.text).join(''),base=run.reduce((sum,g)=>sum+g.width,0),w=base+tracking*Math.max(0,run.length-1);

      if(first.anchor&&!chapterAnchors[first.anchor]){page.anchors.push({id:first.anchor,x:at,y:top});chapterAnchors[first.anchor]={page:pages.length-1,x:at,y:top};}

      page.commands.push({...first,kind:'text',text,x:at,y:baseline-(first.shift||0)*size,size:size*(first.scale||1),width:w,tracking});
      at+=base+tracking*run.length+(extra&&spaceCount?run.filter(g=>g.text===' ').length*extra/spaceCount:0);run=[];
    };

    for(const glyph of glyphs){
      const prior=run[0];

      if(prior&&(prior.bold!==glyph.bold||prior.italic!==glyph.italic||prior.underline!==glyph.underline||prior.strike!==glyph.strike||prior.highlight!==glyph.highlight||prior.scale!==glyph.scale||prior.shift!==glyph.shift||prior.href!==glyph.href||prior.anchor!==glyph.anchor||extra&&spaceCount&&(glyph.text===' '||run.at(-1)?.text===' ')))emit();
      run.push(glyph);
    }

    emit();
  }

  function paragraph(spans:BookSpan[],{size=options.size,indent=0,first=0,before=0,after=options.size*.65,align=options.align,keep=false,id}:{size?:number;indent?:number;first?:number;before?:number;after?:number;align?:Align;keep?:boolean;id?:string}={}){
    const lineHeight=size*options.lineHeight,maxScale=Math.max(1,...spans.map(span=>span.scale||1)),step=Math.max(lineHeight,size*(maxScale*1.35+Math.max(0,...spans.map(span=>-(span.shift||0)))));
    const largest=Math.max(size,...spans.flatMap(span=>Array.from(segmenter.segment(span.text),g=>metrics.width(g.segment==='\n'?'':g.segment,size*(span.scale||1),!!span.bold))));
    indent=Math.min(indent,Math.max(0,columnWidth-largest));first=Math.min(first,Math.max(0,columnWidth-indent-largest));
    const lines=wrapBookText(spans,size,Math.max(20,columnWidth-indent),metrics,Math.max(20,columnWidth-indent-first));

    if(y+before+Math.min(lines.length,keep?lines.length:2)*step+(keep?options.size*options.lineHeight*2:0)>bottom&&y>margin)next();
    y+=before;

if(id)anchor(id);

    for(let i=0;i<lines.length;i++){
      if(y+step>bottom){next();}

      drawLine(lines[i],x()+indent+(i===0?first:0),y,columnWidth-indent-(i===0?first:0),size,align,i===lines.length-1);y+=step;
    }

    y+=after;
  }

  function table(node:RichNode){
    const rows=node.content||[],cells:{row:number;col:number;rowspan:number;colspan:number;lines:Glyph[][];step:number;header:boolean}[]=[],occupied:number[][]=[];
    let columns=0;

    for(let r=0;r<rows.length;r++){
      let col=0;occupied[r]??=[];

      for(const cell of rows[r].content||[]){
        while(occupied[r][col])col++;
        const colspan=cellSpan(cell.attrs?.colspan),rowspan=cellSpan(cell.attrs?.rowspan);
        cells.push({row:r,col,colspan,rowspan,lines:[],step:0,header:cell.type==='tableHeader'});

        for(let rr=r;rr<r+rowspan;rr++){occupied[rr]??=[];

for(let cc=col;cc<col+colspan;cc++)occupied[rr][cc]=1;}

        col+=colspan;columns=Math.max(columns,col);
      }
    }

    if(!columns)return;
    const size=Math.min(options.size,10),step=size*1.4,padding=4,cw=columnWidth/columns,heights=rows.map(()=>step+padding*2);
    let index=0;

    for(const row of rows)for(const cell of row.content||[]){
      const entry=cells[index++],spans:BookSpan[]=[];
      (cell.content||[]).forEach((child,i)=>{if(i)spans.push({text:'\n'});spans.push(...bookSpans(child).map(span=>({...span,bold:entry.header||span.bold})));});
      const availableWidth=cw*entry.colspan-padding*2;

      if(spans.some(span=>Array.from(segmenter.segment(span.text),g=>metrics.width(g.segment==='\n'?'':g.segment,size*(span.scale||1),!!span.bold)).some(width=>width>availableWidth)))throw new Error('표의 열이 너무 좁습니다. 단수를 줄이거나 EPUB으로 저장하세요.');
      entry.step=Math.max(step,size*(Math.max(1,...spans.map(span=>span.scale||1))*1.35+Math.max(0,...spans.map(span=>-(span.shift||0)))));
      entry.lines=wrapBookText(spans,size,Math.max(10,availableWidth),metrics);
      const needed=entry.lines.length*entry.step+padding*2,available=heights.slice(entry.row,entry.row+entry.rowspan).reduce((sum,h)=>sum+h,0);

      if(needed>available)for(let r=entry.row;r<Math.min(rows.length,entry.row+entry.rowspan);r++)heights[r]+=(needed-available)/entry.rowspan;
    }

    for(let row=0;row<rows.length;){
      let end=row+1;

      for(let r=row;r<end;r++)for(const cell of cells.filter(c=>c.row===r))end=Math.max(end,Math.min(rows.length,r+cell.rowspan));
      const total=heights.slice(row,end).reduce((sum,h)=>sum+h,0);

      if(total>bottom-margin)throw new Error('표의 병합 구간이 한 쪽보다 큽니다. 글자 크기나 여백을 줄이세요.');

      if(y+total>bottom)next();

      for(const cell of cells.filter(c=>c.row>=row&&c.row<end)){
        const top=y+heights.slice(row,cell.row).reduce((sum,h)=>sum+h,0),left=x()+cell.col*cw,h=heights.slice(cell.row,cell.row+cell.rowspan).reduce((sum,h)=>sum+h,0);
        page.commands.push({kind:'rect',x:left,y:top,width:cw*cell.colspan,height:h,fill:cell.header});
        cell.lines.forEach((line,i)=>drawLine(line,left+padding,top+padding+i*cell.step,cw*cell.colspan-padding*2,size,'left',true));
      }

      y+=total;row=end;
    }

    y+=options.size;
  }

  function blocks(node:RichNode,depth=0,prefix=''){
    if(node.type==='paragraph'||node.type==='heading'||node.type==='codeBlock'){
      const heading=node.type==='heading',level=Math.max(1,Math.min(6,Number(node.attrs?.level)||2)),size=heading?options.size*(1.6-level*.12):options.size;
      const attrs=node.attrs||{},value=attrs.textAlign,align:Align=value==='left'||value==='right'||value==='center'||value==='justify'?value:options.align;
      const indent=depth*options.size+Number(attrs.indent||0)*options.size*1.5;
      const spans:BookSpan[]=bookSpans(node).map(span=>({...span,bold:heading||span.bold}));

if(prefix)spans.unshift({text:prefix});
      paragraph(spans,{size,indent,first:heading||prefix?0:Number(attrs.firstLineIndent??1)*options.size,before:heading?options.size:Math.max(0,Number(attrs.spaceBefore||0))*.75,after:heading?options.size*.5:Math.max(options.size*.65,Number(attrs.spaceAfter||0)*.75),align:heading?'left':align,keep:heading});

return;
    }

    if(node.type==='table'){table(node);

return;}

    if(node.type==='horizontalRule'){if(y+options.size*3>bottom)next();page.commands.push({kind:'line',x:x()+columnWidth*.35,y:y+options.size,x2:x()+columnWidth*.65,y2:y+options.size,width:.5});y+=options.size*3;

return;}

    if(node.type==='bulletList'||node.type==='orderedList'){
      (node.content||[]).forEach((item,index)=>{const marker=node.type==='bulletList'?'• ':`${Math.max(1,Number(node.attrs?.start)||1)+index}. `;(item.content||[]).forEach((child,i)=>blocks(child,depth+1,i===0?marker:''));});

return;
    }

    (node.content||[]).forEach(child=>blocks(child,depth+(node.type==='blockquote'?1:0)));
  }

  if(options.cover){
    pageNew(true);let size=26,title=wrapBookText([{text:options.title,bold:true}],size,width-margin*2,metrics);
    const author=options.author?wrapBookText([{text:options.author}],11,width-margin*2,metrics):[],authorHeight=author.length*18;

    while(size>7&&title.length*size*1.45+authorHeight+24>height-margin*2){size--;title=wrapBookText([{text:options.title,bold:true}],size,width-margin*2,metrics);}

    y=margin+(height-margin*2-title.length*size*1.45-authorHeight-24)/2;
    title.forEach((line,i)=>drawLine(line,margin,y+i*size*1.45,width-margin*2,size,'center',true));y+=title.length*size*1.45+24;
    author.forEach((line,i)=>drawLine(line,margin,y+i*18,width-margin*2,11,'center',true));
  }

  // Reserve the complete TOC first so every printed number and internal link matches the final PDF page.
  const tocEntries:{chapter:string;commands:BookText[]}[]=[];

  if(options.toc){
    pageNew();y=margin+32;page.commands.push({kind:'text',text:'목차',x:margin,y:margin+18,size:18,width:metrics.width('목차',18,true),tracking:0,bold:true});
    source.chapters.forEach((chapter,index)=>{
      const lines=wrapBookText([{text:chapter.title||String(index+1)}],11,width-margin*2-38,metrics),needed=lines.length*18+9;

      if(y+Math.min(needed,36)>bottom)pageNew();const commands:BookText[]=[];const firstPage=page,numberY=y+11;

      for(let i=0;i<lines.length;i++){
        if(y+18>bottom)pageNew();
        const text=lines[i].map(g=>g.text).join(''),command:BookText={kind:'text',text,x:margin,y:y+11,size:11,width:metrics.width(text,11,false),tracking:0,href:`#${chapter.id}`};page.commands.push(command);commands.push(command);y+=18;
      }

      const number:BookText={kind:'text',text:'',x:width-margin-32,y:numberY,size:11,width:32,tracking:0,href:`#${chapter.id}`};firstPage.commands.push(number);commands.push(number);tocEntries.push({chapter:chapter.id,commands});y+=9;
    });
  }

  for(const chapter of source.chapters){
    pageNew();anchor(chapter.id);

    if(chapter.section)paragraph([{text:chapter.section}],{size:options.size*.9,after:options.size,align:'left'});

    if(chapter.title)paragraph([{text:chapter.title,bold:true}],{size:options.size*1.7,after:options.size*2,align:'left',keep:true});
    blocks(chapter.content);

    if(chapter.notes.length){paragraph([{text:'각주',bold:true}],{size:options.size,before:options.size,align:'left',keep:true});

for(const note of chapter.notes)paragraph([{text:`[${note.index}] `,href:`#ref-${note.id}`},{text:note.text}],{size:options.size*.85,after:options.size*.5,align:'left',id:note.id});}
  }

  for(const entry of tocEntries){const number=entry.commands.at(-1)!;number.text=String(chapterAnchors[entry.chapter].page+1);number.width=metrics.width(number.text,11,false);number.x=width-margin-number.width;}

  if(options.pageNumbers)pages.forEach((page,index)=>{if(page.cover)return;const text=String(index+1),size=9,w=metrics.width(text,size,false);page.commands.push({kind:'text',text,x:(width-w)/2,y:height-margin/2,size,width:w,tracking:0});});

  return {width,height,pages,anchors:chapterAnchors};
}
