import assert from 'node:assert/strict';
import test from 'node:test';
import { OffscreenExecution } from '../../ide/workbench/services/execution/offscreen_execution';
import { RuntimeGuestFault } from '../../ide/runtime/fault_state';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import { compileLuaSource } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';

function execution(source: string, optLevel: 0 | 3) {
	const image = linkTestSystemBlua32(compileLuaSource(source, 'offscreen_execution', optLevel));
	return new OffscreenExecution({ systemRom: image.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC,
		currentBlua32Media: { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports,
			new Map([['offscreen_execution', { displayPath: 'offscreen_execution.lua', content: { kind: 'text', text: source } }]]),
			TEST_SYSTEM_CONTEXT_ID), cartridgeSlots: [null, null] } });
}

for (const optLevel of [0, 3] as const) {
	for (const exact of [false, true]) test(`O${optLevel}: ${exact ? 'instruction boundary' : 'quantum'} execution captures a physical fault before BIOS publication`, async t => {
		const source = `function exception(message)
 while true do halt_until_irq end
end
local function fail(value)
 return #value
end
answer = fail(nil)`;
		const target = execution(source, optLevel); t.after(() => target.dispose());
		const runtime = target.runtime;
		await assert.rejects(exact ? target.runUntil(() => false) : target.advanceUntil(() => false), error => {
			assert.ok(error instanceof RuntimeGuestFault);
			assert.deepEqual(error.snapshot.resource, { contextId: TEST_SYSTEM_CONTEXT_ID, path: 'offscreen_execution.lua' });
			assert.equal(error.snapshot.line, 5);
			assert.ok(error.snapshot.details.luaStack.some(frame => frame.functionName === 'fail'));
			return true;
		});
		assert.equal(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 0);
		assert.ok(runtime.machine.scheduler.nowCycles < 5000 * runtime.timing.cpuCyclesPerMillisecond,
			'the execution owner reports the fault before spending its completion budget');
	});

	test(`O${optLevel}: a non-maskable interruption is not reported as a failed operation`, async t => {
		const target = execution(`function exception(message) interrupted = true end
ready = true
while true do halt_until_irq end`, optLevel);
		t.after(() => target.dispose());
		const cpu = target.runtime.machine.cpu, ready = cpu.stringPool.intern('ready'), interrupted = cpu.stringPool.intern('interrupted');
		await target.runUntil(() => cpu.getGlobalByKey(ready) === true);
		cpu.requestNonMaskableInterrupt();
		await target.runUntil(() => cpu.getGlobalByKey(interrupted) === true);
		assert.equal(cpu.getGlobalByKey(interrupted), true);
	});
}
