import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeDirect16GxTexture, encodePalette4GxTexture } from '../../../toolchain/ts/rompack/gx_texture_codec';
import { streamingImage, type StreamingConfiguration } from '../../helpers/imgdec_streaming';

const extensions = (Module as any)._extensions;
for (const extension of ['.glsl', '.wgsl']) extensions[extension] = (module: any, filename: string) => {
	module._compile(`module.exports = ${JSON.stringify(readFileSync(filename, 'utf8'))}`, filename);
};

async function main() {
	const [bios, directory, ticks = '120'] = process.argv.slice(2);
	const { Runtime } = await import('../../../machine/ts/machine/runtime/runtime');
	const { parseSystemRomImage, parseCartridgePackage } = await import('../../../machine/ts/rompack/image');
	const { cartridgeMediaFromPackage } = await import('../../../hosts/common/cartridge_media');
	const { HeadlessGPUBackend } = await import('../../../machine/ts/render/headless/backend');
	const { PSX_MACHINE_SPEC } = await import('../../../machine/ts/spec/bmsx/model');
	const { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } = await import('../../../machine/ts/spec/bmsx/io');
	const { configuration }: { configuration: StreamingConfiguration } = JSON.parse(readFileSync(join(directory, 'streaming.json'), 'utf8'));
	const runtime = new Runtime({
		systemRomBytes: parseSystemRomImage(readFileSync(bios)).bytes,
		cartridgeSlots: [cartridgeMediaFromPackage(parseCartridgePackage(readFileSync(join(directory, 'streaming.rom')))), null],
		machineModel: PSX_MACHINE_SPEC,
	}, { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {} });
	const gpu = runtime.machine.gxGpu, cpu = runtime.machine.cpu;
	const backend = new HeadlessGPUBackend(320, 240, PSX_MACHINE_SPEC.gxGpuVramBytes);
	const images = Array.from({ length: 8 }, (_, frame) => {
		const rgba = streamingImage(configuration.width, configuration.height, frame, configuration.palette4);
		return configuration.palette4 ? encodePalette4GxTexture(configuration.width, configuration.height, rgba)
			: encodeDirect16GxTexture(configuration.width, configuration.height, rgba);
	});
	let previousFrame = 0, checkedFrames = 0, audibleFrames = 0;
	runtime.boot();
	const start = performance.now();
	for (let tick = 0; tick < +ticks; tick += 1) {
		let completed = false;
		for (let attempt = 0; (!completed || gpu.backendServicePending()) && attempt < 32; attempt += 1) {
			if (gpu.backendServicePending()) {
				if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
				else backend.executeGxGpuReadback(gpu);
			}
			if (!completed) completed = runtime.frameScheduler.runToNextLogicalTick();
		}
		assert.equal(completed, true, 'streaming must not deadlock either DMA channel or GPU fence');
		backend.executeGxGpuCommandDrain(gpu);
		gpu.retirePresentedCommands();
		const audio = runtime.machine.audioController.synchronizeOutput();
		while (audio.queuedFrames() !== 0) if (audio.readFramePacked() !== 0) audibleFrames += 1;
		assert.equal(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 0, 'streaming must not fault');
		const frame = cpu.getGlobalByKey(cpu.stringPool.intern('stream_completed_frames')) as number;
		if (tick >= 100) {
			assert.equal(frame, previousFrame + 1, 'each physical VBlank must complete another uploaded image');
			assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('stream_late_frames')), 0, 'guest work fits in one physical frame');
			assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('stream_uploads')), frame * configuration.uploads);
			const vram = backend.gxGpuSoftware.vram;
			let displayed = 0;
			for (let bit = 0; bit < 16; bit += 1) {
				const word = vram[236 * 1024 + 4 + bit * 3] & 0x7fff;
				assert.ok(word === 0 || word === 0x7fff, 'every counter cell is completely rendered');
				if (word === 0x7fff) displayed |= 1 << bit;
			}
			assert.equal(displayed, (frame - 1) & 0xffff, 'completed uploads must reach the actual drawn output');
			for (let slot = 0; slot < configuration.uploads; slot += 1) {
				const image = images[(frame - 1 + slot) & 7];
				const atlasX = 512 + (slot & 1) * image.wordWidth, atlasY = 256 + (slot >> 1) * image.height;
				for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.wordWidth; x += 1) {
					assert.equal(vram[(atlasY + y) * 1024 + atlasX + x], image.words.readUInt16LE((y * image.wordWidth + x) * 2),
						'every uploaded texture word must match the current ROM phase');
				}
				for (let entry = 0; entry < image.clutWordCount * 2; entry += 1) {
					assert.equal(vram[768 * 1024 + 512 + slot * 16 + entry], image.words.readUInt16LE(image.textureWordCount * 4 + entry * 2),
						'the uploaded CLUT must match the current ROM phase');
				}
			}
			const x = configuration.uploads > 1 ? 32 : (320 - configuration.width) >> 1;
			const y = configuration.uploads > 1 ? 0 : (240 - configuration.height) >> 1;
			for (let bit = 0; bit < 3; bit += 1) assert.equal(vram[y * 1024 + x + bit * 4] & 0x7fff,
				((displayed >> bit) & 1) * 0x7fff, 'the sampled image must be fresh, not only its upload or counter');
			checkedFrames += 1;
		}
		previousFrame = frame;
	}
	assert.ok(checkedFrames > 8);
	assert.ok(audibleFrames > 0, 'the four PCM voices must produce non-silent audio while streaming');
	assert.equal(runtime.machine.audioController.captureState().output.voices.length,
		configuration.voices, 'every requested voice must still be active after sustained streaming');
	assert.equal((cpu.getGlobalByKey(cpu.stringPool.intern('stream_checksum')) as number) > 0, configuration.actors > 0);
	console.log(JSON.stringify({ host: 'ts-software-reference', ticks: +ticks, configuration, completedFrames: previousFrame,
		checkedFrames, audibleFrames, elapsedMs: performance.now() - start }));
}
void main();
