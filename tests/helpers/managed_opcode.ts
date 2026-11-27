import { reserveThreadFrameReference } from './thread_allocation_reference';
import type { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { linkRawTestSystemBlua32, type TestBlua32Source } from './blua32';
import { createTestHeapServiceCpu } from './heap_service_system';

/** The exact subject stays in the instruction stream but is not the reset vector. */
export function linkManagedTestOpcodes(source: TestBlua32Source, bssByteCount = 0) {
	const firstWord = source.text.length / INSTRUCTION_BYTES;
	const text = new Uint8Array(source.text.length + INSTRUCTION_BYTES);
	text.set(source.text);
	writeInstruction(text, firstWord, OpCode.RET, 0, 1, 0);
	const image = linkRawTestSystemBlua32({
		...source, text,
		functions: [...source.functions, { firstWord, wordCount: 1 }],
		startupFunctionIndex: source.functions.length,
	}, bssByteCount);
	return { ...image, subject: image.image.functions[source.startupFunctionIndex ?? 0] };
}

/** Seed the original managed activation without fitting it in the physical reset bank. */
export function createManagedTestOpcodeCpu(image: ReturnType<typeof linkManagedTestOpcodes>, backend: CpuExecutionBackend) {
	const machine = createTestHeapServiceCpu(image, backend);
	const thread = machine.cpu.rootThread, { subject } = image;
	const capacity = Math.max(1, subject.numParams, subject.maxStack);
	const backing = Math.max(8, 1 << (32 - Math.clz32(capacity - 1)));
	reserveThreadFrameReference(machine.cpu, thread, backing);
	thread.currentFrame!.initializeControl(subject.address, subject.codeAddress, subject.codeAddress, false,
		SYSTEM_EXECUTION_DOMAIN_ID, subject.numParams, 0, 0, 0, subject.numParams, 0, 0, capacity);
	thread.stackTop = capacity;
	return machine;
}
