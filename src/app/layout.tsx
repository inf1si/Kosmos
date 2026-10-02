import type { Metadata } from 'next';
import './globals.css';
import './workflows.css';
export const metadata:Metadata={title:'Orbis Tertius',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>;}
