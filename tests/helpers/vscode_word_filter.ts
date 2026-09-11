/* ASCII branches of VS Code matchesWords, revision 7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca.
 * Copyright (c) Microsoft Corporation. All rights reserved. MIT licensed;
 * see ide/common/third_party_notices.md. No runtime/network oracle dependency.
 */
type IMatch = { start: number; end: number };
const wordSeparators = new Set<number>();
'()[]{}<>`\'"-/;:,.?!'.split('').forEach(s => wordSeparators.add(s.charCodeAt(0)));
function isWordSeparator(code: number): boolean {
	return code === 32 || code === 9 || code === 10 || code === 13 || wordSeparators.has(code);
}
function charactersMatch(codeA: number, codeB: number): boolean {
	return codeA === codeB || (isWordSeparator(codeA) && isWordSeparator(codeB));
}
function join(head: IMatch, tail: IMatch[]): IMatch[] {
	if (tail.length === 0) {
		tail = [head];
	} else if (head.end === tail[0].start) {
		tail[0].start = head.start;
	} else {
		tail.unshift(head);
	}
	return tail;
}

export function matchesWords(word: string, target: string, contiguous: boolean = false): IMatch[] | null {
	if (!target || target.length === 0) {
		return null;
	}

	let result: IMatch[] | null = null;
	let targetIndex = 0;

	// Memoize recursive calls within a single top-level invocation. Because word
	// separators are treated as an equivalence class by `charactersMatch`, the
	// recursion in `_matchesWords` can otherwise explode exponentially for inputs
	// like `editor.action` against targets that contain many separators.
	const memo = new Map<number, IMatch[] | null>();
	while (targetIndex < target.length) {
		result = _matchesWords(word, target, 0, targetIndex, contiguous, memo);
		if (result !== null) {
			break;
		}
		targetIndex = nextWord(target, targetIndex + 1);
	}

	return result;
}

function cloneMatches(matches: IMatch[] | null): IMatch[] | null {
	if (matches === null) {
		return null;
	}
	const result: IMatch[] = [];
	for (const m of matches) {
		result.push({ start: m.start, end: m.end });
	}
	return result;
}

function _matchesWords(word: string, target: string, wordIndex: number, targetIndex: number, contiguous: boolean, memo: Map<number, IMatch[] | null>): IMatch[] | null {
	if (wordIndex === word.length) {
		return [];
	} else if (targetIndex === target.length) {
		return null;
	}

	const memoKey = wordIndex * (target.length + 1) + targetIndex;
	const cached = memo.get(memoKey);
	if (cached !== undefined) {
		// Caller (`join`) mutates the returned array, so always return a clone.
		return cloneMatches(cached);
	}

	const computed = _matchesWordsCompute(word, target, wordIndex, targetIndex, contiguous, memo);
	memo.set(memoKey, cloneMatches(computed));
	return computed;
}

function _matchesWordsCompute(word: string, target: string, wordIndex: number, targetIndex: number, contiguous: boolean, memo: Map<number, IMatch[] | null>): IMatch[] | null {
	const targetIndexOffset = 0;

	if (!charactersMatch(word.charCodeAt(wordIndex), target.charCodeAt(targetIndex))) {
		return null;
	}

	let result: IMatch[] | null = null;
	let nextWordIndex = targetIndex + targetIndexOffset + 1;
	result = _matchesWords(word, target, wordIndex + 1, nextWordIndex, contiguous, memo);
	if (!contiguous) {
		while (!result && (nextWordIndex = nextWord(target, nextWordIndex)) < target.length) {
			result = _matchesWords(word, target, wordIndex + 1, nextWordIndex, contiguous, memo);
			nextWordIndex++;
		}
	}

	if (!result) {
		return null;
	}

	// If the characters don't exactly match, then they must be word separators (see charactersMatch(...)).
	// We don't want to include this in the matches but we don't want to throw the target out all together so we return `result`.
	if (word.charCodeAt(wordIndex) !== target.charCodeAt(targetIndex)) {
		return result;
	}

	return join({ start: targetIndex, end: targetIndex + targetIndexOffset + 1 }, result);
}

function nextWord(word: string, start: number): number {
	for (let i = start; i < word.length; i++) {
		if (isWordSeparator(word.charCodeAt(i)) ||
			(i > 0 && isWordSeparator(word.charCodeAt(i - 1)))) {
			return i;
		}
	}
	return word.length;
}

