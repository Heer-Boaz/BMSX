import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';

assert.equal(process.argv.length, 7, 'Expected backend, ROM, state-output, grant and word-count');
const [backend, romPath, statePath, grantText, wordsText] = process.argv.slice(2);
assert.ok(backend === 'ts-interpreter' || backend === 'javascript');
const grant = Number(grantText), wordCount = Number(wordsText);
const runtime = new Runtime({ systemRomBytes: readFileSync(romPath), cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC,
	cpuExecutionBackend: backend === 'javascript' ? CpuExecutionBackend.JavaScript : CpuExecutionBackend.Interpreter }, {
	sampleInputControllerSnapshot: () => {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect: () => {},
});
runtime.boot();
const cpu = runtime.machine.cpu, image = cpu.rootThread.frames[0].executionImage;
for (let index = 0; index < wordCount; ++index) cpu.rootThread.frames[0].registers.setNumber(8 + index, 0x20000000 | (index & 65535));
let result = RunResult.Yielded, cycles = 0;
const start = performance.now();
while (result === RunResult.Yielded) {
	result = cpu.runUntilDepth(0, grant);
	cycles += grant - cpu.instructionBudgetRemaining;
}
const milliseconds = performance.now() - start;
assert.equal(result, RunResult.Halted);
assert.equal(cpu.getFrameDepth(), 0); assert.equal(cpu.readCauseWord(), 0); assert.equal(cpu.isHaltedUntilIrq(), false);
if (wordCount > 0) {
	assert.equal(runtime.machine.memory.readMappedWord(DYNAMIC_RAM_BASE + 0x10000), 0x20000000);
	assert.equal(runtime.machine.memory.readMappedWord(DYNAMIC_RAM_BASE + 0x10000 + (wordCount - 1) * 4), 0x20000000 | ((wordCount - 1) & 65535));
}
const state = captureRuntimeSaveState(runtime);
assert.equal(state.cpuState.hardHalted, false); assert.equal(state.cpuState.memoryWriteBlocked, false);
let compiledBlocks = 0, sourceUnits = 0;
for (const page of image.decodedPages.values()) {
	if (page.compiledBlocks === null) continue;
	sourceUnits += page.compiledBlocks.sourceUnits;
	for (const block of page.compiledBlocks.entries) if (block !== null) ++compiledBlocks;
}
writeFileSync(statePath, encodeRuntimeSaveState(state));
console.log(JSON.stringify({ backend, activeCycles: cycles, idleCycles: 0, milliseconds, megahertz: cycles / milliseconds / 1000,
	remainingCycles: cpu.instructionBudgetRemaining, currentPc: cpu.readCurrentInstructionPc(), lastPc: cpu.lastPc, compiledBlocks, sourceUnits }));
