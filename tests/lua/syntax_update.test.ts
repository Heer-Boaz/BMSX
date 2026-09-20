import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunkWithRecovery, updateLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';
import { LuaSyntaxKind, type LuaChunk } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { LuaSourceLayoutBuilder } from '../../toolchain/ts/lua/syntax/source_layout';
import { LuaTokenSequence } from '../../toolchain/ts/lua/syntax/token_sequence';
import { decodeLuaChunk, encodeLuaChunk } from '../../toolchain/ts/lua/syntax/serialization';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { luaSyntaxSnapshot } from '../helpers/lua_syntax_snapshot';

function edit(previous: LuaChunk, offset: number, deletedLength: number, text: string): LuaChunk {
	const source = previous.source.slice(0, offset) + text + previous.source.slice(offset + deletedLength);
	const changes = SourceChangeMap.unchanged(previous.source.length).append([{ offset, deletedLength, insertedLength: text.length }]);
	const updated = updateLuaChunk(previous, source, changes).chunk;
	const cold = parseLuaChunkWithRecovery(source, previous.locations.path).chunk;
	assert.deepEqual(luaSyntaxSnapshot(updated), luaSyntaxSnapshot(cold));
	return updated;
}

const LINES = Array.from({ length: 200 }, (_, i) => `local value_${i} = ${i}`).join('\n');
const SOURCES = [
	LINES,
	`local function outer(arg)\n${LINES}\nreturn arg\nend\nouter(1)`,
	`local config = { run = function()\n${LINES}\nreturn 1 end }\nreturn config`,
	`if first then\n${LINES}\nelseif second then\n${LINES}\nelse ${LINES}\nend`,
	`repeat\n${LINES}\nuntil done`,
	`module<const>\n${LINES}\nreturn {}`, 
	`local function broken()\n${LINES}\nfirst.; second.;\nend\nlocal good = 1`,
];

for (const source of SOURCES) test(`edited grammar matches independent cold parse: ${source.slice(0, 40)}`, () => {
	const previous = parseLuaChunkWithRecovery(source, 'edit.lua').chunk;
	const snapshot = luaSyntaxSnapshot(previous);
	const middle = source.indexOf('value_100');
	for (const [offset, deletedLength, inserted] of [
		[0, 0, '\n-- prefix\r\n'], [middle, 0, '--[['], [middle, 9, 'renamed_value'],
		[middle, 9, 'value_100'], [middle, 0, 'end\n'], [source.length, 0, '\nlocal tail = 1'],
	] as const) {
		const updated = edit(previous, offset, deletedLength, inserted);
		edit(updated, offset, inserted.length, source.slice(offset, offset + deletedLength));
		assert.deepEqual(luaSyntaxSnapshot(previous), snapshot);
	}
});

test('local edits share complete statement suffixes and retained nested bodies', () => {
	const source = `local function run(arg)\n${LINES}\nreturn arg end\nrun(1)`;
	const previous = parseLuaChunkWithRecovery(source, 'reuse.lua').chunk;
	const first = previous.body.get(0);
	assert.ok(first.kind === LuaSyntaxKind.LocalFunctionStatement);
	const body = first.functionExpression.body.body;
	const changed = edit(previous, source.indexOf('value_100'), 9, 'renamed_value');
	const next = changed.body.get(0);
	assert.ok(next.kind === LuaSyntaxKind.LocalFunctionStatement);
	assert.notEqual(next, first);
	assert.equal(next.functionExpression.body.body.get(0), body.get(0));
	assert.equal(next.functionExpression.body.body.get(190), body.get(190));
	assert.notEqual(next.functionExpression.body.body.get(100), body.get(100));
	const header = edit(previous, source.indexOf('run'), 3, 'renamed_run');
	const renamed = header.body.get(0);
	assert.ok(renamed.kind === LuaSyntaxKind.LocalFunctionStatement);
	assert.equal(renamed.functionExpression.body.body.get(190), body.get(190));
});

