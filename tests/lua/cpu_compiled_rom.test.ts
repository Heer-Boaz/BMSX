import assert from 'node:assert/strict';
import { test } from 'node:test';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { valueFloat, valueInteger, type Value } from '../../machine/ts/machine/cpu/value';
import { runCpuParity } from '../helpers/cpu_execution';
import { writeLE32 } from '../../machine/ts/common/endian';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { CompiledCodeLookup } from '../../machine/ts/machine/cpu/compiled_code_lookup';
import { createDecodedInstructionPage } from '../../machine/ts/machine/cpu/execution_image';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import type { CartridgeSocketMediaPair } from '../../machine/ts/machine/devices/cartridge/contracts';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { COP0_EXEC } from '../../machine/ts/spec/blua32/cop0';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_FUNCTION_RECORD_SIZE } from '../../machine/ts/spec/blua32/image_format';
import { BASE_BX_BITS, INSTRUCTION_BYTES, MAX_EXT_BX, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { IO_CART_SELECT } from '../../machine/ts/spec/bmsx/io';
import { CART_RAM_BASE, CART_ROM_BASE, CART_ROM_END, DYNAMIC_RAM_BASE, SYSTEM_ROM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { RAM_CODE_FIXTURE_BYTES, blua32TestFunctionAddress, linkRawTestBlua32Pair, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';

function loadSource(kind: MemoryAccessKind, displaced = false) {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, displaced ? OpCode.LOAD_MEM_D : OpCode.LOAD_MEM, 0, 1, kind, displaced ? 255 : 0);
	writeInstruction(text, 2, OpCode.ADD, 3, 0, 2);
	writeInstruction(text, 3, OpCode.MOV, 5, 3, 0);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	writeInstruction(text, 5, OpCode.HALT, 0, 0, 0);
	return { text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }, { firstWord: 5, wordCount: 1 }], exceptionFunctionIndex: 1 };
}

function machine(systemRom: Uint8Array, slots: CartridgeSocketMediaPair, backend: CpuExecutionBackend) {
	const memory = new Memory({ systemRom, cartridgeSlots: slots }, PSX_MACHINE_SPEC.ramBytes);
	const irq = new IrqController(memory);
	const addresses = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, irq, addresses, backend);
	const scheduler = new DeviceScheduler(cpu);
	const dma = new DmaController(memory, cpu, irq, scheduler);
	memory.cartridgeController.connect(memory, irq, dma);
	cpu.reset();
	return { cpu, memory, addresses };
}

test('the sparse code index preserves page identity, socket banks and unsigned address boundaries', () => {
	const lookup = new CompiledCodeLookup();
	for (const address of [0, 0x003ffc00, 0x00400000, DYNAMIC_RAM_BASE, CART_ROM_BASE, 0xfffffc00]) {
		assert.equal(lookup.find(address, 0), null);
		assert.equal(lookup.find(address, 1), null);
		const first = createDecodedInstructionPage(true, null, 0);
		lookup.install(address, 0, first);
		assert.equal(lookup.find(address + MAPPED_PAGE_BYTE_SIZE - 4, 0), first);
		if (address < CART_ROM_BASE) {
			assert.equal(lookup.find(address, 1), first, 'main memory has no socket-dependent identity');
		} else {
			assert.equal(lookup.find(address, 1), null);
			const second = createDecodedInstructionPage(true, null, 0);
			lookup.install(address, 1, second);
			assert.equal(lookup.find(address, 0), first);
			assert.equal(lookup.find(address, 1), second);
		}
	}
});

