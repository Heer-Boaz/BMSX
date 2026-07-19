import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputPath = resolve(
	process.cwd(),
	'machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts',
);

const operations = [
	{
		name: 'RawRgb',
		constant: 'GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB',
		generic: `const source = READ_PIXEL;
			target[output] = (source & 0x00ffffff) | (target[output] & 0xff000000);`,
		gx16: `const word = rawWordAtAddress(address);
			target[output] = (rgb555Color(word) | (target[output] & 0xff000000)) >>> 0;`,
	},
	{
		name: 'RawRgba',
		constant: 'GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA',
		generic: 'target[output] = READ_PIXEL >>> 0;',
		gx16: `const word = rawWordAtAddress(address);
			target[output] = (rgb555Color(word) | ((word & 0x8000) << 16)) >>> 0;`,
	},
	{
		name: 'RawAlpha',
		constant: 'GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA',
		generic: `const source = READ_PIXEL;
			target[output] = (target[output] & 0x00ffffff) | (source & 0xff000000);`,
		gx16: 'target[output] = (target[output] & 0x00ffffff) | ((rawWordAtAddress(address) & 0x8000) << 16);',
	},
	{
		name: 'BlendSourceRgb',
		constant: 'GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB',
		generic: `const source = READ_PIXEL;
			const doubledAlpha = source >>> 23 & 0x1fe;
			const blendAlpha = (doubledAlpha | -(doubledAlpha >>> 8)) & 0xff;
			const destination = target[output];
			target[output] = blendOutputRgba(destination, source, blendAlpha, destination & 0xff000000);`,
		gx16: `const word = rawWordAtAddress(address);
			const sourceMask = -(word >>> 15);
			const destination = target[output];
			const rgb = (rgb555Color(word) & sourceMask) | (destination & ~sourceMask & 0x00ffffff);
			target[output] = (rgb | (destination & 0xff000000)) >>> 0;`,
	},
	{
		name: 'BlendSourceRgba',
		constant: 'GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA',
		generic: `const source = READ_PIXEL;
			const doubledAlpha = source >>> 23 & 0x1fe;
			const blendAlpha = (doubledAlpha | -(doubledAlpha >>> 8)) & 0xff;
			target[output] = blendOutputRgba(target[output], source, blendAlpha, source & 0xff000000);`,
		gx16: `const word = rawWordAtAddress(address);
			const sourceMask = -(word >>> 15);
			const destination = target[output];
			const rgb = (rgb555Color(word) & sourceMask) | (destination & ~sourceMask & 0x00ffffff);
			target[output] = (rgb | ((word & 0x8000) << 16)) >>> 0;`,
	},
	{
		name: 'BlendConstantRgb',
		constant: 'GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB',
		generic: `const source = READ_PIXEL;
			const destination = target[output];
			target[output] = blendOutputRgba(destination, source, blendAlpha, destination & 0xff000000);`,
		gx16: `const word = rawWordAtAddress(address);
			const destination = target[output];
			target[output] = blendOutputRgba(destination, rgb555Color(word), blendAlpha, destination & 0xff000000);`,
	},
	{
		name: 'BlendConstantRgba',
		constant: 'GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA',
		generic: `const source = READ_PIXEL;
			target[output] = blendOutputRgba(target[output], source, blendAlpha, source & 0xff000000);`,
		gx16: `const word = rawWordAtAddress(address);
			target[output] = blendOutputRgba(
				target[output],
				rgb555Color(word),
				blendAlpha,
				(word & 0x8000) << 16,
			);`,
	},
];

const storages = [
	{ name: 'Ct32', constant: 'GX_GPU_PCRTC_STORAGE_CT32', reader: 'circuitPixelCt32(circuit, sourceX, sourceY)' },
	{ name: 'Ct24', constant: 'GX_GPU_PCRTC_STORAGE_CT24', reader: 'circuitPixelCt24(circuit, sourceX, sourceY)' },
	{ name: 'Ct16', constant: 'GX_GPU_PCRTC_STORAGE_CT16', reader: 'circuitPixelCt16(circuit, sourceX, sourceY)' },
	{ name: 'Ct16S', constant: 'GX_GPU_PCRTC_STORAGE_CT16S', reader: 'circuitPixelCt16S(circuit, sourceX, sourceY)' },
	{ name: 'Gpu24', constant: 'GX_GPU_PCRTC_STORAGE_GPU24', reader: 'circuitPixelGpu24(circuit, sourceX, sourceY)' },
	{ name: 'Gx16', constant: 'GX_GPU_PCRTC_STORAGE_GX16', reader: 'circuitPixelGx16(circuit, sourceX, sourceY)' },
	{ name: 'Zero', constant: 'GX_GPU_PCRTC_STORAGE_ZERO', reader: '0' },
];