test('failed reparsed parents own discarded reused children without dropping their locations', () => {
	const source = `local function run()\n${LINES}\nend`;
	const previous = parseLuaChunkWithRecovery(source, 'failed.lua').chunk;
	const updated = edit(previous, source.lastIndexOf('end'), 3, '');
	assert.ok(updated.syntaxError);
	assert.equal(updated.body.length, 0);
	assert.equal(updated.skippedSyntax.length, 1);
	assert.ok(updated.skippedSyntax[0].units.length > 200);
	const units = [...updated.body.parts()].flatMap(part => part.units);
	assert.deepEqual(units, updated.skippedSyntax[0].units);
	assert.equal(new Set(units).size, units.length);
	edit(updated, updated.source.length, 0, 'end');
});

test('decoded syntax supports real reuse and re-encodes with complete metadata', () => {
	const original = parseLuaChunkWithRecovery(LINES, 'stored_edit.lua').chunk;
	const previous = decodeLuaChunk(encodeLuaChunk(original));
	const changed = edit(previous, previous.source.indexOf('value_100'), 9, 'renamed_value');
	assert.equal(changed.body.get(190), previous.body.get(190));
	assert.deepEqual(luaSyntaxSnapshot(decodeLuaChunk(encodeLuaChunk(changed))), luaSyntaxSnapshot(changed));
});

test('composed disjoint edits retain middle syntax and agree with cold analysis', () => {
	const previous = parseLuaChunkWithRecovery(LINES, 'islands.lua').chunk;
	let source = previous.source;
	let changes = SourceChangeMap.unchanged(source.length);
	for (const name of ['value_10', 'value_170']) {
		const offset = source.indexOf(name);
		source = source.slice(0, offset) + '-- comment\n' + source.slice(offset);
		changes = changes.append([{ offset, deletedLength: 0, insertedLength: '-- comment\n'.length }]);
	}
	const updated = updateLuaChunk(previous, source, changes).chunk;
	assert.deepEqual(luaSyntaxSnapshot(updated), luaSyntaxSnapshot(parseLuaChunkWithRecovery(source, 'islands.lua').chunk));
	assert.equal(updated.body.get(100), previous.body.get(100));
});

for (const count of [500, 12000]) test(`local parser/layout work does not visit ${count} unchanged statements`, t => {
	const source = Array.from({ length: count }, (_, i) => `value_${i} = ${i}`).join('\n');
	const previous = parseLuaChunkWithRecovery(source, 'work.lua').chunk;
	// One-time cold-to-edit index construction is separate from recurring edits.
	previous.locations.layout;
	let statements = 0, inserted = 0, removed = 0;
	const parser = LuaParser.prototype as unknown as { parseStatement(): unknown };
	const parse = parser.parseStatement;
	t.mock.method(parser, 'parseStatement', function(this: LuaParser) { statements++; return parse.call(this); });
	const insert = LuaSourceLayoutBuilder.prototype.insertUnit, remove = LuaSourceLayoutBuilder.prototype.removeUnit;
	t.mock.method(LuaSourceLayoutBuilder.prototype, 'insertUnit', function(this: LuaSourceLayoutBuilder, ...args: Parameters<typeof insert>) { inserted++; return insert.apply(this, args); });
	t.mock.method(LuaSourceLayoutBuilder.prototype, 'removeUnit', function(this: LuaSourceLayoutBuilder, ...args: Parameters<typeof remove>) { removed++; return remove.apply(this, args); });
	t.mock.method(LuaTokenSequence.prototype, 'placements', () => { throw new Error('edited parser must not enumerate all lexical placements'); });
	const changes = SourceChangeMap.unchanged(source.length).append([{ offset: 0, deletedLength: 0, insertedLength: 1 }]);
	const updated = updateLuaChunk(previous, '\n' + source, changes).chunk;
	assert.equal(updated.body.get(count - 1), previous.body.get(count - 1));
	assert.ok(statements < 12, `${statements} parsed statements`);
	assert.ok(inserted < 20, `${inserted} inserted markers`);
	assert.ok(removed < 20, `${removed} retired markers`);
});

