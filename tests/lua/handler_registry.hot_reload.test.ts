import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandlerRegistry, type HandlerDescriptor } from '../../src/bmsx/core/handlerregistry';

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
