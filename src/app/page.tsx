import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './public-info.module.css';

export const metadata: Metadata = {
  title: 'Kosmos · 궤도 서재',
  description: '소설을 쓰고, 읽고, 작품의 세계를 기록하는 개인 서재.',
};

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Kosmos 궤도 서재 홈">
          <span className={styles.brandMark} aria-hidden="true">◌</span>
          궤도 서재 <span className={styles.brandEnglish}>Kosmos</span>
        </Link>
        <nav aria-label="주 메뉴">
          <Link href="/library">서재</Link>
          <Link href="/studio">집필실</Link>
        </nav>
      </header>

      <main className={styles.home}>
        <section className={styles.intro} aria-labelledby="home-title">
          <p className={styles.eyebrow}>A PERSONAL FICTION LIBRARY</p>
          <h1 id="home-title">이야기를 쓰고,<br />그 세계를 기록하는 곳.</h1>
          <p className={styles.lead}>
            궤도 서재는 SF 소설을 위한 개인 집필 공간이자 작은 서재입니다.
            원고와 작품별 설정을 함께 정리하고, 공개한 이야기는 책장을 넘기듯 읽습니다.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primaryLink} href="/library">서재 둘러보기 <span aria-hidden="true">↗</span></Link>
            <Link className={styles.quietLink} href="/studio">작가 집필실 <span aria-hidden="true">→</span></Link>
          </div>
        </section>

        <section className={styles.contents} aria-label="서재 안내">
          <div className={styles.contentRow}>
            <span className={styles.number} aria-hidden="true">01</span>
            <h2>집필</h2>
            <p>장면과 메모를 정리하는 작가 전용 공간. 원고는 기기에 저장하고 클라우드와 동기화합니다.</p>
          </div>
          <div className={styles.contentRow}>
            <span className={styles.number} aria-hidden="true">02</span>
            <h2>읽기</h2>
            <p>작가가 공개한 판본을 읽는 서재. 각주와 설정 연결을 따라 이야기의 맥락을 살펴볼 수 있습니다.</p>
          </div>
          <div className={styles.contentRow}>
            <span className={styles.number} aria-hidden="true">03</span>
            <h2>세계</h2>
            <p>인물, 장소, 기술과 연표를 작품별로 기록합니다. 공개한 설정은 원고와 이어집니다.</p>
          </div>
        </section>

        <aside className={styles.note}>
          <p>집필실은 허용된 작가 계정으로 이용합니다. Google Drive 백업과 AI 검토는 별도 연결이 필요한 선택 기능입니다.</p>
          <Link href="/privacy">개인정보 및 데이터 이용 안내 <span aria-hidden="true">→</span></Link>
        </aside>
      </main>

      <footer className={styles.footer}>
        <span>Kosmos · 궤도 서재</span>
        <div>
          <Link href="/privacy">데이터 이용 안내</Link>
          <a href="https://github.com/inf1si/Kosmos">GitHub</a>
        </div>
      </footer>
    </div>
  );
}
