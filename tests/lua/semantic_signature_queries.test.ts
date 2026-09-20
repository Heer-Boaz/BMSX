import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';

test('signature queries use the bound callee rather than the latest same-name declaration', () => {
	for (const source of [
		'local function g(x) return x end\ndo local function g(x) return x + 1 end end\nlocal function f(a, b) g(a) end',
		'local function g(x) return x + 1 end\nlocal function f(a, b) local function g(x) return x end; g(a) end',
	]) {
		const workspace = new LuaSemanticWorkspace();
		const file = workspace.updateFile('signatures.lua', source);
		const declaration = file.decls.find(decl => decl.name === 'f')!;
		assert.equal('signature' in declaration, false, 'a declaration is not mutable inferred metadata');
		const signatures = workspace.getSnapshot().symbolResolver.getFunctionSignatures(declaration.id);
		assert.equal(signatures.length, 1);
		assert.equal(signatures[0].minimumArgumentCount, 0);
	}
});

test('a shadowed parameter name does not make the original parameter required', () => {
	const workspace = new LuaSemanticWorkspace();
	const file = workspace.updateFile('parameters.lua', 'local function f(value) do local value = {}; print(value.x) end; return value end');
	const declaration = file.decls.find(decl => decl.name === 'f')!;
	assert.equal(workspace.getSnapshot().symbolResolver.getFunctionSignatures(declaration.id)[0].minimumArgumentCount, 0);
});

test('hover presents written function headers without required-argument analysis', t => {
	const frontend = buildLuaSemanticFrontend([{ path: 'header.lua', source: 'local function run(first, second) return first + second end\nrun(1, 2)' }]);
	const inference = t.mock.method(frontend.snapshot.symbolResolver, 'getFunctionSignatures', () => {
		throw new Error('hover must not request required-argument inference');
	});
	assert.deepEqual(frontend.provideHover('header.lua', 2, 2)!.contents, [{ label: '(function) run(first, second)' }]);
	assert.deepEqual(frontend.provideHover('header.lua', 1, 17)!.contents, [{ label: '(function) run(first, second)' }]);
	assert.equal(inference.mock.callCount(), 0);
});

test('distinct written functions assigned to one binding retain distinct signatures', () => {
	const frontend = buildLuaSemanticFrontend([{ path: 'multiple.lua', source: [
		'local callback',
		'callback = function(first) return first + 1 end',
		'callback = function(second, third) return second + third end',
		'callback(1)',
	].join('\n') }]);
	const signature = frontend.provideSignatureHelp('multiple.lua', 4, 10)!;
	assert.deepEqual(signature.signatures.map(item => item.label), ['callback(first)', 'callback(second, third)']);
	assert.equal(signature.activeSignature, 0);
});

test('editing a signature dependency replaces only the new snapshot answer', () => {
	const source = 'local function g(x) return x end\n' + '-- retained body\n'.repeat(80)
		+ 'local function f(a, b) g(a) end';
	const workspace = new LuaSemanticWorkspace();
	const old = workspace.updateFile('dependencies.lua', source);
	const before = workspace.getSnapshot();
	const declaration = old.decls.find(decl => decl.name === 'f')!;
	const retained = before.symbolResolver.getFunctionSignatures(declaration.id);
	assert.equal(retained[0].minimumArgumentCount, 0);
	const offset = source.indexOf('return x') + 'return x'.length;
	const inserted = ' + 1';
	const current = workspace.updateFile('dependencies.lua', source.slice(0, offset) + inserted + source.slice(offset),
		SourceChangeMap.unchanged(source.length).append([{ offset, deletedLength: 0, insertedLength: inserted.length }]));
	assert.equal(current.decls.find(decl => decl.name === 'f')!.id, declaration.id);
	assert.equal(workspace.getSnapshot().symbolResolver.getFunctionSignatures(declaration.id)[0].minimumArgumentCount, 1);
	assert.strictEqual(before.symbolResolver.getFunctionSignatures(declaration.id), retained);
	assert.equal(retained[0].minimumArgumentCount, 0);
});

