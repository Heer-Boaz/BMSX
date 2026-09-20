import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunk, parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { HashMapSnapshot } from '../../toolchain/ts/collections/hash_map';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { LuaSourceLocations } from '../../toolchain/ts/lua/syntax/source_locations';
import { LuaSourceLayout, createLuaSourceUnit } from '../../toolchain/ts/lua/syntax/source_layout';

function position(source: string, offset: number) {
	const prefix = source.slice(0, offset), start = prefix.lastIndexOf('\n') + 1;
	return { line: prefix.split('\n').length, column: offset - start + 1 };
}

test('exclusive EOF points retain their residual offset in every location backing', () => {
	for (const source of ['', 'text', 'text\n', 'text\r\n']) {
		for (const terminalUnit of [false, true]) {
			const placements = terminalUnit ? [{ unit: createLuaSourceUnit(), offset: source.length }] : [];
			const layout = LuaSourceLayout.create(source, placements);
			const locations = LuaSourceLocations.fromLayout('end.lua', layout);
			const cursor = layout.cursor();
			for (const offset of [0, source.length, source.length + 1, source.length + 2, source.length]) {
				const expected = position(source, offset);
				assert.deepEqual(layout.positionAt(offset), expected);
				assert.deepEqual(layout.cursor(offset).positionAt(offset), expected);
				assert.deepEqual(locations.positionAt(offset), expected);
				assert.deepEqual(cursor.positionAt(offset), expected);
			}
		}
	}
});

test('location cursor projects forward and backward UTF-16 seeks through source and occurrence leaves', () => {
	const source = 'a\r\n😀\ud800x\udc00\n'.repeat(120);
	const placements = Array.from({ length: 100 }, (_, index) => ({ unit: createLuaSourceUnit(), offset: index * 13 }));
	const layout = LuaSourceLayout.create(source, placements);
	const cursor = layout.cursor();
	for (let offset = 0; offset <= source.length; offset++) assert.deepEqual(cursor.positionAt(offset), position(source, offset));
	for (let offset = source.length; offset >= 0; offset -= 7) assert.deepEqual(layout.cursor(offset).positionAt(offset), position(source, offset));
});

test('one retained syntax occurrence projects independently in old and shifted snapshots', () => {
	const old = parseLuaChunk('local a = 1\nlocal b = a\n', 'retained.lua').chunk;
	const node = old.body.get(1)!;
	const oldRange = old.locations.range(node.span);
	const edit = old.locations.layout.edit();
	edit.replace(0, 0, '-- leading\n');
	const current = LuaSourceLocations.fromLayout(old.locations.path, edit.snapshot());
	assert.deepEqual(current.range(node.span), { path: 'retained.lua', start: { line: 3, column: 1 }, end: { line: 3, column: 11 } });
	assert.strictEqual(old.locations.range(node.span), oldRange);
	assert.strictEqual(current.range(node.span), current.range(node.span));
	assert.notStrictEqual(current.range(node.span), oldRange);
	assert.equal(oldRange.start.line, 2);
	// Coordinate equality must not merge separate syntactic execution sites.
	assert.notStrictEqual(current.range({ ...node.span }), current.range(node.span));
});

test('parser emits unit-local nodes, block boundaries and argument separators directly', () => {
	const source = '-- header\r\nlocal function f(a)\r\n local b = function() return a end\r\n return g(a, b)\r\nend';
	const chunk = parseLuaChunk(source, 'nested.lua').chunk;
	const statement = chunk.body.get(0)!;
	assert.equal(statement.kind, LuaSyntaxKind.LocalFunctionStatement);
	if (statement.kind !== LuaSyntaxKind.LocalFunctionStatement) throw new Error('Expected local function');
	const fn = statement.functionExpression;
	assert.notEqual(statement.span.unit, fn.span.unit);
	assert.equal(statement.span.start, 0);
	assert.equal(fn.span.start, 0);
	assert.deepEqual(chunk.locations.range(fn.parameters[0].span).start, { line: 2, column: 18 });
	assert.deepEqual(chunk.locations.position(fn.body.span.unit, fn.body.startInclusive), { line: 2, column: 20 });
	walkLuaAst(chunk, node => {
		const range = chunk.locations.range(node.span);
		const start = chunk.locations.offset(node.span.unit, node.span.start);
		const end = chunk.locations.offset(node.span.unit, node.span.end);
		assert.deepEqual(range.start, position(source, start));
		assert.deepEqual(range.end, position(source, end));
		assert.equal('range' in node, false);
		if (node.kind === LuaSyntaxKind.CallExpression) {
			const arguments_ = node.argumentList!;
			assert.deepEqual(arguments_.separators.map(offset => chunk.locations.position(arguments_.span.unit, offset)), [{ line: 4, column: 12 }]);
		}
	});
});

