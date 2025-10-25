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
