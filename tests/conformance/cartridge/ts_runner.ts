import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const sourceExtensions = (Module as any)._extensions as Record<string, (module: any, filename: string) => void>;
for (const extension of ['.glsl', '.wgsl']) {
	sourceExtensions[extension] = (module, filename) => {
		module._compile(`module.exports = ${JSON.stringify(readFileSync(filename, 'utf8'))}`, filename);
	};
}

async function main(): Promise<void> {
	const [systemPath, dataPath, bootableCartPath] = process.argv.slice(2);
	if (!systemPath || !dataPath || !bootableCartPath) {
		throw new Error('Usage: ts_runner.ts SYSTEM_ROM DATA_CART_ROM BOOTABLE_CART_ROM');
	}

	const [
		{ machineManager },
		{ prepareMachineRuntime },
		{ runMachineHostFrame },
		{ RenderPresentationState },
		{ HostOverlayMenu },
		{ runGate },
		{ HeadlessPlatformServices },
		{ applyRuntimeSaveStateBytes },
		{ CART_MMIO_BASE },
		{ CARTRIDGE_MAILBOX_CONTROL_OFFSET, CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER },
	] = await Promise.all([
		import('../../../machine/ts/core/machine_manager'),
		import('../../../runtime/machine_runtime'),
		import('../../../runtime/host_frame'),
		import('../../../runtime/presentation_state'),
		import('../../../runtime/host_overlay_menu'),
		import('../../../machine/ts/common/taskgate'),
		import('../../../hosts/node/headless/platform_headless'),
		import('../../../machine/ts/machine/runtime/save_state/codec'),
		import('../../../machine/ts/machine/memory/map'),
		import('../../../machine/ts/machine/devices/cartridge/contracts'),
	]);

	const transcript: string[] = [];
	class ConformancePlatform extends HeadlessPlatformServices {
		public override log(_level: number, message: string): void {
			if (message.startsWith('CART-CONFORMANCE:')) {
				transcript.push(message.slice('CART-CONFORMANCE:'.length));
			}
		}
	}

	const [systemRom, dataRom, bootableCartRom] = await Promise.all([
		readFile(systemPath),
		readFile(dataPath),
		readFile(bootableCartPath),
	]);
	const platform = new ConformancePlatform();
	const ide = await prepareMachineRuntime({
		systemRom,
		cartridgeSlots: [dataRom, bootableCartRom],
		platform,
		viewHost: platform.gameviewHost,
	});
	const runtime = machineManager.runtime;
	const presentation = new RenderPresentationState(ide);
	const hostOverlayMenu = new HostOverlayMenu(ide);
	machineManager.start();
	runtime.frameLoop.currentTimeMs = 0;
	let currentTimeMs = 0;
	const transcriptCount = (entry: string): number => {
		let count = 0;
		for (let index = 0; index < transcript.length; index += 1) {
			if (transcript[index] === entry) {
				count += 1;
			}
		}
		return count;
	};
	const runUntil = (entry: string, count: number): void => {
		for (let frame = 0; frame < 240; frame += 1) {
			if (transcriptCount(entry) >= count) {
				return;
			}
			currentTimeMs += runtime.timing.frameDurationMs;
			runMachineHostFrame(
				ide,
				presentation,
				hostOverlayMenu,
				runtime,
				currentTimeMs,
				runGate.ready,
			);
		}
		throw new Error(`Guest did not publish ${entry} x${count}.`);
	};

	runUntil('READY', 1);
	const saved = await machineManager.captureRuntimeSaveStateBytes();
	const mailboxControl = CART_MMIO_BASE + CARTRIDGE_MAILBOX_CONTROL_OFFSET;
	runtime.machine.memory.writeMappedU32LE(mailboxControl, CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	runUntil('STEP1', 1);
	applyRuntimeSaveStateBytes(runtime, saved);
	runtime.machine.memory.writeMappedU32LE(mailboxControl, CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	runUntil('STEP1', 2);
	machineManager.running = false;

	process.stdout.write(`BMSX-CARTRIDGE-CONFORMANCE=${transcript.join('|')}\n`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