for (const count of [500, 12000]) test(`nested body edits do not parse or replace ${count} retained statements`, t => {
	const source = 'local function run()\n' + Array.from({ length: count }, (_, i) => `value_${i} = ${i}`).join('\n') + '\nend\nrun()';
	const previous = parseLuaChunkWithRecovery(source, 'nested_work.lua').chunk;
	previous.locations.layout;
	const first = previous.body.get(0);
	assert.ok(first.kind === LuaSyntaxKind.LocalFunctionStatement);
	const offset = source.indexOf('value_250');
	let statements = 0, inserted = 0, removed = 0;
	const parser = LuaParser.prototype as unknown as { parseStatement(): unknown };
	const parse = parser.parseStatement;
	t.mock.method(parser, 'parseStatement', function(this: LuaParser) { statements++; return parse.call(this); });
	const insert = LuaSourceLayoutBuilder.prototype.insertUnit, remove = LuaSourceLayoutBuilder.prototype.removeUnit;
	t.mock.method(LuaSourceLayoutBuilder.prototype, 'insertUnit', function(this: LuaSourceLayoutBuilder, ...args: Parameters<typeof insert>) { inserted++; return insert.apply(this, args); });
	t.mock.method(LuaSourceLayoutBuilder.prototype, 'removeUnit', function(this: LuaSourceLayoutBuilder, ...args: Parameters<typeof remove>) { removed++; return remove.apply(this, args); });
	t.mock.method(LuaTokenSequence.prototype, 'placements', () => { throw new Error('edited parser must not enumerate all lexical placements'); });
	const changes = SourceChangeMap.unchanged(source.length).append([{ offset, deletedLength: 9, insertedLength: 12 }]);
	const updated = updateLuaChunk(previous, source.slice(0, offset) + 'renamed_slot' + source.slice(offset + 9), changes).chunk;
	const next = updated.body.get(0);
	assert.ok(next.kind === LuaSyntaxKind.LocalFunctionStatement);
	assert.equal(next.functionExpression.body.body.get(0), first.functionExpression.body.body.get(0));
	assert.equal(next.functionExpression.body.body.get(count - 1), first.functionExpression.body.body.get(count - 1));
	assert.ok(statements < 14, `${statements} parsed statements`);
	assert.ok(inserted < 24, `${inserted} inserted markers`);
	assert.ok(removed < 24, `${removed} retired markers`);
});

for (const optLevel of [0, 3] as const) test(`reused syntax keeps O${optLevel} output and debug locations`, () => {
	const source = `local function run(arg)\n${LINES}\nreturn arg + value_199 end\nreturn run(2)`;
	const previous = parseLuaChunkWithRecovery(source, 'compile_edit.lua').chunk;
	const updated = edit(previous, 0, 0, '-- heading\n');
	const cold = parseLuaChunkWithRecovery(updated.source, 'compile_edit.lua').chunk;
	assert.deepEqual(compileLuaChunkToProgram(updated, [], { entrySource: updated.source, optLevel }),
		compileLuaChunkToProgram(cold, [], { entrySource: cold.source, optLevel }));
});

test('all retained statement parts still own exactly the published nonlexical units after edits', () => {
	let chunk = parseLuaChunkWithRecovery(`local function run()\n${LINES}\nend\nrun()`, 'units.lua').chunk;
	for (const text of ['\n', '--[[', '', 'end\n', 'local inserted = 1\n']) {
		chunk = edit(chunk, chunk.source.indexOf('value_100'), 0, text);
		const owned = new Set([chunk.span.unit]);
		walkLuaAst(chunk, node => {
			if (node.kind !== LuaSyntaxKind.Chunk && node.kind !== LuaSyntaxKind.Block) return;
			for (const part of node.body.parts()) for (const unit of part.units) {
				assert.equal(owned.has(unit), false);
				owned.add(unit);
			}
		});
		for (const { block } of chunk.tokens.blocks()) owned.add(block.unit);
		assert.deepEqual(new Set([...chunk.locations.unitPlacements()].map(placement => placement.unit)), owned);
	}
});

