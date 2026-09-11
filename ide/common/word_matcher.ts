/* Word-boundary recurrence adapted from VS Code matchesWords, MIT licensed.
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * See third_party_notices.md. Input is already case-folded text; this primitive
 * does not normalize accents or transliterate input methods.
 */

const WORD_SEPARATORS = ' \t\n\r()[]{}<>`\'"-/;:,.?!';

/** The same adjacent-first/word-boundary recurrence, with retained iterative storage. */
export class WordMatcher {
	private readonly matches: number[] = [];
	private readonly boundaries: boolean[] = [];

	public test(query: string, target: string): boolean {
		const width = target.length, height = query.length;
		if (width === 0 || height > width) return false;
		if (height === 0) return true;
		const cells = this.matches, boundaries = this.boundaries;
		let previousSeparator = false;
		for (let index = 0; index < width; index += 1) {
			const separator = WORD_SEPARATORS.includes(target[index]);
			boundaries[index] = separator || previousSeparator;
			previousSeparator = separator;
		}
		for (let row = height - 1; row >= 0; row -= 1) {
			const offset = row * width, nextRow = offset + width;
			const last = row === height - 1;
			const querySeparator = WORD_SEPARATORS.includes(query[row]);
			let laterWordMatches = false;
			for (let column = width - 1; column >= 0; column -= 1) {
				const next = column + 1;
				const adjacentMatches = last || (next < width && cells[nextRow + next] !== 0);
				if (!last && next < width && boundaries[next] && cells[nextRow + next] !== 0) laterWordMatches = true;
				const equal = query[row] === target[column]
					|| (querySeparator && WORD_SEPARATORS.includes(target[column]));
				cells[offset + column] = equal && (adjacentMatches || laterWordMatches) ? 1 : 0;
			}
		}
		for (let index = 0; index < width; index += 1) {
			if ((index === 0 || boundaries[index]) && cells[index] !== 0) return true;
		}
		return false;
	}
}
