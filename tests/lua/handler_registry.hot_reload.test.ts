import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandlerRegistry, registerLuaHandler, type HandlerDescriptor } from '../../src/bmsx/core/handlerregistry';

test('HandlerRegistry preserves stub identity and bumps version on register', () => {
	const registry = new HandlerRegistry();
	const desc: HandlerDescriptor = {
		id: 'fsm.machine.handlers.Class.tick',
		category: 'fsm',
		source: { lang: 'lua', module: 'test.module', symbol: 'tick' },
	};
	const stub = registry.register(desc, function initial() {
		return 'initial';
	});
	assert.equal(typeof stub, 'function');
	assert.equal(stub(), 'initial');
	const firstVersion = registry.describe(desc.id)?.version ?? 0;
	const updatedStub = registry.register(desc, function updated() {
		return 'updated';
	});
	assert.equal(stub, updatedStub, 'HandlerRegistry should reuse the same stub');
	const secondVersion = registry.describe(desc.id)?.version ?? 0;
	assert.equal(secondVersion, firstVersion + 1, 'register should bump version when rebinding');
	assert.equal(stub(), 'updated');
});

test('HandlerRegistry.swapByModule removes missing handlers and sets traps', () => {
	const registry = new HandlerRegistry();
	const desc: HandlerDescriptor = {
		id: 'component.example.onattach',
		category: 'component',
		source: { lang: 'lua', module: 'components/example.lua', symbol: 'onattach' },
	};
	const stub = registry.register(desc, function attach() {
		return 'attached';
	});
	assert.equal(stub(), 'attached');
	const result = registry.swapByModule('components/example.lua', () => null);
	assert.deepEqual(result.removed, ['component.example.onattach']);
	assert.throws(() => stub(), /(missing|no longer exists)/, 'stub should throw after removal');
});

test('HandlerRegistry multicast slots respect STOP sentinel', () => {
	const registry = new HandlerRegistry();
	const slotId = 'event.global.test';
	const calls: string[] = [];
	registry.on(slotId, {
		id: `${slotId}::listener1`,
		category: 'event',
		source: { lang: 'js', module: 'tests', symbol: 'listener1' },
	}, function first(this: unknown, eventName: string) {
		calls.push(`first:${eventName}`);
		return HandlerRegistry.STOP;
	});
	registry.on(slotId, {
		id: `${slotId}::listener2`,
		category: 'event',
		source: { lang: 'js', module: 'tests', symbol: 'listener2' },
	}, function second(this: unknown, eventName: string) {
		calls.push(`second:${eventName}`);
	});
	const stub = registry.get(slotId);
	assert.ok(stub, 'multicast slot should expose a stub');
	stub!.call(undefined, 'TestEvent');
	assert.deepEqual(calls, ['first:TestEvent'], 'STOP should halt subsequent listeners');
});

test('registerLuaHandler rebind bumps descriptor version', () => {
	const id = 'lua.handlers.test.module.tick';
	const meta = { module: 'modules/test.lua', symbol: 'tick' };
	const firstStub = registerLuaHandler(id, function initialHandler() {
		return 'initial';
	}, meta, { category: 'fsm' });
	const beforeVersion = HandlerRegistry.instance.describe(id)?.version ?? 0;
	const reboundStub = registerLuaHandler(id, function updatedHandler() {
		return 'updated';
	}, meta, { category: 'fsm' });
	const afterVersion = HandlerRegistry.instance.describe(id)?.version ?? 0;
	try {
		assert.equal(firstStub, reboundStub, 're-register should reuse stub identity');
		assert.equal(afterVersion, beforeVersion + 1, 'descriptor version should increment on rebind');
		assert.equal(firstStub(), 'updated', 'stub should reflect latest implementation');
	} finally {
		HandlerRegistry.instance.unregister(id);
	}
});

test('registerLuaHandler rejects anonymous symbols', () => {
	const id = 'lua.handlers.test.anonymous';
	assert.throws(() => {
		registerLuaHandler(id, function () {
			return undefined;
		}, { module: 'modules/test.lua', symbol: '<anonymous>' });
	}, /\bnon-anonymous\b/i);
});

test('HandlerRegistry.swapByModule updates escaped symbol implementations', () => {
	const registry = new HandlerRegistry();
	const moduleId = 'modules/test';
	const symbol = 'handlers.foo\\.bar';
	const desc: HandlerDescriptor = {
		id: 'test.handler',
		category: 'other',
		source: { lang: 'lua', module: moduleId, symbol },
	};
	const stub = registry.register(desc, function initial(this: unknown) {
		return 'initial';
	});
	const result = registry.swapByModule(moduleId, () => function updated(this: unknown) {
		return 'updated';
	});
	assert.deepEqual(result, { updated: ['test.handler'], removed: [], unchanged: [] });
	assert.equal(stub.call(undefined), 'updated');
});

test('HandlerRegistry.swapByModule handles escaped backslash and dot in symbols', () => {
	const registry = new HandlerRegistry();
	const moduleId = 'modules/test';
	const symbol = 'handlers.foo\\.bar\\\\baz';
	const desc: HandlerDescriptor = {
		id: 'test.handler.backslash',
		category: 'other',
		source: { lang: 'lua', module: moduleId, symbol },
	};
	const stub = registry.register(desc, function initial() {
		return 'initial';
	});
	assert.equal(stub(), 'initial');
	const result = registry.swapByModule(moduleId, () => function updated() {
		return 'updated';
	});
	assert.deepEqual(result, { updated: ['test.handler.backslash'], removed: [], unchanged: [] });
	assert.equal(stub(), 'updated');
});

test('HandlerRegistry.swapByModule removes listeners cleanly', () => {
	const registry = new HandlerRegistry();
	const slotId = 'event.global.test';
	const listenerId = 'listener.id';
	registry.on(slotId, {
		id: listenerId,
		category: 'event',
		source: { lang: 'lua', module: 'modules/events.lua', symbol: 'events.listener' },
	}, function (this: unknown) {
		return 'listener';
	});
	const res = registry.swapByModule('modules/events.lua', () => null);
	assert.deepEqual(res, { updated: [], removed: [listenerId], unchanged: [] });
	const slotStub = registry.get(slotId);
	assert.ok(slotStub);
	assert.equal(slotStub!.call(undefined, 'event'), undefined);
});
