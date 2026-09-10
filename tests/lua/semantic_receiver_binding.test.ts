import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';
import { FunctionSummaryStore, TermKind } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { findImplicitSelfValueAt, findLuaLexicalBindingAt } from '../../toolchain/ts/lua/semantic/scope_query';
import { declarationValueSource } from '../../toolchain/ts/lua/semantic/value_graph';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk, runCompiledLua } from './cpu_test_harness';

const PATH = 'receiver.lua';

test('implicit receiver reads and writes bind the same parameter, not a global declaration', () => {
	const source = `self = 99
local original = { initial = 11 }
local replacement = { updated = 22 }
function original:change()
	self = replacement
	return self
end
local result = original:change()
return original.initial, result.updated, self == 99`;
	const data = buildLuaFileSemanticData(source, PATH);
	const frontend = buildLuaSemanticFrontend([{ path: PATH, source, analysis: data }]);
	const file = frontend.getFile(PATH);
	assert.deepEqual(data.decls.filter(declaration => declaration.name === 'self').map(declaration => declaration.range.start.line), [1]);
	const references = data.refs.filter(reference => reference.name === 'self');
	assert.deepEqual(references.map(reference => reference.referenceKind), ['identifier', 'self', 'self', 'identifier']);
	for (const [syntax, reference] of data.referencesBySyntax) {
		if (reference.referenceKind === 'self') {
			assert.equal(file.getReference(syntax)!.kind, 'implicit_self');
		}
	}
	const summaries = new FunctionSummaryStore([data], new WorkspaceValueIdentityIndex({ files: [data], globalValues: new Map() }));
	const method = summaries.list()[0];
	assert.equal(summaries.terms.kind(summaries.terms.compileSource(method.source.parameters[0])), TermKind.Local);
	assert.equal(summaries.terms.kind(method.parameters[0]), TermKind.Parameter);
	for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, PATH, level), [11, 22, true]);
});

for (const [label, change] of [
	['direct', 'self = replacement'],
	['captured', 'local function change() self = replacement end; change()'],
] as const) {
	test(`${label} receiver reassignment preserves shared-object and caller boundaries`, () => {
		const source = `local original = { initial = true }
local replacement = { updated = true }
function original:change()
	${change}
	return self
end
local result = original:change()
return result.updated`;
		for (const names of [['original', 'replacement', 'result'], ['result', 'replacement', 'original']]) {
			const workspace = new LuaSemanticWorkspace();
			workspace.updateFile(PATH, source);
			const snapshot = workspace.getSnapshot();
			for (const name of names) {
				const declaration = snapshot.getFileData(PATH)!.decls.find(entry => entry.name === name)!;
				const members = snapshot.symbolResolver.getMembers(declarationValueSource(declaration.id)).map(member => member.name).sort();
				assert.deepEqual(members, name === 'original' ? ['change', 'initial'] : name === 'replacement' ? ['updated'] : ['change', 'initial', 'updated'], name);
			}
		}
		for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, PATH, level), [true]);
	});
}

test('receiver lookup follows lexical scope, including explicit self parameters and delayed local visibility', () => {
	const source = `local self = 90
local original = { value = 11 }
function original:read()
	local inherited = self
	do
		local self = self
		self = { value = 22 }
		inherited.block = self.value
	end
	local function shadow(self) self = 33; return self end
	local function capture() return self.value end
	return inherited.block, shadow(0), capture()
end
function original:explicit(self) self = 44; return self end
function original:shadow_twice()
	local function outer() return self.value end
	local self = { value = 22 }
	local function first() return self.value end
	local self = { value = 33 }
	return outer(), first(), self.value
end
local block, shadow, captured = original:read()
local receiver, previous, latest = original:shadow_twice()
return block, shadow, captured, original:explicit(0), self, receiver, previous, latest`;
	for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, PATH, level), [22, 33, 11, 44, 90, 11, 22, 33]);
});

test('function declarations and member definitions use the same receiver binding as assignments', () => {
	const source = `self = 99
local original = { value = 11 }
function original:install()
	function self.handler() return 22 end
	local before = self.handler()
	function self() return 33 end
	return before, self()
end
local before, after = original:install()
return original.value, original.handler(), before, after, self == 99`;
	for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, PATH, level), [11, 22, 22, 33, true]);
});

test('method targets after receiver reassignment are resolved from receiver values, not its original spelling', () => {
	const source = `local original = {}
function original:read() return 11 end
local replacement = {}
function replacement:read() return 22 end
function original:change()
	self = replacement
	return self:read()
end
return original:change()`;
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile(PATH, source);
	const snapshot = workspace.getSnapshot();
	const data = snapshot.getFileData(PATH)!;
	const reference = data.refs.find(entry => entry.name === 'read' && entry.isCall)!;
	const targets = snapshot.symbolResolver.resolveReferenceTargets(reference).map(id => snapshot.symbolResolver.getDeclaration(id)!.namePath.join('.')).sort();
	assert.deepEqual(targets, ['original.read', 'replacement.read'], 'possible targets, not exclusive reaching-definition proof');
	for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, PATH, level), [22]);
});

