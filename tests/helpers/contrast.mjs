/** Independent WCAG relative luminance for opaque ARGB colors, in linear sRGB. */
function luminance(color) {
	const channels = [color >>> 16 & 255, color >>> 8 & 255, color & 255]
		.map(value => value / 255)
		.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(foregroundARGB, backgroundARGB) {
	const foreground = luminance(foregroundARGB), background = luminance(backgroundARGB);
	return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
}