for (let format = 0; format <= 5; ++format) for (const displaced of [false, true]) {
	test(`ROM scalar ${format}, displaced ${displaced}: direct reads, tails and every short grant`, () => {
		const image = linkRawTestSystemBlua32(loadSource(format, displaced), RAM_CODE_FIXTURE_BYTES);
		const data = (image.romBytes.byteLength + 3) & ~3;
		const bytes = new Uint8Array(data + 4).subarray(1); bytes.set(image.romBytes);
		bytes.set([0x55, 0x33, 0x11], data);
		const card = new Uint8Array([0xff, 0x55, 0x33, 0x11]).subarray(1);
		const machines = [machine(bytes, cartridgeSlots(card), CpuExecutionBackend.JavaScript),
			machine(bytes, cartridgeSlots(card), CpuExecutionBackend.Interpreter)];
		for (const { cpu } of machines) {
			const frame = cpu.rootThread.frameAtDepth(0);
			frame.registers.setInteger(1, DYNAMIC_RAM_BASE + 0x1000 - (displaced ? 1020 : 0));
			frame.registers.setInteger(2, 1); cpu.runUntilDepth(0, 999);
		}
		const frame = machines[0].cpu.rootThread.frameAtDepth(0), page = frame.decodedPage!;
		const block = page.compiledBlocks!.entries[(image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
		assert.equal(block.sourceWords, 5);
		const probe = new ValueSlots(frame.stackCapacity);
		probe.setInteger(1, 4 - (displaced ? 1020 : 0));
		probe.setInteger(2, 1);
		const run = { remainingCycles: block.admissionCycles + 1, registerTop: frame.top, memoryAddress: 0, stackOffset: 0, stackBytes: 0, lengthWork: { probes: 0 } };
		const exit = block.region.execute(probe, frame.executionImage.constWords, page, frame, block.entry, run);
		assert.equal(block.region.exits[exit].nextPc, image.image.functions[0].codeAddress,
			'a backed system-ROM load and dependent arithmetic do not return through the bus owner');
		for (const address of [4, data, data + 4, CART_ROM_BASE, CART_ROM_BASE + 4]) for (let grant = 1; grant <= 17; ++grant) {
			for (const { cpu } of machines) {
				cpu.rootThread.frameAtDepth(0).registers.setInteger(1, address - (displaced ? 1020 : 0));
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
			}
			runCpuParity(machines[0].cpu, machines[1].cpu, grant);
			assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		}
	});
}

test('ROM replacement, data selection, reset and restore keep a generated RAM entry coherent', () => {
	const source = loadSource(MemoryAccessKind.Word);
	const image = linkRawTestSystemBlua32(source, RAM_CODE_FIXTURE_BYTES);
	const data = (image.romBytes.byteLength + 3) & ~3;
	const bytes = new Uint8Array(data + 16); bytes.set(image.romBytes); writeLE32(bytes, data, 11);
	const slot0 = new Uint8Array(16), slot1 = new Uint8Array(16);
	writeLE32(slot0, 0, 22); writeLE32(slot1, 0, 33);
	const machines = [machine(bytes, cartridgeSlots(slot0, slot1), CpuExecutionBackend.JavaScript),
		machine(bytes, cartridgeSlots(slot0, slot1), CpuExecutionBackend.Interpreter)];
	for (const [index, { cpu, memory }] of machines.entries()) {
		const frame = cpu.rootThread.frameAtDepth(0);
		memory.writeBytes(DYNAMIC_RAM_BASE, source.text);
		frame.registers.setInteger(1, data); frame.registers.setInteger(2, 1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 999);
		const page = frame.decodedPage!, block = index === 0 ? page.compiledBlocks!.entries[0] : null;
		if (index === 0) assert.ok(block);
		const replacement = new Uint8Array(bytes.byteLength + 17).subarray(17);
		replacement.set(bytes); writeLE32(replacement, data, 44);
		memory.installSystemRom(replacement); cpu.runUntilDepth(0, 9);
		assert.equal(frame.registers.get(0), valueInteger(44));
		if (index === 0) assert.equal(page.compiledBlocks!.entries[0], block);
		frame.registers.setInteger(1, CART_ROM_BASE);
		for (const select of [0xfffffffe, 0xffffffff, 0, 1]) {
			memory.writeMappedWord(IO_CART_SELECT, select); cpu.runUntilDepth(0, 9);
			assert.equal(frame.registers.get(0), valueInteger((select & 1) === 0 ? 22 : 33));
		}
		writeLE32(replacement, data, 55);
		memory.cartridgeController.installRom(1, replacement.subarray(data, data + 16)); cpu.runUntilDepth(0, 9);
		assert.equal(frame.registers.get(0), valueInteger(55));
		if (index === 0) assert.equal(page.compiledBlocks!.entries[0], block);
		const saved = memory.cartridgeController.captureState();
		memory.cartridgeController.reset(); cpu.runUntilDepth(0, 9); assert.equal(frame.registers.get(0), valueInteger(22));
		memory.cartridgeController.restoreState(saved); cpu.runUntilDepth(0, 9); assert.equal(frame.registers.get(0), valueInteger(55));
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

test('an empty ROM bus does not hide F64 cross-region reads or high-half faults', () => {
	const image = linkRawTestSystemBlua32(loadSource(MemoryAccessKind.F64LE), RAM_CODE_FIXTURE_BYTES);
	const slots: CartridgeSocketMediaPair = [{ rom: null, ramByteCount: 8, mailboxPresent: false }, null];
	const machines = [machine(image.romBytes, slots, CpuExecutionBackend.JavaScript), machine(image.romBytes, slots, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(1, CART_ROM_BASE); frame.registers.setInteger(2, 1);
		cpu.runUntilDepth(0, 999); assert.equal(frame.registers.get(0), valueFloat(0));
		memory.writeMappedWord(IO_CART_SELECT, 1); cpu.runUntilDepth(0, 9); assert.equal(frame.registers.get(0), valueFloat(0));
		memory.writeMappedWord(IO_CART_SELECT, 0); memory.writeMappedWord(CART_RAM_BASE, 0x3ff00000);
		frame.registers.setInteger(1, CART_ROM_END - 4); cpu.runUntilDepth(0, 9);
		assert.equal(frame.registers.get(0), valueFloat(1), 'the high word comes from cartridge RAM, not ROM padding');
		frame.registers.setInteger(0, 73); frame.registers.setInteger(1, SYSTEM_ROM_SIZE - 4); frame.top = 0;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
		assert.equal(frame.registers.get(0), valueInteger(73)); assert.equal(frame.top, 0);
		assert.equal(cpu.captureRuntimeState().epcWord, image.image.functions[0].codeAddress);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

test('data SELECT does not change the physical socket supplying executable instructions', () => {
	const source0 = loadSource(MemoryAccessKind.Word), source1 = loadSource(MemoryAccessKind.Word);
	writeInstruction(source1.text, 1, OpCode.K0, 0, 0, 0);
	const text = new Uint8Array(16);
	writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(text, 1, OpCode.LOAD_MEM, 0, 0, MemoryAccessKind.Word);
	writeInstruction(text, 2, OpCode.MTC0, 0, COP0_EXEC, 0);
	writeInstruction(text, 3, OpCode.HALT, 0, 0, 0);
	const launcher = { text, constants: [integerConstant(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET)],
		functions: [{ firstWord: 0, wordCount: 3 }, { firstWord: 3, wordCount: 1 }], exceptionFunctionIndex: 1 };
	const pair0 = linkRawTestBlua32Pair(launcher, source0, RAM_CODE_FIXTURE_BYTES), pair1 = linkRawTestBlua32Pair(launcher, source1, RAM_CODE_FIXTURE_BYTES);
	const data = (Math.max(pair0.cartRomBytes.byteLength, pair1.cartRomBytes.byteLength) + 3) & ~3;
	const cart0 = new Uint8Array(data + 16), cart1 = new Uint8Array(data + 16);
	cart0.set(pair0.cartRomBytes); cart1.set(pair1.cartRomBytes); writeLE32(cart0, data, 22); writeLE32(cart1, data, 33);
	for (const backend of [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter]) {
		const { cpu, memory } = machine(pair0.systemRomBytes, cartridgeSlots(cart0, cart1), backend);
		// Enter through CP0.EXEC, establishing socket 0 before any cartridge fetch.
		cpu.runUntilDepth(0, 7);
		const frame = cpu.rootThread.frameAtDepth(0);
		assert.equal(frame.executionImage.executionDomainId, 0);
		assert.equal(frame.pc, pair0.cartImage.functions[0].codeAddress);
		frame.registers.setInteger(1, CART_ROM_BASE + data); frame.registers.setInteger(2, 1);
		memory.writeMappedWord(IO_CART_SELECT, 1);
		cpu.runUntilDepth(0, 999);
		assert.equal(frame.registers.get(0), valueInteger(33), 'even the first instruction fetch uses the execution socket');
		for (const select of [0, 1, 0xfffffffe, 0xffffffff]) {
			memory.writeMappedWord(IO_CART_SELECT, select); cpu.runUntilDepth(0, 9);
			assert.equal(frame.registers.get(0), valueInteger((select & 1) === 0 ? 22 : 33));
			assert.equal(frame.executionImage.executionDomainId, 0);
		}
	}
});

test('a cached instruction binding follows SELECT when EXEC has not overridden its chip select', () => {
	const text = new Uint8Array(4); writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 2 }] }, RAM_CODE_FIXTURE_BYTES);
	const cards = [new Uint8Array(MAPPED_PAGE_BYTE_SIZE), new Uint8Array(MAPPED_PAGE_BYTE_SIZE)];
	for (let slot = 0; slot < 2; ++slot) {
		writeInstruction(cards[slot], 0, slot === 0 ? OpCode.K1 : OpCode.K0, 0, 0, 0);
		writeInstruction(cards[slot], 1, OpCode.MOV, 1, 0, 0);
		writeInstruction(cards[slot], 2, OpCode.JMP, 0, 63, 61, 255);
	}
	for (const backend of [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter]) {
		const { cpu, memory } = machine(image.romBytes, cartridgeSlots(cards[0], cards[1]), backend);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], CART_ROM_BASE);
		assert.equal(cpu.runUntilDepth(0, 768), RunResult.Yielded); assert.equal(cpu.readFramePc(0), CART_ROM_BASE);
		const frame = cpu.rootThread.frameAtDepth(0), firstPage = frame.decodedPage;
		for (const select of [1, 0xfffffffe, 0xffffffff, 0]) {
			memory.writeMappedWord(IO_CART_SELECT, select);
			assert.equal(cpu.runUntilDepth(0, 768), RunResult.Yielded);
			assert.equal(frame.registers.get(1), valueInteger((select & 1) === 0 ? 1 : 0));
			if ((select & 1) === 0) assert.equal(frame.decodedPage, firstPage, 'physical code is retained, not retired by a bus-selection change');
		}
	}
});

test('warm continuations resolve the live instruction socket after an in-block MMIO mux write', () => {
	const text = new Uint8Array(4); writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 8 }] }, RAM_CODE_FIXTURE_BYTES);
	const cards = [new Uint8Array(2 * MAPPED_PAGE_BYTE_SIZE), new Uint8Array(2 * MAPPED_PAGE_BYTE_SIZE)];
	const second = MAPPED_PAGE_BYTE_SIZE / 4;
	for (let slot = 0; slot < 2; ++slot) {
		writeInstruction(cards[slot], 0, slot === 0 ? OpCode.K1 : OpCode.K0, 0, 0, 0);
		writeInstruction(cards[slot], 1, OpCode.JMP, 0, 3, 62); // next page, +254 words
		writeInstruction(cards[slot], second, OpCode.MOV, 3, 0, 0);
		writeInstruction(cards[slot], second + 1, OpCode.STORE_MEM, 4, 2, MemoryAccessKind.Word);
		writeInstruction(cards[slot], second + 2, slot === 0 ? OpCode.K1 : OpCode.K0, 5, 0, 0);
		writeInstruction(cards[slot], second + 3, OpCode.MOV, 6, 5, 0);
		writeInstruction(cards[slot], second + 4, OpCode.JMP, 0, 59, 59, 255); // first page, -261 words
	}
	const machines = [machine(image.romBytes, cartridgeSlots(cards[0], cards[1]), CpuExecutionBackend.JavaScript),
		machine(image.romBytes, cartridgeSlots(cards[0], cards[1]), CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(2, IO_CART_SELECT);
		for (const slot of [0, 1]) {
			memory.writeMappedWord(IO_CART_SELECT, slot); frame.registers.setInteger(4, slot);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], CART_ROM_BASE);
			cpu.runUntilDepth(0, 10000);
		}
	}
	const lookup = machines[0].cpu.rootThread.frameAtDepth(0).executionImage.compiledCodeLookup!;
	for (const slot of [0, 1]) assert.ok(lookup.find(CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE, slot)!.compiledBlocks!.entries[2]);
	for (const slot of [0, 1, 1, 0]) {
		for (const { cpu, memory } of machines) {
			const frame = cpu.rootThread.frameAtDepth(0);
			memory.writeMappedWord(IO_CART_SELECT, slot);
			frame.registers.setInteger(0, 1 - slot); frame.registers.setInteger(4, slot ^ 1);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE);
			assert.equal(cpu.runUntilDepth(0, 11), RunResult.Yielded);
			assert.equal(frame.registers.get(3), valueInteger(1 - slot));
			assert.equal(frame.registers.get(6), valueInteger(slot), 'the first instruction after the mux write comes from the newly selected ROM');
			assert.equal(frame.pc, CART_ROM_BASE); assert.equal(cpu.instructionBudgetRemaining, 0);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	// Replace a hot physical ROM without replacing the decoded-page owner.
	const page = lookup.find(CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE, 1)!;
	const replacement = cards[1].slice(); writeInstruction(replacement, second + 2, OpCode.KSMI, 5, 0, 7);
	for (const { cpu, memory } of machines) {
		memory.cartridgeController.installRom(1, replacement); memory.writeMappedWord(IO_CART_SELECT, 1);
		const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(4, 1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE);
		cpu.runUntilDepth(0, 11); assert.equal(frame.registers.get(6), valueInteger(7));
	}
	assert.equal(lookup.find(CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE, 1), page);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

for (const cartridgeBound of [false, true]) test(`cross-page links follow the instruction chip select (cartridgeBound=${cartridgeBound})`, () => {
	const launcherText = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(launcherText, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(launcherText, 1, OpCode.LOAD_MEM, 0, 0, MemoryAccessKind.Word);
	writeInstruction(launcherText, 2, OpCode.MTC0, 0, COP0_EXEC, 0);
	writeInstruction(launcherText, 3, OpCode.HALT, 0, 0, 0);
	const launcher = { text: launcherText, constants: [integerConstant(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET)],
		functions: [{ firstWord: 0, wordCount: 3, maxStack: 8 }, { firstWord: 3, wordCount: 1 }], exceptionFunctionIndex: 1 };
	const text = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.KSMI, 3, 0, 11); writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 0, 0);
	const pair = linkRawTestBlua32Pair(launcher, { text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 8 }] }, RAM_CODE_FIXTURE_BYTES);
	const cardPc = pair.cartImage.functions[0].codeAddress, cardWord = (cardPc - CART_ROM_BASE) / INSTRUCTION_BYTES;
	const cards = [new Uint8Array(MAPPED_PAGE_BYTE_SIZE), new Uint8Array(MAPPED_PAGE_BYTE_SIZE)];
	const back = ((DYNAMIC_RAM_BASE - (cardPc + 3 * INSTRUCTION_BYTES)) >>> 2) & MAX_EXT_BX;
	for (let slot = 0; slot < 2; ++slot) {
		cards[slot].set(pair.cartRomBytes);
		writeInstruction(cards[slot], cardWord, OpCode.KSMI, 3, 0, slot === 0 ? 11 : 22);
		writeInstruction(cards[slot], cardWord + 1, OpCode.WIDE, 0, back >>> BASE_BX_BITS, 0);
		writeInstruction(cards[slot], cardWord + 2, OpCode.JMP, 0, (back >>> 6) & 63, back & 63, (back >>> 12) & 255);
	}
	const ram = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(ram, 0, OpCode.LOAD_MEM, 0, 5, MemoryAccessKind.Word); writeInstruction(ram, 1, OpCode.MOV, 2, 0, 0);
	const forward = (cardPc - (DYNAMIC_RAM_BASE + 4 * INSTRUCTION_BYTES)) >>> 2;
	writeInstruction(ram, 2, OpCode.WIDE, 0, forward >>> BASE_BX_BITS, 0);
	writeInstruction(ram, 3, OpCode.JMP, 0, (forward >>> 6) & 63, forward & 63, (forward >>> 12) & 255);
	const machines = [machine(pair.systemRomBytes, cartridgeSlots(cards[0], cards[1]), CpuExecutionBackend.JavaScript),
		machine(pair.systemRomBytes, cartridgeSlots(cards[0], cards[1]), CpuExecutionBackend.Interpreter)];
	const domain = cartridgeBound ? 0 : SYSTEM_EXECUTION_DOMAIN_ID;
	const functionAddress = cartridgeBound ? pair.cartSymbols.functionAddresses[0] : pair.systemSymbols.functionAddresses[0];
	for (const { cpu, memory } of machines) {
		if (cartridgeBound) cpu.runUntilDepth(0, 7);
		memory.writeBytes(DYNAMIC_RAM_BASE, ram);
		const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(5, IO_CART_SELECT); frame.registers.setInteger(4, 73);
		for (const slot of [0, 1]) {
			memory.writeMappedWord(IO_CART_SELECT, slot); cpu.writeFrameExecution(0, domain, functionAddress, DYNAMIC_RAM_BASE);
			cpu.runUntilDepth(0, 1200);
		}
	}
	const lookup = machines[0].cpu.rootThread.frameAtDepth(0).executionImage.compiledCodeLookup!;
	const shared = lookup.find(DYNAMIC_RAM_BASE, 0)!.compiledBlocks!.entries[1]!;
	assert.ok(shared); assert.equal(shared.terminal.linkedBlock !== null, cartridgeBound,
		'a RAM-to-cartridge edge links only when execution has pinned the physical instruction socket');
	const returns = [0, ...(cartridgeBound ? [] : [1])].map(slot => {
		const block = lookup.find(cardPc, slot)!.compiledBlocks!.entries[(cardPc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
		assert.ok(block); assert.equal(block.terminal.linkedBlock, lookup.find(DYNAMIC_RAM_BASE, 0)!.compiledBlocks!.entries[0]);
		return block;
	});
	for (const select of [0, 1, 0xffffffff, 0xfffffffe, 1]) {
		for (const { cpu, memory } of machines) {
			memory.writeMappedWord(IO_CART_SELECT, select); cpu.writeFrameExecution(0, domain, functionAddress, DYNAMIC_RAM_BASE);
			assert.equal(cpu.runUntilDepth(0, 11), RunResult.Yielded);
			const frame = cpu.rootThread.frameAtDepth(0);
			assert.equal(frame.registers.get(0), valueInteger(select)); assert.equal(frame.registers.get(2), valueInteger(select));
			assert.equal(frame.registers.get(3), valueInteger(!cartridgeBound && (select & 1) !== 0 ? 22 : 11));
			assert.equal(frame.pc, DYNAMIC_RAM_BASE); assert.equal(cpu.instructionBudgetRemaining, 0);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	const replacement = new Uint8Array(INSTRUCTION_BYTES); writeInstruction(replacement, 0, OpCode.MOV, 0, 4, 0);
	for (const { memory } of machines) memory.writeBytes(DYNAMIC_RAM_BASE, replacement);
	for (const block of returns) assert.equal(block.terminal.linkedBlock, null, 'rewriting shared RAM unlinks incoming edges from every socket');
	for (const { cpu } of machines) {
		cpu.writeFrameExecution(0, domain, functionAddress, DYNAMIC_RAM_BASE); cpu.runUntilDepth(0, 1200);
		assert.equal(cpu.rootThread.frameAtDepth(0).registers.get(0), valueInteger(73));
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

for (const ramRecord of [false, true]) {
	test(ramRecord ? 'a system caller binds a RAM function record to the system image'
		: 'warm cartridge calls read function records through EXEC rather than data SELECT', () => {
		const record = DYNAMIC_RAM_BASE + 0x4000, code = record + 0x800;
		const systemText = new Uint8Array(11 * INSTRUCTION_BYTES);
		writeInstruction(systemText, 0, OpCode.LOADK, 0, 0, 0);
		writeInstruction(systemText, 1, OpCode.LOAD_MEM, 0, 0, MemoryAccessKind.Word);
		writeInstruction(systemText, 2, OpCode.MTC0, 0, COP0_EXEC, 0);
		writeInstruction(systemText, 3, OpCode.WIDE, 0, 0, 0);
		writeInstruction(systemText, 4, OpCode.CLOSURE, 4, 0, 0);
		writeInstruction(systemText, 5, OpCode.MOV, 0, 4, 0);
		writeInstruction(systemText, 6, OpCode.CALL, 0, 1, 2);
		writeInstruction(systemText, 7, OpCode.RET, 0, 2, 0);
		writeInstruction(systemText, 8, OpCode.HALT, 0, 0, 0);
		writeInstruction(systemText, 9, OpCode.LOADK, 0, 0, 1);
		writeInstruction(systemText, 10, OpCode.RET, 0, 2, 0);
		const system = { text: systemText, functions: [
			{ firstWord: 0, wordCount: 3, maxStack: 8 },
			{ firstWord: 3, wordCount: 5, maxStack: 8 },
			{ firstWord: 8, wordCount: 1 }, { firstWord: 9, wordCount: 2, maxStack: 8 },
		], constants: [integerConstant(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET), integerConstant(11)],
			exceptionFunctionIndex: 2, closureRelocations: [{ wordIndex: 4, functionAddress: record }] };
		const text = new Uint8Array(10 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 1, OpCode.CLOSURE, 4, 0, 0);
		writeInstruction(text, 2, OpCode.MOV, 0, 4, 0);
		writeInstruction(text, 3, OpCode.CALL, 0, 1, 2);
		writeInstruction(text, 4, OpCode.MOV, 3, 0, 0);
		writeInstruction(text, 5, OpCode.JMP, 0, 63, 60, 255);
		writeInstruction(text, 6, OpCode.LOADK, 0, 0, 1);
		writeInstruction(text, 7, OpCode.RET, 0, 2, 0);
		writeInstruction(text, 8, OpCode.LOADK, 0, 0, 2);
		writeInstruction(text, 9, OpCode.RET, 0, 2, 0);
		const source = { text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 8 },
			{ firstWord: 6, wordCount: 2, maxStack: 8 }, { firstWord: 8, wordCount: 2, maxStack: 8 }],
			constants: [integerConstant(0), integerConstant(22), integerConstant(44)], closureRelocations: [{ wordIndex: 1,
				functionAddress: blua32TestFunctionAddress(ramRecord ? 0 : CART_ROM_BASE, 1) }] };
		const pair = linkRawTestBlua32Pair(system, source, RAM_CODE_FIXTURE_BYTES);
		const other = linkRawTestBlua32Pair(system, { ...source, constants: [integerConstant(0), integerConstant(33), integerConstant(55)] }, RAM_CODE_FIXTURE_BYTES);
		const otherRecord = other.cartSymbols.functionAddresses[1] - CART_ROM_BASE;
		writeLE32(other.cartRomBytes, otherRecord + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, other.cartImage.functions[2].codeAddress);
		writeLE32(other.cartRomBytes, otherRecord + BLUA32_FUNCTION_MAX_STACK_OFFSET, 12);
		const machines = [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter].map(backend =>
			machine(pair.systemRomBytes, cartridgeSlots(pair.cartRomBytes, other.cartRomBytes), backend));
		for (const { cpu, memory } of machines) {
			const template = pair.systemSymbols.functionAddresses[3];
			memory.writeBytes(record, pair.systemRomBytes.subarray(template, template + BLUA32_FUNCTION_RECORD_SIZE));
			memory.writeMappedU32LE(record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, code);
			memory.writeBytes(code, systemText.subarray(9 * INSTRUCTION_BYTES));
			assert.equal(cpu.runUntilDepth(0, 7), RunResult.Yielded);
			assert.equal(cpu.readFrameExecutionDomain(0), 0, 'EXEC establishes socket 0 before SELECT changes');
			memory.writeMappedWord(IO_CART_SELECT, 1);
			assert.equal(memory.readMappedU32LE(pair.cartSymbols.functionAddresses[1]), other.cartImage.functions[2].codeAddress,
				'ordinary data reads see the different record fitted to socket 1');
		}
		runCpuParity(machines[0].cpu, machines[1].cpu, 20000);
		runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
		const entry = pair.cartImage.functions[0].codeAddress + 2 * INSTRUCTION_BYTES;
		for (const { cpu } of machines) {
			assert.equal(cpu.rootThread.frameAtDepth(0).registers.get(3), valueInteger(ramRecord ? 11 : 22));
			cpu.writeFrameExecution(0, 0, pair.cartSymbols.functionAddresses[0], entry);
		}
		const root = machines[0].cpu.rootThread.frameAtDepth(0);
		assert.ok(root.executionImage.compiledCodeLookup!.find(entry, 0)!.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2],
			'the repeated caller has a generated entry');
		for (let grant = 1; grant <= 128; ++grant) {
			runCpuParity(machines[0].cpu, machines[1].cpu, grant);
			assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
			assert.equal(machines[0].cpu.rootThread.frameAtDepth(0).registers.get(3), valueInteger(ramRecord ? 11 : 22));
		}
		runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
		for (const { cpu } of machines) cpu.writeFrameExecution(0, 0, pair.cartSymbols.functionAddresses[0], entry);
		runCpuParity(machines[0].cpu, machines[1].cpu, 3);
		if (ramRecord) {
			assert.equal(machines[0].cpu.readFrameExecutionDomain(1), SYSTEM_EXECUTION_DOMAIN_ID);
			const relay = machines[0].cpu.rootThread.frameAtDepth(1);
			const relayEntry = pair.systemImage.functions[1].codeAddress + 2 * INSTRUCTION_BYTES;
			assert.ok(relay.executionImage.compiledCodeLookup!.find(relayEntry, 0)!.compiledBlocks!.entries[(relayEntry & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2],
				'the system relay is also generated');
			for (let step = 0; step < 8 && machines[0].cpu.getFrameDepth() !== 3; ++step) runCpuParity(machines[0].cpu, machines[1].cpu, 1);
		}
		assert.equal(machines[0].cpu.getFrameDepth(), ramRecord ? 3 : 2);
		const callee = machines[0].cpu.rootThread.currentFrame!;
		assert.equal(callee.executionImage.executionDomainId, ramRecord ? SYSTEM_EXECUTION_DOMAIN_ID : 0, 'the callee uses the domain bound at closure creation');
		assert.equal(callee.stackCapacity, 8, 'CALL consumes the execution-socket record, not SELECT metadata');
		assert.equal(callee.pc, ramRecord ? code : pair.cartImage.functions[1].codeAddress);
		assert.ok(callee.executionImage.compiledCodeLookup!.find(callee.pc, 0)!.compiledBlocks!.entries[(callee.pc & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2],
			'the callee body is generated as well as its caller');
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
		for (const { cpu } of machines) assert.equal(cpu.rootThread.frameAtDepth(0).registers.get(0), valueInteger(ramRecord ? 11 : 22),
			'the result uses the constants of the closure-bound execution image');
	});
}

test('closure records bind their selected socket and survive cross-domain calls and snapshot restore', () => {
	const launcherText = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(launcherText, 0, OpCode.WIDE, 0, 0, 32);
	writeInstruction(launcherText, 1, OpCode.CLOSURE, 0, 0, 1);
	writeInstruction(launcherText, 2, OpCode.JMP, 0, 63, 63, 255);
	writeInstruction(launcherText, 3, OpCode.HALT, 0, 0, 0);
	const cartText = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(cartText, 0, OpCode.KSMI, 0, 0, 11);
	writeInstruction(cartText, 1, OpCode.RET, 0, 2, 0);
	writeInstruction(cartText, 2, OpCode.KSMI, 0, 0, 22);
	writeInstruction(cartText, 3, OpCode.RET, 0, 2, 0);
	const pair = linkRawTestBlua32Pair(
		{ text: launcherText, functions: [{ firstWord: 0, wordCount: 3, maxStack: 2 }, { firstWord: 3, wordCount: 1 }], exceptionFunctionIndex: 1 },
		{ text: cartText, functions: [{ firstWord: 0, wordCount: 2, maxStack: 1 }, { firstWord: 2, wordCount: 2, maxStack: 1 }] }, RAM_CODE_FIXTURE_BYTES,
	);
	const cards = [pair.cartRomBytes.slice(), pair.cartRomBytes.slice()];
	writeInstruction(cards[1], (pair.cartImage.functions[0].codeAddress - CART_ROM_BASE) / INSTRUCTION_BYTES, OpCode.KSMI, 0, 0, 55);
	writeInstruction(cards[0], (pair.cartImage.functions[1].codeAddress - CART_ROM_BASE) / INSTRUCTION_BYTES, OpCode.KSMI, 0, 0, 77);
	const record = pair.cartSymbols.functionAddresses[0];
	writeLE32(cards[1], record - CART_ROM_BASE + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, pair.cartImage.functions[1].codeAddress);
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu, memory } = machine(pair.systemRomBytes, cartridgeSlots(cards[0], cards[1]), backend);
		const frame = cpu.rootThread.frameAtDepth(0);
		const entry = pair.systemImage.functions[0].codeAddress;
		const closures = [];
		for (const slot of [0, 1]) {
			memory.writeMappedWord(IO_CART_SELECT, slot);
			frame.registers.setInteger(1, record);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, pair.systemSymbols.functionAddresses[0], entry);
			cpu.runUntilDepth(0, 2);
			closures.push(frame.registers.getClosure(0, cpu.gc));
		}
		assert.notEqual(closures[0], closures[1]);
		assert.equal(closures[0].prototypeRecord.executionDomainId, 0);
		assert.equal(closures[1].prototypeRecord.executionDomainId, 1);
		assert.equal(closures[0].prototypeRecord.codeAddress, pair.cartImage.functions[0].codeAddress);
		assert.equal(closures[1].prototypeRecord.codeAddress, pair.cartImage.functions[1].codeAddress);
		frame.registers.setClosure(0, cpu.gc.reference(closures[0]));
		frame.registers.setClosure(1, cpu.gc.reference(closures[1]));
		const state = cpu.captureRuntimeState();
		cpu.restoreRuntimeState(state);
		for (const slot of [0, 1]) {
			memory.writeMappedWord(IO_CART_SELECT, 1 - slot);
			const closure = cpu.rootThread.frameAtDepth(0).registers.getClosure(slot, cpu.gc);
			cpu.beginCompletionCall(closure);
			cpu.runUntilDepth(1, 100);
			const result: Value[] = [];
			cpu.readCompletionValues(result);
			assert.deepEqual(result, [valueInteger(slot === 0 ? 11 : 22)]);
		}
	}
});
