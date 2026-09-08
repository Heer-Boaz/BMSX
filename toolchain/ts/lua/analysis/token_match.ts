/*
 * Myers frontier/path algorithm adapted from Microsoft VS Code,
 * myersDiffAlgorithm.ts, revision 48ac1875628144c02d79ff412e0323af9991dfc7.
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License:
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to
 * do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { LuaToken } from '../syntax/token';

type MatchPath = { previous: MatchPath | null; x: number; y: number; length: number };

/** Exact, ordered token correspondence. -1 denotes an unmatched old token. */
export function matchLuaTokens(oldTokens: readonly LuaToken[], newTokens: readonly LuaToken[]): Int32Array {
	const matches = new Int32Array(oldTokens.length).fill(-1);
	let prefix = 0;
	while (prefix < oldTokens.length && prefix < newTokens.length
		&& oldTokens[prefix].type === newTokens[prefix].type
		&& oldTokens[prefix].lexeme === newTokens[prefix].lexeme) {
		matches[prefix] = prefix;
		prefix += 1;
	}
	let oldEnd = oldTokens.length;
	let newEnd = newTokens.length;
	while (oldEnd > prefix && newEnd > prefix
		&& oldTokens[oldEnd - 1].type === newTokens[newEnd - 1].type
		&& oldTokens[oldEnd - 1].lexeme === newTokens[newEnd - 1].lexeme) {
		oldEnd -= 1;
		newEnd -= 1;
		matches[oldEnd] = newEnd;
	}
	const width = oldEnd - prefix;
	const height = newEnd - prefix;
	if (width === 0 || height === 0) {
		return matches;
	}
	const center = height + 1;
	const frontier = new Int32Array(width + height + 3);
	const paths = new Array<MatchPath | null>(frontier.length).fill(null);
	let result: MatchPath | null = null;
	search: for (let distance = 1; ; distance += 1) {
		const lower = -Math.min(distance, height + (distance % 2));
		const upper = Math.min(distance, width + (distance % 2));
		for (let diagonal = lower; diagonal <= upper; diagonal += 2) {
			const top = diagonal === upper ? -1 : frontier[center + diagonal + 1];
			const left = diagonal === lower ? -1 : frontier[center + diagonal - 1] + 1;
			const x = Math.min(Math.max(top, left), width);
			const y = x - diagonal;
			if (y > height) {
				continue;
			}
			let end = x;
			while (end < width && y + end - x < height) {
				const oldToken = oldTokens[prefix + end];
				const newToken = newTokens[prefix + y + end - x];
				if (oldToken.type !== newToken.type || oldToken.lexeme !== newToken.lexeme) {
					break;
				}
				end += 1;
			}
			const previous = paths[center + diagonal + (x === top ? 1 : -1)];
			const path = end === x ? previous : { previous, x, y, length: end - x };
			frontier[center + diagonal] = end;
			paths[center + diagonal] = path;
			if (end === width && end - diagonal === height) {
				result = path;
				break search;
			}
		}
	}
	for (let path = result; path !== null; path = path.previous) {
		for (let index = 0; index < path.length; index += 1) {
			matches[prefix + path.x + index] = prefix + path.y + index;
		}
	}
	return matches;
}
