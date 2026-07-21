import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IO_SYS_CONTROL,
	IO_SYS_PRINT_CHAR,
	IO_SYS_PRINT_FLUSH,
	SYS_CONTROL_RESET,
	SYS_PRINT_BUFFER_BYTES,
} from '../../machine/ts/machine/bus/io';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PROGRAM_STATIC_RAM_BASE } from '../../machine/ts/machine/memory/map';
import { resolveRuntimeTiming } from '../../machine/ts/machine/runtime/boot_timing';
import type { RuntimeInputSource } from '../../machine/ts/machine/runtime/input';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { compileLuaChunkToProgram } from '../../machine/ts/lua/compiler';
import { parseLuaChunk } from './cpu_test_harness';
import { finalizeTestProgramPair } from '../helpers/program_image';

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

function createSystemResetRuntime(systemRom: Uint8Array, cartRom: Uint8Array): Runtime {
	const timing = resolveRuntimeTiming(5_000_000);
	return new Runtime({
		memory: new Memory({ systemRom, cartRom }),
		pcrtcRunning: timing.pcrtcRunning,
		ufpsScaled: timing.ufpsScaled,
		cpuHz: timing.cpuHz,
		cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
		totalHalfLines: timing.totalHalfLines,
		activeDisplayHalfLines: timing.activeDisplayHalfLines,
		geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
	}, new SystemResetInputSource());
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

test('system print registers retain firmware output and publish complete host lines', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const machine = new Machine(memory, new SystemResetInputSource());
	machine.resetDevices();
	const controller = machine.systemController;

	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x68);
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x69);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(controller.hostOutputAvailableByteCount(), 3);
	assert.deepEqual([
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
	], [0x68, 0x69, 0x0a]);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_FLUSH), 3);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x68);

	const state = controller.captureState();
	controller.reset();
	controller.restoreState(state);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x69);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x0a);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_FLUSH), 0);

	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x20ac);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(controller.hostOutputAvailableByteCount(), 4);
	assert.deepEqual([
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
	], [0xe2, 0x82, 0xac, 0x0a]);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x3f);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 0x0a);

	controller.reset();
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x6f);
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x6b);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	for (let index = 0; index < SYS_PRINT_BUFFER_BYTES; index += 1) {
		memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x78);
	}
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(controller.hostOutputAvailableByteCount(), 3);
	assert.deepEqual([
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
		controller.readHostOutputByte(),
	], [0x6f, 0x6b, 0x0a]);
	memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, 0x79);
	memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, 1);
	assert.equal(controller.hostOutputAvailableByteCount(), 2);
	assert.equal(controller.readHostOutputByte(), 0x79);
	assert.equal(controller.readHostOutputByte(), 0x0a);

	controller.reset();
	for (let index = 0; index < SYS_PRINT_BUFFER_BYTES + 2; index += 1) {
		memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, index);
	}
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_FLUSH), SYS_PRINT_BUFFER_BYTES);
	assert.equal(memory.readMappedU32LE(IO_SYS_PRINT_CHAR), 2);
});

test('runtime reset boundary restarts the loaded system program and preserves cart entry', () => {
	const systemSource = `
data marker: word = 41
*marker = *marker + 1
return
`;
	const system = compileLuaChunkToProgram(parseLuaChunk(systemSource, 'system_reset_system.lua'), [], { entrySource: systemSource, programDomain: 'system' });
	const cartSource = `
mem[${PROGRAM_STATIC_RAM_BASE}] = 99
mem[${IO_SYS_CONTROL}] = ${SYS_CONTROL_RESET}
return
`;
	const cart = compileLuaChunkToProgram(parseLuaChunk(cartSource, 'system_reset_cart.lua'), [], { entrySource: cartSource, programDomain: 'cart' });
	const images = finalizeTestProgramPair(system, cart);
	const runtime = createSystemResetRuntime(images.systemRomBytes, images.cartRomBytes);
	runtime.enterSystemFirmware();
	runtime.boot(images.systemImage, images.systemMetadata, images.cartImage, images.cartMetadata, 'system');

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
