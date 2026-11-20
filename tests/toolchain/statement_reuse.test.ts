import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunk, parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind, type LuaBlock, type LuaChunk } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import type { LuaSourceUnit } from '../../toolchain/ts/lua/syntax/source_layout';
import { LuaStatementReuse } from '../../toolchain/ts/lua/syntax/statement_reuse';

function syntaxUnits(chunk: LuaChunk): LuaSourceUnit[] {
	const lexical = new Set([...chunk.tokens.blocks()].map(({ block }) => block.unit));
	return [...chunk.locations.unitPlacements()].filter(({ unit }) => !lexical.has(unit)).map(({ unit }) => unit);
}

function assertRetirement(chunk: LuaChunk, reuse: LuaStatementReuse, retained: readonly LuaSourceUnit[]): void {
	const retired: LuaSourceUnit[] = [];
	reuse.retire(unit => retired.push(unit));
	assert.equal(new Set(retired).size, retired.length, 'each discarded occurrence is retired once');
	assert.equal(new Set(retained).size, retained.length, 'retained occurrences are disjoint');
	const all = [...retired, ...retained];
	assert.equal(new Set(all).size, all.length, 'retained and retired units are disjoint');
	assert.deepEqual(new Set(all), new Set(syntaxUnits(chunk)));
}

test('root selection excludes module headers and failed lexical suffixes', () => {
	for (const source of ['', 'local a = 1\nlocal b = 2', 'module<const>\nlocal a = 1',
		'module<const>\nlocal a = 1\n--[[unfinished']) {
		const chunk = parseLuaChunkWithRecovery(source, 'root.lua').chunk;
		const reuse = new LuaStatementReuse(chunk);
		const end = chunk.locations.offset(chunk.span.unit, chunk.span.end);
		const start = end - chunk.body.width;
		if (start > 0) assert.equal(reuse.take(0, source.length + 1, chunk.body.context), undefined);
		const run = reuse.take(start, source.length + 1, chunk.body.context);
		if (chunk.body.partCount === 0) assert.equal(run, undefined);
		else {
			assert.ok(run);
			assert.deepEqual([...run.parts()], [...chunk.body.parts()]);
			assertRetirement(chunk, reuse, reuse.collectUnits(run));
		}
	}
});

test('nested bodies can be selected independently of changed headers and containing statements', () => {
	const source = 'local function outer(arg)\nif arg then\nlocal a = 1\nelseif other then\nlocal b = 2\nelse\nlocal c = 3\nend\nrepeat work() until done\nend\nouter(1)';
	const chunk = parseLuaChunkWithRecovery(source, 'nested.lua').chunk;
	const blocks: LuaBlock[] = [];
	walkLuaAst(chunk, node => { if (node.kind === LuaSyntaxKind.Block) blocks.push(node); });
	for (const block of blocks) {
		const reuse = new LuaStatementReuse(chunk);
		const start = chunk.locations.offset(block.span.unit, block.startInclusive);
		const run = reuse.take(start, source.length + 1, block.body.context);
		assert.ok(run);
		assert.deepEqual([...run.parts()], [...block.body.parts()]);
		assertRetirement(chunk, reuse, reuse.collectUnits(run));
	}
	const reuse = new LuaStatementReuse(chunk);
	assert.equal(reuse.take(source.indexOf('outer(arg)'), source.length + 1, blocks[0].body.context), undefined);
	assertRetirement(chunk, reuse, []);
});

test('exact part boundaries, grammar context, recovery mode and inspected extent gate reuse', () => {
	const source = 'local a = 1\nlocal b = 2';
	const chunk = parseLuaChunkWithRecovery(source, 'gates.lua').chunk;
	const strict = parseLuaChunk(source, 'gates.lua').chunk;
	const reuse = new LuaStatementReuse(chunk);
	const first = chunk.body.cursor().part!;
	assert.equal(reuse.take(1, source.length + 1, chunk.body.context), undefined);
	assert.equal(reuse.take(0, source.length + 1, strict.body.context), undefined);
	assert.equal(reuse.take(0, source.length + 1, chunk.body.context ^ 1), undefined);
	assert.equal(reuse.take(0, first.readWidth - 1, chunk.body.context), undefined);
	const run = reuse.take(0, first.readWidth, chunk.body.context);
	assert.ok(run);
	assert.equal(run.partCount, 1);
	assert.equal(run.cursor().part, first);
	assertRetirement(chunk, reuse, reuse.collectUnits(run));

	const recovered = parseLuaChunkWithRecovery('broken.\nlocal good = 1', 'recovery.lua').chunk;
	const recoveryReuse = new LuaStatementReuse(recovered);
	assert.equal(recoveryReuse.take(0, recovered.source.length + 1, recovered.body.context), undefined);
	const cursor = recovered.body.cursor();
	cursor.advance();
	const clean = recoveryReuse.take(cursor.offset, recovered.source.length + 1, recovered.body.context);
	assert.ok(clean);
	assertRetirement(recovered, recoveryReuse, recoveryReuse.collectUnits(clean));
});

