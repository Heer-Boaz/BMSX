import assert from 'node:assert/strict';
import test from 'node:test';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';
import { buildLuaFileSemanticData, LuaSemanticWorkspace, type FileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind, type LuaExpression } from '../../toolchain/ts/lua/syntax/ast';
import { parseLuaChunk, parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';
import { StaticSourceError } from '../../toolchain/ts/lua/static/errors';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { materializeCpuCompletionValues, runCompiledLua } from './cpu_test_harness';

function fixture(source: string) {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['reads.lua']));
	const file = workspace.updateFile('reads.lua', source);
	assert.equal(file.syntaxError, null);
	const snapshot = workspace.getSnapshot();
	return { workspace, file, snapshot, query: snapshot.staticSourceReads, expressions: returned(file) };
}

function returned(file: FileSemanticData): readonly LuaExpression[] {
	const statement = file.chunk.body.get(file.chunk.body.length - 1);
	assert.equal(statement.kind, LuaSyntaxKind.ReturnStatement);
	assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
	return statement.expressions;
}

test('RODATA scalar string loads retain authored read and initializer identities, not a bare address value', () => {
	const f = fixture('rodata title: string = "ready"\nreturn *title, title, &title, title[0]');
	const [load, address, addressOf, indexed] = f.expressions.map(expression => f.query.read(f.file, expression));
	assert.ok(load?.kind === 'typed');
	assert.equal(load.expression, f.expressions[0]);
	assert.equal(load.storage?.name, 'title');
	assert.equal(load.type.name, 'string');
	assert.equal(load.byteOffset, 0);
	assert.equal(load.load, true);
	assert.deepEqual(load.value, { kind: 'string', value: 'ready' });
	const declaration = f.snapshot.symbolResolver.staticDeclarations.storage(load.storage!);
	assert.ok(declaration.kind === LuaSyntaxKind.RodataDeclarationStatement);
	assert.equal(load.initializer?.expression, declaration.initializer);
	assert.notEqual(load.expression, load.initializer?.expression);
	for (const read of [address, addressOf]) {
		assert.ok(read?.kind === 'typed');
		assert.equal(read.load, false);
		assert.equal(read.value, undefined);
	}
	assert.ok(indexed?.kind === 'typed');
	assert.deepEqual(indexed.value, load.value);
});

test('struct fields, inferred arrays and cumulative zero-based offsets select the physical initializer leaf', () => {
	const f = fixture(`struct row
	id: u8
	name: string
end
rodata rows: row[] = { { id = 1, name = "one" }, { id = 2, name = "two" } }
rodata matrix: string[2][3] = { { "a", "b", "c" }, { "d", "e", "f" } }
return rows[1].name, matrix[0][2], matrix[1][-1], matrix[-1][4], (*matrix)[1][2]`);
	const values = f.expressions.map(expression => f.query.scalar(f.file, expression));
	assert.deepEqual(values, ['two', 'c', 'c', 'b', 'f'].map(value => ({ kind: 'string', value })));
	const read = f.query.read(f.file, f.expressions[0]);
	assert.ok(read?.kind === 'typed');
	assert.equal(read.byteOffset, 12, 'row padding and row stride both contribute');
	assert.equal(read.initializer?.byteOffset, 12);
});

test('view field names cannot substitute for physical byte offsets, and numeric accesses cannot reveal string text', () => {
	const f = fixture(`struct row
	id: word
	name: string
end
struct renamed
	other: word
	caption: string
end
struct swapped
	caption: string
	other: word
end
rodata rows: row[2] = { { id = 1, name = "one" }, { id = 2, name = "two" } }
local view<const>: *renamed = rows
local wrong<const>: *swapped = rows
local words<const>: *word = rows + offsetof(row.name)
local bytes<const>: *u8 = rows + offsetof(row.name)
return view[1].caption, wrong[0].caption, *words, *bytes`);
	assert.deepEqual(f.query.scalar(f.file, f.expressions[0]), { kind: 'string', value: 'two' });
	for (const expression of f.expressions.slice(1)) {
		const read = f.query.read(f.file, expression);
		assert.ok(read?.kind === 'typed');
		assert.equal(read.value, undefined);
	}
});

