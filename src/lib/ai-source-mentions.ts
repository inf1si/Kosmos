export type ChatMentionQuery={from:number;to:number;text:string};

export function chatMentionQuery(value:string,start:number,end:number):ChatMentionQuery|null{
  if(start!==end)return null;
  const before=value.slice(0,start),from=before.lastIndexOf('@');

  if(from<0||/[A-Za-z0-9._%+-]$/.test(before.slice(0,from))||/[@\n\r/]/.test(before.slice(from+1)))return null;

  return {from,to:start,text:before.slice(from+1)};
}

/** A question may hold an ordinary @: text after it that has a space and matches no source is not a source search. */
export function chatMentionAbandoned(text:string,matches:number){return matches===0&&/\s/.test(text);}

export function insertChatMention(value:string,query:ChatMentionQuery,title:string){
  if(value.slice(query.from,query.to)!==`@${query.text}`)return null;
  const prefix=value.slice(0,query.from)+`@${title}`,suffix=value.slice(query.to);

  return {value:prefix+(suffix.startsWith(' ')?'':' ')+suffix,caret:prefix.length+1};
}
