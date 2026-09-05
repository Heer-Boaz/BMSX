import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const extensions = (Module as any)._extensions;
for (const extension of ['.glsl', '.wgsl']) {
	extensions[extension] = (module: any, filename: string) => {
		module._compile(`module.exports = ${JSON.stringify(readFileSync(filename, 'utf8'))}`, filename);
	};
}

async function main(): Promise<void> {
	const [systemPath, cartPath, outputPrefix] = process.argv.slice(2);
	const { Runtime } = await import('../../../machine/ts/machine/runtime/runtime');
	const { parseSystemRomImage, parseCartridgePackage } = await import('../../../machine/ts/rompack/image');
	const { cartridgeMediaFromPackage } = await import('../../../hosts/common/cartridge_media');
	const { HeadlessGPUBackend } = await import('../../../machine/ts/render/headless/backend');
	const { PSX_MACHINE_SPEC } = await import('../../../machine/ts/spec/bmsx/model');
	const { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } = await import('../../../machine/ts/spec/bmsx/io');
	const { captureRuntimeSaveState, applyRuntimeSaveState } = await import('../../../machine/ts/machine/runtime/save_state');
	const { encodeRuntimeSaveState, decodeRuntimeSaveState } = await import('../../../machine/ts/machine/runtime/save_state/codec');
	type Snapshot = import('../../../machine/ts/machine/devices/input/contracts').InputControllerSnapshot;
	let inputTick = 0;
	const input = {
		sampleInputControllerSnapshot(snapshot: Snapshot): void {
			snapshot.pads[0].buttons = (inputTick % 40) < 20 ? 1 : 1 << 15;
		},
		supervisorRequestLineHigh(): boolean { return false; },
		applyInputControllerVibrationEffect(): void {},
	};
	const runtime = new Runtime({
		systemRomBytes: parseSystemRomImage(readFileSync(systemPath)).bytes,
		cartridgeSlots: [cartridgeMediaFromPackage(parseCartridgePackage(readFileSync(cartPath))), null],
		machineModel: PSX_MACHINE_SPEC,
	}, input);
	const gpu = runtime.machine.gxGpu;
	const backend = new HeadlessGPUBackend(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes);
	const tick = (): void => {
		inputTick = runtime.frameScheduler.lastTickSequence;
		let completed = runtime.frameScheduler.runToNextLogicalTick();
		for (let attempt = 0; (!completed || gpu.backendServicePending()) && attempt < 32; attempt += 1) {
			if (gpu.backendServicePending()) {
				if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
				else backend.executeGxGpuReadback(gpu);
			}
			if (!completed) completed = runtime.frameScheduler.runToNextLogicalTick();
		}
		assert.equal(completed, true, 'machine must reach its next PCRTC tick');
		backend.executeGxGpuCommandDrain(gpu);
		gpu.retirePresentedCommands();
		runtime.machine.audioController.synchronizeOutput().clear();
		assert.equal(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 0, 'guest fault');
	};
	const capture = () => {
		backend.captureGxGpuVramSnapshot(gpu);
		return captureRuntimeSaveState(runtime);
	};
	runtime.boot();
	for (const checkpointTick of [2, 400, 1200]) {
		while (runtime.frameScheduler.lastTickSequence < checkpointTick) tick();
		const captureStart = performance.now();
		const anchor = capture();
		const captureMs = performance.now() - captureStart;
		const bytes = encodeRuntimeSaveState(anchor);
		for (let count = 0; count < 120; count += 1) tick();
		const expected = capture();
		if (outputPrefix) writeFileSync(`${outputPrefix}-${checkpointTick}.state`, encodeRuntimeSaveState(expected));
		const restoreStart = performance.now();
		applyRuntimeSaveState(runtime, anchor);
		const restoreMs = performance.now() - restoreStart;
		const replayStart = performance.now();
		for (let count = 0; count < 120; count += 1) tick();
		const replayMs = performance.now() - replayStart;
		assert.deepEqual(capture(), expected, 'trusted in-memory replay must reproduce the full runtime state');
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		for (let count = 0; count < 120; count += 1) tick();
		assert.deepEqual(capture(), expected, 'disk-codec replay must reproduce the same runtime state');
		console.log(JSON.stringify({ host: 'ts', checkpointTick, captureMs, restoreMs, replayMs, bytes: bytes.byteLength, objects: anchor.cpuState.objects.length }));
	}
	console.log('RUNTIME-REPLAY:PASS');
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
