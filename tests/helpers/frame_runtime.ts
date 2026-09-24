import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { createTestRuntime } from './runtime_sources';
import { linkRawTestSystemBlua32 } from './blua32';

export function createFrameRuntime() {
	const code = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.RFE, 0, 0, 0, 0);
	const system = linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 1 }, { firstWord: 1, wordCount: 1 }],
		systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name),
		startupFunctionIndex: 0, irqFunctionIndex: 1, exceptionFunctionIndex: 1,
	});
	const runtime = createTestRuntime(system.romBytes);
	runtime.boot();
	return runtime;
}
