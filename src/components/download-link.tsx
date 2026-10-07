'use client';

import { useEffect, useState } from 'react';
import type { TransferDownload } from '@/lib/interchange';

/** Keep the link alive until the dialog closes, so an interrupted download can be retried. */
export function DownloadLink({file}:{file:TransferDownload|null}){
  const [href,setHref]=useState('');
  useEffect(()=>{if(!file){setHref('');

return;}

const url=URL.createObjectURL(file.blob);setHref(url);

return()=>URL.revokeObjectURL(url);},[file]);

  if(!file||!href)return null;

  return <div className="download-ready" role="status"><strong>파일 준비 완료</strong><a className="button primary" href={href} download={file.name}>파일 저장 · {file.name}</a><small>저장한 파일을 별도 보관하세요. 다운로드가 중단되면 이 링크로 다시 저장할 수 있습니다.</small></div>;
}
