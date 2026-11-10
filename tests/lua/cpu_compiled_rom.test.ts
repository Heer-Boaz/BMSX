import assert from 'node:assert/strict';
import { test } from 'node:test';
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
import { BASE_BX_BITS, INSTRUCTION_BYTES, MAX_EXT_BX, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { IO_CART_SELECT } from '../../machine/ts/spec/bmsx/io';
import { CART_RAM_BASE, CART_ROM_BASE, CART_ROM_END, DYNAMIC_RAM_BASE, SYSTEM_ROM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { linkRawTestBlua32Pair, linkRawTestSystemBlua32 } from '../helpers/blua32';
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
		const image = linkRawTestSystemBlua32(loadSource(format, displaced));
		const data = (image.romBytes.byteLength + 3) & ~3;
		const bytes = new Uint8Array(data + 4).subarray(1); bytes.set(image.romBytes);
		bytes.set([0x55, 0x33, 0x11], data);
		const card = new Uint8Array([0xff, 0x55, 0x33, 0x11]).subarray(1);
		const machines = [machine(bytes, cartridgeSlots(card), CpuExecutionBackend.JavaScript),
			machine(bytes, cartridgeSlots(card), CpuExecutionBackend.Interpreter)];
		for (const { cpu } of machines) {
			const frame = cpu.rootThread.frames[0];
			frame.registers.setNumber(1, DYNAMIC_RAM_BASE + 0x1000 - (displaced ? 1020 : 0));
			frame.registers.setNumber(2, 1); cpu.runUntilDepth(0, 1000);
		}
		const frame = machines[0].cpu.rootThread.frames[0], page = frame.decodedPage!;
		const block = page.compiledBlocks!.entries[(image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
		assert.equal(block.sourceWords, 5);
		frame.registers.setNumber(1, 4 - (displaced ? 1020 : 0));
		assert.equal(block.region.exits[block.region.execute(frame.registers, frame.executionImage.constScalars, page, frame, block.entry, { remainingCycles: block.entryCycles, registerTop: frame.top })].nextPc, image.image.functions[0].codeAddress,
			'a backed system-ROM load and dependent arithmetic do not return through the bus owner');
		machines[1].cpu.rootThread.frames[0].registers.setNumber(1, 4 - (displaced ? 1020 : 0));
		machines[1].cpu.runUntilDepth(0, 5);
		for (const address of [4, data, data + 4, CART_ROM_BASE, CART_ROM_BASE + 4]) for (let grant = 1; grant <= 17; ++grant) {
			for (const { cpu } of machines) {
				cpu.rootThread.frames[0].registers.setNumber(1, address - (displaced ? 1020 : 0));
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
				cpu.runUntilDepth(0, grant);
			}
			assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
			assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
		}
	});
}

test('ROM replacement, data selection, reset and restore keep a generated RAM entry coherent', () => {
	const source = loadSource(MemoryAccessKind.Word);
	const image = linkRawTestSystemBlua32(source);
	const data = (image.romBytes.byteLength + 3) & ~3;
	const bytes = new Uint8Array(data + 16); bytes.set(image.romBytes); writeLE32(bytes, data, 11);
	const slot0 = new Uint8Array(16), slot1 = new Uint8Array(16);
	writeLE32(slot0, 0, 22); writeLE32(slot1, 0, 33);
	const machines = [machine(bytes, cartridgeSlots(slot0, slot1), CpuExecutionBackend.JavaScript),
		machine(bytes, cartridgeSlots(slot0, slot1), CpuExecutionBackend.Interpreter)];
	for (const [index, { cpu, memory }] of machines.entries()) {
		const frame = cpu.rootThread.frames[0];
		memory.writeBytes(DYNAMIC_RAM_BASE, source.text);
		frame.registers.setNumber(1, data); frame.registers.setNumber(2, 1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1000);
		const page = frame.decodedPage!, block = index === 0 ? page.compiledBlocks!.entries[0] : null;
		if (index === 0) assert.ok(block);
		const replacement = new Uint8Array(bytes.byteLength + 17).subarray(17);
		replacement.set(bytes); writeLE32(replacement, data, 44);
		memory.installSystemRom(replacement); cpu.runUntilDepth(0, 5);
		assert.equal(frame.registers.getNumber(0), 44);
		if (index === 0) assert.equal(page.compiledBlocks!.entries[0], block);
		frame.registers.setNumber(1, CART_ROM_BASE);
		for (const select of [0xfffffffe, 0xffffffff, 0, 1]) {
			memory.writeMappedWord(IO_CART_SELECT, select); cpu.runUntilDepth(0, 5);
			assert.equal(frame.registers.getNumber(0), (select & 1) === 0 ? 22 : 33);
		}
		writeLE32(replacement, data, 55);
		memory.cartridgeController.installRom(1, replacement.subarray(data, data + 16)); cpu.runUntilDepth(0, 5);
		assert.equal(frame.registers.getNumber(0), 55);
		if (index === 0) assert.equal(page.compiledBlocks!.entries[0], block);
		const saved = memory.cartridgeController.captureState();
		memory.cartridgeController.reset(); cpu.runUntilDepth(0, 5); assert.equal(frame.registers.getNumber(0), 22);
		memory.cartridgeController.restoreState(saved); cpu.runUntilDepth(0, 5); assert.equal(frame.registers.getNumber(0), 55);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

test('an empty ROM bus does not hide F64 cross-region reads or high-half faults', () => {
	const image = linkRawTestSystemBlua32(loadSource(MemoryAccessKind.F64LE));
	const slots: CartridgeSocketMediaPair = [{ rom: null, ramByteCount: 8, mailboxPresent: false }, null];
	const machines = [machine(image.romBytes, slots, CpuExecutionBackend.JavaScript), machine(image.romBytes, slots, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		const frame = cpu.rootThread.frames[0];
		frame.registers.setNumber(1, CART_ROM_BASE); frame.registers.setNumber(2, 1);
		cpu.runUntilDepth(0, 1000); assert.equal(frame.registers.getNumber(0), 0);
		memory.writeMappedWord(IO_CART_SELECT, 1); cpu.runUntilDepth(0, 5); assert.equal(frame.registers.getNumber(0), 0);
		memory.writeMappedWord(IO_CART_SELECT, 0); memory.writeMappedWord(CART_RAM_BASE, 0x3ff00000);
		frame.registers.setNumber(1, CART_ROM_END - 4); cpu.runUntilDepth(0, 5);
		assert.equal(frame.registers.getNumber(0), 1, 'the high word comes from cartridge RAM, not ROM padding');
		frame.registers.setNumber(0, 73); frame.registers.setNumber(1, SYSTEM_ROM_SIZE - 4); frame.top = 0;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
		assert.equal(frame.registers.getNumber(0), 73); assert.equal(frame.top, 0);
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
	const launcher = { text, constants: [CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET],
		functions: [{ firstWord: 0, wordCount: 3 }, { firstWord: 3, wordCount: 1 }], exceptionFunctionIndex: 1 };
	const pair0 = linkRawTestBlua32Pair(launcher, source0), pair1 = linkRawTestBlua32Pair(launcher, source1);
	const data = (Math.max(pair0.cartRomBytes.byteLength, pair1.cartRomBytes.byteLength) + 3) & ~3;
	const cart0 = new Uint8Array(data + 16), cart1 = new Uint8Array(data + 16);
	cart0.set(pair0.cartRomBytes); cart1.set(pair1.cartRomBytes); writeLE32(cart0, data, 22); writeLE32(cart1, data, 33);
	for (const backend of [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter]) {
		const { cpu, memory } = machine(pair0.systemRomBytes, cartridgeSlots(cart0, cart1), backend);
		// Enter through CP0.EXEC, establishing socket 0 before any cartridge fetch.
		cpu.runUntilDepth(0, 4);
		const frame = cpu.rootThread.frames[0];
		assert.equal(frame.executionImage.executionDomainId, 0);
		assert.equal(frame.pc, pair0.cartImage.functions[0].codeAddress);
		frame.registers.setNumber(1, CART_ROM_BASE + data); frame.registers.setNumber(2, 1);
		memory.writeMappedWord(IO_CART_SELECT, 1);
		cpu.runUntilDepth(0, 1000);
		assert.equal(frame.registers.getNumber(0), 33, 'even the first instruction fetch uses the execution socket');
		for (const select of [0, 1, 0xfffffffe, 0xffffffff]) {
			memory.writeMappedWord(IO_CART_SELECT, select); cpu.runUntilDepth(0, 5);
			assert.equal(frame.registers.getNumber(0), (select & 1) === 0 ? 22 : 33);
			assert.equal(frame.executionImage.executionDomainId, 0);
		}
	}
});

test('a cached instruction binding follows SELECT when EXEC has not overridden its chip select', () => {
	const text = new Uint8Array(4); writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 2 }] });
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
		const frame = cpu.rootThread.frames[0], firstPage = frame.decodedPage;
		for (const select of [1, 0xfffffffe, 0xffffffff, 0]) {
			memory.writeMappedWord(IO_CART_SELECT, select);
			assert.equal(cpu.runUntilDepth(0, 768), RunResult.Yielded);
			assert.equal(frame.registers.getNumber(1), (select & 1) === 0 ? 1 : 0);
			if ((select & 1) === 0) assert.equal(frame.decodedPage, firstPage, 'physical code is retained, not retired by a bus-selection change');
		}
	}
});

test('warm continuations resolve the live instruction socket after an in-block MMIO mux write', () => {
	const text = new Uint8Array(4); writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 8 }] });
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
		const frame = cpu.rootThread.frames[0];
		frame.registers.setNumber(2, IO_CART_SELECT);
		for (const slot of [0, 1]) {
			memory.writeMappedWord(IO_CART_SELECT, slot); frame.registers.setNumber(4, slot);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], CART_ROM_BASE);
			cpu.runUntilDepth(0, 10000);
		}
	}
	const lookup = machines[0].cpu.rootThread.frames[0].executionImage.compiledCodeLookup!;
	for (const slot of [0, 1]) assert.ok(lookup.find(CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE, slot)!.compiledBlocks!.entries[2]);
	for (const slot of [0, 1, 1, 0]) {
		for (const { cpu, memory } of machines) {
			const frame = cpu.rootThread.frames[0];
			memory.writeMappedWord(IO_CART_SELECT, slot);
			frame.registers.setNumber(0, 1 - slot); frame.registers.setNumber(4, slot ^ 1);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE);
			assert.equal(cpu.runUntilDepth(0, 6), RunResult.Yielded);
			assert.equal(frame.registers.getNumber(3), 1 - slot);
			assert.equal(frame.registers.getNumber(6), slot, 'the first instruction after the mux write comes from the newly selected ROM');
			assert.equal(frame.pc, CART_ROM_BASE); assert.equal(cpu.instructionBudgetRemaining, 0);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	// Replace a hot physical ROM without replacing the decoded-page owner.
	const page = lookup.find(CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE, 1)!;
	const replacement = cards[1].slice(); writeInstruction(replacement, second + 2, OpCode.KSMI, 5, 0, 7);
	for (const { cpu, memory } of machines) {
		memory.cartridgeController.installRom(1, replacement); memory.writeMappedWord(IO_CART_SELECT, 1);
		const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(4, 1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE);
		cpu.runUntilDepth(0, 6); assert.equal(frame.registers.getNumber(6), 7);
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
	const launcher = { text: launcherText, constants: [CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET],
		functions: [{ firstWord: 0, wordCount: 3, maxStack: 8 }, { firstWord: 3, wordCount: 1 }], exceptionFunctionIndex: 1 };
	const text = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.KSMI, 3, 0, 11); writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 0, 0);
	const pair = linkRawTestBlua32Pair(launcher, { text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 8 }] });
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
		if (cartridgeBound) cpu.runUntilDepth(0, 4);
		memory.writeBytes(DYNAMIC_RAM_BASE, ram);
		const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(5, IO_CART_SELECT); frame.registers.setNumber(4, 73);
		for (const slot of [0, 1]) {
			memory.writeMappedWord(IO_CART_SELECT, slot); cpu.writeFrameExecution(0, domain, functionAddress, DYNAMIC_RAM_BASE);
			cpu.runUntilDepth(0, 1200);
		}
	}
	const lookup = machines[0].cpu.rootThread.frames[0].executionImage.compiledCodeLookup!;
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
			assert.equal(cpu.runUntilDepth(0, 6), RunResult.Yielded);
			const frame = cpu.rootThread.frames[0];
			assert.equal(frame.registers.getNumber(0), select); assert.equal(frame.registers.getNumber(2), select);
			assert.equal(frame.registers.getNumber(3), !cartridgeBound && (select & 1) !== 0 ? 22 : 11);
			assert.equal(frame.pc, DYNAMIC_RAM_BASE); assert.equal(cpu.instructionBudgetRemaining, 0);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	const replacement = new Uint8Array(INSTRUCTION_BYTES); writeInstruction(replacement, 0, OpCode.MOV, 0, 4, 0);
	for (const { memory } of machines) memory.writeBytes(DYNAMIC_RAM_BASE, replacement);
	for (const block of returns) assert.equal(block.terminal.linkedBlock, null, 'rewriting shared RAM unlinks incoming edges from every socket');
	for (const { cpu } of machines) {
		cpu.writeFrameExecution(0, domain, functionAddress, DYNAMIC_RAM_BASE); cpu.runUntilDepth(0, 1200);
		assert.equal(cpu.rootThread.frames[0].registers.getNumber(0), 73);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});
