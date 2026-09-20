import type { SourcePosition, SourceRange } from '../source_range';
import type { LuaSourceLocations, LuaSyntaxSpan } from '../syntax/source_locations';

export type SourceLocation = {
	readonly path: string;
} & SourcePosition;


export function sourcePositionKey(position: SourcePosition): string {
	return `${position.line}:${position.column}`;
}

export function sourceRangeKey(range: SourceRange): string {
	return `${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;
}

export function compareSourcePosition(line: number, column: number, otherLine: number, otherColumn: number): number {
	if (line < otherLine) {
		return -1;
	}
	if (line > otherLine) {
		return 1;
	}
	if (column < otherColumn) {
		return -1;
	}
	if (column > otherColumn) {
		return 1;
	}
	return 0;
}

export function sourcePositionInRange(line: number, column: number, range: SourceRange): boolean {
	return compareSourcePosition(line, column, range.start.line, range.start.column) >= 0
		&& compareSourcePosition(line, column, range.end.line, range.end.column) <= 0;
}

// The producer orders non-overlapping semantic occurrences by source start.
// Position queries can therefore descend the retained array without scanning
// every declaration or reference in the file.
export function findOrderedSourceRangeEntryAtPosition<T extends { readonly range: SourceRange }>(
	entries: readonly T[],
	line: number,
	column: number,
): T | undefined {
	let low = 0;
	let high = entries.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const start = entries[middle].range.start;
		if (compareSourcePosition(start.line, start.column, line, column) <= 0) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	const index = low - 1;
	if (index < 0) {
		return undefined;
	}
	const entry = entries[index];
	return compareSourcePosition(line, column, entry.range.end.line, entry.range.end.column) <= 0
		? entry
		: undefined;
}

// Binder occurrences stay relative; only the query position crosses the source boundary.
export function findOrderedSourceSpanEntryAtPosition<T extends { readonly span: LuaSyntaxSpan }>(
	entries: readonly T[],
	locations: LuaSourceLocations,
	line: number,
	column: number,
): T | undefined {
	const offset = locations.offsetAt({ line, column });
	let low = 0;
	let high = entries.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const span = entries[middle].span;
		if (locations.offset(span.unit, span.start) <= offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	const index = low - 1;
	if (index < 0) return undefined;
	const entry = entries[index];
	return offset <= locations.offset(entry.span.unit, entry.span.end) ? entry : undefined;
}

export function cloneSourceRange(range: SourceRange): SourceRange {
	return {
		path: range.path,
		start: { line: range.start.line, column: range.start.column },
		end: { line: range.end.line, column: range.end.column },
	};
}