function indent(text, tabs) {
	const prefix = '\t'.repeat(tabs);
	return text.split('\n').map(line => `${prefix}${line.replace(/^\t+/, '')}`).join('\n');
}

function genericFunction(operation, storage) {
	const body = operation.generic.replaceAll('READ_PIXEL', storage.reader);
	const blendAlpha = operation.name.startsWith('BlendConstant')
		? '\tconst blendAlpha = state.pcrtcScanout.blendAlpha;\n'
		: '';
	if (storage.name === 'Zero') {
		return `function writeGeneric${storage.name}${operation.name}Rows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
${blendAlpha}\tlet outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
${indent(body, 3)}
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
	}
}`;
	}
	return `function writeGeneric${storage.name}${operation.name}Rows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
	const sourceXStart = circuit.framebufferX
		+ (circuit.sourcePhaseX * circuit.sourceDivisionMultiplierX >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT);
	const sourceRemainderStart = circuit.sourcePhaseX % circuit.magnificationX;
${blendAlpha}	let sourceYNumerator = circuit.fieldSourceNumeratorY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		const sourceY = circuit.framebufferY
			+ (sourceYNumerator * circuit.fieldSourceDivisionMultiplierY >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT)
				* circuit.fieldSourceStride
			+ circuit.fieldSourcePhase;
		let sourceX = sourceXStart;
		let sourceRemainder = sourceRemainderStart;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
${indent(body, 3)}
			sourceX += circuit.sourceAdvanceX;
			sourceRemainder += circuit.sourceRemainderStepX;
			if (sourceRemainder >= circuit.magnificationX) {
				sourceRemainder -= circuit.magnificationX;
				sourceX += 1;
			}
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceYNumerator += circuit.fieldSourceNumeratorStepY;
	}
}`;
}

function gx16Function(operation) {
	const blendAlpha = operation.name.startsWith('BlendConstant')
		? '\tconst blendAlpha = state.pcrtcScanout.blendAlpha;\n'
		: '';
	return `function writeGx16${operation.name}Rows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
${blendAlpha}	let sourceY = circuit.linearFieldSourceY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		let address = circuit.framebufferBaseWord
			+ sourceY * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
${indent(operation.gx16, 3)}
			address += 1;
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceY += circuit.linearFieldSourceRowStep;
	}
}`;
}

const imports = operations.map(operation => `\t${operation.constant},`).join('\n');
const storageImports = storages.map(storage => `\t${storage.constant},`).join('\n');
const gx16Functions = operations.map(gx16Function).join('\n\n');
const genericFunctions = operations.flatMap(operation => storages.map(storage => genericFunction(operation, storage))).join('\n\n');
const gx16Cases = operations.map(operation => `\t\tcase ${operation.constant}:
			writeGx16${operation.name}Rows(state, target, circuit);
			return;`).join('\n');
const genericCases = operations.map(operation => {
	const storageCases = storages.map(storage => `\t\t\t\tcase ${storage.constant}:
					writeGeneric${storage.name}${operation.name}Rows(state, target, circuit);
					return;`).join('\n');
	return `\t\tcase ${operation.constant}:
			switch (circuit.framebufferStoragePath) {
${storageCases}
			}
			return;`;
}).join('\n');