test('recovery EOF stays at the failing token while source layout retains the skipped suffix', () => {
	for (const suffix of ['"unterminated\nremaining', '--[=[unterminated\nremaining', '[==[unterminated']) {
		const source = 'local a = 1\n' + suffix;
		const parsed = parseLuaChunkWithRecovery(source, 'recovery.lua');
		const token = parsed.tokens.get(parsed.tokens.length - 1);
		assert.equal(parsed.chunk.locations.offset(token.unit, token.start), 12);
		assert.deepEqual(parsed.chunk.locations.range(parsed.chunk.span).end, { line: 2, column: 1 });
		assert.equal(parsed.chunk.locations.layout.read(0, source.length), source);
	}
});

test('standalone expression retains its own source generation without a fabricated statement', () => {
	const text = '\n(function(a) return a end)(1)';
	const fragment = new LuaParser(new LuaLexer(text, 'fragment.lua').scanTokens(), 'fragment.lua', text).parseExpressionOnly();
	assert.deepEqual(fragment.locations.range(fragment.expression.span), { path: 'fragment.lua', start: { line: 2, column: 2 }, end: { line: 2, column: 29 } });
});

test('recovery owns discarded nested unit markers and lexical suffixes explicitly', () => {
	for (const source of ['a', 'a\nlocal b=1', 'local function f() a end', 'local = 1;', 'local function f() return 1', 'do\nlocal a=1\n', 'local a="bad\nrest', 'local function f() a.\nreturn 1 end']) {
		const { chunk } = parseLuaChunkWithRecovery(source, 'skipped.lua');
		const owned = new Set<number>(Array.from(chunk.tokens.placements(), entry => entry.unit));
		walkLuaAst(chunk, node => {
			owned.add(node.span.unit);
			if (node.kind === LuaSyntaxKind.Block || node.kind === LuaSyntaxKind.Chunk) {
				for (const skipped of node.skippedSyntax) {
					owned.add(skipped.span.unit);
					for (const unit of skipped.units) owned.add(unit);
					assert.ok(skipped.span.end >= skipped.span.start);
				}
			}
		});
		for (const cursor = chunk.locations.layout.cursor(); cursor.current !== undefined; cursor.next()) {
			if (cursor.current.kind === 'unit') assert.ok(owned.has(cursor.current.unit), `Unowned marker in ${source}`);
		}
	}
});


test('distant location projection skips whole subtrees rather than walking occurrence leaves', t => {
	const count = 10000;
	const source = 'ab\r\n'.repeat(count);
	const layout = LuaSourceLayout.create(source, Array.from({ length: count }, (_, index) => ({ unit: createLuaSourceUnit(), offset: index * 4 })));
	const cursor = layout.cursor();
	const get = HashMapSnapshot.prototype.get;
	let reads = 0;
	t.mock.method(HashMapSnapshot.prototype, 'get', function(this: HashMapSnapshot<number, unknown>, key: number) { reads++; return get.call(this, key); });
	assert.deepEqual(cursor.positionAt(source.length - 1), { line: count, column: 4 });
	assert.ok(reads <= layout.height * 3, `Expected a tree-height-bounded seek, got ${reads} reads at height ${layout.height}`);
});

test('native generations project all coordinates without materializing a persistent edit index', t => {
	const create = LuaSourceLayout.create;
	let builds = 0;
	t.mock.method(LuaSourceLayout, 'create', (source: string, units: Parameters<typeof create>[1]) => {
		builds++;
		return create(source, units);
	});
	for (const source of ['', '\r', '\r\n', '-- 😀\ud800x\udc00\r\nlocal a=1\n', 'local a="unfinished\nremainder']) {
		const { chunk } = parseLuaChunkWithRecovery(source, 'native.lua');
		const before = builds;
		for (let offset = 0; offset <= source.length; offset++) {
			assert.deepEqual(chunk.locations.position(chunk.span.unit, offset), position(source, offset));
		}
		const range = chunk.locations.range(chunk.span);
		assert.equal(builds, before, 'cold parsing and first projection use source-owned coordinates');
		const layout = chunk.locations.layout;
		assert.equal(builds, before + 1);
		assert.strictEqual(chunk.locations.layout, layout);
		assert.equal(builds, before + 1);
		assert.strictEqual(chunk.locations.range(chunk.span), range, 'index materialization does not replace the generation');
		for (let offset = 0; offset <= source.length; offset++) assert.deepEqual(layout.positionAt(offset), position(source, offset));
	}
});

test('two layout edits fork from a native generation without borrowing its absolute caches', () => {
	const { chunk } = parseLuaChunk('local a=1\nlocal b=2', 'fork.lua');
	const span = chunk.body.get(1)!.span;
	const oldRange = chunk.locations.range(span);
	const left = chunk.locations.layout.edit(), right = chunk.locations.layout.edit();
	left.replace(0, 0, '-- left\n');
	right.replace(0, 0, '-- right\n\n');
	const a = LuaSourceLocations.fromLayout('fork.lua', left.snapshot());
	const b = LuaSourceLocations.fromLayout('fork.lua', right.snapshot());
	assert.equal(a.range(span).start.line, 3);
	assert.equal(b.range(span).start.line, 4);
	assert.strictEqual(chunk.locations.range(span), oldRange);
	assert.equal(oldRange.start.line, 2);
});