test('lookahead, block terminators and newline operators remain cold-equivalent through repair', () => {
	const prefix = LINES + '\n';
	for (const tail of [
		'f(); (g)()', 'local value = 1\n*ptr = 2', 'local value = 1 --[[gap\n]]*ptr = 2',
		'local value = 1\r\n*ptr = 2', 'if condition then f() else g() end',
		'repeat f() until condition', 'do f() end', 'local function run() f() end',
		'f(1,\nlocal value = 2', 'first.; second.;\nlocal good = 1',
	]) {
		const source = prefix + tail;
		const previous = parseLuaChunkWithRecovery(source, 'traps.lua').chunk;
		for (let at = prefix.length; at <= source.length; at++) {
			const changed = edit(previous, at, at === source.length ? 0 : 1, '');
			if (at < source.length) edit(changed, at, 0, source[at]);
		}
	}
});

test('deterministic edit generations preserve retained snapshots and match fresh grammar', () => {
	let state = 871;
	const random = (bound: number): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % bound; };
	let chunk = parseLuaChunkWithRecovery(`module<const>\nlocal function run(arg)\n${LINES}\nreturn { arg } end\nreturn run`, 'random.lua').chunk;
	const retained: { chunk: LuaChunk; grammar: unknown }[] = [];
	const inserts = ['\n', '\r\n', ' ', ';', '(', ')', '--[[', ']]', 'end', 'else', 'until', '"', '*', 'local inserted = 1\n', '😀'];
	for (let index = 0; index < 240; index++) {
		if (index % 20 === 0) retained.push({ chunk, grammar: luaSyntaxSnapshot(chunk) });
		if (index % 31 === 0) chunk = retained[random(retained.length)].chunk;
		const offset = random(chunk.source.length + 1);
		const deletedLength = random(Math.min(5, chunk.source.length - offset) + 1);
		chunk = edit(chunk, offset, deletedLength, inserts[random(inserts.length)]);
	}
	for (const snapshot of retained) assert.deepEqual(luaSyntaxSnapshot(snapshot.chunk), snapshot.grammar);
});

test('repeated edits retire replaced occurrences rather than accumulating stale layout records', () => {
	const source = `local function run()\n${LINES}\nend\nrun()`;
	let chunk = parseLuaChunkWithRecovery(source, 'lifetime.lua').chunk;
	const initialRecords = chunk.locations.layout.recordCount;
	const offset = source.indexOf('value_100');
	let maximumRecords = initialRecords;
	for (let iteration = 0; iteration < 200; iteration++) {
		const inserted = iteration % 2 === 0 ? 'renamed_value' : 'value_100';
		const removed = iteration % 2 === 0 ? 'value_100' : 'renamed_value';
		const changes = SourceChangeMap.unchanged(chunk.source.length).append([{ offset, deletedLength: removed.length, insertedLength: inserted.length }]);
		const next = chunk.source.slice(0, offset) + inserted + chunk.source.slice(offset + removed.length);
		chunk = updateLuaChunk(chunk, next, changes).chunk;
		maximumRecords = Math.max(maximumRecords, chunk.locations.layout.recordCount);
	}
	assert.ok(maximumRecords < initialRecords + 60, `${initialRecords} -> at most ${maximumRecords} records`);
	assert.deepEqual(luaSyntaxSnapshot(chunk), luaSyntaxSnapshot(parseLuaChunkWithRecovery(source, 'lifetime.lua').chunk));
});
