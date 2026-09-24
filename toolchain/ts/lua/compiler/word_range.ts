/** Half-open instruction-word intervals in a finalized function, not source scopes. */
export type ProgramWordRange = { start: number; end: number };

/** Append an ordered interval, coalescing adjacent coverage without per-word storage. */
export function appendProgramWordRange(ranges: ProgramWordRange[], start: number, end: number): void {
	const previous = ranges[ranges.length - 1];
	if (previous !== undefined && previous.end === start) previous.end = end;
	else ranges.push({ start, end });
}
