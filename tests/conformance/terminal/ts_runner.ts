import assert from 'node:assert/strict';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { parseSystemRomImage } from '../../../machine/ts/rompack/image';
import { cartridgeMediaFromImages } from '../../../hosts/common/cartridge_media';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE, IO_SYS_STATUS, SYS_STATUS_SUPERVISOR_ACTIVE } from '../../../machine/ts/spec/bmsx/io';
import type { InputControllerSnapshot } from '../../../machine/ts/machine/devices/input/contracts';

export function runTerminalFixture(bios: Uint8Array, cart: Uint8Array, events: string): string {
	let usage = 0, shifted = 0, supervisor = 0;
	const input = {
		sampleInputControllerSnapshot(snapshot: InputControllerSnapshot) {
			snapshot.keyWords.fill(0);
			if (usage !== 0) snapshot.keyWords[usage >>> 5] = 1 << (usage & 31);
			if (shifted !== 0) snapshot.keyWords[7] |= 1 << 1; // USB HID Left Shift, 225.
		},
		supervisorRequestLineHigh: () => supervisor !== 0,
		applyInputControllerVibrationEffect() {},
	};
	const runtime = new Runtime({ systemRomBytes: parseSystemRomImage(bios).bytes,
		cartridgeSlots: cartridgeMediaFromImages([cart, null]), machineModel: PSX_MACHINE_SPEC }, input);
	const backend = new HeadlessGPUBackend(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes), gpu = runtime.machine.gxGpu;
	runtime.boot();
	let transcript = '';
	for (const row of events.split('\n')) {
		let frames: number;
		[frames, usage, shifted, supervisor] = row.split(' ').map(Number);
		for (let frame = 0; frame < frames; frame++) {
			let completed = false;
			for (let attempt = 0; (!completed || gpu.backendServicePending()) && attempt < 32; attempt++) {
				if (gpu.backendServicePending()) {
					if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
					else backend.executeGxGpuReadback(gpu);
				}
				if (!completed) completed = runtime.frameScheduler.runToNextLogicalTick();
			}
			assert.ok(completed, 'physical video boundary');
			backend.executeGxGpuCommandDrain(gpu); gpu.retirePresentedCommands();
			runtime.machine.audioController.synchronizeOutput().clear();
			assert.equal(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 0, 'no physical Lua fault');
			const output = runtime.machine.systemDebugTransmit;
			while (output.availableByteCount() !== 0) transcript += String.fromCharCode(output.readByte());
		}
	}
	assert.notEqual(runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE, 0, 'actual BIOS monitor retained');
	return transcript;
}