test('byte displacements and address-of preserve storage provenance but unannotated aliases never inherit views', () => {
	const f = fixture(`struct row
	id: word
	name: string
end
rodata rows: row[2] = { { id = 1, name = "one" }, { id = 2, name = "two" } }
local direct<const>: *string = rows + sizeof(row) + offsetof(row.name)
local selected<const>: *string = &rows[1].name
local pointer<const>: *row = rows
local alias<const> = pointer
return *direct, *selected, alias[0].name, pointer[0].name, &rows[1].name`);
	assert.deepEqual(f.query.scalar(f.file, f.expressions[0]), { kind: 'string', value: 'two' });
	assert.deepEqual(f.query.scalar(f.file, f.expressions[1]), { kind: 'string', value: 'two' });
	assert.equal(f.query.read(f.file, f.expressions[2]), undefined);
	assert.equal(f.query.scalar(f.file, f.expressions[2]), undefined);
	assert.deepEqual(f.query.scalar(f.file, f.expressions[3]), { kind: 'string', value: 'one' });
	const address = f.query.read(f.file, f.expressions[4]);
	assert.ok(address?.kind === 'typed');
	assert.equal(address.byteOffset, 12);
	assert.equal(address.load, false);
});

test('typed address proof applies word wrapping only after exact source arithmetic', () => {
	const declarations = `rodata names: string[4] = { 'a', 'b', 'c', 'd' }
local wrapped: *string = &names[1073741825]
local p: *string = &names[1] + 36028797018963968 - 36028797018963968
local q: *string = &names[2] + 36028797018963968 - 36028797018963968
local fractional: *string = names - 0.5`;
	const f = fixture(declarations + `\nreturn names[1], names[1073741825], names[-1073741823], *wrapped, *p, *q, *fractional`);
	for (const expression of f.expressions.slice(0, 4)) {
		const read = f.query.read(f.file, expression);
		assert.ok(read?.kind === 'typed');
		assert.equal(read.byteOffset, 4);
		assert.deepEqual(read.value, { kind: 'string', value: 'b' });
	}
	for (const expression of f.expressions.slice(4)) {
		const read = f.query.read(f.file, expression);
		assert.ok(read?.kind === 'typed');
		assert.equal(read.byteOffset, undefined);
		assert.equal(read.value, undefined);
	}
	const source = declarations + `\nreturn names[1073741825] == names[1], names[-1073741823] == names[1], *wrapped == names[1], *p == names[1], *q == names[2]`;
	for (const optLevel of [0, 3] as const) {
		const values = runCompiledLua(source, 'wrapped-address', optLevel);
		assert.deepEqual(values.slice(0, 3), [true, true, true]);
		assert.equal(values[3] && values[4], false, 'binary64 rounding makes at least one flattened address wrong');
	}
});

test('fractional addresses are not prematurely converted into relative words', () => {
	const source = `rodata prefix: u8[4] = { 1, 2, 3, 4 }
rodata bytes: u8[2] = { 5, 6 }
local positive: *u8 = bytes + 0.5
local negative: *u8 = bytes - 0.5
return positive[0], negative[0]`;
	const f = fixture(source);
	for (const expression of f.expressions) {
		const read = f.query.read(f.file, expression);
		assert.ok(read?.kind === 'typed');
		assert.equal(read.byteOffset, undefined);
		assert.equal(read.value, undefined);
	}
	for (const optLevel of [0, 3] as const)
		assert.deepEqual(runCompiledLua(source, 'fractional-address', optLevel), [5, 4]);
});

