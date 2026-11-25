import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { COMPILED_BLOCK_MAX_INSTRUCTIONS } from '../../machine/ts/machine/cpu/compiled_block';
import { CompiledSourceGraph, SourceWord } from '../../machine/ts/machine/cpu/compiled_source_graph';
import { createDecodedInstructionPage } from '../../machine/ts/machine/cpu/execution_image';

test('planning visits late split leaders and does not retain them across a new compilation window', () => {
	const page = createDecodedInstructionPage({ key: 0, cacheable: true, readBytes: null, readByteOffset: 0,
		writeWatches: null, writeWatchIndex: 0 });
	page.widths.fill(1);
	page.ops.fill(OpCode.K1);
	const graph = new CompiledSourceGraph(), start = 31, split = start + COMPILED_BLOCK_MAX_INSTRUCTIONS, end = split + 3;
	graph.begin(0, start, end);
	for (let word = start; word < end; ++word) {
		graph.enqueue(word * INSTRUCTION_BYTES, word === start);
		graph.flags[word] |= SourceWord.Available;
	}
	graph.skipWidths[end - 1] = 2;
	assert.deepEqual(graph.plan([page]).map(p => [p.firstWord, p.endWord, p.skippedInstructionWidth]),
		[[start, split, 0], [split, end, 2]]);

	graph.begin(0, split - 1, end);
	for (let word = split - 1; word < end; ++word) {
		graph.enqueue(word * INSTRUCTION_BYTES, word === split - 1);
		graph.flags[word] |= SourceWord.Available;
	}
	assert.deepEqual(graph.plan([page]).map(p => [p.firstWord, p.endWord, p.skippedInstructionWidth]),
		[[split - 1, end, 0]]);
});
