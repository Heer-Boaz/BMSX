import { clamp01 } from '../../../../common/clamp';

const TABLE_SIZE = 4096;
const TABLE_SCALE = 4095.0;
const INV_255 = 1.0 / 255.0;
const PSX_DITHER = new Int8Array([
	-4, 0, -3, 1,
	2, -2, 3, -1,
	-3, 1, -4, 0,
	3, -1, 2, -2,
]);
const BAYER_4X4 = new Float32Array([
	0.0, 8.0, 2.0, 10.0,
	12.0, 4.0, 14.0, 6.0,
	3.0, 11.0, 1.0, 9.0,
	15.0, 7.0, 13.0, 5.0,
]);
const linearToSignalTable = buildLinearToSignalTable();
const signalToLinearTable = buildSignalToLinearTable();

function buildLinearToSignalTable(): Float32Array {
	const table = new Float32Array(TABLE_SIZE);
	for (let index = 0; index < TABLE_SIZE; index += 1) {
		const c = index / TABLE_SCALE;
		table[index] = c <= 0.0031308
			? c * 12.92
			: 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
	}
	return table;
}

function buildSignalToLinearTable(): Float32Array {
	const table = new Float32Array(TABLE_SIZE);
	for (let index = 0; index < TABLE_SIZE; index += 1) {
		const c = index / TABLE_SCALE;
		table[index] = c <= 0.04045
			? c / 12.92
			: Math.pow((c + 0.055) / 1.055, 2.4);
	}
	return table;
}

function tableLookup(table: Float32Array, value: number): number {
	return table[(clamp01(value) * TABLE_SCALE + 0.5) | 0];
}

function linearToSignal(c: number): number {
	return tableLookup(linearToSignalTable, c);
}

function signalToLinear(c: number): number {
	return tableLookup(signalToLinearTable, c);
}

function bayer4x4(x: number, y: number): number {
	return (BAYER_4X4[(x & 3) + ((y & 3) << 2)] + 0.5) * (1.0 / 16.0);
}

function quantizeOrderedConditional(c: number, levels: number, threshold: number): number {
	const value = c * levels;
	const quantized = value | 0;
	return (quantized + (value - quantized >= threshold ? 1.0 : 0.0)) / levels;
}

function quantizeRgb555Psx(c: number, ditherOffset: number): number {
	return (((c * 255.0 + ditherOffset) * 0.125) | 0) / 31.0;
}

function byteFromLinear(c: number): number {
	return (clamp01(c) * 255.0) | 0;
}

export function applyHeadlessDeviceQuantize(pixels: Uint8Array, width: number, height: number, ditherType: number): void {
	for (let y = 0; y < height; y += 1) {
		let offset = y * width * 4;
		for (let x = 0; x < width; x += 1) {
			const signalR = linearToSignal(pixels[offset + 0] * INV_255);
			const signalG = linearToSignal(pixels[offset + 1] * INV_255);
			const signalB = linearToSignal(pixels[offset + 2] * INV_255);
			let outR = signalR;
			let outG = signalG;
			let outB = signalB;
			if (ditherType === 1) {
				const ditherOffset = PSX_DITHER[(x & 3) + ((y & 3) << 2)];
				outR = quantizeRgb555Psx(signalR, ditherOffset);
				outG = quantizeRgb555Psx(signalG, ditherOffset);
				outB = quantizeRgb555Psx(signalB, ditherOffset);
			} else if (ditherType === 2) {
				outR = quantizeOrderedConditional(signalR, 127.0, bayer4x4(x, y));
				outG = quantizeOrderedConditional(signalG, 127.0, bayer4x4(x + 1, y + 2));
				outB = quantizeOrderedConditional(signalB, 127.0, bayer4x4(x + 2, y + 1));
			} else if (ditherType === 3) {
				const threshold = bayer4x4(x, y);
				outR = quantizeOrderedConditional(signalR, 7.0, threshold);
				outG = quantizeOrderedConditional(signalG, 15.0, threshold);
				outB = quantizeOrderedConditional(signalB, 7.0, threshold);
			}
			pixels[offset + 0] = byteFromLinear(signalToLinear(outR));
			pixels[offset + 1] = byteFromLinear(signalToLinear(outG));
			pixels[offset + 2] = byteFromLinear(signalToLinear(outB));
			pixels[offset + 3] = 255;
			offset += 4;
		}
	}
}
