import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IO_SYS_CONTROL, SYS_CONTROL_RESET } from '../../machine/ts/machine/bus/io';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PROGRAM_STATIC_RAM_BASE } from '../../machine/ts/machine/memory/map';
import { linkBootProgramImages } from '../../machine/ts/machine/program/linker';
import { resolveRuntimeTiming } from '../../machine/ts/machine/runtime/boot_timing';
import type { RuntimeInputSource } from '../../machine/ts/machine/runtime/input';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../machine/ts/lua/compiler';
import { parseLuaChunk } from './cpu_test_harness';

class SystemResetInputSource implements RuntimeInputSource {
	public setRuntimeInputFrameDurationMs(): void {
	}

	public sampleInputControllerSnapshot(): void {
	}

	public supervisorRequestLineHigh(): boolean {
		return false;
	}

	public applyInputControllerVibrationEffect(): void {
	}
}

function createRuntime(): Runtime {
	const timing = resolveRuntimeTiming(5_000_000);
	return new Runtime({
		memory: new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }),
		pcrtcRunning: timing.pcrtcRunning,
		ufpsScaled: timing.ufpsScaled,
		cpuHz: timing.cpuHz,
		cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
		totalHalfLines: timing.totalHalfLines,
		activeDisplayHalfLines: timing.activeDisplayHalfLines,
		geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
	}, new SystemResetInputSource());
}

function compileProgram(source: string, path: string, programDomain: 'cart' | 'system') {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, path), [], { entrySource: source, programDomain });
	return {
		image: encodeCompiledProgramImage(compiled),
		metadata: compiled.metadata,
	};
}

test('system control reset command is write-only, self-clearing, and save-state visible', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const machine = new Machine(memory, new SystemResetInputSource());
	machine.resetDevices();
	const controller = machine.systemController;

	memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_RESET);
	assert.equal(memory.readIoU32(IO_SYS_CONTROL), 0);
	assert.equal(controller.captureState().resetRequested, true);

	const state = controller.captureState();
	controller.reset();
	controller.restoreState(state);
	assert.equal(controller.takeResetRequest(), true);
	assert.equal(controller.takeResetRequest(), false);
});

test('runtime reset boundary restarts the loaded system program and preserves cart entry', () => {
	const system = compileProgram(`
data marker: word = 41
*marker = *marker + 1
return
`, 'system_reset_system.lua', 'system');
	const cart = compileProgram(`
mem[${PROGRAM_STATIC_RAM_BASE}] = 99
mem[${IO_SYS_CONTROL}] = ${SYS_CONTROL_RESET}
return
`, 'system_reset_cart.lua', 'cart');
	const runtime = createRuntime();
	runtime.enterSystemFirmware();
	runtime.bootLinkedProgramImage(linkBootProgramImages(system.image, system.metadata, cart.image, cart.metadata, 'system'));

	assert.equal(runtime.machine.memory.readMappedU32LE(PROGRAM_STATIC_RAM_BASE), 41);
	runtime.frameScheduler.run(runtime.timing.frameDurationMs);
	assert.equal(runtime.cartProgramStarted, true);
	assert.equal(runtime.machine.memory.readMappedU32LE(PROGRAM_STATIC_RAM_BASE), 42);

	runtime.frameScheduler.run(runtime.timing.frameDurationMs);
	assert.equal(runtime.cartProgramStarted, false);
	assert.equal(runtime.pendingCall, 'entry');
	assert.equal(runtime.machine.memory.readMappedU32LE(PROGRAM_STATIC_RAM_BASE), 41);
	assert.equal(runtime.machine.systemController.captureState().resetRequested, false);
	assert.equal(runtime.frameScheduler.lastTickSequence, 0);

	runtime.frameScheduler.run(runtime.timing.frameDurationMs);
	assert.equal(runtime.cartProgramStarted, true);
	assert.equal(runtime.machine.memory.readMappedU32LE(PROGRAM_STATIC_RAM_BASE), 42);
});
