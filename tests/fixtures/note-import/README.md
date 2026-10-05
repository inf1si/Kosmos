# 노트 가져오기 시험 파일

[note-import-formats.test.ts](../../note-import-formats.test.ts)가 읽는 합성 파일이다. 실제 원고 내용은 없다.

| 파일 | 만든 방법 |
|---|---|
| `voyage.docx` | python-docx 1.x: 제목 1·2, 굵게·기울임, 글머리·번호 목록(스타일에 번호가 들어 있는 형식), 가운데 정렬, 2×2 표, 2×2 PNG |
| `sea.epub` | EbookLib: EPUB 3 목차(nav)·NCX, 두 장, 장 사이 링크, 상대 경로 PNG |
| `memo.hwp` | SheetJS `cfb` 1.2.2로 만든 OLE 파일. `FileHeader`(압축 플래그), raw deflate한 `BodyText/Section0`(문단 4개와 표 컨트롤 1개)과 4KB를 넘는 `Section1`(일반 FAT 경로 확인용) |

`memo.hwp`의 레코드는 HWP 5.0 공개 문서의 `HWPTAG_PARA_HEADER`(66)·`HWPTAG_PARA_TEXT`(67) 형식을 따른다. 실제 한글 프로그램이 저장한 파일은 아니므로 실제 파일 확인은 [검증 기록](../../../VERIFICATION.md)에 따로 적는다.