test('an exact negative 2^53 displacement differs from a rounded following subtraction', () => {
	const declarations = `rodata names: string[2] = { 'a', 'b' }
local exact: *string = names - 9007199254740992
local rounded: *string = names - 9007199254740992 - 1`;
	const f = fixture(declarations + '\nreturn *exact, *rounded');
	const exact = f.query.read(f.file, f.expressions[0]), rounded = f.query.read(f.file, f.expressions[1]);
	assert.ok(exact?.kind === 'typed' && rounded?.kind === 'typed');
	assert.equal(exact.byteOffset, 0); assert.deepEqual(exact.value, { kind: 'string', value: 'a' });
	assert.equal(rounded.byteOffset, undefined); assert.equal(rounded.value, undefined);
	for (const optLevel of [0, 3] as const) {
		assert.deepEqual(runCompiledLua(declarations + '\nreturn *exact == names[0]', 'exact-address', optLevel), [true]);
		const source = declarations + '\nreturn *rounded';
		const program = compileLuaChunkToProgram(parseLuaChunk(source, 'rounded-address').chunk, [],
			{ entrySource: source, programDomain: 'system', optLevel });
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(program));
		assert.notEqual(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	}
});

test('dereference retains dimensions and scalar root-only pointer indexing does not persist', () => {
	const f = fixture(`rodata names: string[2] = { "a", "b" }
local view: *string[2] = names
return (*view)[1], view[0][0], names[0][0], *view`);
	assert.deepEqual(f.query.scalar(f.file, f.expressions[0]), { kind: 'string', value: 'b' });
	for (const expression of f.expressions.slice(1, 3)) {
		const read = f.query.read(f.file, expression);
		assert.equal(read?.kind, 'invalid');
	}
	const aggregate = f.query.read(f.file, f.expressions[3]);
	assert.ok(aggregate?.kind === 'typed');
	assert.deepEqual(aggregate.type.dimensions, [2]);
	assert.equal(aggregate.value, undefined);
});

test('DATA/BSS and closed-looking const address bindings are not immutable content', () => {
	const f = fixture(`data state: word = 7
bss blank: word
local immutable_binding<const>: *word = state
return *state, *blank, *immutable_binding`);
	for (const expression of f.expressions) {
		const read = f.query.read(f.file, expression);
		assert.ok(read?.kind === 'typed');
		assert.equal(read.value, undefined);
		assert.equal(read.initializer, undefined);
	}
});

test('closed source scalar operations use authored aliases and typed string terminals without admitting typed compiler constants', () => {
	const f = fixture(`rodata names: string[2] = { "a", "b" }
local offset = 1 + 1
local selected: *string = names + (offset - 1) * sizeof(string)
local message = { text = *selected }
local index = (2 << 1) - 3
return message.text .. "!", names[index], #names, false and unknown(), true or unknown()`);
	assert.deepEqual(f.query.scalar(f.file, f.expressions[0]), { kind: 'string', value: 'b!' });
	assert.deepEqual(f.query.scalar(f.file, f.expressions[1]), { kind: 'string', value: 'b' });
	assert.deepEqual(f.query.scalar(f.file, f.expressions[2]), { kind: 'number', value: 2 });
	assert.deepEqual(f.query.scalar(f.file, f.expressions[3]), { kind: 'boolean', value: false });
	assert.deepEqual(f.query.scalar(f.file, f.expressions[4]), { kind: 'boolean', value: true });
	assert.equal(f.query.types.constants.evaluate(f.file, f.expressions[1]), undefined, 'source load capability does not change compile-time admission');
});

test('unknown, called, competing-write bases and indices stay recognized without becoming table-member values', () => {
	const f = fixture(`rodata names: string[2] = { "a", "b" }
local unknown_pointer: *string = input
local called_pointer: *string = obtain()
local changed_pointer: *string = names
changed_pointer = names
local changed_index = 0
changed_index = 0
local dynamic_index = obtain()
return *unknown_pointer, *called_pointer, *changed_pointer, names[changed_index], names[dynamic_index]`);
	for (const expression of f.expressions) {
		const read = f.query.read(f.file, expression);
		assert.ok(read?.kind === 'typed');
		assert.equal(read.value, undefined);
		assert.equal(read.byteOffset, undefined);
		assert.equal(f.query.scalar(f.file, expression), undefined);
	}
});

