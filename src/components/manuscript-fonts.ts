import { Gowun_Batang, IBM_Plex_Sans_KR, Nanum_Gothic, Nanum_Myeongjo, Noto_Sans_KR, Noto_Serif_KR } from 'next/font/google';
// No preload: the browser downloads only the selected family's needed glyph ranges.
const gowun=Gowun_Batang({weight:['400','700'],display:'swap',preload:false,variable:'--font-gowun',fallback:['Batang','serif']});
const plex=IBM_Plex_Sans_KR({weight:['400','700'],display:'swap',preload:false,variable:'--font-plex',fallback:['Malgun Gothic','sans-serif']});
const serif=Noto_Serif_KR({weight:['400','700'],display:'swap',preload:false,variable:'--font-noto-serif',fallback:['Batang','serif']});
const sans=Noto_Sans_KR({weight:['400','700'],display:'swap',preload:false,variable:'--font-noto-sans',fallback:['Malgun Gothic','sans-serif']});
const myeongjo=Nanum_Myeongjo({weight:['400','700'],display:'swap',preload:false,variable:'--font-nanum-myeongjo',fallback:['Batang','serif']});
const gothic=Nanum_Gothic({weight:['400','700'],display:'swap',preload:false,variable:'--font-nanum-gothic',fallback:['Malgun Gothic','sans-serif']});
export const manuscriptFontVariables=[gowun.variable,plex.variable,serif.variable,sans.variable,myeongjo.variable,gothic.variable].join(' ');
