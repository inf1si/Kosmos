import type { Metadata } from 'next';
import { themeScript } from '@/lib/theme';
import './globals.css';
import './workflows.css';
import './studio.css';
import './studio-tools.css';
import './personal-notes.css';
import './workspace-trash.css';
import './settings.css';
import './editor-content.css';

export const metadata:Metadata={title:'Orbis Tertius',icons:{icon:'/favicon.svg'}};

export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}}/><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=Chakra+Petch:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+KR:wght@400;500;600&family=Michroma&family=Oxanium:wght@500;600&family=Saira+Semi+Condensed:wght@600;700&family=Saira+Stencil+One&family=Cinzel:wght@500;600&family=Marcellus+SC&family=Fredoka:wght@600&family=Jua&family=Shrikhand&family=Orbitron:wght@500;600&family=Share+Tech+Mono&family=Nanum+Gothic+Coding:wght@400;700&family=M+PLUS+1+Code&family=Syncopate:wght@400;700&family=Jost:wght@500&family=VT323&family=Source+Sans+3:wght@300;400;600&family=Space+Grotesk:wght@400;500&family=Tenor+Sans&family=Cormorant+SC:wght@500;600&family=Raleway:wght@300;400;500&display=swap"/></head><body>{children}</body></html>;}
