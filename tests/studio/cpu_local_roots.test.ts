import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asClosure, asStringId, valueString, type Value, valuePayload } from '../../machine/ts/machine/cpu/value';
import { prepareLuaLiteral } from '../../ide/runtime/lua_literal';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from '../helpers/cpu_test_harness';

for (const optLevel of [3] as const) {
	test(`local roots own nested host literal materialization and release nested scopes (O${optLevel})`, t => {
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'local_roots.lua', optLevel)));
		const baseline = cpu.collectTrackedHeapBytes();
		const intern = cpu.stringPool.intern.bind(cpu.stringPool);
		t.mock.method(cpu.stringPool, 'intern', (text: string) => {
			const id = intern(text);
			cpu.collectTrackedHeapBytes();
			return id;
		});
		const outer = cpu.acquireLocalRoots();
		try {
			const value = valuePayload(prepareLuaLiteral('{ local_root_key = "outer-payload", child = { "nested-payload" } }')(cpu));
			assert.equal(cpu.stringPool.toString(asStringId(cpu.gc.tables.getStringKey(value, cpu.stringPool.find('local_root_key')!))), 'outer-payload');
			const child = valuePayload(cpu.gc.tables.getStringKey(value, cpu.stringPool.find('child')!));
			assert.equal(cpu.stringPool.toString(asStringId(cpu.gc.tables.getInteger(child, 1))), 'nested-payload');
			const inner = cpu.acquireLocalRoots();
			try {
				cpu.stringPool.intern('inner-only-payload');
				assert.notEqual(cpu.stringPool.find('inner-only-payload'), undefined);
			} finally {
				cpu.releaseLocalRoots(inner);
			}
			cpu.collectTrackedHeapBytes();
			assert.equal(cpu.stringPool.find('inner-only-payload'), undefined);
			assert.notEqual(cpu.stringPool.find('outer-payload'), undefined);
		} finally {
			cpu.releaseLocalRoots(outer);
		}
		assert.equal(cpu.collectTrackedHeapBytes(), baseline + (32 - 16) * 4,
			'only the doubled intern bucket array remains allocated');
		assert.equal(cpu.stringPool.find('outer-payload'), undefined);
		assert.equal(cpu.stringPool.find('nested-payload'), undefined);
	});

	test(`external call arguments survive stack-growth collection (O${optLevel})`, t => {
			const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource(
				'local holder = {1}; return function(...) if holder[1] == 1 then return ... end end', 'call_roots.lua', optLevel,
			)));
			assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
			const completion: Value[] = [];
			cpu.readCompletionValues(completion);
			const closure = asClosure(completion[0], cpu.gc);
			const args: Value[] = [];
			const strings = Array.from({ length: 24 }, (_, index) => `host-argument-${index}`);
			const roots = cpu.acquireLocalRoots();
			try {
				for (const text of strings) args.push(valueString(cpu.stringPool.intern(text)));
			} finally {
				cpu.releaseLocalRoots(roots);
			}
			const gc = t.mock.method(cpu.gc, 'step');
			cpu.luaHeap.setCollectionTarget(0);
			cpu.beginCompletionCall(closure, args);
			assert.ok(gc.mock.callCount() > 0, 'actual call entry must grow the stack and collect before copying host arguments');
			assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
			cpu.readCompletionValues(completion);
			assert.deepEqual(completion.map(value => cpu.stringPool.toString(asStringId(value))), strings);
		});
}
