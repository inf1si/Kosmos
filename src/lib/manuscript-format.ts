import { z } from 'zod';
import type { JsonValue } from './json-value';
import type { RichAttributes } from './model';

/** Only bounded numeric formatting reaches HTML, the reader or the editor. */
export function formatNumber(value: JsonValue | undefined, min: number, max: number): number | undefined {
  const parsed = z.number().min(min).max(max).safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

const textAlignmentSchema = z.enum(['left', 'center', 'right', 'justify']);

type ParagraphAttributes = {
  textAlign?: z.infer<typeof textAlignmentSchema>; lineHeight?: number; indent?: number;
  firstLineIndent?: number; spaceBefore?: number; spaceAfter?: number;
};

export function paragraphStyle(attrs: RichAttributes = {}) {
  const lineHeight = formatNumber(attrs.lineHeight, 1, 3), indent = formatNumber(attrs.indent, 0, 8);
  const firstLineIndent = formatNumber(attrs.firstLineIndent, 0, 4), spaceBefore = formatNumber(attrs.spaceBefore, 0, 48), spaceAfter = formatNumber(attrs.spaceAfter, 0, 48);
  const alignment = textAlignmentSchema.safeParse(attrs.textAlign);

  return {
    textAlign: alignment.success ? alignment.data : undefined, lineHeight,
    marginInlineStart: indent === undefined ? undefined : `${indent * 1.5}em`,
    textIndent: firstLineIndent === undefined ? undefined : `${firstLineIndent}em`,
    marginTop: spaceBefore === undefined ? undefined : `${spaceBefore}px`,
    marginBottom: spaceAfter === undefined ? undefined : `${spaceAfter}px`,
  };
}

const paragraphCssNames = new Map([
  ['textAlign', 'text-align'], ['lineHeight', 'line-height'], ['marginInlineStart', 'margin-inline-start'],
  ['textIndent', 'text-indent'], ['marginTop', 'margin-top'], ['marginBottom', 'margin-bottom'],
]);

export function paragraphCss(attrs: RichAttributes = {}) {
  return Object.entries(paragraphStyle(attrs)).flatMap(([key, value]) => value === undefined ? [] : [`${paragraphCssNames.get(key)}:${value}`]).join(';');
}

export function htmlParagraphAttrs(style: string): ParagraphAttributes {
  const attrs: ParagraphAttributes = {};

  const declarations = new Map(style.split(';').flatMap(declaration => {
    const pair = declaration.trim().split(':').map(value => value.trim().toLowerCase());

    return pair.length === 2 ? [[pair[0], pair[1]]] : [];
  }));

  const numeric = (css: string, key: Exclude<keyof ParagraphAttributes, 'textAlign'>, min: number, max: number, suffix = '', scale = 1) => {
    const source = declarations.get(css);

    if (source === undefined || !(suffix ? new RegExp(`^\\d+(?:\\.\\d+)?${suffix}$`) : /^\d+(?:\.\d+)?$/).test(source)) return;
    const value = formatNumber(Number(source.replace(suffix, '')) / scale, min, max);

    if (value !== undefined) attrs[key] = value;
  };

  numeric('line-height', 'lineHeight', 1, 3); numeric('margin-inline-start', 'indent', 0, 8, 'em', 1.5); numeric('text-indent', 'firstLineIndent', 0, 4, 'em');
  numeric('margin-top', 'spaceBefore', 0, 48, 'px'); numeric('margin-bottom', 'spaceAfter', 0, 48, 'px');
  const alignment = textAlignmentSchema.safeParse(declarations.get('text-align'));

  if (alignment.success) attrs.textAlign = alignment.data;

  return attrs;
}

/** A size set on selected text: 10–72px in 0.5px steps, the same range as the manuscript size. */
export const inlineFontSizeSchema = z.number().min(10).max(72).refine(value => Number.isInteger(value * 2));

export function inlineFontSize(value: JsonValue | undefined): number | undefined {
  const parsed = inlineFontSizeSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

export const bulletListStyles = [{ id: 'disc', label: '점', marker: '•' }, { id: 'circle', label: '빈 원', marker: '◦' }, { id: 'square', label: '네모', marker: '▪' }] as const;

export const orderedListStyles = [{ id: 'decimal', label: '숫자', marker: '1.' }, { id: 'hangul', label: '가나다', marker: '가.' }, { id: 'hangul-consonant', label: 'ㄱㄴㄷ', marker: 'ㄱ.' }, { id: 'lower-alpha', label: '소문자', marker: 'a.' }, { id: 'upper-alpha', label: '대문자', marker: 'A.' }, { id: 'lower-roman', label: '로마자', marker: 'i.' }] as const;

const listStyles = (type: string) => type === 'bulletList' ? bulletListStyles : type === 'orderedList' ? orderedListStyles : [];

/** null means the default marker (점, 숫자). */
export function validListStyle(type: string, value: JsonValue | undefined) { return value === null || value === undefined || listStyles(type).some(style => style.id === value); }

const htmlOrderedTypes = new Map([['1', 'decimal'], ['a', 'lower-alpha'], ['A', 'upper-alpha'], ['i', 'lower-roman'], ['I', 'upper-roman']]);

/** The marker a list shows. Pasted numbered lists may carry only the HTML type attribute (a, A, i, I). */
export function listStyleType(node: { type: string; attrs?: RichAttributes }): string | undefined {
  const own = listStyles(node.type).find(style => style.id === node.attrs?.listStyle)?.id;

  if (own) return own;
  const parsed = z.string().safeParse(node.attrs?.type);

  if (node.type === 'orderedList' && parsed.success) return htmlOrderedTypes.get(parsed.data);
}

const cellSpanSchema = z.number().int().min(1).max(40);

export function cellSpan(value: JsonValue | undefined) {
  const parsed = cellSpanSchema.safeParse(value);

  return parsed.success ? parsed.data : 1;
}

export function tableColumns(row?: { content?: { attrs?: RichAttributes }[] }) {
  return (row?.content || []).flatMap(cell => Array.from({ length: cellSpan(cell.attrs?.colspan) }, (_, index) => {
    const widths = cell.attrs?.colwidth;

    return Array.isArray(widths) ? formatNumber(widths[index], 1, 2000) : undefined;
  }));
}
