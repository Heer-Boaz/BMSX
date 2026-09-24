import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';

const extensions = (Module as any)._extensions;
for (const extension of ['.glsl', '.wgsl']) extensions[extension] = (module: any, filename: string) => {
	module._compile(`module.exports = ${JSON.stringify(readFileSync(filename, 'utf8'))}`, filename);
};

async function main(): Promise<void> {
	const { Runtime } = await import('../../../machine/ts/machine/runtime/runtime');
	const { parseSystemRomImage } = await import('../../../machine/ts/rompack/image');
	const { cartridgeMediaFromImages } = await import('../../../hosts/common/cartridge_media');
	const { HeadlessGPUBackend } = await import('../../../machine/ts/render/headless/backend');
	const { PSX_MACHINE_SPEC } = await import('../../../machine/ts/spec/bmsx/model');
	const { IO_SYS_SUPERVISOR_FAULT_SEQUENCE, IO_SYS_STATUS, SYS_STATUS_SUPERVISOR_ACTIVE } = await import('../../../machine/ts/spec/bmsx/io');
	type Snapshot = import('../../../machine/ts/machine/devices/input/contracts').InputControllerSnapshot;
	const [bios, cart, events] = process.argv.slice(2);
	let usage = 0, shifted = 0, supervisor = 0;
	const input = {
		sampleInputControllerSnapshot(snapshot: Snapshot) {
			snapshot.keyWords.fill(0);
			if (usage !== 0) snapshot.keyWords[usage >>> 5] = 1 << (usage & 31);
			if (shifted !== 0) snapshot.keyWords[7] |= 1 << 1; // USB HID Left Shift, 225.
		},
		supervisorRequestLineHigh: () => supervisor !== 0,
		applyInputControllerVibrationEffect() {},
	};
	const runtime = new Runtime({ systemRomBytes: parseSystemRomImage(readFileSync(bios)).bytes,
		cartridgeSlots: cartridgeMediaFromImages([readFileSync(cart), null]), machineModel: PSX_MACHINE_SPEC }, input);
	const backend = new HeadlessGPUBackend(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes), gpu = runtime.machine.gxGpu;
	runtime.boot();
	let transcript = '';
	for (const row of readFileSync(events, 'utf8').trim().split('\n')) {
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
	process.stdout.write(transcript);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
