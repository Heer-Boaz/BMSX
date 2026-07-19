import { DEVICE_QUANTIZE_BAYER_4X4, type DeviceQuantizeLuts } from '../lut';

export function applyHeadlessDeviceQuantize(pixels: Uint8Array, width: number, height: number, luts: DeviceQuantizeLuts): void {
	const redBlueLut = luts.redBlue;
	const greenLut = luts.green;
	for (let y = 0; y < height; y += 1) {
		let offset = y * width * 4;
		const bayerRowOffset = (y & 3) << 2;
		for (let x = 0; x < width; x += 1) {
			const bayerIndex = (x & 3) | bayerRowOffset;
			const tableOffset = DEVICE_QUANTIZE_BAYER_4X4[bayerIndex] << 8;
			pixels[offset + 0] = redBlueLut[tableOffset | pixels[offset + 0]];
			pixels[offset + 1] = greenLut[tableOffset | pixels[offset + 1]];
			pixels[offset + 2] = redBlueLut[tableOffset | pixels[offset + 2]];
			pixels[offset + 3] = 255;
			offset += 4;
		}
	}
}
