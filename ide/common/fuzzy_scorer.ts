/* Non-contiguous scoreFuzzy recurrence adapted from VS Code, MIT licensed.
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * See third_party_notices.md. Storage is retained, and case-folded positions
 * are related to original text by CaseFoldedText rather than index guessing.
 */
import type { CaseFoldedText } from './search_text';

/** One scoring workspace; positions belong to its most recent successful score. */
export class FuzzyScorer {
	private readonly scores: number[] = [];
	private readonly consecutive: number[] = [];
	public readonly positions: number[] = [];

	public score(query: CaseFoldedText, target: CaseFoldedText): number {
		this.positions.length = 0;
		const pattern = query.lower, word = target.lower;
		const height = pattern.length, width = word.length;
		if (height === 0 || height > width) return 0;

		// Same ordered-match feasibility proof used before VS Code's fuzzyScore
		// matrix, with scoreFuzzy's platform-independent path separators.
		let matched = 0;
		for (let column = 0; column < width && matched < height; column += 1) {
			if (charactersMatch(pattern[matched], word[column])) matched += 1;
		}
		if (matched !== height) return 0;

		const scores = this.scores, consecutive = this.consecutive;
		for (let row = 0; row < height; row += 1) {
			const offset = row * width, previous = offset - width;
			const queryChar = query.text[query.sourceStart(row)];
			for (let column = 0; column < width; column += 1) {
				const cell = offset + column, diagonal = previous + column - 1;
				const leftScore = column > 0 ? scores[cell - 1] : 0;
				const diagonalScore = row > 0 && column > 0 ? scores[diagonal] : 0;
				const sequence = row > 0 && column > 0 ? consecutive[diagonal] : 0;
				let score = 0;
				if ((row === 0 || diagonalScore !== 0) && charactersMatch(pattern[row], word[column])) {
					const sourceIndex = target.sourceStart(column);
					score = 1 + Math.min(sequence, 3) * 6 + Math.max(0, sequence - 3) * 3;
					if (queryChar === target.text[sourceIndex]) score += 1;
					if (column === 0) score += 8;
					else {
						const separator = separatorScore(target.text.charCodeAt(target.sourceStart(column - 1)));
						if (separator !== 0) score += separator;
						else {
							const char = target.text.charCodeAt(sourceIndex);
							if (char >= 65 && char <= 90 && sequence === 0) score += 2;
						}
					}
				}
				if (score !== 0 && diagonalScore + score >= leftScore) {
					consecutive[cell] = sequence + 1;
					scores[cell] = diagonalScore + score;
				} else {
					consecutive[cell] = 0;
					scores[cell] = leftScore;
				}
			}
		}

		let row = height - 1, column = width - 1;
		while (row >= 0 && column >= 0) {
			if (consecutive[row * width + column] !== 0) {
				this.positions.push(column);
				row -= 1;
			}
			column -= 1;
		}
		this.positions.reverse();
		return scores[height * width - 1];
	}
}

function charactersMatch(left: string, right: string): boolean {
	return left === right || ((left === '/' || left === '\\') && (right === '/' || right === '\\'));
}

function separatorScore(code: number): number {
	switch (code) {
		case 47: case 92: return 5; // / \
		case 95: case 45: case 46: case 32: case 39: case 34: case 58: return 4; // _ - . space ' " :
		default: return 0;
	}
}
