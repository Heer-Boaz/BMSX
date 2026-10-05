import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

// Real runtime/backend, without the Lua test setup's legacy module mocks.
const extensions = (Module as any)._extensions;
for (const extension of ['.glsl', '.wgsl']) {
	extensions[extension] = (module: any, filename: string) => {
		module._compile(`module.exports = ${JSON.stringify(readFileSync(filename, 'utf8'))}`, filename);
	};
}

async function main(): Promise<void> {
	const [systemPath, cartPath] = process.argv.slice(2);
	const { Runtime } = await import('../../../machine/ts/machine/runtime/runtime');
	const { parseSystemRomImage, parseCartridgePackage } = await import('../../../machine/ts/rompack/image');
	const { cartridgeMediaFromPackage } = await import('../../../hosts/common/cartridge_media');
	const { HeadlessGPUBackend } = await import('../../../machine/ts/render/headless/backend');
	const { PSX_MACHINE_SPEC } = await import('../../../machine/ts/spec/bmsx/model');
	const { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } = await import('../../../machine/ts/spec/bmsx/io');
	const { InputControllerGamepadButtonBit: Button } = await import('../../../machine/ts/machine/devices/input/contracts');
	const { captureRuntimeSaveState, applyRuntimeSaveState } = await import('../../../machine/ts/machine/runtime/save_state');
	const { formatValueSnapshot } = await import('../../../ide/runtime/value_snapshot');
	const { RuntimeEventHistory } = await import('../../../ide/runtime/event_history');
	const { createRuntimeSourceState } = await import('../../../ide/runtime/sources');
	const { loadRomToolingMedia } = await import('../../../toolchain/ts/rompack/media');
	const system = readFileSync(systemPath), cart = readFileSync(cartPath);
	const media = await loadRomToolingMedia(system, [cart, null]);
	const sources = createRuntimeSourceState(media.system, media.cartridgeSlots);
	let inputTick = 0;
	const input = {
		sampleInputControllerSnapshot(snapshot: import('../../../machine/ts/machine/devices/input/contracts').InputControllerSnapshot): void {
			// Nemesis uses A for confirm/fire. Same recorded input for both variants.
			snapshot.pads[0].buttons = 1 << ((inputTick % 40) < 20 ? Button.A : Button.Right);
		},
		supervisorRequestLineHigh: () => false,
		applyInputControllerVibrationEffect(): void {},
	};
	const runtime = new Runtime({
		systemRomBytes: parseSystemRomImage(system).bytes,
		cartridgeSlots: [cartridgeMediaFromPackage(parseCartridgePackage(cart)), null],
		machineModel: PSX_MACHINE_SPEC,
	}, input);
	const gpu = runtime.machine.gxGpu;
	const backend = new HeadlessGPUBackend(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes);
	const tick = (): void => {
		inputTick = runtime.frameScheduler.lastTickSequence;
		let completed = false;
		while (!completed || gpu.backendServicePending()) {
			if (gpu.backendServicePending()) {
				if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
				else backend.executeGxGpuReadback(gpu);
			}
			if (!completed) completed = runtime.frameScheduler.runToNextLogicalTick();
		}
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
	let history = new RuntimeEventHistory(runtime, sources);
	for (const checkpoint of [400, 1200, 2400]) {
		while (runtime.frameScheduler.lastTickSequence < checkpoint) tick();
		const anchor = capture();
		const samples: number[][] = [[], []];
		let events = 0, names: string[] = [];
		let expected: ReturnType<typeof capture>;
		// Alternate order; restore/observer setup and state comparison are outside timing.
		for (let round = 0; round < 11; round++) for (let offset = 0; offset < 2; offset++) {
			const observed = (round + offset) % 2;
			applyRuntimeSaveState(runtime, anchor);
			history.dispose();
			if (observed) history = new RuntimeEventHistory(runtime, sources);
			const start = performance.now();
			for (let frame = 0; frame < 120; frame++) tick();
			samples[observed].push(performance.now() - start);
			if (observed) {
				events = history.endSequence;
				names = [...new Set(Array.from({ length: history.count }, (_, index) => formatValueSnapshot(history.at(history.firstSequence + index).event)))];
			}
			if (round === 0) {
				const result = capture();
				if (offset === 0) expected = result;
				else assert.ok(isDeepStrictEqual(result, expected!), 'observer must not change complete machine/CPU state');
			}
		}
		const medianMs = samples.map(values => values.slice(4).sort((a, b) => a - b)[3]);
		console.log(JSON.stringify({ cart: cartPath, checkpoint, frames: 120, events, names,
			variants: ['unobserved-debug', 'automatic-history'], medianMs,
			overheadPercent: (medianMs[1] / medianMs[0] - 1) * 100, samples }));
		history.dispose();
		history = new RuntimeEventHistory(runtime, sources);
	}
	history.dispose();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