test('retirement skips multiple disjoint and adjacent source-forward runs', () => {
	const source = Array.from({ length: 12 }, (_, i) => `local v${i} = ${i}`).join('\n');
	const chunk = parseLuaChunkWithRecovery(source, 'islands.lua').chunk;
	const reuse = new LuaStatementReuse(chunk);
	const retained: LuaSourceUnit[] = [];
	for (const index of [1, 2, 5, 8, 9]) {
		const cursor = chunk.body.cursor(index);
		const run = reuse.take(cursor.offset, cursor.offset + cursor.part!.readWidth, chunk.body.context);
		assert.ok(run);
		assert.equal(run.length, 1);
		retained.push(...reuse.collectUnits(run));
	}
	assertRetirement(chunk, reuse, retained);
});

test('failed parts retire detached units once without revisiting skipped-syntax ownership', () => {
	const source = 'local value = { [1] = function() return 1 end, [ }\nlocal good = 2';
	const chunk = parseLuaChunkWithRecovery(source, 'detached.lua').chunk;
	const failed = [...chunk.body.parts()][0];
	assert.equal(failed.statement, null);
	assert.ok(failed.units.length > 1);
	assert.equal(failed.units, chunk.skippedSyntax[0].units);
	const reuse = new LuaStatementReuse(chunk);
	assert.equal(reuse.take(0, source.length + 1, chunk.body.context), undefined);
	const cursor = chunk.body.cursor();
	const run = reuse.take(cursor.offset, source.length + 1, chunk.body.context);
	assert.ok(run);
	assertRetirement(chunk, reuse, reuse.collectUnits(run));
});

test('recovery collection owns all reused descendants exactly once in source order', () => {
	const source = 'local function outer()\nlocal f = function() local a = 1 return a end\nreturn f\nend\nouter()';
	const chunk = parseLuaChunkWithRecovery(source, 'collect.lua').chunk;
	const reuse = new LuaStatementReuse(chunk);
	const run = reuse.take(0, source.length + 1, chunk.body.context)!;
	const units = reuse.collectUnits(run);
	assert.deepEqual(units, syntaxUnits(chunk).filter(unit => unit !== chunk.span.unit));
	assertRetirement(chunk, reuse, units);
});

test('large flat suffix selection and retirement touch bounded leaf payloads, not shared units', () => {
	const source = Array.from({ length: 8192 }, (_, i) => `local v${i} = ${i}`).join('\n');
	const chunk = parseLuaChunkWithRecovery(source, 'flat.lua').chunk;
	const parts = [...chunk.body.parts()];
	let partReads = 0;
	let unitReads = 0;
	for (const part of parts) {
		const statement = part.statement;
		const units = part.units;
		Object.defineProperty(part, 'statement', { get: () => { partReads++; return statement; } });
		Object.defineProperty(part, 'units', { get: () => { unitReads++; return units; } });
	}
	const reuse = new LuaStatementReuse(chunk);
	const run = reuse.take(parts[0].width, source.length + 1, chunk.body.context)!;
	assert.equal(run.length, 8191);
	assert.equal(unitReads, 0, 'successful reuse does not enumerate occurrence units');
	const retired: LuaSourceUnit[] = [];
	reuse.retire(unit => retired.push(unit));
	assert.equal(unitReads, 1, 'only the discarded first statement owns retired units');
	assert.ok(partReads < 512, `bounded balanced paths and leaf probes, got ${partReads}`);
	assert.equal(retired.length, 2);
});

test('nested lookup seeks only containing statements and retains the ancestor frontier', () => {
	const body = Array.from({ length: 4096 }, (_, i) => `local v${i} = ${i}`).join('\n');
	const source = 'local function outer()\n' + body + '\nend\nouter()';
	const chunk = parseLuaChunkWithRecovery(source, 'nested-large.lua').chunk;
	const outer = chunk.body.get(0);
	assert.equal(outer.kind, LuaSyntaxKind.LocalFunctionStatement);
	if (outer.kind !== LuaSyntaxKind.LocalFunctionStatement) throw new Error('expected function');
	const block = outer.functionExpression.body;
	let ancestorReads = 0;
	const span = outer.span;
	Object.defineProperty(outer, 'span', { get: () => { ancestorReads++; return span; } });
	let partReads = 0;
	for (const part of block.body.parts()) {
		const statement = part.statement;
		Object.defineProperty(part, 'statement', { get: () => { partReads++; return statement; } });
	}
	partReads = 0;
	const reuse = new LuaStatementReuse(chunk);
	const start = chunk.locations.offset(block.span.unit, block.startInclusive);
	for (let index = 4000; index < 4064; index++) {
		const cursor = block.body.cursor(index);
		const offset = start + cursor.offset;
		const readLimit = offset + cursor.part!.readWidth;
		const run = reuse.take(offset, readLimit, block.body.context);
		assert.ok(run);
		assert.equal(run.length, 1);
	}
	assert.ok(ancestorReads < 10, 'subsequent body queries do not traverse ancestors again');
	assert.ok(partReads < 8192, `bounded leaves per query rather than scanning the body: ${partReads}`);
});
