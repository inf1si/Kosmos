import type { Metadata } from 'next';
import Link from 'next/link';
import { ThemeControls } from '@/components/theme-toggle';
import { PublicAuthorProfile } from '@/components/public-author-profile';
import { getPublicAuthorProfile } from '@/lib/public-data';
import styles from '../public-info.module.css';

export const dynamic='force-dynamic';

export const metadata:Metadata={title:'자기소개 · Orbis Tertius'};

export default async function AboutPage(){
  let profile:Awaited<ReturnType<typeof getPublicAuthorProfile>>=null,error='';

  try{profile=await getPublicAuthorProfile();}catch{error='자기소개를 불러오지 못했습니다. 잠시 뒤 다시 열어주세요.';}

  return <div className={`public-site ${styles.page}`}>
    <header className={styles.header}><Link className={styles.brand} href="/" aria-label="Orbis Tertius 홈"><span className={styles.brandMark} aria-hidden="true">◌</span>Orbis Tertius</Link><nav aria-label="주 메뉴"><Link href="/library">서재</Link><Link href="/studio">집필실</Link><ThemeControls/></nav></header>
    <main className={styles.document}><h1>자기소개</h1><PublicAuthorProfile initial={profile} error={error}/></main>
    <footer className={styles.footer}><span>Orbis Tertius</span><div><Link href="/">홈</Link></div></footer>
  </div>;
}
