import { clamp01 } from '../../../../common/clamp';
import { DeviceQuantizeMode } from '../mode';

const TABLE_SIZE = 4096;
const TABLE_SCALE = 4095.0;
const INV_255 = 1.0 / 255.0;
const BAYER_4X4 = new Uint8Array([
	0, 8, 2, 10,
	12, 4, 14, 6,
	3, 11, 1, 9,
	15, 7, 13, 5,
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

function byteFromLinear(c: number): number {
	return (clamp01(c) * 255.0) | 0;
}

function buildQuantizeTable(levels: number): Uint8Array {
	const table = new Uint8Array(16 * 256);
	for (let thresholdIndex = 0; thresholdIndex < 16; thresholdIndex += 1) {
		const threshold = (thresholdIndex + 0.5) * (1.0 / 16.0);
		for (let signalByte = 0; signalByte < 256; signalByte += 1) {
			const signal = tableLookup(linearToSignalTable, signalByte * INV_255);
			const value = signal * levels;
			const bucket = value | 0;
			const quantized = (bucket + (value - bucket >= threshold ? 1.0 : 0.0)) / levels;
			table[(thresholdIndex << 8) | signalByte] = byteFromLinear(tableLookup(signalToLinearTable, quantized));
		}
	}
	return table;
}

const quantize7Table = buildQuantizeTable(7.0);
const quantize15Table = buildQuantizeTable(15.0);
const quantize31Table = buildQuantizeTable(31.0);
const quantize63Table = buildQuantizeTable(63.0);
const RED_BLUE_TABLE_BY_ACTIVE_MODE = [quantize31Table, quantize7Table];
const GREEN_TABLE_BY_ACTIVE_MODE = [quantize63Table, quantize15Table];

export function applyHeadlessDeviceQuantize(pixels: Uint8Array, width: number, height: number, deviceQuantizeMode: DeviceQuantizeMode): void {
	const activeModeIndex = deviceQuantizeMode - DeviceQuantizeMode.Rgb565;
	const redBlueTable = RED_BLUE_TABLE_BY_ACTIVE_MODE[activeModeIndex];
	const greenTable = GREEN_TABLE_BY_ACTIVE_MODE[activeModeIndex];
	for (let y = 0; y < height; y += 1) {
		let offset = y * width * 4;
		const bayerRowOffset = (y & 3) << 2;
		for (let x = 0; x < width; x += 1) {
			const bayerIndex = (x & 3) | bayerRowOffset;
			const tableOffset = BAYER_4X4[bayerIndex] << 8;
			pixels[offset + 0] = redBlueTable[tableOffset | pixels[offset + 0]];
			pixels[offset + 1] = greenTable[tableOffset | pixels[offset + 1]];
			pixels[offset + 2] = redBlueTable[tableOffset | pixels[offset + 2]];
			pixels[offset + 3] = 255;
			offset += 4;
		}
	}
}
