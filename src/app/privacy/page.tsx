import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../public-info.module.css';

export const metadata: Metadata = {
  title: '개인정보 및 데이터 이용 안내 · Orbis Tertius',
  description: 'Orbis Tertius의 원고 저장, Google Drive 백업, 선택적 AI 검토에 대한 데이터 이용 안내.',
};

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Orbis Tertius 홈">
          <span className={styles.brandMark} aria-hidden="true">◌</span>
          Orbis Tertius
        </Link>
        <nav aria-label="주 메뉴">
          <Link href="/library">서재</Link>
          <Link href="/studio">집필실</Link>
        </nav>
      </header>

      <main className={styles.document}>
        <p className={styles.eyebrow}>DATA USE</p>
        <h1>개인정보 및<br className={styles.mobileBreak} /> 데이터 이용 안내</h1>
        <p className={styles.updated}>최종 수정: 2026년 10월 2일</p>
        <p className={styles.documentLead}>
          Orbis Tertius는 개인 소설 집필과 작품 공개를 위한 사이트입니다.
          이 페이지는 현재 구현된 저장·백업·AI 기능이 어떤 데이터를 처리하는지 설명합니다.
          Google Drive 백업과 AI 검토는 연결 설정을 완료한 경우에만 실행됩니다.
        </p>

        <section aria-labelledby="storage-title">
          <h2 id="storage-title">원고와 계정</h2>
          <p>
            집필실은 로그인한 허용 작가의 작업 공간입니다. 로그인과 계정 인증은 Supabase를 사용합니다.
            원고, 작품 설정, 메모, 각주, 첨부 이미지와 복구 이력은 집필 기능에 사용됩니다.
            작업 내용은 브라우저의 기기 저장소에 보관되고, 로그인한 작가의 Supabase 작업 공간과 동기화됩니다.
            첨부 원본은 비공개 저장소에 보관합니다.
          </p>
          <p>
            서재에 공개한 판본과 공개 설정은 로그인하지 않은 방문자도 읽을 수 있습니다.
            공개는 작가가 선택한 판본을 기준으로 하며, 집필실의 수정 내용이 자동으로 공개되지는 않습니다.
          </p>
        </section>

        <section aria-labelledby="drive-title">
          <h2 id="drive-title">Google Drive 백업</h2>
          <p>
            Google 계정 연결은 선택 사항이며, 클라우드에 저장된 원고를 별도로 보관하기 위해 사용합니다.
            연결 시 요청하는 권한은 <code>drive.file</code> 하나입니다.
            Orbis Tertius는 자신이 만든 백업 폴더와 파일을 조회·생성·읽기·갱신하며,
            Google Drive의 일반 문서나 사진을 전체 검색하지 않습니다.
          </p>
          <p>
            백업 ZIP에는 설정된 작가 한 명의 서버 작업 공간, 최근 서버 복구 이력 최대 50개,
            해당 내용에서 참조하는 첨부 이미지가 포함됩니다. 기기에만 남아 있는 미동기화 수정은 포함되지 않습니다.
            서버는 업로드한 ZIP을 다시 읽어 검증하고, 성공한 경우 마지막 백업 시각과 버전 등을 담은 기록 파일을 갱신합니다.
          </p>
          <p>
            Google 연결 토큰과 클라이언트 비밀키는 서버 환경 변수에 보관합니다.
            백업 코드는 파일의 공유 권한을 추가하지 않으며, ZIP 내용에 별도의 앱 암호화를 적용하지 않습니다.
            백업은 연결한 Google 계정의 저장 공간을 사용합니다.
          </p>
          <p>
            Google 계정의 앱 연결 관리에서 Orbis Tertius의 접근 권한을 취소할 수 있습니다.
            취소 후에는 새로운 Drive 백업을 계속할 수 없지만, 이미 만들어진 파일이 자동으로 삭제되지는 않습니다.
            자동 삭제나 보관 기간에 따른 정리는 구현되어 있지 않으므로, 기존 백업은 Google Drive에서 직접 관리해야 합니다.
          </p>
          <p className={styles.reference}>
            관련 안내: <a href="https://developers.google.com/workspace/drive/api/guides/api-specific-auth">Google Drive 권한</a>,{' '}
            <a href="https://myaccount.google.com/connections">Google 계정 연결 관리</a>,{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API 서비스 사용자 데이터 정책</a>
          </p>
        </section>

        <section aria-labelledby="ai-title">
          <h2 id="ai-title">선택적 AI 검토</h2>
          <p>
            AI는 작가가 검토를 요청할 때만 호출됩니다. 선택한 제공자(OpenAI, Claude 또는 Gemini)에게
            현재 검토 문서의 일반 텍스트와 제목, 검토 목적, 관련 작품 설정을 전송합니다.
            문서는 최대 12,000자이며, 관련 설정은 원고에서 연결한 설정 또는 시점 인물과 제목이 같은 설정 중
            최대 8개를 문서당 1,800자까지 포함합니다.
          </p>
          <p>
            Google Drive의 백업 파일이나 Google 연결 정보를 AI 검토에 사용하거나 AI 제공자에게 보내지 않습니다.
            AI 검토는 서버에 저장된 선택 문서에서 필요한 텍스트를 가져옵니다.
            제공자의 데이터 보관·사용 정책은 각 서비스의 정책을 따르므로, 원고 검토 전에 확인해야 합니다.
          </p>
          <p>
            제안은 작가가 선택하여 적용하며, AI가 원고를 자동으로 수정하거나 공개하지 않습니다.
            AI 키는 서버 환경 변수로 설정하며 집필 화면에 키 값을 반환하지 않습니다.
          </p>
        </section>

        <section aria-labelledby="manage-title">
          <h2 id="manage-title">보관과 직접 관리</h2>
          <p>
            원고를 삭제하거나 공개 판본을 비공개로 전환해도, 복구 이력과 이미 내보낸 파일 또는 Drive 백업에는
            이전 내용이 남아 있을 수 있습니다. 브라우저의 사이트 데이터를 지우는 작업은 해당 기기의 저장소에만 영향을 줍니다.
            클라우드 원고, 복구 이력과 외부 백업은 각각 따로 관리해야 합니다.
          </p>
          <p>
            기능 문의와 오류 제보는 <a href="https://github.com/inf1si/Kosmos/issues">Orbis Tertius GitHub 저장소</a>에서 받습니다.
            공개 게시물에 비밀번호, 인증 키, 백업 파일이나 비공개 원고를 첨부하지 마세요.
          </p>
        </section>

        <Link className={styles.quietLink} href="/">홈으로 돌아가기 <span aria-hidden="true">→</span></Link>
      </main>

      <footer className={styles.footer}>
        <span>Orbis Tertius</span>
        <div><Link href="/library">서재</Link><Link href="/studio">집필실</Link></div>
      </footer>
    </div>
  );
}
