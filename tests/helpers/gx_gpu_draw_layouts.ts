import { GxGpuCommandBuffer, GX_GPU_COMMAND_DRAW_LINE, GX_GPU_COMMAND_FILL_RECTANGLE, GX_GPU_SKIPPED_LINE_NONE } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import type { BrowserGxFixture } from './gx_gpu_browser_fixture';

export async function renderGxGpuDrawLayouts(fixture: BrowserGxFixture) {
	const { machine, pixels, softwareBytes: expected, width } = fixture;
	// Exercise every polygon packet layout, line encoding and rectangle size against the
	// software renderer, including the second triangle of each quad.
	const drawLayoutDifferences: number[] = [], drawLayoutPixels: number[] = [];
	const point = (x: number, y: number) => x | (y << 16);
	const vertices = [point(10, 10), point(80, 10), point(10, 80), point(80, 80)];
	const colors = [0x00804020, 0x00208040, 0x00402080, 0x00808040];
	const texture = [0, 1 | (0x0118 << 16), 0x100, 0x101];
	const packets: number[][] = [];
	for (const shaded of [false, true]) for (const textured of [false, true]) for (const quad of [false, true]) {
		const opcode = 0x20 | (shaded ? 0x10 : 0) | (textured ? 0x04 : 0) | (quad ? 0x08 : 0);
		const packet = [(opcode << 24) | colors[0], vertices[0]];
		if (textured) packet.push(texture[0]);
		for (let vertex = 1; vertex < (quad ? 4 : 3); ++vertex) {
			if (shaded) packet.push(colors[vertex]);
			packet.push(vertices[vertex]);
			if (textured) packet.push(texture[vertex]);
		}
		packets.push(packet);
	}
	for (const shaded of [false, true]) for (const polyline of [false, true]) {
		const opcode = 0x40 | (shaded ? 0x10 : 0) | (polyline ? 0x08 : 0);
		const packet = [(opcode << 24) | colors[0], point(10, 10)];
		if (shaded) packet.push(colors[1]);
		packet.push(point(80, 10));
		if (polyline) {
			if (shaded) packet.push(colors[2]);
			packet.push(point(80, 80), 0x50005000);
		}
		packets.push(packet);
	}
	for (const textured of [false, true]) for (const sizeBits of [0, 0x08, 0x10, 0x18]) {
		const opcode = 0x60 | (textured ? 0x04 : 0) | sizeBits;
		const packet = [(opcode << 24) | 0x00808080, point(10, 10)];
		if (textured) packet.push(0);
		if (sizeBits === 0) packet.push(point(16, 8));
		packets.push(packet);
	}
	machine.gxGpu.writeGp1(0x09000000);
	for (const packet of packets) {
		const words = [0xe3000000, 0xe407ffff, 0xe5000000, 0xe6000000,
			0x02000000, 0, 0x01000100,
			0xe1000118, 0xa0000000, 0x01000200, 0x00020002, 0x03e0001f, 0x7fff7c00,
			...packet];
		fixture.submit(words);
		const next = fixture.present();
		const rendered = await fixture.captureColor(next);
		drawLayoutDifferences.push(rendered.findIndex((value, index) => value !== expected[index]));
		drawLayoutPixels.push(pixels.filter(pixel => (pixel & 0xffffff) !== 0).length);
	}
	// A DRAW_LINE consumes exactly two vertices even if its retained raw span
	// contains extra words. The old third word would draw a spurious segment.
	const lineExtraWordDifferences: number[] = [], lineExtraWordPixels: number[][] = [], lineExtraWordCounts: number[] = [];
	for (const shaded of [false, true]) {
		const buffer = new GxGpuCommandBuffer(machine.dmaController);
		buffer.reset();
		const fill = Uint32Array.from([0x02000000, 0, 0x01000100]);
		const fillStart = buffer.appendWords(fill, fill.length);
		buffer.pushCommand(GX_GPU_COMMAND_FILL_RECTANGLE, 0x02, fillStart, fill.length, 0, 0, 0, 0, 0x0007ffff, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
		const line = Uint32Array.from(shaded
			? [0x50ffffff, point(10, 10), 0x00ffffff, point(80, 10), 0x00ffffff, point(80, 80)]
			: [0x40ffffff, point(10, 10), point(80, 10), point(80, 80)]);
		const lineStart = buffer.appendWords(line, line.length);
		buffer.pushCommand(GX_GPU_COMMAND_DRAW_LINE, shaded ? 0x50 : 0x40, lineStart, line.length, 0, 0, 0, 0, 0x0007ffff, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
		lineExtraWordCounts.push(buffer.drawVertexCount[buffer.commandDrawIndex[1]]);
		buffer.completeCommandExecution(buffer.commandCount);
		buffer.sealCommandsForPresentation();
		const next = { ...machine.gxGpu.readDeviceOutput(), commandBuffer: buffer, readbackPort: buffer.readback };
		const rendered = await fixture.captureColor(next);
		lineExtraWordDifferences.push(rendered.findIndex((value, index) => value !== expected[index]));
		lineExtraWordPixels.push([pixels[10 * width + 20] & 0xffffff, pixels[40 * width + 80] & 0xffffff]);
	}
	return { drawLayoutDifferences, drawLayoutPixels, lineExtraWordDifferences, lineExtraWordPixels, lineExtraWordCounts };
}
