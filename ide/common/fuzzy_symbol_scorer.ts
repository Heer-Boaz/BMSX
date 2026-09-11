/* Symbol fuzzyScore recurrence adapted from VS Code, MIT licensed.
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * See third_party_notices.md. This is scoreFuzzy2's weak-first/full-boost
 * policy, with retained unbounded storage and original-text offset ownership.
 */
import type { CaseFoldedText } from './search_text';

const enum Arrow { Diagonal = 1, Left = 2, LeftLeft = 3 }
const NO_SCORE = Number.MIN_SAFE_INTEGER;

/** Zero and negative scores are matches. Only undefined means no ordered match. */
export class FuzzySymbolScorer {
	private readonly minimum: number[] = [];
	private readonly maximum: number[] = [];
	private readonly scores: number[] = [];
	private readonly diagonals: number[] = [];
	private readonly arrows: Arrow[] = [];
	public readonly positions: number[] = [];

	public score(query: CaseFoldedText, target: CaseFoldedText): number | undefined {
		this.positions.length = 0;
		const pattern = query.lower, word = target.lower;
		const height = pattern.length, width = word.length;
		if (height === 0 || height > width) return undefined;
		let matched = 0;
		for (let column = 0; column < width && matched < height; column += 1) {
			if (pattern[matched] === word[column]) this.minimum[matched++] = column;
		}
		if (matched !== height) return undefined;
		matched = height - 1;
		for (let column = width - 1; column >= 0 && matched >= 0; column -= 1) {
			if (pattern[matched] === word[column]) this.maximum[matched--] = column;
		}

		const stride = width + 1, scores = this.scores, diagonals = this.diagonals, arrows = this.arrows;
		// The recurrence reads the zero row/column; all other cells it reads are
		// produced inside the proven match bounds, even when the stride changes.
		for (let column = 0; column <= width; column += 1) { scores[column] = 0; diagonals[column] = 0; }
		for (let row = 1; row <= height; row += 1) {
			const offset = row * stride, previous = offset - stride;
			scores[offset] = 0; diagonals[offset] = 0;
			const first = this.minimum[row - 1], last = this.maximum[row - 1];
			const nextLast = row < height ? this.maximum[row] : width;
			for (let position = first; position < nextLast; position += 1) {
				const column = position + 1, cell = offset + column, diagonal = previous + column - 1;
				const score = position <= last ? charScore(query, target, row - 1, position, diagonals[diagonal] === 0) : NO_SCORE;
				const canDiagonal = score !== NO_SCORE;
				const diagonalScore = canDiagonal ? score + scores[diagonal] : 0;
				const canLeft = position > first;
				const leftScore = canLeft ? scores[cell - 1] + (diagonals[cell - 1] > 0 ? -5 : 0) : 0;
				const canLeftLeft = position > first + 1 && diagonals[cell - 1] > 0;
				const leftLeftScore = canLeftLeft ? scores[cell - 2] + (diagonals[cell - 2] > 0 ? -5 : 0) : 0;
				if (canLeftLeft && (!canLeft || leftLeftScore >= leftScore) && (!canDiagonal || leftLeftScore >= diagonalScore)) {
					scores[cell] = leftLeftScore; arrows[cell] = Arrow.LeftLeft; diagonals[cell] = 0;
				} else if (canLeft && (!canDiagonal || leftScore >= diagonalScore)) {
					scores[cell] = leftScore; arrows[cell] = Arrow.Left; diagonals[cell] = 0;
				} else {
					// A proven match bound always supplies a diagonal or a left path.
					scores[cell] = diagonalScore; arrows[cell] = Arrow.Diagonal; diagonals[cell] = diagonals[diagonal] + 1;
				}
			}
		}

		let row = height, column = width, backwardsLength = 0, lastColumn = 0;
		const result = scores[height * stride + width];
		while (row >= 1) {
			let diagonalColumn = column;
			while (arrows[row * stride + diagonalColumn] !== Arrow.Diagonal) {
				diagonalColumn -= arrows[row * stride + diagonalColumn] === Arrow.LeftLeft ? 2 : 1;
			}
			if (backwardsLength > 1 && pattern[row - 1] === word[column - 1]
				&& !isUpperAt(target, diagonalColumn - 1) && backwardsLength + 1 > diagonals[row * stride + diagonalColumn]) {
				diagonalColumn = column;
			}
			backwardsLength = diagonalColumn === column ? backwardsLength + 1 : 1;
			if (lastColumn === 0) lastColumn = diagonalColumn;
			row -= 1; column = diagonalColumn - 1;
			this.positions.push(column);
		}
		this.positions.reverse();
		return result + (width === height ? 2 : 0) - (lastColumn - height);
	}
}

function charScore(query: CaseFoldedText, target: CaseFoldedText, row: number, column: number, newMatch: boolean): number {
	if (query.lower[row] !== target.lower[column]) return NO_SCORE;
	let score = 1, gapLocation = false;
	const sameCase = query.text[query.sourceStart(row)] === target.text[target.sourceStart(column)];
	if (column === row) score = sameCase ? 7 : 5;
	else if (isUpperAt(target, column) && (column === 0 || !isUpperAt(target, column - 1))) {
		score = sameCase ? 7 : 5; gapLocation = true;
	} else if (isSeparatorAt(target.lower, column) && (column === 0 || !isSeparatorAt(target.lower, column - 1))) score = 5;
	else if (isSeparatorAt(target.lower, column - 1) || isWhitespaceAt(target.lower, column - 1)) {
		score = 5; gapLocation = true;
	}
	if (!gapLocation) gapLocation = isUpperAt(target, column) || isSeparatorAt(target.lower, column - 1) || isWhitespaceAt(target.lower, column - 1);
	if (row === 0) {
		if (column > 0) score -= gapLocation ? 3 : 5;
	} else if (newMatch) score += gapLocation ? 2 : 0;
	else score += gapLocation ? 0 : 1;
	if (column + 1 === target.lower.length) score -= gapLocation ? 3 : 5;
	return score;
}

function isUpperAt(text: CaseFoldedText, index: number): boolean { return text.text[text.sourceStart(index)] !== text.lower[index]; }
function isWhitespaceAt(text: string, index: number): boolean { return text[index] === ' ' || text[index] === '\t'; }

function isSeparatorAt(text: string, index: number): boolean {
	if (index < 0) return false;
	const code = text.codePointAt(index)!;
	switch (code) {
		case 95: case 45: case 46: case 32: case 47: case 92: case 39: case 34: case 58:
		case 36: case 60: case 62: case 40: case 41: case 91: case 93: case 123: case 125: return true;
		default:
			// Same imprecise emoji separator classification as the production scorer.
			return (code >= 0x1F1E6 && code <= 0x1F1FF) || code === 8986 || code === 8987 || code === 9200
				|| code === 9203 || (code >= 9728 && code <= 10175) || code === 11088 || code === 11093
				|| (code >= 127744 && code <= 128591) || (code >= 128640 && code <= 128764)
				|| (code >= 128992 && code <= 129008) || (code >= 129280 && code <= 129535)
				|| (code >= 129648 && code <= 129782);
	}
}
