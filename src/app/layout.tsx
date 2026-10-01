import type { Metadata } from 'next';
import './globals.css';
import './workflows.css';
export const metadata:Metadata={title:'궤도 서재',description:'소설을 쓰고, 읽고, 세계를 기록하는 개인 서재.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>;}
