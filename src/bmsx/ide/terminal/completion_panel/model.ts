import { clamp } from '../../../common/clamp';

export type TerminalPanelGridLayout = {
	columns: number;
	rows: number;
	cellWidth: number;
	gap: number;
	visibleRows: number;
	paddingX: number;
	paddingY: number;
};

export function isSymbolQueryChar(ch: string): boolean {
	const code = ch.charCodeAt(0);
	if (code >= 48 && code <= 57) return true;
	if (code >= 65 && code <= 90) return true;
	if (code >= 97 && code <= 122) return true;
	switch (ch) {
		case '_':
		case '.':
		case ':':
			return true;
		default:
			return false;
	}
}

export function findSymbolCompletionBounds(text: string, cursor: number): { start: number; end: number } {
	let start = cursor;
	while (start > 0 && isSymbolQueryChar(text.charAt(start - 1))) {
		start -= 1;
	}
	let end = cursor;
	while (end < text.length && isSymbolQueryChar(text.charAt(end))) {
		end += 1;
	}
	return { start, end };
}

export function splitSymbolQuerySegments(value: string): string[] {
	const rawSegments = value.split(/[.:]/);
	const segments: string[] = [];
	for (let index = 0; index < rawSegments.length; index += 1) {
		const segment = rawSegments[index];
		if (segment.length > 0) segments.push(segment);
	}
	return segments;
}

export function matchesSymbolSegmentChain(nameLower: string, needleSegments: string[]): boolean {
	if (needleSegments.length <= 1) return false;
	const nameSegments = splitSymbolQuerySegments(nameLower);
	if (needleSegments.length > nameSegments.length) return false;
	for (let index = 0; index < needleSegments.length; index += 1) {
		if (!nameSegments[index].startsWith(needleSegments[index])) return false;
	}
	return true;
}

export function matchesAnySymbolSegment(nameLower: string, needleSegments: string[]): boolean {
	if (needleSegments.length === 0) return false;
	const tailNeedle = needleSegments[needleSegments.length - 1];
	if (tailNeedle.length === 0) return false;
	const nameSegments = splitSymbolQuerySegments(nameLower);
	for (let index = 0; index < nameSegments.length; index += 1) {
		const segment = nameSegments[index];
		if (segment.startsWith(tailNeedle) || segment.includes(tailNeedle)) return true;
	}
	return false;
}

export function computePanelGridLayout(total: number, maxColumns: number, maxRows: number, maxLabelLength: number, minCellWidth: number, columnGap: number, paddingX: number, paddingY: number): TerminalPanelGridLayout {
	const px = clamp(paddingX, 0, Math.max(0, Math.floor((maxColumns - 1) / 2)));
	const py = clamp(paddingY, 0, Math.max(0, Math.floor((maxRows - 1) / 2)));
	const availableColumns = Math.max(1, maxColumns - px * 2);
	const availableRows = Math.max(1, maxRows - py * 2);
	const fullCell = clamp(Math.max(1, maxLabelLength), 1, availableColumns);
	const maxByFull = Math.max(1, Math.floor((availableColumns + columnGap) / (fullCell + columnGap)));
	let columns = Math.max(1, total > 0 ? Math.min(total, maxByFull) : 1);
	let cellWidth = Math.max(1, Math.floor((availableColumns - columnGap * (columns - 1)) / columns));
	if (columns < 2 && total > 1) {
		const compactCell = clamp(minCellWidth, 1, availableColumns);
		const maxByCompact = Math.max(1, Math.floor((availableColumns + columnGap) / (compactCell + columnGap)));
		if (maxByCompact > columns) {
			columns = Math.min(total, maxByCompact);
			cellWidth = Math.max(1, Math.floor((availableColumns - columnGap * (columns - 1)) / columns));
		}
	}
	const rows = Math.max(1, Math.ceil(total / columns));
	const visibleRows = Math.max(1, Math.min(rows, availableRows));
	return { columns, rows, cellWidth, gap: columnGap, visibleRows, paddingX: px, paddingY: py };
}

export function truncatePanelLabel(name: string, cellWidth: number): string {
	if (name.length <= cellWidth) return name;
	if (cellWidth <= 3) return name.slice(0, cellWidth);
	return `${name.slice(0, cellWidth - 3)}...`;
}
