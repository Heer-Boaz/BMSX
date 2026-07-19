export const enum DeviceQuantizeMode {
	None = 0,
	Rgb565 = 1,
	Msx10Rgb343 = 2,
}

export const DEVICE_QUANTIZE_LEVELS: ReadonlyArray<Float32Array> = [
	new Float32Array([0, 0, 0]),
	new Float32Array([31, 63, 31]),
	new Float32Array([7, 15, 7]),
];
