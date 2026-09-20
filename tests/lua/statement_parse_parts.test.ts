import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunk, parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import { decodeLuaChunk, encodeLuaChunk } from '../../toolchain/ts/lua/syntax/serialization';

const SOURCES = [
	'', '\n; -- gap\n; ', '--[[unterminated', 'local value = 1\n--[[unterminated', 'local value = "bad\nremainder', 'module<const>\nlocal value = 1;\nreturn value',
	'local function outer(arg)\n; local function inner() return arg end\nreturn inner\nend\nouter(1)',
	'if first then\n call()\nelseif second then ; else\n; end\nrepeat work() until done',
	'local first =\nlocal second =\nlocal third = 1',
	'local function run() first.\nsecond.\nreturn 1 end\nrun()',
	'local value = { [1] = function() broken. end }\nreturn value',
];

for (const source of SOURCES) test(`statement parts cover consumed source and survive storage: ${source.slice(0, 45)}`, () => {
	const parsed = parseLuaChunkWithRecovery(source, 'parts.lua').chunk;
	for (const chunk of [parsed, decodeLuaChunk(encodeLuaChunk(parsed))]) {
		const owned = new Set<number>();
		walkLuaAst(chunk, node => {
			if (node.kind !== LuaSyntaxKind.Block && node.kind !== LuaSyntaxKind.Chunk) return;
			const body = node.body;
			assert.deepEqual(Array.from(body), [...body.parts()].flatMap(part => part.statement === null ? [] : [part.statement]));
			if (node.kind === LuaSyntaxKind.Block) assert.equal(body.width, node.endExclusive - node.startInclusive);
			assert.equal(body.hasRecovery, [...body.parts()].some(part => part.recovery));
			for (const part of body.parts()) {
				assert.ok(part.width >= 0);
				assert.ok(part.readWidth >= part.width);
				for (const unit of part.units) {
					assert.equal(owned.has(unit), false, 'child statements own their units independently');
					owned.add(unit);
					assert.ok(chunk.locations.offset(unit, 0) >= 0);
				}
			}
		});
		const lexicalUnits = new Set([...chunk.tokens.blocks()].map(({ block }) => block.unit));
		for (const { unit } of chunk.locations.unitPlacements()) {
			if (unit === chunk.span.unit || lexicalUnits.has(unit)) continue;
			assert.ok(owned.has(unit), 'every syntax occurrence belongs to a part, including discarded recovery trees');
		}
	}
	assert.deepEqual(encodeLuaChunk(decodeLuaChunk(encodeLuaChunk(parsed))), encodeLuaChunk(parsed));
});

test('every recovery contributes locally even after the first diagnostic is latched', () => {
	const { chunk, syntaxError } = parseLuaChunkWithRecovery('first.; second.; local good = 1', 'errors.lua');
	assert.ok(syntaxError);
	const statements = [...chunk.body.parts()].filter(part => part.statement !== null);
	assert.deepEqual(statements.map(part => part.recovery), [true, true, false]);
	assert.equal(chunk.body.hasRecovery, true);
});

test('nested recovery taints ancestors, not adjacent clean statements', () => {
	const { chunk } = parseLuaChunkWithRecovery('local function run() broken.\nreturn 1 end\nrun()', 'nested.lua');
	const parts = [...chunk.body.parts()].filter(part => part.statement !== null);
	assert.deepEqual(parts.map(part => part.recovery), [true, false]);
	const declaration = parts[0].statement!;
	assert.equal(declaration.kind, LuaSyntaxKind.LocalFunctionStatement);
	if (declaration.kind !== LuaSyntaxKind.LocalFunctionStatement) throw new Error('expected local function');
	assert.deepEqual([...declaration.functionExpression.body.body.parts()].filter(part => part.statement !== null).map(part => part.recovery), [true, false]);
});

test('read extent includes continuation lookahead beyond the consumed statement', () => {
	const source = 'local value = 1\nlocal next_value = 2';
	const { chunk } = parseLuaChunkWithRecovery(source, 'read.lua');
	const first = chunk.body.cursor().part!;
	assert.ok(first.readWidth > first.width);
	assert.ok(first.readWidth >= source.indexOf('local next_value') + 'local'.length);
});

test('strict and recovering block contexts are separate grammar contracts', () => {
	const source = 'do local value = 1 end';
	assert.notEqual(parseLuaChunk(source, 'context.lua').chunk.body.context,
		parseLuaChunkWithRecovery(source, 'context.lua').chunk.body.context);
});

// Chunk prefix/suffix productions are always reevaluated; only block statements
// are candidates for reuse, and lexical token dependencies also gate that reuse.
test('module attributes and failed lexical tails remain chunk-owned outside statement coverage', () => {
	const prefix = 'module<const>\n';
	const source = prefix + 'local value = 1\n--[[unterminated';
	const { chunk, syntaxError } = parseLuaChunkWithRecovery(source, 'boundaries.lua');
	const lexicalStart = source.indexOf('--[[');
	assert.ok(syntaxError);
	assert.equal(chunk.constModule, true);
	assert.equal(chunk.tokens.width, source.length, 'lexical ownership covers the failed suffix');
	// The attribute's final > is consumed before blockStartOffset; its newline
	// is the initial block gap, while the attribute itself is a root production.
	assert.equal(chunk.body.width, lexicalStart - (prefix.length - 1));
	assert.equal(chunk.body.hasRecovery, false, 'no statement contains parser recovery');
	assert.equal(chunk.skippedSyntax.length, 1);
	const skipped = chunk.skippedSyntax[0].span;
	assert.equal(skipped.unit, chunk.span.unit);
	assert.equal(chunk.locations.offset(skipped.unit, skipped.start), lexicalStart);
	assert.equal(chunk.locations.offset(skipped.unit, skipped.end), source.length - 1);
});


test('parts retain parser newline exit state across comments, semicolons and CRLF', () => {
	for (const source of [
		'break; -- gap\r\nlocal value = 1',
		'break --[[gap\n]] local value = 1',
		'break --[[gap]] local value = 1',
	]) {
		const original = parseLuaChunkWithRecovery(source, 'newlines.lua').chunk;
		for (const chunk of [original, decodeLuaChunk(encodeLuaChunk(original))]) {
			const parts = [...chunk.body.parts()];
			assert.equal(parts[parts.length - 2].endsNewLine, source.includes('\n'));
			assert.equal(parts[parts.length - 1].endsNewLine, false);
		}
	}
});
