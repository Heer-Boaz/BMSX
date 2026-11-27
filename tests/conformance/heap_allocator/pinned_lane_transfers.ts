import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField, THREAD_STACK_SLOT_BYTES } from '../../../machine/ts/machine/cpu/thread_record';
import { CpuSuspendedRunResult } from '../../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../../machine/ts/spec/bmsx/heap_service';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const modulePath = 'test/native_firmware_activations';
const iterations = 1024;
const testModule = `module<const>
local leaf<const> = function(a, b, c)
 if b ~= nil then return -1, -2 end
 if c ~= nil then return -3, -4 end
 return a + 27, a ~ 0x155
end
local middle<const> = function(n)
 local value, flag, pad = leaf(n, nil)
 if pad ~= nil then return -9999 end
 return value + flag
end
local invoke<const> = function()
 local check = 0
 for i = 1, ${iterations} do
  local value = middle(i)
  check = check ~ value
 end
 return check
end
return { invoke = invoke, internal = { leaf = leaf, middle = middle } }`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { configure: ['-DBMSX_NATIVE_GATE_PROFILE=ON'] });
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'pinned-lane-transfers-'));
try {
	for (const optLevel of [0, 3] as const) {
		const compiled = compileHeapServiceSystem('return 0', optLevel, [{ path: modulePath, source: testModule }]);
		const object = encodeCompiledProgramObject(compiled), image = linkTestSystemBlua32(compiled);
		const exported = object.sections.rodata.moduleExports.find(row => row.path === modulePath && row.exportPathKey === 'invoke');
		assert.ok(exported);
		const entry = image.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(entry >= 0);
		const fixed = deriveBlua32FixedStack(image.image, [entry]);
		assert.equal(fixed.frames >= 2 && fixed.frames <= 3, true, 'source lowering leaves an actual private call');
		const address = image.image.functions[entry].address;
		const rom = join(directory, `system-${optLevel}.rom`), commands = join(directory, `trace-${optLevel}.txt`);
		const seed = join(directory, `boot-${optLevel}.state`);
		writeFileSync(rom, image.romBytes);
		const runtime = new Runtime({ systemRomBytes: image.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		assert.equal(runtime.cpuExecution.runSuspendedUntilDepth(0, 32768), CpuSuspendedRunResult.Completed);
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const management = cpu.heapAllocator.managementOffset(), occupied = cpu.heapAllocator.occupiedBytes();
		const trace = ['X'], expected: string[] = [];
		function grant(cycles: number) {
			const outcome = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			assert.equal(outcome, RunResult.Yielded);
			trace.push(`L ${cycles}`);
			expected.push(`${outcome} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()}`);
		}
		function observeStack() {
			const first = management + HEAP_SERVICE_THREAD_OFFSET;
			const end = management + HEAP_SERVICE_VALUE_OFFSET + HEAP_SERVICE_VALUE_COUNT * THREAD_STACK_SLOT_BYTES;
			trace.push(`H ${first} ${end}`);
			expected.push(String(hashBytes(memory.ramData(), first, end - first)));
		}
		assert.equal(cpu.beginHeapService(address, []), true);
		trace.push(`B ${address} 0`);
		expected.push('1');
		grant(8192); // Warm the loop and its static call/return sites.
		const depth = () => memory.readRamRecordWord(management + HEAP_SERVICE_THREAD_OFFSET + ThreadField.FrameDepth);
		for (let i = 0; i < 128 && depth() !== fixed.frames; ++i) grant(1);
		assert.equal(depth(), fixed.frames, 'checkpoint with a nested return placement pending');
		observeStack();
		const checkpoint = captureRuntimeSaveState(runtime);
		trace.push('S');
		for (let i = 0; i < 12; ++i) { grant(1); observeStack(); } // Includes a return and its placement charge.
		const runToEnd = () => {
			for (let i = 0; i < 128 && cpu.heapServiceActive(); ++i) grant(4096);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(cpu.heapAllocator.occupiedBytes(), occupied, 'no ordinary activations or closures are allocated');
			observeStack();
		};
		runToEnd();
		let check = 0;
		for (let i = 1; i <= iterations; ++i) check ^= i + 27 + (i ^ 0x155);
		assert.equal(cpu.heapServiceResult(), check);
		trace.push('t', 'U');
		applyRuntimeSaveState(runtime, checkpoint);
		assert.equal(depth(), fixed.frames);
		observeStack();
		runToEnd();
		assert.equal(cpu.heapServiceResult(), check);
		trace.push('t');
		writeFileSync(commands, trace.join('\n'));
		const output = execFileSync(native, [rom, commands, seed], { encoding: 'utf8' }).trim().split('\n');
		const profiles = output.filter(row => row.startsWith('firmware-transfer '));
		assert.equal(profiles.length, 2);
		for (const row of profiles) {
			const [, result, calls, returns, closures] = row.split(' ').map(Number);
			assert.equal(result, check);
			assert.equal(closures, 0, 'a fixed CLOSURE must not enter the ordinary closure gate');
			assert.ok(calls > 0 && returns > 0, 'both fixed transfer instructions leave actual generated code');
		}
		assert.deepEqual(output.filter(row => !row.startsWith('firmware-transfer '))
			.map(row => row.split(' ').slice(0, 3).join(' ')), expected);
		console.log(`PINNED-NATIVE-TRANSFERS:PASS O${optLevel} (fixed calls to depth ${fixed.frames}, nil padding, one-cycle frontiers and rewind)`);
	}
} finally {
	rmSync(directory, { recursive: true });
}
