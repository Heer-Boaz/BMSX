import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { advanceRuntimeTime, runDueRuntimeTimers } from '../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { geometryVectors } from '../conformance/geometry/vectors';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';

function createRuntime(mode: CpuExecutionBackend): Runtime {
	const code = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.MOV, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.JMP, 0, 63, 62, 255);
	writeInstruction(code, 2, OpCode.HALT, 0, 0, 0, 0);
	const system = linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 2 }, { firstWord: 2, wordCount: 1 }],
		systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name),
		startupFunctionIndex: 0,
		irqFunctionIndex: 1,
		exceptionFunctionIndex: 1,
	});
	const runtime = new Runtime({
		systemRomBytes: system.romBytes,
		cartridgeSlots: cartridgeSlots(),
		machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: mode,
	}, {
		sampleInputControllerSnapshot() {},
		supervisorRequestLineHigh() { return false; },
		applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	runtime.frameScheduler.runCyclesToNextLogicalTick(512);
	const frame = runtime.machine.cpu.activeThread.frameAtDepth(0);
	const entry = system.image.functions[0].codeAddress;
	if (mode === CpuExecutionBackend.JavaScript) {
		const word = (entry & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
		assert.ok(frame.decodedPage?.compiledBlocks?.entries[word], 'generated entry is installed before the boundary');
	}
	frame.pc = entry;
	return runtime;
}

for (const mode of [CpuExecutionBackend.Interpreter]) {
	for (const restore of [false, true]) {
		test(`GEO advances during a completed CPU instruction overrun, mode ${mode}, restore ${restore}`, () => {
			const runtime = createRuntime(mode);
			const vector = geometryVectors().find(vector => vector.name === 'overlap-overlap')!;
			for (const [address, word] of vector.writes) runtime.machine.memory.writeMappedWord(address, word);
			runDueRuntimeTimers(runtime);
			const geo = runtime.machine.geometryController;
			assert.equal(geo.captureState().pendingCycles, 4);
			advanceRuntimeTime(runtime, 3);
			assert.equal(geo.captureState().pendingCycles, 1);
			if (restore) {
				const saved = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
				const decoded = decodeRuntimeSaveState(saved, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
				applyRuntimeSaveState(runtime, decoded);
				assert.equal(geo.captureState().pendingCycles, 1, 'runtime restore preserves the device deadline');
			}
			const before = runtime.machine.scheduler.nowCycles;
			runtime.frameScheduler.runCyclesToNextLogicalTick(1);
			assert.equal(runtime.machine.scheduler.nowCycles - before, 2, 'MOV completes despite a one-cycle grant');
			assert.equal(geo.captureState().pendingCycles, 25, 'the next 26-cycle header has already progressed one cycle');
		});
	}
}