test('a goto that skips a function-local const view cannot prove an initialized typed read', () => {
	const source = `rodata title: string = 'hi'
local function register()
 goto skip
 local p<const>: *string = title
 ::skip::
 return { text = *p }
end
return register`;
	const f = fixture(source), flow = f.file.functionValueFlows[0];
	const returned = flow.expression.body.body.get(3);
	assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
	const table = returned.expressions[0]; assert.ok(table.kind === LuaSyntaxKind.TableConstructorExpression);
	const read = f.query.read(f.file, table.fields[0].value);
	assert.ok(read?.kind === 'typed');
	assert.equal(read.byteOffset, undefined); assert.equal(read.value, undefined);
	const runtimeSource = source + `().text == 'hi'`;
	for (const optLevel of [0, 3] as const) {
		const program = compileLuaChunkToProgram(parseLuaChunk(runtimeSource, 'skipped-view').chunk, [],
			{ entrySource: runtimeSource, programDomain: 'system', optLevel });
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(program));
		assert.notEqual(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	}
});

test('a reached function-local const view preserves an immutable source address', () => {
	const source = `rodata title: string = 'hi'
local function register()
 local p<const>: *string = title
 return { text = *p }
end
return register`;
	const f = fixture(source), flow = f.file.functionValueFlows[0];
	const returned = flow.expression.body.body.get(1);
	assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
	const table = returned.expressions[0]; assert.ok(table.kind === LuaSyntaxKind.TableConstructorExpression);
	const read = f.query.read(f.file, table.fields[0].value);
	assert.ok(read?.kind === 'typed');
	assert.deepEqual(read.value, { kind: 'string', value: 'hi' });
	for (const optLevel of [0, 3] as const)
		assert.deepEqual(runCompiledLua(source + `().text == 'hi'`, 'reached-view', optLevel), [true]);
});

test('each function-local alias must dominate its own dependent read', () => {
	for (const skipped of [false, true]) {
		const source = `rodata title: string = 'hi'
local function register()
 ${skipped ? 'goto skip' : ''}
 local first<const>: *string = title
 ::skip::
 local second<const>: *string = first
 return { text = *second }
end
return register`;
		const f = fixture(source), flow = f.file.functionValueFlows[0];
		const returned = flow.expression.body.body.get(skipped ? 4 : 3);
		assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
		const table = returned.expressions[0]; assert.ok(table.kind === LuaSyntaxKind.TableConstructorExpression);
		const read = f.query.read(f.file, table.fields[0].value);
		assert.ok(read?.kind === 'typed');
		assert.deepEqual(read.value, skipped ? undefined : { kind: 'string', value: 'hi' });
		const runtimeSource = source + `().text == 'hi'`;
		for (const optLevel of [0, 3] as const) {
			const program = compileLuaChunkToProgram(parseLuaChunk(runtimeSource, 'alias-view').chunk, [],
				{ entrySource: runtimeSource, programDomain: 'system', optLevel });
			const { cpu } = createTestSystemCpu(linkTestSystemBlua32(program));
			const result = cpu.runUntilDepth(0, 100000);
			if (skipped) assert.notEqual(result, RunResult.Halted);
			else { assert.equal(result, RunResult.Halted); assert.deepEqual(materializeCpuCompletionValues(cpu), [true]); }
		}
	}
});

test('invalid typed syntax has an explicit source error boundary and invalid siblings invalidate the whole initializer', () => {
	const f = fixture(`struct broken
	name: string
	count: word
end
rodata bad: broken = { name = "visible", count = unknown() }
local invalid: *missing = 0
return bad.name, invalid[0], bad.no_such_field`);
	for (const expression of f.expressions) {
		const read = f.query.read(f.file, expression);
		assert.ok(read?.kind === 'invalid');
		assert.ok(read.error instanceof StaticSourceError);
		assert.equal(f.query.scalar(f.file, expression), undefined);
		assert.equal(f.query.read(f.file, expression), read);
	}
});

test('numeric initializer leaves are never exposed as unencoded source numbers', () => {
	const f = fixture('rodata values: u8[2] = { 257, -1 }\nreturn values[0], values[1]');
	for (const expression of f.expressions) {
		const read = f.query.read(f.file, expression);
		assert.ok(read?.kind === 'typed');
		assert.equal(read.value, undefined);
	}
});

