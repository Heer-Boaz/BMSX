export function assignRowColumn<T extends { row: number; column: number }>(
	target: T | null,
	row: number,
	column: number,
	fallback: T,
): T {
	const next = target ?? fallback;
	next.row = row;
	next.column = column;
	return next;
}
