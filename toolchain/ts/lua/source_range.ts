export type SourcePosition = {
	line: number;
	column: number;
};

export type SourceRange = {
	path: string;
	start: SourcePosition;
	end: SourcePosition;
};

export function sourceRangesEqual(left: SourceRange, right: SourceRange): boolean {
	return left.path === right.path
		&& left.start.line === right.start.line
		&& left.start.column === right.start.column
		&& left.end.line === right.end.line
		&& left.end.column === right.end.column;
}
