import assert from 'node:assert/strict';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueInteger, valuePayload, ValueTag, valueTag } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_PREPARED_FRAME_OFFSET, PreparedWindowField } from '../../machine/ts/spec/bmsx/heap_service';
import { instructionOpcode } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkTestSystemBlua32 } from './blua32';
import { compileHeapServiceSystem } from './heap_service_system';

const numbers = Array.from({ length: 65 }, (_, i) => i + 10);
// Open returns through a short receiving window at a nonzero stack base.
// The source fits the current backing, but the receiver's rounded window does not.
const program = `
local function leaf()
	local marker = 183
	local capture = function() return marker end
	return ${numbers.join(', ')}, capture
end
local function relay(f) return f() end
local function call(f, ...) return relay(f) end
return 37, call(leaf)
`;

export function returnWindowFixture(level: 0 | 3) {
	const linked = linkTestSystemBlua32(compileHeapServiceSystem(program, level));
	const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, arena = cpu.heapAllocator;
	const management = arena.managementOffset();
	function grant(cycles: number) {
		const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		return { result, used: cycles - cpu.instructionBudgetRemaining };
	}
	function atLeafRet() {
		if (cpu.heapServiceActive()) return false;
		const frame = cpu.activeThread.currentFrame;
		return frame !== null && frame.previous !== null && frame.top >= numbers.length + 1 && frame.previous.stackCapacity <= 8
			&& instructionOpcode(memory.readMappedU32LE(frame.pc)) === OpCode.RET;
	}
	for (let n = 0; n < 65_536 && !atLeafRet(); ++n)
		assert.equal(grant(cpu.heapServiceActive() ? 256 : 1).result, RunResult.Yielded);
	assert.ok(atLeafRet());
	cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
	const thread = cpu.activeThread, callee = thread.currentFrame!, caller = callee.previous!;
	const issue = callee.pc;
	const ret = decodeBlua32InstructionAtPc(linked.image.textBytes, linked.image.header.textAddress, issue);
	const first = ret.a, expected = numbers.map(valueInteger);
	const edge = callee.registers.get(first + expected.length);
	assert.equal(valueTag(edge), ValueTag.Closure);
	expected.push(edge);
	return {
		linked, runtime, cpu, memory, arena, management, thread, callee, caller, issue, first, expected, edge, closure: valuePayload(edge), grant,
		flags: () => memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Flags),
		prepared: (field: PreparedWindowField) => memory.readRamRecordWord(management + HEAP_SERVICE_PREPARED_FRAME_OFFSET + field),
		completion: [valueInteger(37), ...expected],
	};
}