test('rebound receivers retain every inherited method contribution without changing the original object', () => {
	const source = `local first, second, third = {}, {}, {}
first.__index, second.__index, third.__index = first, second, third
function first:read() return 11 end
function second:read() return 22 end
function third:read() return 33 end
local original = setmetatable({}, first)
local middle = setmetatable({}, second)
local replacement = setmetatable({}, third)
function original:change()
	self = middle
	self = replacement
	return self:read()
end
return original:change(), original:read()`;
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile(PATH, source);
	const snapshot = workspace.getSnapshot();
	const references = snapshot.getFileData(PATH)!.refs.filter(entry => entry.name === 'read' && entry.isCall);
	for (const index of [1, 0, 1, 0]) {
		const targets = snapshot.symbolResolver.resolveReferenceTargets(references[index])
			.map(id => snapshot.symbolResolver.getDeclaration(id)!.namePath.join('.')).sort();
		assert.deepEqual(targets, index === 0 ? ['first.read', 'second.read', 'third.read'] : ['first.read']);
	}
	// A system module, like BIOS base.lua, publishes the primitive before startup
	// clears the private boot bindings. No replacement metatable implementation.
	const bootSource = 'setmetatable = __bmsx_setmetatable';
	const entrySource = `require('test_boot')\n${source}`;
	for (const level of [0, 3] as const) {
		const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource, PATH), [
			{ path: 'test_boot', source: bootSource, chunk: parseLuaChunk(bootSource, 'test_boot.lua') },
		], { entrySource, optLevel: level, programDomain: 'system' });
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled));
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [33, 11]);
	}
});

test('receiver writes without a modeled RHS still have storage, and scope queries agree with binding facts', () => {
	const source = `local outer = {}
function outer:change()
	self = self + 1
	local function read() return self end
	return read()
end
function outer:shadow(self)
	self = 9
	return self
end
return outer.change(40), outer:shadow(0)`;
	const data = buildLuaFileSemanticData(source, PATH);
	const summaries = new FunctionSummaryStore([data], new WorkspaceValueIdentityIndex({ files: [data], globalValues: new Map() }));
	for (const reference of data.refs.filter(entry => entry.name === 'self')) {
		const { line, column } = reference.range.start;
		const binding = findLuaLexicalBindingAt(data, 'self', line, column);
		if (binding.kind === 'receiver') {
			assert.equal(reference.referenceKind, 'self');
			assert.equal(reference.binding, data.scopes[binding.scopeIndex].implicitSelfValue);
			assert.equal(findImplicitSelfValueAt(data, line, column), reference.binding);
			assert.equal(summaries.terms.kind(summaries.terms.compileSource(reference.binding!)), TermKind.Local);
		} else {
			assert.equal(binding.kind, 'declaration');
			assert.equal(reference.referenceKind, 'identifier');
			assert.equal(findImplicitSelfValueAt(data, line, column), undefined);
		}
	}
	for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, PATH, level), [41, 9]);
});

test('a nested method shadows an enclosing self local; captured writes survive its return', () => {
	const source = `local object = { value = 11 }
local self = 90
function object:make()
	local self = 91
	local nested = { value = 22 }
	function nested:make_writer()
		return function(value) self = { value = value }; return self.value end
	end
	return nested:make_writer(), self
end
local write, enclosing = object:make()
return write(33), write(44), enclosing, object.value, self`;
	for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, PATH, level), [33, 44, 91, 11, 90]);
});

for (const depth of [1, 4, 8]) {
	test(`effect demand follows ${depth} receiver-dependent hops without invoking a namesake`, () => {
		const lines = ['local writer = {}'];
		for (let index = 0; index < depth; index += 1) {
			lines.push(`function writer:step_${index}(target) self:step_${index + 1}(target) end`);
		}
		lines.push(
			`function writer:step_${depth}(target) target.ready = true end`,
			'local observer = {}',
			'function observer:step_0(target) end',
			'local function relay(owner, target) owner:step_0(target) end',
			'local written, untouched, uncalled = {}, {}, {}',
			'relay(writer, written)',
			'relay(observer, untouched)',
			'return written.ready, untouched.ready, uncalled.ready',
		);
		const source = lines.join('\n');
		for (const names of [['written', 'untouched', 'uncalled'], ['uncalled', 'untouched', 'written']]) {
			const workspace = new LuaSemanticWorkspace();
			workspace.updateFile(PATH, source);
			const snapshot = workspace.getSnapshot();
			for (const name of names) {
				const declaration = snapshot.getFileData(PATH)!.decls.find(entry => entry.name === name)!;
				assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(declaration.id)).map(member => member.name), name === 'written' ? ['ready'] : []);
			}
		}
		for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, PATH, level), [true, null, null]);
	});
}
