import type { Metadata } from 'next';
import Link from 'next/link';
import { ThemeControls } from '@/components/theme-toggle';
import styles from './public-info.module.css';

export const metadata: Metadata = {
  title: 'Orbis Tertius',
};

export default function Home() {
  return (
    <div className={`public-site ${styles.page}`}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Orbis Tertius 홈">
          <span className={styles.brandMark} aria-hidden="true">◌</span>
          Orbis Tertius
        </Link>
        <nav aria-label="주 메뉴">
          <Link href="/library">서재</Link>
          <Link href="/studio">집필실</Link>
          <ThemeControls />
        </nav>
      </header>

      <main className={styles.home}>
        <section className={styles.intro} aria-labelledby="home-title">
          <h1 id="home-title">Orbis Tertius</h1>
          <div className={styles.actions}>
            <Link className={styles.primaryLink} href="/library">서재 둘러보기 <span aria-hidden="true">↗</span></Link>
            <Link className={styles.quietLink} href="/studio">작가 집필실 <span aria-hidden="true">→</span></Link>
          </div>
        </section>

      </main>

      <footer className={styles.footer}>
        <span>Orbis Tertius</span>
      </footer>
    </div>
  );
}
