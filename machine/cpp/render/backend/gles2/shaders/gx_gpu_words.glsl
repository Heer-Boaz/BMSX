// RGBA stores the four nibbles of one VRAM word, most significant first.
// Keep bytes separate: fragment integers need only the GLES2 minimum range.
ivec2 gxWordBytes(vec4 rawPixel) {
	ivec4 n = ivec4(rawPixel * 15.0 + 0.5);
	return ivec2(n.b * 16 + n.a, n.r * 16 + n.g);
}

ivec3 decodeRgb555To5(ivec2 word) {
	return ivec3(word.x - (word.x / 32) * 32,
		word.x / 32 + (word.y - (word.y / 4) * 4) * 8,
		(word.y / 4) - (word.y / 128) * 32);
}

vec4 encodeRgb555(ivec3 color5, int maskBit) {
	int low = color5.x + (color5.y - (color5.y / 8) * 8) * 32;
	int high = color5.y / 8 + color5.z * 4 + maskBit * 128;
	return vec4(high / 16, high - (high / 16) * 16,
		low / 16, low - (low / 16) * 16) / 15.0;
}

// A Q12 attribute accumulator has 20 bits. Vertex attributes carry its two
// ten-bit limbs; base-32 products below never exceed 2014, even at Y=2047.
vec4 gxSplitPlane(vec2 words) {
	ivec2 value = ivec2(words);
	ivec2 high = value / 1024;
	return vec4(vec2(value - high * 1024), vec2(high));
}

ivec4 gxPlaneDigits(vec2 limbs) {
	ivec2 value = ivec2(limbs);
	return ivec4(value.x - (value.x / 32) * 32, value.x / 32,
		value.y - (value.y / 32) * 32, value.y / 32);
}

ivec4 gxMultiplyPlane(ivec4 a, int coord) {
	int x2 = coord / 1024;
	int x1 = coord / 32 - x2 * 32;
	int x0 = coord - (coord / 32) * 32;
	int p0 = a.x * x0;
	int p1 = a.y * x0 + a.x * x1 + p0 / 32;
	int p2 = a.z * x0 + a.y * x1 + a.x * x2 + p1 / 32;
	int p3 = a.w * x0 + a.z * x1 + a.y * x2 + p2 / 32;
	return ivec4(p0 - (p0 / 32) * 32, p1 - (p1 / 32) * 32,
		p2 - (p2 / 32) * 32, p3 - (p3 / 32) * 32);
}

int gxAttributeByte(vec2 base, vec2 stepX, vec2 stepY, ivec2 coord) {
	ivec4 sum = gxPlaneDigits(base)
		+ gxMultiplyPlane(gxPlaneDigits(stepX), coord.x)
		+ gxMultiplyPlane(gxPlaneDigits(stepY), coord.y);
	sum.y += sum.x / 32;
	sum.z += sum.y / 32;
	sum.w += sum.z / 32;
	return (sum.z - (sum.z / 32) * 32) / 4
		+ (sum.w - (sum.w / 32) * 32) * 8;
}

void gxColorPlanePayload(vec3 base, vec3 stepX, vec3 stepY,
	out vec4 p0, out vec4 p1, out vec4 p2, out vec4 p3, out vec4 p4) {
	ivec3 b = ivec3(base), x = ivec3(stepX), y = ivec3(stepY);
	ivec3 bh = b / 1024, xh = x / 1024, yh = y / 1024;
	ivec3 bl = b - bh * 1024, xl = x - xh * 1024, yl = y - yh * 1024;
	p0 = vec4(bl, bh.x);
	p1 = vec4(bh.yz, xl.xy);
	p2 = vec4(xl.z, xh);
	p3 = vec4(yl, yh.x);
	p4 = vec4(yh.yz, 0, 0);
}

ivec3 gxColorPlaneBytes(vec4 p0, vec4 p1, vec4 p2, vec4 p3, vec4 p4, ivec2 coord) {
	return ivec3(
		gxAttributeByte(p0.xw, vec2(p1.z, p2.y), p3.xw, coord),
		gxAttributeByte(vec2(p0.y, p1.x), vec2(p1.w, p2.z), vec2(p3.y, p4.x), coord),
		gxAttributeByte(vec2(p0.z, p1.y), p2.xw, vec2(p3.z, p4.y), coord));
}
