import type { SourceChangeMap } from '../../text/source_changes';
import { LuaLexer } from './lexer';
import type { LuaTokenBlock, LuaTokenSequence } from './token_sequence';

/** One actual relex run, in the original and updated source coordinates. */
export type LuaLexicalReplacement = {
	readonly oldBlockStart: number;
	readonly oldBlockCount: number;
	readonly oldStart: number;
	readonly oldEnd: number;
	readonly newStart: number;
	readonly newEnd: number;
	readonly blocks: readonly LuaTokenBlock[];
};

export type LuaLexicalUpdate = {
	readonly tokens: LuaTokenSequence;
	readonly replacements: readonly LuaLexicalReplacement[];
};

/**
 * Relex affected blocks, synchronizing at an unchanged old block boundary.
 * Lua's items consume complete strings/comments, so every such boundary has
 * the same base lexical state. Actual read extents select the restart point.
 */
export function updateLuaTokens(previous: LuaTokenSequence, source: string, path: string, changeMap: SourceChangeMap): LuaLexicalUpdate {
	const changes = Array.from(changeMap.changes());
	if (changes.length === 0) return { tokens: previous, replacements: [] };
	const oldCursor = previous.cursor();
	const starts = changes.map(change => {
		oldCursor.seek(previous.firstDependency(change.oldStart));
		return { index: oldCursor.blockIndex, offset: oldCursor.blockOffset };
	});
	let result = previous, blockDelta = 0;
	const replacements: LuaLexicalReplacement[] = [];
	for (let changeIndex = 0; changeIndex < changes.length; changeIndex++) {
		const start = starts[changeIndex], change = changes[changeIndex];
		const newStart = change.newStart - (change.oldStart - start.offset);
		const lexer = new LuaLexer(source, path, newStart);
		const blocks: LuaTokenBlock[] = [];
		let endBlock: number, oldEnd: number;
		for (;;) {
			const active = changes[changeIndex];
			const delta = active.newEnd - active.oldEnd;
			const wanted = Math.max(active.oldEnd, lexer.offset - delta);
			let candidateIndex = previous.blockCount;
			if (wanted <= previous.width) {
				oldCursor.seekOffset(wanted);
				candidateIndex = oldCursor.blockIndex;
				if (oldCursor.token !== undefined && oldCursor.blockOffset < wanted) candidateIndex++;
			}
			const candidate = previous.blocks(candidateIndex).next().value;
			// A new item may cross another edit, or an earlier token may have
			// looked ahead into it. Consume those changes in the same relex run.
			if (changeIndex + 1 < changes.length && candidateIndex > starts[changeIndex + 1].index) {
				changeIndex++;
				continue;
			}
			const until = candidate === undefined ? source.length + 1 : candidate.offset + delta;
			if (lexer.offset === until) { endBlock = candidateIndex; oldEnd = candidate.offset; break; }
			blocks.push(lexer.scanBlock(until));
			if (lexer.done) { endBlock = previous.blockCount; oldEnd = previous.width; changeIndex = changes.length; break; }
		}
		const removed = endBlock - start.index;
		result = result.replaceBlocks(start.index + blockDelta, removed, blocks);
		blockDelta += blocks.length - removed;
		replacements.push({ oldBlockStart: start.index, oldBlockCount: removed, oldStart: start.offset, oldEnd,
			newStart, newEnd: lexer.done ? source.length : lexer.offset, blocks });
	}
	return { tokens: result, replacements };
}
