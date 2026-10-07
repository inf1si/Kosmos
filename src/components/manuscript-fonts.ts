import { Gowun_Batang, IBM_Plex_Sans_KR, Nanum_Gothic, Nanum_Myeongjo, Noto_Sans_KR, Noto_Serif_KR, Hahmlet, Gowun_Dodum, Gothic_A1, Nanum_Gothic_Coding, Nanum_Pen_Script, Nanum_Brush_Script } from 'next/font/google';
// Fonts missing from Google Fonts come from npm packages and are bundled with the app.
// Pretendard and Wanted Sans use unicode-range subsets; NanumBarunGothic and MaruBuri ship whole files per weight.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import 'wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.css';
import '@kfonts/nanum-barun-gothic/index.css';
import '@kfonts/maruburi/index.css';

// No preload: the browser downloads only the selected family's needed glyph ranges.
const gowun=Gowun_Batang({weight:['400','700'],display:'swap',preload:false,variable:'--font-gowun',fallback:['Batang','serif']});

const plex=IBM_Plex_Sans_KR({weight:['400','700'],display:'swap',preload:false,variable:'--font-plex',fallback:['Malgun Gothic','sans-serif']});

const serif=Noto_Serif_KR({weight:['400','700'],display:'swap',preload:false,variable:'--font-noto-serif',fallback:['Batang','serif']});

const sans=Noto_Sans_KR({weight:['400','700'],display:'swap',preload:false,variable:'--font-noto-sans',fallback:['Malgun Gothic','sans-serif']});

const myeongjo=Nanum_Myeongjo({weight:['400','700'],display:'swap',preload:false,variable:'--font-nanum-myeongjo',fallback:['Batang','serif']});

const gothic=Nanum_Gothic({weight:['400','700'],display:'swap',preload:false,variable:'--font-nanum-gothic',fallback:['Malgun Gothic','sans-serif']});

const hahmlet=Hahmlet({weight:['400','700'],display:'swap',preload:false,variable:'--font-hahmlet'});

const dodum=Gowun_Dodum({weight:'400',display:'swap',preload:false,variable:'--font-gowun-dodum'});

const a1=Gothic_A1({weight:['400','700'],display:'swap',preload:false,variable:'--font-gothic-a1'});

const coding=Nanum_Gothic_Coding({weight:['400','700'],display:'swap',preload:false,variable:'--font-nanum-coding'});

const pen=Nanum_Pen_Script({weight:'400',display:'swap',preload:false,variable:'--font-nanum-pen'});

const brush=Nanum_Brush_Script({weight:'400',display:'swap',preload:false,variable:'--font-nanum-brush'});

export const manuscriptFontVariables=[gowun.variable,plex.variable,serif.variable,sans.variable,myeongjo.variable,gothic.variable,hahmlet.variable,dodum.variable,a1.variable,coding.variable,pen.variable,brush.variable].join(' ');
