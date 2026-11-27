import assert from 'node:assert/strict';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueInteger, valuePayload, type Value } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { instructionOpcode } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from './blua32';
import { runGuestToHalt } from './cpu_execution';
import { linkManagedTestSystem } from './managed_system';

const source = `
local function capture(n)
	return function(...) return n, ... end
end
return capture(183)
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
export const varargArguments = Array.from({ length: 33 }, (_, i) => valueInteger(i + 74));

export function varargWindowFixture(level: 0 | 3) {
	const romBytes = writeTestBlua32Rom(linkManagedTestSystem(source, level));
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, arena = cpu.heapAllocator;
	runGuestToHalt(cpu, 1_000_000);
	const [value] = runtime.readCompletionValues();
	const closure = valuePayload(value);
	cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
	function grant(cycles: number) {
		const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		return { result, used: cycles - cpu.instructionBudgetRemaining };
	}
	function begin(args: Value[]) {
		cpu.beginCompletionCall(closure, args);
		assert.deepEqual(runtime.readCompletionValues(), []);
		const frame = cpu.activeThread.currentFrame!;
		for (let n = 0; n < 64 && instructionOpcode(memory.readMappedU32LE(frame.pc)) !== OpCode.VARARG; ++n)
			assert.equal(grant(1).result, RunResult.Yielded);
		assert.equal(instructionOpcode(memory.readMappedU32LE(frame.pc)), OpCode.VARARG);
		return frame;
	}
	return { romBytes, runtime, cpu, memory, arena, closure, grant, begin, completion: [valueInteger(183), ...varargArguments] };
}
