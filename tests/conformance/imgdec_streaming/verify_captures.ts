import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import type { StreamingConfiguration } from '../../helpers/imgdec_streaming';

const { positionals: [directory, captures], values } = parseArgs({ allowPositionals: true, options: {
	'software-surface': { type: 'boolean', default: false }, reference: { type: 'string' },
} });
const reference = values.reference;
const { configuration }: { configuration: StreamingConfiguration } = JSON.parse(readFileSync(join(directory, 'streaming.json'), 'utf8'));
const files = readdirSync(captures).filter(file => /^frame_\d+\.png$/.test(file)).sort();
assert.ok(files.length >= 4, 'capture consecutive frames, not only a final held image');
const observations: { hostFrame: number; drawnFrame: number; phase: number }[] = [];
for (const file of files) {
	const png = PNG.sync.read(readFileSync(join(captures, file)));
	// The fb software frontend captures its integer-scaled physical surface;
	// the hardware frontend captures the core target before the final blit.
	const scale = values['software-surface'] ? Math.min((png.width / 320) | 0, (png.height / 240) | 0) : 1;
	const left = values['software-surface'] ? (png.width - 320 * scale) >> 1 : 0;
	const top = values['software-surface'] ? (png.height - 240 * scale) >> 1 : 0;
	if (!values['software-surface']) { assert.equal(png.width, 320); assert.equal(png.height, 240); }
	assert.ok(scale > 0);
	const bitAt = (x: number, y: number) => {
		const offset = ((top + y * scale + (scale >> 1)) * png.width + left + x * scale + (scale >> 1)) * 4;
		const brightness = png.data[offset] + png.data[offset + 1] + png.data[offset + 2];
		assert.ok(brightness < 192 || brightness > 573, 'marker cells must be completely black or white, allowing noise');
		return brightness > 573 ? 1 : 0;
	};
	let drawnFrame = 0, phase = 0;
	for (let bit = 0; bit < 16; bit += 1) drawnFrame |= bitAt(5 + bit * 3, 237) << bit;
	const x = configuration.uploads > 1 ? 32 : (320 - configuration.width) >> 1;
	const y = configuration.uploads > 1 ? 0 : (240 - configuration.height) >> 1;
	for (let bit = 0; bit < 3; bit += 1) phase |= bitAt(x + 1 + bit * 4, y + 1) << bit;
	assert.equal(phase, drawnFrame & 7, 'the sampled ROM image and independently drawn counter must agree');
	if (reference) assert.deepEqual(png.data, PNG.sync.read(readFileSync(join(reference, file))).data,
		'GLES2 and the software reference must agree on the complete frame with CRT disabled');
	const hostFrame = +file.slice(6, -4);
	const previous = observations.at(-1);
	if (previous) assert.equal((drawnFrame - previous.drawnFrame) & 0xffff, hostFrame - previous.hostFrame,
		'each emulated frame must display a fresh upload, including across distant captures');
	observations.push({ hostFrame, drawnFrame, phase });
}
console.log(JSON.stringify({ configuration, reference, softwareSurface: values['software-surface'], captures: observations }));