test('const-module static exports are resolved by referrer-relative proven module identity', () => {
	const paths = ['left/main.lua', 'left/labels.lua', 'right/main.lua', 'right/labels.lua', 'right/mutable.lua'];
	const bindings = new Map([
		['left/main.lua', new Map([['labels', 'left/labels.lua']])],
		['left/labels.lua', new Map<string, string>()],
		['right/main.lua', new Map([['labels', 'right/labels.lua'], ['mutable', 'right/mutable.lua']])],
		['right/labels.lua', new Map<string, string>()],
		['right/mutable.lua', new Map<string, string>()],
	]);
	const workspace = new LuaSemanticWorkspace(bindings);
	const modules = ['module<const>\nrodata names: string[1] = { "left" }\nreturn { names = names, count = 1 }',
		'module<const>\nrodata names: string[1] = { "right" }\nreturn { names = names, count = 1 }'];
	workspace.updateFiles(paths.map((path, index) => buildLuaFileSemanticData(index === 1 ? modules[0] : index === 3 ? modules[1]
		: index === 4 ? 'rodata names: string[1] = { "mutable" }\nreturn { names = names }'
		: 'local labels = require("labels")\nlocal view: *string = labels.names\nreturn *view, labels.names[0]', path)));
	const snapshot = workspace.getSnapshot();
	for (const [path, text] of [['left/main.lua', 'left'], ['right/main.lua', 'right']]) {
		const file = snapshot.getFileData(path)!;
		const [view, direct] = returned(file);
		assert.deepEqual(snapshot.staticSourceReads.scalar(file, view), { kind: 'string', value: text });
		// A module export is an address value, not a typed view. Only the explicitly
		// annotated local admits typed memory selection; direct indexing is Lua indexing.
		assert.equal(snapshot.staticSourceReads.read(file, direct), undefined);
		assert.equal(snapshot.staticSourceReads.scalar(file, direct), undefined);
	}
});

test('a cross-file global navigation winner is not a typed storage binding', () => {
	const moduleSource = `rodata shared: string[2] = { 'one', 'two' }\nreturn 1`;
	const entrySource = `shared = { 'table' }\nreturn shared[1] == 'table', shared[1] == 'two'`;
	const analysisSource = `shared = { 'table' }\nreturn shared[1]`;
	for (const order of [['module.lua', 'entry.lua'], ['entry.lua', 'module.lua']]) {
		const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(order));
		for (const path of order) workspace.updateFile(path, path === 'module.lua' ? moduleSource : analysisSource);
		const snapshot = workspace.getSnapshot(), file = snapshot.getFileData('entry.lua')!;
		assert.equal(snapshot.staticSourceReads.read(file, returned(file)[0]), undefined);
	}
	const modules = [{ path: 'module', source: moduleSource, chunk: parseLuaChunk(moduleSource, 'module').chunk }];
	for (const optLevel of [0, 3] as const) {
		const program = compileLuaChunkToProgram(parseLuaChunk(entrySource, 'entry').chunk, modules,
			{ entrySource, programDomain: 'system', optLevel });
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(program));
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true, false]);
	}
});

