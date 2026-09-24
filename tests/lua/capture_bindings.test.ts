import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileLuaSource, runCompiledLua } from './cpu_test_harness';
import { LexicalDeclarationKind } from '../../toolchain/ts/lua/compiler/declaration_kind';

const PATH = 'capture_bindings.lua';

test('equal names in disjoint scopes retain distinct defining declarations', () => {
	const source = `local first, second
do
	local value = 10
	first = function() return value end
end
do
	local value = 20
	second = function() return value end
end
return first(), second()`;
	for (const level of [0, 3] as const) {
		const { metadata, program } = compileLuaSource(source, PATH, level);
		const locals = metadata.lexicalDeclarations.filter(local => local.name === 'value');
		assert.equal(locals.length, 2);
		assert.equal(locals[0].functionId, locals[1].functionId);
		assert.deepEqual(locals.map(local => local.definition.start.line), [3, 7]);
		const slots = metadata.upvalueBindingsByProto.flat();
		assert.equal(slots.length, 2);
		assert.notEqual(slots[0], slots[1]);
		const descriptors = program.protos.flatMap(proto => proto.upvalueDescs);
		assert.deepEqual(descriptors, [{ inStack: true, index: 2 }, { inStack: true, index: 3 }]);
		assert.deepEqual(runCompiledLua(source, PATH, level), [10, 20]);
	}
});

test('nested readers and writers share the ultimate defining declaration', () => {
	const source = `local state = 3
local function outer()
	local function write(value) state = value end
	local function read() return state end
	return write, read
end
local write, read = outer()
write(42)
return read()`;
	for (const level of [0, 3] as const) {
		const { metadata, program, entryProtoIndex } = compileLuaSource(source, PATH, level);
		const stateIndex = metadata.lexicalDeclarations.findIndex(local => local.name === 'state');
		const state = metadata.lexicalDeclarations[stateIndex];
		assert.equal(state.functionId, metadata.protoIds[entryProtoIndex]);
		assert.deepEqual(state.definition, { path: PATH, start: { line: 1, column: 7 }, end: { line: 1, column: 11 } });
		const outerIndex = metadata.protoIds.findIndex(id => id.endsWith('/local:outer'));
		const readIndex = metadata.protoIds.findIndex(id => id.endsWith('/local:read'));
		const writeIndex = metadata.protoIds.findIndex(id => id.endsWith('/local:write'));
		for (const index of [outerIndex, readIndex, writeIndex]) {
			assert.notEqual(index, -1);
			assert.deepEqual(metadata.upvalueBindingsByProto[index], [stateIndex]);
		}
		assert.deepEqual(program.protos[outerIndex].upvalueDescs, [{ inStack: true, index: 0 }]);
		assert.deepEqual(program.protos[readIndex].upvalueDescs, [{ inStack: false, index: 0 }]);
		assert.deepEqual(program.protos[writeIndex].upvalueDescs, [{ inStack: false, index: 0 }]);
		assert.deepEqual(runCompiledLua(source, PATH, level), [42]);
	}
});

test('redeclarations in one scope do not share a captured-local identity', () => {
	const source = `local value = 1
local first = function() return value end
local value = 2
local second = function() return value end
return first(), second()`;
	const { metadata } = compileLuaSource(source, PATH, 3);
	const locals = metadata.lexicalDeclarations.filter(local => local.name === 'value');
	assert.equal(locals.length, 2);
	assert.equal(locals[0].functionId, locals[1].functionId);
	assert.notDeepEqual(locals[0].definition, locals[1].definition);
	assert.deepEqual(runCompiledLua(source, PATH, 3), [1, 2]);
});

test('implicit receivers belong to their defining methods, not the shared self spelling', () => {
	const source = `local first = { value = 11 }
function first:read()
	return function() return self.value end
end
local second = { value = 22 }
function second:read()
	return function() return self.value end
end
return first:read()(), second:read()()`;
	const { metadata } = compileLuaSource(source, PATH, 3);
	const receivers = metadata.lexicalDeclarations.filter(local => local.name === 'self');
	assert.equal(receivers.length, 2);
	assert.notEqual(receivers[0].functionId, receivers[1].functionId);
	assert.notDeepEqual(receivers[0].definition, receivers[1].definition);
	assert.deepEqual(runCompiledLua(source, PATH, 3), [11, 22]);
});

test('locals without nested functions need no shared declaration records', () => {
	const compiled = compileLuaSource('local value = 3\nreturn value', PATH, 3);
	assert.deepEqual(compiled.metadata.lexicalDeclarations, []);
	assert.ok(compiled.metadata.upvalueBindingsByProto.every(bindings => bindings.length === 0));
});

