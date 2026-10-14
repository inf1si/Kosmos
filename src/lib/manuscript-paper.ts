import type { RichNode } from './model';

export type PaperCell={text:string;low?:boolean};

/** 200자 원고지: 20 columns × 10 rows per sheet. */
export const paperColumns=20,paperRowsPerSheet=10;

const segmenter=new Intl.Segmenter('ko',{granularity:'grapheme'});

const textBlocks=new Set(['paragraph','heading','codeBlock']);

// Closing marks never open a row; at a row end they share the last cell.
const closing=/^[.,?!…”’)」』〉》:;]$/u;

// Full stops and commas sit low in their cell and take the following space with them.
const low=/^[.,]$/u;

// A closing quote right after . , ? ! shares that cell.
const quote=/^[”’]$/u,sentenceEnd=/^[.,?!]$/u;

// Lowercase letters and digits go two to a cell.
const pairable=/^[a-z0-9]$/u;

/** Body text as one string per block: footnotes are skipped, a hard break stays as a newline, a rule is an empty block. */
function blocks(node:RichNode,out:string[]=[]){
  if(node.type==='horizontalRule')out.push('');
  else if(textBlocks.has(node.type))out.push(inline(node));
  else node.content?.forEach(child=>blocks(child,out));

  return out;
}

function inline(node:RichNode):string{
  if(node.type==='footnote')return '';

  if(node.type==='text')return node.text||'';

  if(node.type==='hardBreak')return '\n';

  return (node.content||[]).map(inline).join('');
}

/** Lay the body out on 원고지 rows: each paragraph opens a row with one blank cell, every space takes a cell except at a row start or after a full stop or comma. */
export function paperRows(content:RichNode,columns=paperColumns):PaperCell[][]{
  const rows:PaperCell[][]=[];
  let row:PaperCell[]=[];

  const open=()=>{row=[];rows.push(row);};

  const put=(cell:PaperCell)=>{if(row.length===columns)open();row.push(cell);};

  for(const block of blocks(content)){
    const lines=block.split('\n');

    lines.forEach((line,index)=>{
      open();

      if(index===0&&line.trim())row.push({text:''});
      let previous='',half:PaperCell|null=null;

      for(const {segment:g} of segmenter.segment(line)){
        if(/^\s$/u.test(g)){
          if(row.length&&row.length<columns&&!low.test(previous))put({text:''});
          half=null;
        }else if(row.length&&(quote.test(g)&&sentenceEnd.test(previous)||closing.test(g)&&row.length===columns)){
          const last=row[row.length-1];

          last.text+=g;
          delete last.low;
          half=null;
        }else if(pairable.test(g)&&half){
          half.text+=g;
          half=null;
        }else{
          const cell:PaperCell=low.test(g)?{text:g,low:true}:{text:g};

          put(cell);
          half=pairable.test(g)?cell:null;
        }

        previous=g;
      }
    });
  }

  return rows;
}

/** Rows split into 200-character sheets; an empty document still has one sheet. */
export function paperSheets(content:RichNode):PaperCell[][][]{
  const rows=paperRows(content),sheets:PaperCell[][][]=[];

  for(let i=0;i<rows.length;i+=paperRowsPerSheet)sheets.push(rows.slice(i,i+paperRowsPerSheet));

  return sheets.length?sheets:[[]];
}
