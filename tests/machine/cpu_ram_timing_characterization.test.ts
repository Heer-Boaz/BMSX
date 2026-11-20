import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueFloat, valueInteger } from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

// Pairs with hardware/tests/dma_controller_memory_integration_tb.sv. This
// measures runtime instruction charges, not DRAM clocks or host execution time.
// The RTL producer is a bus client, not an implemented CPU, so its elapsed
// clocks must not be asserted as instruction prices here.
test('characterize current public RAM charges for scalar and counted accesses', () => {
	const reference = new Map<string, number>();
	const report = (backend: CpuExecutionBackend, workload: string, cycles: number) => {
		if (backend === CpuExecutionBackend.Interpreter) reference.set(workload, cycles);
		else assert.equal(cycles, reference.get(workload), `generated accounting: ${workload}`);
		const mode = backend === CpuExecutionBackend.Interpreter ? 'interpreter' : 'js_compilation_enabled';
		console.log(`RAM_CHARACTERIZE candidate=runtime backend=${mode} ${workload} guest_cycles=${cycles}`);
	};
	for (const backend of [CpuExecutionBackend.Interpreter]) {
		for (const count of [0, 1, 4, 16, 256]) {
			const text = new Uint8Array(3 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, OpCode.WIDE, 0, 0, count >> 9);
			writeInstruction(text, 1, OpCode.STORE_MEM_WORDS, 8, 0, count & 63, (count >> 6) & 7);
			writeInstruction(text, 2, OpCode.HALT, 0, 0, 0);
			const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 8 + count }] }, 4 * Math.max(count, 1));
			const { cpu, memory } = createTestSystemCpu(image, backend);
			const address = image.image.header.bssAddress;
			const registers = cpu.rootThread.frameAtDepth(0).registers;
			registers.setInteger(0, address);
			for (let i = 0; i < count; ++i) registers.setInteger(8 + i, 0xcafe0000 + i);
			let cycles = 0;
			for (let i = 0; i < 12; ++i) {
				for (let word = 0; word < Math.max(count, 1); ++word) memory.writeMappedU32LE(address + 4 * word, 0xa5a5a5a5);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
				cpu.runUntilDepth(0, 1);
				cycles = 1 - cpu.instructionBudgetRemaining;
				for (let word = 0; word < count; ++word) assert.equal(memory.readMappedU32LE(address + 4 * word), 0xcafe0000 + word);
				if (count === 0) assert.equal(memory.readMappedU32LE(address), 0xa5a5a5a5);
			}
			if (backend === CpuExecutionBackend.JavaScript) {
				const pc = image.image.functions[0].codeAddress;
				assert.ok(cpu.rootThread.frameAtDepth(0).decodedPage?.compiledBlocks?.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]);
			}
			report(backend, `workload=cpu_counted_u32_write words=${count}`, cycles);
		}
		for (const op of [OpCode.STORE_MEM, OpCode.LOAD_MEM]) for (const kind of [MemoryAccessKind.U8, MemoryAccessKind.U16LE, MemoryAccessKind.U32LE, MemoryAccessKind.F64LE]) {
			const text = new Uint8Array(2 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, op, 1, 0, kind);
			writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
			const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 2 }] }, 8);
			const { cpu, memory } = createTestSystemCpu(image, backend);
			const address = image.image.header.bssAddress;
			const registers = cpu.rootThread.frameAtDepth(0).registers;
			registers.setInteger(0, address); registers.setInteger(1, 17);
			let cycles = 0;
			for (let i = 0; i < 12; ++i) {
				if (op === OpCode.LOAD_MEM) {
					registers.setInteger(1, -123);
					if (kind === MemoryAccessKind.F64LE) memory.writeMappedF64LE(address, 17);
					else memory.writeMappedU32LE(address, 17);
				} else {
					registers.setInteger(1, 17);
					memory.writeMappedU32LE(address, 0xa5a5a5a5);
					memory.writeMappedU32LE(address + 4, 0xa5a5a5a5);
				}
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
				cpu.runUntilDepth(0, 1);
				cycles = 1 - cpu.instructionBudgetRemaining;
				if (op === OpCode.LOAD_MEM) assert.equal(registers.get(1), kind === MemoryAccessKind.F64LE ? valueFloat(17) : valueInteger(17));
				else if (kind === MemoryAccessKind.F64LE) {
					assert.equal(memory.readMappedF64LE(address), 17);
					assert.equal(memory.readMappedU32LE(address), 0);
					assert.equal(memory.readMappedU32LE(address + 4), 0x40310000);
				} else {
					const expected = kind === MemoryAccessKind.U8 ? 0xa5a5a511 : kind === MemoryAccessKind.U16LE ? 0xa5a50011 : 17;
					assert.equal(memory.readMappedU32LE(address), expected);
					assert.equal(memory.readMappedU32LE(address + 4), 0xa5a5a5a5);
				}
			}
			if (backend === CpuExecutionBackend.JavaScript) {
				const pc = image.image.functions[0].codeAddress;
				assert.ok(cpu.rootThread.frameAtDepth(0).decodedPage?.compiledBlocks?.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]);
			}
			report(backend, `workload=cpu_scalar_${op === OpCode.STORE_MEM ? 'write' : 'read'} kind=${kind}`, cycles);
		}
	}
});
