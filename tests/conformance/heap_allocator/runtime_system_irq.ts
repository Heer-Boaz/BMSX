import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_IRQ, CPU_STATUS_USER_MODE_CURRENT } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { GC_ROOT_BANKS_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../helpers/firmware_heap_layout';
import { IO_IRQ_FLAGS, IO_IRQ_MASK, IRQ_DMA0_DONE, IRQ_DMA1_DONE, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CPU_FIXED_STACK_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_IRQ_VECTOR_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET, BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { buildBlua32Image } from '../../../toolchain/ts/rompack/blua32_image_builder';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const irqPath = 'kernel/irq', eventsPath = 'kernel/interrupts', resetPath = 'fixture/reset';
const exceptionPath = 'kernel/cold_exception';
const authored = [
	['main', 'module<entry>\nreturn -1'],
	// This returns from the reset body, not through a managed module export.
	[resetPath, 'do return 37 end'],
	[irqPath, readFileSync('machine/bios/' + irqPath + '.lua', 'utf8')],
	[exceptionPath, readFileSync('machine/bios/' + exceptionPath + '.lua', 'utf8')],
	['kernel/exception_report', readFileSync('machine/bios/kernel/exception_report.lua', 'utf8')],
	[eventsPath, readFileSync('machine/bios/' + eventsPath + '.lua', 'utf8')],
].map(([path, source]) => ({ path, source, displayPath: path + '.lua', chunk: parseLuaChunk(source, path) }));
const armedReset = `
cop0.irq_vector = cop0.system_vector
cop0.status = cop0.status | ${CPU_STATUS_USER_MODE_CURRENT}
halt_until_irq
do return 37 end
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const handled = IRQ_DMA0_DONE | IRQ_VBLANK;
const flags = handled | IRQ_DMA1_DONE;

mkdirSync('tmp', { recursive: true });
const dir = mkdtempSync(join('tmp', 'authored-system-irq-'));
try {
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	for (const optLevel of [0, 3] as const) for (const armed of [false, true]) {
		const sources = armed ? authored.map(module => module.path === resetPath
			? { ...module, source: armedReset, chunk: parseLuaChunk(armedReset, resetPath) } : module) : authored;
		const built = buildBlua32Image({
			domain: 'system', luaModules: sources, generatedLuaModules: [], loadAddress: 0x100,
			ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel, traceStatements: 'erase',
			resetModule: resetPath, irqModule: irqPath, exceptionModule: exceptionPath, biosExports: [],
		});
		const { layout, functionProtoIndices } = built.linked, { header } = layout;
		const irq = layout.functions[functionProtoIndices.indexOf(built.object.vectors.irqProtoIndex)];
		assert.equal(built.object.sections.rodata.staticModulePaths.includes(irqPath), false);
		assert.equal(built.object.sections.rodata.moduleProtos.some(module => module.path === irqPath), false);
		const ops: OpCode[] = [];
		for (let pc = irq.codeAddress; pc < irq.codeAddress + irq.codeByteCount;) {
			const instruction = decodeBlua32InstructionAtPc(layout.textBytes, header.textAddress, pc);
			ops.push(instruction.op);
			pc = instruction.pc + INSTRUCTION_BYTES;
		}
		assert.ok(ops.includes(OpCode.RFE));
		for (const op of [OpCode.RET, OpCode.CALL, OpCode.CLOSURE, OpCode.GETSYS, OpCode.GETGL]) assert.ok(!ops.includes(op), `unexpected opcode ${op}`);
		const declarations = built.linked.symbols.metadata.staticScopes.declarations;
		const bssAddress = (name: string) => {
			const address = declarations.find(symbol => symbol.name === name)!.address;
			assert.ok(address !== undefined);
			return address;
		};
		const dma = bssAddress('bios_dma_completion_sequence'), vblank = bssAddress('bios_vblank_count');
		const rom = writeTestBlua32Rom(built.linked);
		assert.equal(readLE32(rom, BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET), irq.address);
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler, irqController } = runtime.machine;
		const trace: string[] = [], expected: string[] = [];
		const management = CPU_FIXED_STACK_BASE - RAM_BASE;
		const heapFirst = management + HEAP_STRING_METADATA_OFFSET, heapEnd = management + GC_ROOT_BANKS_OFFSET;
		const zeroHeap = new Uint8Array(heapEnd - heapFirst), heapHash = hashBytes(zeroHeap, 0, zeroHeap.length);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		function observe(cmd: string, output?: string | number) {
			trace.push(cmd);
			if (output !== undefined) expected.push(String(output));
		}
		function observeCounters() {
			for (const address of [dma, vblank]) {
				const offset = address - RAM_BASE;
				observe(`H ${offset} ${offset + 4}`, hashBytes(memory.ramData(), offset, 4));
			}
			const pending = memory.readIoU32(IO_IRQ_FLAGS);
			observe(`M ${IO_IRQ_FLAGS}`, `${pending} 0`);
			assert.deepEqual(memory.ramData().subarray(heapFirst, heapEnd), zeroHeap);
			observe(`H ${heapFirst} ${heapEnd}`, heapHash);
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const elapsed = cycles - cpu.instructionBudgetRemaining;
			assert.deepEqual(memory.ramData().subarray(heapFirst, heapEnd), zeroHeap);
			observe(`E ${cycles}`, `${result} ${elapsed} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			return result;
		}
		assert.equal(scheduler.nowCycles, 0);
		assert.deepEqual(memory.ramData().subarray(heapFirst, heapEnd), zeroHeap);
		observe(`H ${heapFirst} ${heapEnd}`, heapHash);
		if (armed) {
			assert.equal(grant(64), RunResult.Halted);
			assert.equal(cpu.isHaltedUntilIrq(), true);
			assert.equal(cpu.isUserMode(), true);
			const installed = readLE32(rom, BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET);
			assert.notEqual(installed, irq.address);
			assert.equal(memory.readRamRecordWord(CPU_IRQ_VECTOR_ADDRESS), installed);
			const offset = CPU_IRQ_VECTOR_ADDRESS - RAM_BASE;
			observe(`H ${offset} ${offset + 4}`, hashBytes(memory.ramData(), offset, 4));
		}
		const resetPc = cpu.readFramePc(0), resetFunction = cpu.readFrameFunctionAddress(0);
		memory.writeMappedWord(IO_IRQ_MASK, IRQ_VBLANK);
		irqController.raise(flags);
		observe(`O ${IO_IRQ_MASK} ${IRQ_VBLANK}`);
		observe(`i ${flags}`);
		assert.equal(cpu.enterPendingInterrupt(), true);
		observe('I', 1);
		assert.equal(cpu.fixedInterruptActive(), false, 'the fixed IRQ context cannot borrow the live reset bank');
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
		assert.equal(cpu.getFrameDepth(), 2);
		assert.equal(cpu.readFramePc(0), resetPc);
		assert.equal(cpu.readFrameFunctionAddress(0), resetFunction);
		assert.equal(cpu.readFramePc(1), irq.codeAddress);
		assert.equal(cpu.readEpcWord(), resetPc);
		observe('Z', `${CPU_CAUSE_IRQ} 0 ${resetPc}`);
		assert.equal(cpu.activeThread.currentFrame!.closureAddress, 0);
		observe('P', `2 ${irq.codeAddress}`);
		assert.deepEqual(memory.ramData().subarray(heapFirst, heapEnd), zeroHeap, 'vector admission uses the fixed board bank');
		// Before RAM_END is published, these authored BSS words are visible
		// to the board vector's CPU data path, not to the ordinary bus.
		for (let step = 0; step < 64 && memory.readRamRecordWord(dma) === 0; ++step) {
			assert.equal(grant(1), RunResult.Yielded);
		}
		assert.equal(memory.readRamRecordWord(dma), 1);
		assert.equal(memory.readRamRecordWord(vblank), 0);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS), flags);
		observeCounters();
		const checkpoint = captureRuntimeSaveState(runtime);
		const romPath = join(dir, `O${optLevel}.rom`), state = join(dir, `O${optLevel}.state`);
		const nativeState = join(dir, `O${optLevel}.native`), script = join(dir, `O${optLevel}.trace`);
		writeFileSync(romPath, rom);
		writeFileSync(state, encodeRuntimeSaveState(checkpoint));
		observe(`x ${nativeState}`);
		observe('S');

		function finish() {
			for (let step = 0; step < 64 && cpu.getFrameDepth() === 2; ++step) {
				assert.equal(grant(1), RunResult.Yielded);
			}
			assert.equal(cpu.getFrameDepth(), 1);
			assert.equal(cpu.readFramePc(0), resetPc, 'RFE resumes the same raw reset instruction stream');
			assert.equal(cpu.readFrameFunctionAddress(0), resetFunction);
			assert.equal(cpu.isUserMode(), armed);
			observe('P', `1 ${resetPc}`);
			assert.equal(memory.readRamRecordWord(dma), 1);
			assert.equal(memory.readRamRecordWord(vblank), 1);
			assert.equal(memory.readIoU32(IO_IRQ_FLAGS), IRQ_DMA1_DONE, 'only handled bits are acknowledged');
			observeCounters();
			assert.equal(grant(64), RunResult.Halted);
			assert.deepEqual(runtime.readCompletionValues(), [valueInteger(37)]);
			observe('C', 37);
		}
		finish();
		observe('U');
		applyRuntimeSaveState(runtime, checkpoint);
		finish();
		observe('X');
		applyRuntimeSaveState(runtime, checkpoint);
		finish();
		writeFileSync(script, trace.join('\n'));
		assert.deepEqual(execFileSync(native, [romPath, script, state], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		finish();
		console.log(`SYSTEM-IRQ:PASS O${optLevel} ${armed ? 'installed user IRQ while raw reset bank is live' : 'before first reset instruction'}; original reset frame survives IRQ and portable restore`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