test('linker-owned module exports cannot be mistaken for authored constant indices, even through aliases', () => {
	const moduleSource = `module<const>\nreturn { index = 0, other = 1 }`;
	const source = `local asset<const> = require('asset')
local alias<const> = asset.index
local combined<const> = alias + 0
local wrapper = { index = asset.index, other = asset.other }
rodata names: string[2] = { 'a', 'b' }
return names[asset.index], names[alias], names[combined], names[asset.other], names[wrapper.index], names[wrapper.other]`;
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['entry.lua', 'asset.lua']));
	const file = workspace.updateFile('entry.lua', source); workspace.updateFile('asset.lua', moduleSource);
	const before = workspace.getSnapshot();
	assert.deepEqual(returned(file).map(expression => before.staticSourceReads.scalar(file, expression)),
		[{ kind: 'string', value: 'a' }, { kind: 'string', value: 'a' }, { kind: 'string', value: 'a' }, { kind: 'string', value: 'b' },
			{ kind: 'string', value: 'a' }, { kind: 'string', value: 'b' }]);
	workspace.setLinkExports(new Map([['asset.lua', new Set(['index'])]]));
	const after = workspace.getSnapshot();
	assert.deepEqual(returned(file).map(expression => after.staticSourceReads.scalar(file, expression)),
		[undefined, undefined, undefined, { kind: 'string', value: 'b' }, undefined, { kind: 'string', value: 'b' }]);
	assert.deepEqual(before.staticSourceReads.scalar(file, returned(file)[0]), { kind: 'string', value: 'a' });
	const module = { path: 'asset', source: moduleSource, chunk: parseLuaChunk(moduleSource, 'asset').chunk, linkValues: new Map([['index', 1]]) };
	const runtimeSource = source.replace('return names[asset.index], names[alias], names[combined], names[asset.other], names[wrapper.index], names[wrapper.other]',
		"return names[asset.index] == 'b', names[alias] == 'b', names[combined] == 'b', names[asset.other] == 'b', names[wrapper.index] == 'b', names[wrapper.other] == 'b'");
	for (const optLevel of [0, 3] as const) {
		const program = compileLuaChunkToProgram(parseLuaChunk(runtimeSource, 'entry').chunk, [module],
			{ entrySource: runtimeSource, programDomain: 'system', optLevel });
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(program));
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true, true, true, true, true, true]);
	}
});

test('nested link exports affect their own value path, not sibling receiver evidence', () => {
	const moduleSource = `module<const>\nreturn { group = { index = 0, other = 1 } }`;
	const source = `local asset<const> = require('asset')
local group<const> = asset.group
local alias<const> = group.index
rodata names: string[2] = { 'a', 'b' }
return names[asset.group.index], names[group.index], names[alias], names[group.other]`;
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['entry.lua', 'asset.lua']));
	const file = workspace.updateFile('entry.lua', source); workspace.updateFile('asset.lua', moduleSource);
	workspace.setLinkExports(new Map([['asset.lua', new Set(['group.index'])]]));
	const snapshot = workspace.getSnapshot();
	assert.deepEqual(returned(file).map(expression => snapshot.staticSourceReads.scalar(file, expression)),
		[undefined, undefined, undefined, { kind: 'string', value: 'b' }]);
	const module = { path: 'asset', source: moduleSource, chunk: parseLuaChunk(moduleSource, 'asset').chunk,
		linkValues: new Map([['group.index', 1]]) };
	const runtimeSource = source.replace('return names[asset.group.index], names[group.index], names[alias], names[group.other]',
		"return names[asset.group.index] == 'b', names[group.index] == 'b', names[alias] == 'b', names[group.other] == 'b'");
	for (const optLevel of [0, 3] as const) {
		const program = compileLuaChunkToProgram(parseLuaChunk(runtimeSource, 'entry').chunk, [module],
			{ entrySource: runtimeSource, programDomain: 'system', optLevel });
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(program));
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true, true, true, true]);
	}
});

test('a link-owned address export cannot borrow the authored storage identity through a typed view', () => {
	const moduleSource = `module<const>\nrodata title: string = 'authored'\nreturn { ptr = title }`;
	const source = `local asset<const> = require('asset')
local p<const>: *string = asset.ptr
return *p`;
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['entry.lua', 'asset.lua']));
	const file = workspace.updateFile('entry.lua', source); workspace.updateFile('asset.lua', moduleSource);
	const before = workspace.getSnapshot();
	assert.deepEqual(before.staticSourceReads.scalar(file, returned(file)[0]), { kind: 'string', value: 'authored' });
	workspace.setLinkExports(new Map([['asset.lua', new Set(['ptr'])]]));
	const after = workspace.getSnapshot(), read = after.staticSourceReads.read(file, returned(file)[0]);
	assert.ok(read?.kind === 'typed');
	assert.equal(read.storage, undefined); assert.equal(read.byteOffset, undefined); assert.equal(read.value, undefined);
	assert.deepEqual(before.staticSourceReads.scalar(file, returned(file)[0]), { kind: 'string', value: 'authored' });
	const module = { path: 'asset', source: moduleSource, chunk: parseLuaChunk(moduleSource, 'asset').chunk,
		linkValues: new Map([['ptr', 0]]) };
	const runtimeSource = source.replace('return *p', 'return p == 0');
	for (const optLevel of [0, 3] as const) {
		const program = compileLuaChunkToProgram(parseLuaChunk(runtimeSource, 'entry').chunk, [module],
			{ entrySource: runtimeSource, programDomain: 'system', optLevel });
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(program));
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	}
});