const source = `// Generated by scripts/render/generate_gx_gpu_software_scanout_specializations.mjs. Do not edit.
import {
${imports}
	GX_GPU_PCRTC_SCANOUT_DRAW_NONE,
	GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT,
${storageImports}
	type GxGpuPcrtcCircuit,
} from '../../../machine/devices/gx/gpu_pcrtc';
import {
	gxGpuLocalMemoryAddress16,
	gxGpuLocalMemoryAddress16S,
	gxGpuLocalMemoryAddress32,
	gxGpuLocalMemoryAddressGpu24,
	gxGpuLocalMemoryAddressGx16,
} from '../../../machine/devices/gx/gpu_local_memory';
import { GX_GPU_VRAM_WORD_COUNT } from '../../../machine/devices/gx/vram_address';
import type { GxGpuPipelineState } from '../backend';
import { gxGpuSoftwareRgb555ChannelTo8, gxGpuSoftwareVram } from './gx_gpu_vram';

function rawWordAtAddress(address: number): number {
	return gxGpuSoftwareVram[address & (GX_GPU_VRAM_WORD_COUNT - 1)];
}

function rgb555Color(word: number): number {
	return gxGpuSoftwareRgb555ChannelTo8(word & 0x1f)
		| (gxGpuSoftwareRgb555ChannelTo8((word >>> 5) & 0x1f) << 8)
		| (gxGpuSoftwareRgb555ChannelTo8((word >>> 10) & 0x1f) << 16);
}

function blendOutputRgba(destination: number, source: number, blendAlpha: number, outputAlpha: number): number {
	const inverseAlpha = 255 - blendAlpha;
	const red = (((source & 0xff) * blendAlpha + (destination & 0xff) * inverseAlpha + 127) / 255) | 0;
	const green = (((source >>> 8 & 0xff) * blendAlpha + (destination >>> 8 & 0xff) * inverseAlpha + 127) / 255) | 0;
	const blue = (((source >>> 16 & 0xff) * blendAlpha + (destination >>> 16 & 0xff) * inverseAlpha + 127) / 255) | 0;
	return (red | (green << 8) | (blue << 16) | outputAlpha) >>> 0;
}

function circuitPixelCt32(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const address = gxGpuLocalMemoryAddress32(
		circuit.framebufferBaseWord,
		circuit.framebufferPagesPerRow,
		sourceX,
		sourceY,
	);
	const low = rawWordAtAddress(address);
	const high = rawWordAtAddress(address + 1);
	return low | ((high & 0xff) << 16) | ((high >>> 8) << 24);
}

function circuitPixelCt24(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const address = gxGpuLocalMemoryAddress32(
		circuit.framebufferBaseWord,
		circuit.framebufferPagesPerRow,
		sourceX,
		sourceY,
	);
	const low = rawWordAtAddress(address);
	return low | ((rawWordAtAddress(address + 1) & 0xff) << 16) | 0x80000000;
}

function circuitPixelCt16(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const word = rawWordAtAddress(gxGpuLocalMemoryAddress16(
		circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY));
	return rgb555Color(word) | ((word & 0x8000) << 16);
}

function circuitPixelCt16S(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const word = rawWordAtAddress(gxGpuLocalMemoryAddress16S(
		circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY));
	return rgb555Color(word) | ((word & 0x8000) << 16);
}

function circuitPixelGpu24(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const first = rawWordAtAddress(gxGpuLocalMemoryAddressGpu24(
		circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 0));
	const second = rawWordAtAddress(gxGpuLocalMemoryAddressGpu24(
		circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 1));
	const rgb = (sourceX & 1) === 0
		? first | ((second & 0xff) << 16)
		: (first >>> 8) | (second << 8);
	return rgb | 0x80000000;
}

function circuitPixelGx16(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const word = rawWordAtAddress(gxGpuLocalMemoryAddressGx16(
		circuit.framebufferBaseWord, circuit.framebufferWidth, sourceX, sourceY));
	return rgb555Color(word) | ((word & 0x8000) << 16);
}

${gx16Functions}

${genericFunctions}

export function writeGx16CircuitRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	drawPath: number,
): void {
	switch (drawPath) {
		case GX_GPU_PCRTC_SCANOUT_DRAW_NONE:
			return;
${gx16Cases}
	}
}

export function writeGenericCircuitRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	drawPath: number,
): void {
	switch (drawPath) {
		case GX_GPU_PCRTC_SCANOUT_DRAW_NONE:
			return;
${genericCases}
	}
}
`;

if (process.argv.includes('--check')) {
	const current = readFileSync(outputPath, 'utf8');
	if (current !== source) {
		console.error(`${outputPath} is stale`);
		process.exitCode = 1;
	}
} else {
	writeFileSync(outputPath, source);
}
