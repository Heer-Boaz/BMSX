import * as constants from './constants';

export type AdvanceMeasure = (ch: string) => number;

export function expandTabs(source: string): string {
	if (source.indexOf('\t') === -1) return source;
	let result = '';
	for (let i = 0; i < source.length; i++) {
		const ch = source.charAt(i);
		if (ch === '\t') {
			for (let j = 0; j < constants.TAB_SPACES; j++) result += ' ';
		} else {
			result += ch;
		}
	}
	return result;
}

export function measureTextGeneric(text: string, advance: AdvanceMeasure, spaceAdvance: number): number {
	let width = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charAt(i);
		if (ch === '\t') { width += spaceAdvance * constants.TAB_SPACES; continue; }
		if (ch === '\n') continue;
		width += advance(ch);
	}
	return width;
}

export function truncateTextToWidth(text: string, maxWidth: number, advance: AdvanceMeasure, spaceAdvance: number): string {
	if (maxWidth <= 0) return '';
	if (measureTextGeneric(text, advance, spaceAdvance) <= maxWidth) return text;
	const ellipsis = '...';
	const ellipsisWidth = measureTextGeneric(ellipsis, advance, spaceAdvance);
	if (ellipsisWidth > maxWidth) return '';
	let low = 0, high = text.length, best = '';
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const candidate = text.slice(0, mid) + ellipsis;
		if (measureTextGeneric(candidate, advance, spaceAdvance) <= maxWidth) {
			best = candidate; low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return best;
}

// Generic measurement-based wrapper using a callback measure(string)->width
export function wrapTextDynamic(
	text: string,
	firstLineWidth: number,
	subsequentWidth: number,
	measure: (text: string) => number,
	maxLines: number,
): string[] {
	const lines: string[] = [];
	if (maxLines <= 1) {
		if (firstLineWidth <= 0) return [''];
		const truncated = truncateWithMeasure(text, firstLineWidth, measure);
		lines.push(truncated);
		return lines;
	}
	let remaining = text;
	let width = firstLineWidth;
	for (let i = 0; i < maxLines; i += 1) {
		if (remaining.length === 0) break;
		const sliceIndex = findMaxFittingIndexMeasure(remaining, width, measure);
		const lineText = remaining.slice(0, sliceIndex).trimEnd();
		lines.push(lineText);
		remaining = remaining.slice(sliceIndex).trimStart();
		width = subsequentWidth;
	}
	if (lines.length === 0) {
		lines.push('');
		return lines;
	}
	if (remaining.length > 0) {
		const lastIndex = lines.length - 1;
		const last = `${lines[lastIndex]}…`;
		const lastLineWidth = lines.length === 1 ? firstLineWidth : subsequentWidth;
		lines[lastIndex] = truncateWithMeasure(last, lastLineWidth, measure);
	}
	return lines;
}

export function isLuaCommentContext(
	lines: readonly string[],
	targetRow: number,
	targetColumn: number,
): boolean {
	if (targetRow < 0 || targetRow >= lines.length) {
		return false;
	}
	let blockComment = false;
	let stringDelimiter: '\'' | '"' | null = null;
	for (let row = 0; row <= targetRow; row += 1) {
		const line = lines[row] ?? '';
		let index = 0;
		let lineComment = false;
		const limitColumn = row === targetRow ? targetColumn : line.length;
		while (index <= line.length) {
			if (row === targetRow && index >= limitColumn) {
				return blockComment || lineComment;
			}
			if (index === line.length) {
				break;
			}
			const ch = line.charAt(index);
			const next = index + 1 < line.length ? line.charAt(index + 1) : '';
			if (lineComment) {
				index += 1;
				continue;
			}
			if (stringDelimiter !== null) {
				if (ch === '\\') {
					index += 2;
				} else if (ch === stringDelimiter) {
					stringDelimiter = null;
					index += 1;
				} else {
					index += 1;
				}
				continue;
			}
			if (blockComment) {
				if (ch === ']' && next === ']') {
					blockComment = false;
					index += 2;
				} else {
					index += 1;
				}
				continue;
			}
			if (ch === '-' && next === '-') {
				const next2 = index + 2 < line.length ? line.charAt(index + 2) : '';
				const next3 = index + 3 < line.length ? line.charAt(index + 3) : '';
				if (next2 === '[' && next3 === '[') {
					blockComment = true;
					index += 4;
					continue;
				}
				lineComment = true;
				index += 2;
				continue;
			}
			if (ch === '\'' || ch === '"') {
				stringDelimiter = ch as '\'' | '"';
				index += 1;
				continue;
			}
			index += 1;
		}
	}
	return blockComment;
}

function findMaxFittingIndexMeasure(text: string, maxWidth: number, measure: (t: string) => number): number {
	if (text.length === 0) return 0;
	if (maxWidth <= 0) return 1;
	let low = 1;
	let high = text.length;
	let best = 0;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const candidate = text.slice(0, mid);
		const w = measure(candidate);
		if (w <= maxWidth) { best = mid; low = mid + 1; }
		else { high = mid - 1; }
	}
	if (best <= 0) return 1;
	if (best >= text.length) return text.length;
	let breakIndex = best;
	for (let i = best - 1; i >= 0; i -= 1) {
		const ch = text.charAt(i);
		if (ch === ' ' || ch === '\t') { breakIndex = i + 1; break; }
	}
	return breakIndex;
}

function truncateWithMeasure(text: string, maxWidth: number, measure: (t: string) => number): string {
	if (maxWidth <= 0) return '';
	if (measure(text) <= maxWidth) return text;
	const ellipsis = '...';
	const ellipsisWidth = measure(ellipsis);
	if (ellipsisWidth > maxWidth) return '';
	let low = 0, high = text.length, best = '';
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const candidate = text.slice(0, mid) + ellipsis;
		if (measure(candidate) <= maxWidth) { best = candidate; low = mid + 1; }
		else { high = mid - 1; }
	}
	return best;
}