test('source reads and caches belong to lexical declarations and immutable snapshot/file identities', () => {
	const source = `rodata title: string = "old"
local text = *title
return text`;
	const f = fixture(source), initial = f.query.scalar(f.file, f.expressions[0]);
	assert.deepEqual(initial, { kind: 'string', value: 'old' });
	assert.equal(f.snapshot.staticSourceReads, f.query);
	for (let index = 0; index < 100; index++) assert.equal(f.query.scalar(f.file, f.expressions[0]), initial);
	const changed = f.workspace.updateFile(f.file.file, source.replace('"old"', '"new"'));
	const current = f.workspace.getSnapshot().staticSourceReads;
	assert.notEqual(current, f.query);
	assert.deepEqual(current.scalar(changed, returned(changed)[0]), { kind: 'string', value: 'new' });
	assert.equal(f.query.scalar(f.file, f.expressions[0]), initial);
	const shadow = fixture(`rodata title: string = "outer"
do
	rodata title: string = "inner"
	local text = *title
end
return *title`);
	assert.deepEqual(shadow.query.scalar(shadow.file, shadow.expressions[0]), { kind: 'string', value: 'outer' });
});

test('shared syntax occurrences in distinct files keep their storage and initializer provenance distinct', () => {
	const source = 'rodata title: string = "same"\nreturn *title';
	const parsed = parseLuaChunkWithRecovery(source, 'shared.lua');
	const left = buildLuaFileSemanticData(source, 'left.lua', parsed), right = buildLuaFileSemanticData(source, 'right.lua', parsed);
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['left.lua', 'right.lua']));
	workspace.updateFiles([left, right]);
	const query = workspace.getSnapshot().staticSourceReads;
	const a = query.read(left, returned(left)[0]), b = query.read(right, returned(right)[0]);
	assert.ok(a?.kind === 'typed' && b?.kind === 'typed');
	assert.equal(a.expression, b.expression);
	assert.notEqual(a.storage!.id, b.storage!.id);
	assert.equal(a.initializer!.file, left);
	assert.equal(b.initializer!.file, right);
});

test('retained function syntax consumes the current snapshot location and lexical type declaration', () => {
	const source = '-- preserve body\n'.repeat(80) + `rodata title: string = "old"
local read = function()
	local view: *string = title
	return *view
end
return read`;
	const f = fixture(source);
	const oldExpression = f.file.functionValueFlows[0].expression.body.body.get(1);
	assert.ok(oldExpression.kind === LuaSyntaxKind.ReturnStatement);
	const oldRead = f.query.read(f.file, oldExpression.expressions[0]);
	assert.ok(oldRead?.kind === 'typed');
	const prefix = 'local unrelated = 0\n';
	const current = f.workspace.updateFile(f.file.file, prefix + source,
		SourceChangeMap.unchanged(source.length).append([{ offset: 0, deletedLength: 0, insertedLength: prefix.length }]));
	assert.equal(current.functionValueFlows[0], f.file.functionValueFlows[0]);
	const latest = f.workspace.getSnapshot().staticSourceReads.read(current, oldExpression.expressions[0]);
	assert.ok(latest?.kind === 'typed');
	assert.equal(latest.file, current);
	assert.equal(latest.expression, oldRead.expression);
	assert.equal(current.chunk.locations.range(latest.expression.span).start.line, f.file.chunk.locations.range(oldRead.expression.span).start.line + 1);
});
