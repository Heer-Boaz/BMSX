import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { getLuaWrittenDeclarations } from '../../toolchain/ts/lua/semantic/written_declarations';

for (const { name, source, minimum, count } of [
	{ name: 'constructor field', source: 'local t = { run = function(x) return x + 1 end }', minimum: 1, count: 1 },
	{ name: 'nested constructor field', source: 'local t = { child = { run = function(x) return x + 1 end } }', minimum: 1, count: 1 },
	{ name: 'nested written member', source: 'local t = {}; function t.child.run(x) return x + 1 end', minimum: 1, count: 1 },
	{ name: 'declared method', source: 'local t = {}; function t:run(x) return x + 1 end', minimum: 1, count: 1 },
	{ name: 'two written functions', source: 'local t = {}; function t.run(x) return x + 1 end; function t.run(y) return y + 2 end', minimum: 0, count: 2 },
	{ name: 'constructor plus later function', source: 'local t = { run = function(x) return x + 1 end }; function t.run(y) return y + 2 end', minimum: 0, count: 2 },
	{ name: 'aliased owner', source: 'local original = { run = function(x) return x + 1 end }; local t = original', minimum: 0, count: 0 },
	{ name: 'aliased nested owner', source: 'local original = { run = function(x) return x + 1 end }; local t = { child = original }', minimum: 0, count: 0 },
]) {
	test(`direct written declarations: ${name}`, () => {
		const member = name.includes('nested') ? 't.child.run' : name === 'declared method' ? 't:run' : 't.run';
		const workspace = new LuaSemanticWorkspace();
		const file = workspace.updateFile('written.lua', `${source}\nlocal function forward(value, unused) ${member}(value) end`);
		const call = file.callSites[file.callSites.length - 1].call;
		const definitions = getLuaWrittenDeclarations(file, call.callee);
		assert.equal(definitions.length, count);
		assert.strictEqual(getLuaWrittenDeclarations(file, call.callee), definitions, 'retains the direct declaration answer');
		const forward = file.decls.find(declaration => declaration.name === 'forward')!;
		assert.equal(workspace.getSnapshot().symbolResolver.getFunctionSignatures(forward.id)[0].minimumArgumentCount, minimum);
	});
}

test('direct written declarations do not follow function returns or dynamic keys', () => {
	const workspace = new LuaSemanticWorkspace();
	const file = workspace.updateFile('unknown.lua', [
		'local function make() return { run = function(x) return x + 1 end } end',
		'local key = "run"',
		'local t = { run = function(x) return x + 1 end }',
		'local function forward(a, b, unused) make().run(a); t[key](b) end',
	].join('\n'));
	for (const site of file.callSites.filter(site => site.call.callee.steps.length > 0)) {
		assert.deepEqual(getLuaWrittenDeclarations(file, site.call.callee), []);
	}
	const forward = file.decls.find(declaration => declaration.name === 'forward')!;
	assert.equal(workspace.getSnapshot().symbolResolver.getFunctionSignatures(forward.id)[0].minimumArgumentCount, 0);
});

test('function-owned constructor members use the containing file index', () => {
	const workspace = new LuaSemanticWorkspace();
	const file = workspace.updateFile('local.lua', [
		'local function outer()',
		'  local t = { run = function(x) return x + 1 end }',
		'  local function forward(value, unused) t.run(value) end',
		'end',
	].join('\n'));
	assert.equal(file.memberValues.length, 0);
	const source = file.callSites[0].call.callee;
	assert.equal(getLuaWrittenDeclarations(file, source).length, 1);
	const forward = file.decls.find(declaration => declaration.name === 'forward')!;
	assert.equal(workspace.getSnapshot().symbolResolver.getFunctionSignatures(forward.id)[0].minimumArgumentCount, 1);
});

test('written member keys cannot collide with a multi-step path encoding', () => {
	const workspace = new LuaSemanticWorkspace();
	const file = workspace.updateFile('keys.lua', 'local object = {}\nobject["a\\0m\\0b"] = function(value) end\nobject.a.b()');
	assert.deepEqual(getLuaWrittenDeclarations(file, file.callSites[0].call.callee), []);
	const written = file.memberValues[0];
	const source = { root: written.owner.root, steps: [...written.owner.steps, { kind: 'member' as const, name: written.name }] };
	assert.deepEqual(getLuaWrittenDeclarations(file, source), [written.declId]);
	assert.deepEqual(getLuaWrittenDeclarations(file, file.callSites[0].call.callee), []);
});
