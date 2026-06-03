import type { SourceRange } from '../cpu/cpu';

type SourceRangeLike = {
	readonly path: string;
	readonly start: {
		readonly line: number;
		readonly column: number;
	};
	readonly end: {
		readonly line: number;
		readonly column: number;
	};
};

export const cloneSourceRange = (range: SourceRangeLike): SourceRange => ({
	path: range.path,
	start: {
		line: range.start.line,
		column: range.start.column,
	},
	end: {
		line: range.end.line,
		column: range.end.column,
	},
});