test('only the unshadowed builtin type can establish a parameter guard', () => {
	const body = 'local function run(value) if type(value) == "table" then return value.x end end';
	for (const { sources, minimum } of [
		{ sources: [{ path: 'guard.lua', source: body }], minimum: 0 },
		{ sources: [{ path: 'guard.lua', source: 'local function type(value) return "table" end\n' + body }], minimum: 1 },
		{ sources: [{ path: 'guard.lua', source: body + '\nfunction type(value) return "table" end' }], minimum: 1 },
		{ sources: [{ path: 'guard.lua', source: body }, { path: 'shadow.lua', source: 'function type(value) return "table" end' }], minimum: 1 },
	]) {
		const frontend = buildLuaSemanticFrontend(sources);
		const declaration = frontend.snapshot.getFileData('guard.lua')!.decls.find(decl => decl.name === 'run')!;
		assert.equal(frontend.snapshot.symbolResolver.getFunctionSignatures(declaration.id)[0].minimumArgumentCount, minimum);
	}
});

test('global builtin shadowing invalidates signature answers without rebinding the guarded file', () => {
	const workspace = new LuaSemanticWorkspace();
	const file = workspace.updateFile('guard.lua', 'local function run(value) if type(value) == "table" then return value.x end end');
	const id = file.decls.find(decl => decl.name === 'run')!.id;
	const before = workspace.getSnapshot();
	assert.equal(before.symbolResolver.getFunctionSignatures(id)[0].minimumArgumentCount, 0);
	workspace.updateFile('shadow.lua', 'function type(value) return "table" end');
	const shadowed = workspace.getSnapshot();
	assert.strictEqual(shadowed.getFileData('guard.lua'), file);
	assert.equal(shadowed.symbolResolver.getFunctionSignatures(id)[0].minimumArgumentCount, 1);
	workspace.updateFiles([], ['shadow.lua']);
	assert.equal(workspace.getSnapshot().symbolResolver.getFunctionSignatures(id)[0].minimumArgumentCount, 0);
	assert.equal(before.symbolResolver.getFunctionSignatures(id)[0].minimumArgumentCount, 0);
	assert.equal(shadowed.symbolResolver.getFunctionSignatures(id)[0].minimumArgumentCount, 1);
});

test('a type comparison to nil does not prove a parameter is present', () => {
	for (const condition of ['type(value) == "nil"', '"nil" == type(value)']) {
		const frontend = buildLuaSemanticFrontend([{ path: 'nil.lua', source: `local function run(value) if ${condition} then return value.x end end` }]);
		const declaration = frontend.snapshot.getFileData('nil.lua')!.decls.find(decl => decl.name === 'run')!;
		assert.equal(frontend.snapshot.symbolResolver.getFunctionSignatures(declaration.id)[0].minimumArgumentCount, 1);
	}
});

test('arity forwarding treats aliases as unknown regardless of value-query history', () => {
	for (const cyclic of [false, true]) {
		for (const warmAlias of [false, true]) {
			const source = cyclic
				? 'local sink, alias\nsink = alias\nalias = sink\nalias = function(x) return x + 1 end\nlocal function f(a, b) sink(a) end\nf()'
				: 'local function leaf(x) return x + 1 end\nlocal alias = leaf\nlocal function f(a, b) alias(a) end\nf()';
			const frontend = buildLuaSemanticFrontend([{ path: 'alias.lua', source }]);
			const file = frontend.snapshot.getFileData('alias.lua')!;
			const resolver = frontend.snapshot.symbolResolver;
			if (warmAlias) resolver.resolveDefinitionFunctionTargets(file.decls.find(decl => decl.name === 'alias')!.id);
			assert.equal(resolver.getFunctionSignatures(file.decls.find(decl => decl.name === 'f')!.id)[0].minimumArgumentCount, 0);
		}
	}
});

test('a directly written anonymous callee participates in local arity forwarding', () => {
	const frontend = buildLuaSemanticFrontend([{ path: 'literal.lua', source: 'local function f(a, b) (function(value) return value + 1 end)(a) end' }]);
	const file = frontend.snapshot.getFileData('literal.lua')!;
	assert.equal(frontend.snapshot.symbolResolver.getFunctionSignatures(file.decls.find(decl => decl.name === 'f')!.id)[0].minimumArgumentCount, 1);
});
