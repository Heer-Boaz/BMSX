import assert from 'node:assert/strict';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { IO_SYS_CONTROL, IO_SYS_SUPERVISOR_FAULT_SEQUENCE, SYS_CONTROL_SUPERVISOR_FAULT, SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH } from '../../machine/ts/spec/bmsx/io';
import { parseLuaChunk } from '../lua/cpu_test_harness';

// Minimal test firmware: the CPU raises the exception; the real system device
// publishes its CP0 latches. No host Error or fabricated guest diagnostic.
const source = `raise_fault = __bmsx_error
local control<const>: *word = ${IO_SYS_CONTROL}
function exception(error_value)
	*control = ${SYS_CONTROL_SUPERVISOR_FAULT | SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH}
	halt_until_irq
end
return true`;

export const SUPERVISOR_FAULT_MODULE = {
	path: 'supervisor_fault', source, chunk: parseLuaChunk(source, 'supervisor_fault'),
};

export function runToSupervisorFault(runtime: Runtime): void {
	const cpu = runtime.machine.cpu;
	const sequence = runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE);
	for (let grant = 0; grant < 100 && runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) === sequence; grant++) {
		cpu.runUntilDepth(0, 10_000);
	}
	assert.equal(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), sequence + 1);
	assert.ok(cpu.readExceptionReturnFrameDepth() >= 0);
}
