'use client';

import {useState} from 'react';
import {Download} from 'lucide-react';
import {bookDownloadUrl,bookFileSize,type BookDownload} from '@/lib/book-downloads';
import {Popover} from './primitives';

export function BookDownloadMenu({files}:{files:BookDownload[]}){
  const [open,setOpen]=useState(false);

  if(!files.length)return null;

  return <Popover open={open} onOpenChange={setOpen} title="다운로드" className="public-book-downloads" width={260} trigger={<button type="button" className="book-wiki book-download-trigger"><Download size={15}/>다운로드</button>}>
    <div className="public-book-file-list">{files.map(file=><a key={file.format} className="menu-item" href={bookDownloadUrl(file)} download onClick={()=>setOpen(false)}><Download size={15}/><span>{file.format.toUpperCase()}</span><small>{bookFileSize(file.size)}</small></a>)}</div>
  </Popover>;
}
