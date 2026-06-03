export type SourcePosition = {
	readonly line: number;
	readonly column: number;
};

export type SourceLocation = {
	readonly path: string;
} & SourcePosition;

export type SourceRange = {
	readonly path: string;
	readonly start: SourcePosition;
	readonly end: SourcePosition;
};

export function sourceRangeStartKey(range: SourceRange): string {
	return `${range.start.line}:${range.start.column}`;
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

export function cloneSourceRange(range: SourceRange): SourceRange {
	return {
		path: range.path,
		start: { line: range.start.line, column: range.start.column },
		end: { line: range.end.line, column: range.end.column },
	};
}
