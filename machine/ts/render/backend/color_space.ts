const srgbByteToLinearFloat = new Float64Array(256);

for (let value = 0; value < srgbByteToLinearFloat.length; value += 1) {
	const c = value / 255;
	srgbByteToLinearFloat[value] = c <= 0.04045
		? c / 12.92
		: ((c + 0.055) / 1.055) ** 2.4;
}

export const SRGB_BYTE_TO_LINEAR_FLOAT = srgbByteToLinearFloat;
