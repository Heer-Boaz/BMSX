import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileLuaSource, runCompiledLua } from './cpu_test_harness';

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
		const locals = metadata.capturedLocals.filter(local => local.name === 'value');
		assert.equal(locals.length, 2);
		assert.equal(locals[0].functionId, locals[1].functionId);
		assert.deepEqual(locals.map(local => local.definition.start.line), [3, 7]);
		assert.notDeepEqual(locals[0].scope, locals[1].scope);
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
		const stateIndex = metadata.capturedLocals.findIndex(local => local.name === 'state');
		const state = metadata.capturedLocals[stateIndex];
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
	const locals = metadata.capturedLocals.filter(local => local.name === 'value');
	assert.equal(locals.length, 2);
	assert.equal(locals[0].functionId, locals[1].functionId);
	assert.deepEqual(locals[0].scope, locals[1].scope);
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
	const receivers = metadata.capturedLocals.filter(local => local.name === 'self');
	assert.equal(receivers.length, 2);
	assert.notEqual(receivers[0].functionId, receivers[1].functionId);
	assert.notDeepEqual(receivers[0].definition, receivers[1].definition);
	assert.deepEqual(runCompiledLua(source, PATH, 3), [11, 22]);
});

test('uncaptured locals do not allocate captured-local records', () => {
	const compiled = compileLuaSource('local value = 3\nreturn value', PATH, 3);
	assert.deepEqual(compiled.metadata.capturedLocals, []);
	assert.ok(compiled.metadata.upvalueBindingsByProto.every(bindings => bindings.length === 0));
});
