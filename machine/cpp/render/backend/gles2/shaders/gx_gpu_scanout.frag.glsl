precision highp float;
precision highp int;

uniform sampler2D u_vram;
uniform ivec4 u_pcrtc[8];
uniform ivec4 u_interlace;

int wrapPowerOfTwo(int value, int period) {
	int wrapped = value - (value / period) * period;
	return wrapped < 0 ? wrapped + period : wrapped;
}

int rawWordAtAddress(int address) {
	int wrappedAddress = wrapPowerOfTwo(address, 1048576);
	int logicalX = wrappedAddress - (wrappedAddress / 1024) * 1024;
	int logicalY = wrappedAddress / 1024;
	vec2 texcoord = vec2((float(logicalX) + 0.5) / 1024.0, (float(logicalY) + 0.5) / 1024.0);
	vec4 rawPixel = texture2D(u_vram, texcoord);
	int lowByte = int(rawPixel.r * 255.0 + 0.5);
	int highByte = int(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256;
}

int rawByteAtAddress(int address) {
	int wrappedAddress = wrapPowerOfTwo(address, 2097152);
	int word = rawWordAtAddress(wrappedAddress / 2);
	return wrappedAddress - (wrappedAddress / 2) * 2 == 0 ? word - (word / 256) * 256 : word / 256;
}

ivec4 rgb555Pixel(int word) {
	ivec3 color5 = ivec3(
		word - (word / 32) * 32,
		(word / 32) - (word / 1024) * 32,
		(word / 1024) - (word / 32768) * 32
	);
	ivec3 rgb8 = ivec3(
		color5.x * 8 + color5.x / 4,
		color5.y * 8 + color5.y / 4,
		color5.z * 8 + color5.z / 4
	);
	return ivec4(rgb8, word / 32768 != 0 ? 128 : 0);
}

bool circuitContainsOutput(ivec4 display, ivec4 extent, int outputX, int outputY) {
	return outputX >= display.y
		&& outputY >= display.z
		&& outputX < extent.y
		&& outputY < extent.z;
}

ivec4 circuitPixel(ivec4 framebuffer, ivec4 display, ivec4 extent, int outputX, int outputY) {
	int sourceX = framebuffer.w + (outputX - display.y) / display.w;
	int sourceY = display.x + (outputY - display.z) / extent.x;
	int pixelOffset = sourceY * framebuffer.y + sourceX;
	if (framebuffer.z == 0 || framebuffer.z == 1) {
		int address = framebuffer.x + pixelOffset * 2;
		int low = rawWordAtAddress(address);
		int high = rawWordAtAddress(address + 1);
		int alpha = framebuffer.z == 0 ? high / 256 : 128;
		return ivec4(low - (low / 256) * 256, low / 256, high - (high / 256) * 256, alpha);
	}
	if (framebuffer.z == 18) {
		int address = framebuffer.x * 2 + pixelOffset * 3;
		return ivec4(rawByteAtAddress(address), rawByteAtAddress(address + 1), rawByteAtAddress(address + 2), 128);
	}
	return rgb555Pixel(rawWordAtAddress(framebuffer.x + pixelOffset));
}

ivec3 mergedPixel(int outputX, int outputY) {
	ivec3 under = u_pcrtc[1].yzw;
	if (u_pcrtc[0].y != 0 && circuitContainsOutput(u_pcrtc[6], u_pcrtc[7], outputX, outputY)) {
		under = circuitPixel(u_pcrtc[5], u_pcrtc[6], u_pcrtc[7], outputX, outputY).rgb;
	}
	if (u_pcrtc[0].x == 0 || !circuitContainsOutput(u_pcrtc[3], u_pcrtc[4], outputX, outputY)) {
		return under;
	}
	ivec4 circuit1 = circuitPixel(u_pcrtc[2], u_pcrtc[3], u_pcrtc[4], outputX, outputY);
	int alpha = u_pcrtc[0].z != 0 ? u_pcrtc[1].x : (circuit1.a * 2 > 255 ? 255 : circuit1.a * 2);
	int inverseAlpha = 255 - alpha;
	return ivec3(
		(circuit1.r * alpha + under.r * inverseAlpha + 127) / 255,
		(circuit1.g * alpha + under.g * inverseAlpha + 127) / 255,
		(circuit1.b * alpha + under.b * inverseAlpha + 127) / 255
	);
}

vec4 outputPixel(int outputX, int outputY) {
	return vec4(vec3(mergedPixel(outputX, outputY)) / 255.0, 1.0);
}

void main() {
#if defined(GX_GPU_INTERLACED_WEAVE)
	int outputY = u_interlace.y - 1 - int(gl_FragCoord.y);
	int field = outputY - (outputY / 2) * 2;
	int fieldLine = outputY / 2;
	int storedY = field * u_interlace.x + u_interlace.x - 1 - fieldLine;
	gl_FragColor = texture2D(u_vram, vec2(gl_FragCoord.x / float(u_interlace.z), (float(storedY) + 0.5) / float(u_interlace.y)));
#elif defined(GX_GPU_INTERLACED_FIELD)
	int storageY = int(gl_FragCoord.y);
	int localStorageY = storageY - u_interlace.z * u_interlace.x;
	int fieldLine = u_interlace.x - 1 - localStorageY;
	int outputY = u_interlace.z + fieldLine * 2;
	gl_FragColor = outputPixel(int(gl_FragCoord.x), outputY);
#else
	int outputY = u_pcrtc[0].w - 1 - int(gl_FragCoord.y);
	gl_FragColor = outputPixel(int(gl_FragCoord.x), outputY);
#endif
}