for (const level of [0, 3] as const) test(`O${level}: outer declarations do not depend on physical captures`, () => {
	const source = `local fixed<const> = 17
local unused = 40
local make = function(parameter, ...)
	local mutable = parameter
	local read = function(value, ...) return mutable + value + fixed end
	return read
end
return make(20)(5)`;
	const { metadata, program } = compileLuaSource(source, PATH, level);
	const index = metadata.protoDisplayNames.indexOf('read');
	assert.notEqual(index, -1);
	const bindings = metadata.outerBindingsByProto[index];
	assert.deepEqual(bindings.map(slot => metadata.lexicalDeclarations[slot.declarationIndex].name).sort(),
		['fixed', 'mutable', 'parameter', 'unused']);
	for (const slot of bindings) {
		const declaration = metadata.lexicalDeclarations[slot.declarationIndex];
		assert.equal(declaration.isConst, declaration.name === 'fixed');
		if (declaration.name === 'mutable') {
			assert.deepEqual(slot.location, { inStack: false, index: 0 });
			assert.ok(slot.liveWordRanges.length > 0);
		} else {
			assert.equal(slot.location, null);
			assert.deepEqual(slot.liveWordRanges, []);
		}
	}
	assert.deepEqual(metadata.upvalueBindingsByProto[index], [bindings.find(slot =>
		metadata.lexicalDeclarations[slot.declarationIndex].name === 'mutable')!.declarationIndex]);
	assert.equal(program.protos[index].upvalueDescs.length, 1);
	assert.deepEqual(runCompiledLua(source, PATH, level), [42]);
});

for (const level of [0, 3] as const) test(`O${level}: definition scopes select shadowing and recursive declarations before code generation`, () => {
	const source = `local value = 1
local first = function() return 10 end
local value<const> = 2
local second<const> = function() return 20 end
local later = 3
return first(), second()`;
	const { metadata, program } = compileLuaSource(source, PATH, level);
	for (const [name, names, line] of [['first', ['value'], 1], ['second', ['first', 'second', 'value'], 3]] as const) {
		const index = metadata.protoDisplayNames.indexOf(name);
		const bindings = metadata.outerBindingsByProto[index];
		const declarations = bindings.map(slot => metadata.lexicalDeclarations[slot.declarationIndex]);
		assert.deepEqual(declarations.map(declaration => declaration.name).sort(), names);
		assert.equal(declarations.find(declaration => declaration.name === 'value')!.definition.start.line, line);
		assert.ok(bindings.every(slot => slot.location === null && slot.liveWordRanges.length === 0));
		assert.deepEqual(program.protos[index].upvalueDescs, []);
	}
});

for (const level of [0, 3] as const) test(`O${level}: unused implicit receivers and explicit self shadowing retain distinct source owners`, () => {
	const source = `local object = {}
function object:make()
	local receiver = function() return 1 end
	local self<const> = 2
	local shadowed = function() return 3 end
	return receiver, shadowed
end
return object:make()`;
	const { metadata, program } = compileLuaSource(source, PATH, level);
	for (const [name, kind, line] of [['receiver', LexicalDeclarationKind.Receiver, 2], ['shadowed', LexicalDeclarationKind.Local, 4]] as const) {
		const index = metadata.protoDisplayNames.indexOf(name);
		const self = metadata.outerBindingsByProto[index].filter(slot => metadata.lexicalDeclarations[slot.declarationIndex].name === 'self');
		assert.equal(self.length, 1);
		const declaration = metadata.lexicalDeclarations[self[0].declarationIndex];
		assert.equal(declaration.kind, kind);
		assert.equal(declaration.definition.start.line, line);
		assert.equal(declaration.isConst, name === 'shadowed');
		assert.equal(self[0].location, null);
		assert.deepEqual(self[0].liveWordRanges, []);
		assert.deepEqual(program.protos[index].upvalueDescs, []);
	}
});

for (const level of [0, 3] as const) test(`O${level}: captures retain defining constness, not the kind of the captured value`, () => {
	const source = `local fixed<const> = { answer = 10 }
local mutable = { answer = 20 }
local function outer(parameter)
	return function()
		fixed.answer = fixed.answer + 1
		return fixed, mutable, parameter
	end
end
return outer(5)`;
	const { metadata } = compileLuaSource(source, PATH, level);
	for (const name of ['fixed', 'mutable', 'parameter']) {
		const declarationIndex = metadata.lexicalDeclarations.findIndex(local => local.name === name);
		assert.notEqual(declarationIndex, -1);
		const capture = metadata.lexicalDeclarations[declarationIndex];
		assert.equal(capture.isConst, name === 'fixed');
		const declaration = metadata.localSlotsByProto.flat().find(slot => slot.name === name)!;
		assert.equal(declaration.isConst, capture.isConst);
		assert.deepEqual(declaration.definition, capture.definition);
		assert.equal(metadata.upvalueBindingsByProto.flat().filter(index => index === declarationIndex).length,
			name === 'parameter' ? 1 : 2, 'transitive captures share the defining record');
	}
	assert.deepEqual(runCompiledLua(`${source.replace('return outer(5)', 'local read = outer(5)')}
local first, second, parameter = read()
return first.answer, second.answer, parameter`, PATH, level), [11, 20, 5],
		'a const binding does not freeze table members');
});
