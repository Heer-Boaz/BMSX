import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLuaInterpreter } from '../../src/bmsx/lua/runtime';
import type { LuaSourceRange } from '../../src/bmsx/lua/ast';
import type { LuaFunctionValue } from '../../src/bmsx/lua/value';
import { LuaHandlerRegistry, type LuaHandlerBindContext } from '../../src/bmsx/emulator/lua_handler_registry';
import type { LuaValue } from '../../src/bmsx/lua/value';

test('LuaHandlerRegistry tracks registration and path mapping', () => {
	const registry = new LuaHandlerRegistry();
	const interpreter = createLuaInterpreter();
	const range: LuaSourceRange = {
		path: '@test/path.lua',
		start: { line: 1, column: 0 },
		end: { line: 1, column: 10 },
	};
	const fn: LuaFunctionValue = {
		name: 'handlerA',
		call: () => [] as LuaValue[],
	};

	let createCalls = 0;
	let updateCalls = 0;
	let disposeCalls = 0;
	let lastContext: LuaHandlerBindContext = null;
	let lastDisposedContext: LuaHandlerBindContext = null;

	const descriptor = registry.register({
		id: 'lua.handlers.ability:jump.activation',
		category: 'ability',
		targetId: 'jump',
		hook: 'activation',
		functionName: fn.name,
		sourceRange: range,
		path: range.path,
		onCreate(context) {
		createCalls += 1;
		lastContext = context;
	},
	onUpdate(context) {
		updateCalls += 1;
		lastContext = context;
	},
	onDispose(context) {
		disposeCalls += 1;
		lastDisposedContext = context;
	},
}, { fn, interpreter });

	assert.equal(descriptor.normalizedPath, 'test/path.lua');
	assert.equal(registry.listByChunk('@test/path.lua').length, 1);
	assert.equal(createCalls, 1);
	assert.equal(updateCalls, 0);
	assert.ok(lastContext);
assert.equal(lastContext?.fn, fn);
assert.equal(disposeCalls, 0);


	const nextRange: LuaSourceRange = {
		path: '@test/path.lua',
		start: { line: 5, column: 0 },
		end: { line: 5, column: 16 },
	};
	const updatedFn: LuaFunctionValue = {
		name: 'handlerA',
		call: () => [] as LuaValue[],
	};

	registry.register({
		id: 'lua.handlers.ability:jump.activation',
		category: 'ability',
		targetId: 'jump',
		hook: 'activation',
		functionName: updatedFn.name,
		sourceRange: nextRange,
		path: nextRange.path,
	onCreate(context) {
		createCalls += 1;
		lastContext = context;
	},
	onUpdate(context) {
		updateCalls += 1;
		lastContext = context;
	},
	onDispose(context) {
		disposeCalls += 1;
		lastDisposedContext = context;
	},
}, { fn: updatedFn, interpreter });

	const after = registry.get('lua.handlers.ability:jump.activation');
	assert.ok(after, 'descriptor should exist after update');
	assert.equal(after?.sourceRange?.start.line, 5);
assert.equal(createCalls, 1, 'onCreate should not run on update');
assert.equal(updateCalls, 1, 'onUpdate should run exactly once');
assert.equal(lastContext?.fn, updatedFn);
assert.equal(lastContext?.interpreter, interpreter);
assert.equal(disposeCalls, 0, 'Handler should still be registered');
assert.strictEqual(lastDisposedContext, null);
});

test('LuaHandlerRegistry unregister removes path association', () => {
	const registry = new LuaHandlerRegistry();
	const interpreter = createLuaInterpreter();
	const range: LuaSourceRange = {
		path: '@demo/main.lua',
		start: { line: 1, column: 0 },
		end: { line: 1, column: 12 },
	};
	const fn: LuaFunctionValue = {
		name: 'handlerB',
		call: () => [] as LuaValue[],
	};

	let disposeCalled = false;
	let disposedContext: LuaHandlerBindContext = null;

	registry.register({
		id: 'lua.handlers.component:demo.onattach',
		category: 'component',
		targetId: 'demo',
		hook: 'onattach',
		functionName: fn.name,
		sourceRange: range,
		path: range.path,
	onCreate() {},
	onUpdate() {},
	onDispose: (context) => { disposeCalled = true; disposedContext = context; },
}, { fn, interpreter });

	assert.equal(registry.listByChunk('demo/main.lua').length, 1);
	registry.unregister('lua.handlers.component:demo.onattach');
assert.equal(registry.listByChunk('demo/main.lua').length, 0);
assert.equal(registry.get('lua.handlers.component:demo.onattach'), null);
assert.equal(disposeCalled, true);
assert.equal(disposedContext?.fn, fn);
});
