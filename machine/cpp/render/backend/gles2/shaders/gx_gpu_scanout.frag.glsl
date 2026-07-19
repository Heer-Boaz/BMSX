precision highp float;
precision highp int;

uniform sampler2D u_vram;
uniform ivec4 u_pcrtc[11];
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

int rawGx16WordAtAddress(int address) {
	int wrappedAddress = address - (address / 1048576) * 1048576;
	int logicalY = wrappedAddress / 1024;
	int logicalX = wrappedAddress - logicalY * 1024;
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

int localMemoryAddress32(int baseWord, int pagesPerRow, int x, int y) {
	int page = (y / 32) * pagesPerRow + x / 64;
	int pageX = wrapPowerOfTwo(x, 64);
	int pageY = wrapPowerOfTwo(y, 32);
	int blockX = pageX / 8;
	int blockY = pageY / 8;
	int block = wrapPowerOfTwo(blockX, 2)
		+ wrapPowerOfTwo(blockY, 2) * 2
		+ wrapPowerOfTwo(blockX / 2, 2) * 4
		+ wrapPowerOfTwo(blockY / 2, 2) * 8
		+ wrapPowerOfTwo(blockX / 4, 2) * 16;
	int column = wrapPowerOfTwo(pageX, 2)
		+ wrapPowerOfTwo(pageY, 2) * 2
		+ wrapPowerOfTwo(pageX / 2, 2) * 4
		+ wrapPowerOfTwo(pageX / 4, 2) * 8
		+ wrapPowerOfTwo(pageY / 2, 2) * 16
		+ wrapPowerOfTwo(pageY / 4, 2) * 32;
	return wrapPowerOfTwo(baseWord + wrapPowerOfTwo(page, 256) * 4096 + block * 128 + column * 2, 1048576);
}

int localMemoryColumn16(int pageX, int pageY) {
	return wrapPowerOfTwo(pageX, 2) * 2
		+ wrapPowerOfTwo(pageX / 2, 2) * 8
		+ wrapPowerOfTwo(pageX / 4, 2) * 16
		+ wrapPowerOfTwo(pageX / 8, 2)
		+ wrapPowerOfTwo(pageY, 2) * 4
		+ wrapPowerOfTwo(pageY / 2, 2) * 32
		+ wrapPowerOfTwo(pageY / 4, 2) * 64;
}

int localMemoryAddress16(int baseWord, int pagesPerRow, int x, int y, bool signedBlocks) {
	int page = (y / 64) * pagesPerRow + x / 64;
	int pageX = wrapPowerOfTwo(x, 64);
	int pageY = wrapPowerOfTwo(y, 64);
	int blockX = pageX / 16;
	int blockY = pageY / 8;
	int block = signedBlocks
		? wrapPowerOfTwo(blockY, 2)
			+ wrapPowerOfTwo(blockX, 2) * 2
			+ wrapPowerOfTwo(blockY / 4, 2) * 4
			+ wrapPowerOfTwo(blockY / 2, 2) * 8
			+ wrapPowerOfTwo(blockX / 2, 2) * 16
		: wrapPowerOfTwo(blockY, 2)
			+ wrapPowerOfTwo(blockX, 2) * 2
			+ wrapPowerOfTwo(blockY / 2, 2) * 4
			+ wrapPowerOfTwo(blockX / 2, 2) * 8
			+ wrapPowerOfTwo(blockY / 4, 2) * 16;
	return wrapPowerOfTwo(baseWord + wrapPowerOfTwo(page, 256) * 4096 + block * 128 + localMemoryColumn16(pageX, pageY), 1048576);
}

int localMemoryByteAddressGpu24(int baseWord, int framebufferWidth, int pixelX, int y, int channel) {
	return wrapPowerOfTwo(baseWord * 2 + (y * framebufferWidth + pixelX) * 3 + channel, 2097152);
}

bool circuitContainsOutput(ivec4 display, ivec4 extent, int outputX, int outputY) {
	return outputX >= display.y
		&& outputY >= display.z
		&& outputX < extent.x
		&& outputY < extent.y;
}

ivec4 circuitPixel(ivec4 framebuffer, ivec4 display, ivec4 extentPhase, ivec4 sampling, int outputX, int outputY) {
#if defined(GX_GPU_SCANOUT_GX16)
	int sourceX = framebuffer.w + outputX - display.y;
#if defined(GX_GPU_INTERLACED_FIELD)
	int sourceY = display.x + ((outputY - display.z) / 2) * sampling.y + extentPhase.w;
#else
	int sourceY = display.x + outputY - display.z;
#endif
	return rgb555Pixel(rawGx16WordAtAddress(framebuffer.x + sourceY * framebuffer.y + sourceX));
#else
	int sourceXNumerator = extentPhase.z + (outputX - display.y) * sampling.x;
	int sourceYNumerator = outputY - display.z;
	int sourceX = framebuffer.w + (sourceXNumerator * sampling.z) / 262144;
	int sourceY = display.x
		+ ((sourceYNumerator * display.w) / 262144) * sampling.y
		+ extentPhase.w;
	int pagesPerRow = framebuffer.y / 64;
	if (framebuffer.z == 0 || framebuffer.z == 1) {
		int address = localMemoryAddress32(framebuffer.x, pagesPerRow, sourceX, sourceY);
		int low = rawWordAtAddress(address);
		int high = rawWordAtAddress(address + 1);
		int alpha = framebuffer.z == 0 ? high / 256 : 128;
		return ivec4(low - (low / 256) * 256, low / 256, high - (high / 256) * 256, alpha);
	}
	if (framebuffer.z == 2 || framebuffer.z == 10) {
		int address = localMemoryAddress16(framebuffer.x, pagesPerRow, sourceX, sourceY, framebuffer.z == 10);
		return rgb555Pixel(rawWordAtAddress(address));
	}
	if (framebuffer.z == 18) {
		return ivec4(
			rawByteAtAddress(localMemoryByteAddressGpu24(framebuffer.x, framebuffer.y, sourceX, sourceY, 0)),
			rawByteAtAddress(localMemoryByteAddressGpu24(framebuffer.x, framebuffer.y, sourceX, sourceY, 1)),
			rawByteAtAddress(localMemoryByteAddressGpu24(framebuffer.x, framebuffer.y, sourceX, sourceY, 2)),
			128);
	}
	if (framebuffer.z == 31) {
		return rgb555Pixel(rawWordAtAddress(framebuffer.x + sourceY * framebuffer.y + sourceX));
	}
	return ivec4(0);
#endif
}

ivec4 mergedPixel(int outputX, int outputY) {
	ivec4 under = ivec4(u_pcrtc[1].yzw, 0);
	bool circuit2ContainsOutput = u_pcrtc[0].y != 0
		&& circuitContainsOutput(u_pcrtc[8], u_pcrtc[9], outputX, outputY);
	if (circuit2ContainsOutput) {
		ivec4 circuit2 = circuitPixel(u_pcrtc[7], u_pcrtc[8], u_pcrtc[9], u_pcrtc[10], outputX, outputY);
		if (u_pcrtc[2].y != 0) under.rgb = circuit2.rgb;
		if (u_pcrtc[0].w != 0) under.a = circuit2.a;
	}
	if (u_pcrtc[0].x == 0 || !circuitContainsOutput(u_pcrtc[4], u_pcrtc[5], outputX, outputY)) {
		return under;
	}
	ivec4 circuit1 = circuitPixel(u_pcrtc[3], u_pcrtc[4], u_pcrtc[5], u_pcrtc[6], outputX, outputY);
	int alpha = u_pcrtc[0].z != 0 ? u_pcrtc[2].x : (circuit1.a * 2 > 255 ? 255 : circuit1.a * 2);
	int inverseAlpha = 255 - alpha;
	ivec3 rgb = ivec3(
		(circuit1.r * alpha + under.r * inverseAlpha + 127) / 255,
		(circuit1.g * alpha + under.g * inverseAlpha + 127) / 255,
		(circuit1.b * alpha + under.b * inverseAlpha + 127) / 255
	);
	return ivec4(rgb, u_pcrtc[0].w != 0 ? under.a : circuit1.a);
}

vec4 outputPixel(int outputX, int outputY) {
#if defined(GX_GPU_SCANOUT_GX16_DIRECT)
	return vec4(circuitPixel(u_pcrtc[3], u_pcrtc[4], u_pcrtc[5], u_pcrtc[6], outputX, outputY)) / 255.0;
#else
	return vec4(mergedPixel(outputX, outputY)) / 255.0;
#endif
}

void main() {
#if defined(GX_GPU_INTERLACED_WEAVE)
	int outputY = u_interlace.y - 1 - int(gl_FragCoord.y);
	int field = outputY - (outputY / 2) * 2;
	int fieldLine = outputY / 2;
	int fieldHeight = field == 0 ? u_interlace.x : u_interlace.w;
	int fieldOffset = field == 0 ? 0 : u_interlace.x;
	int storedY = fieldOffset + fieldHeight - 1 - fieldLine;
	gl_FragColor = texture2D(u_vram, vec2(gl_FragCoord.x / float(u_interlace.z), (float(storedY) + 0.5) / float(u_interlace.y)));
#elif defined(GX_GPU_INTERLACED_FIELD)
	int storageY = int(gl_FragCoord.y);
	int localStorageY = storageY - u_interlace.w;
	int fieldLine = u_interlace.x - 1 - localStorageY;
	int outputY = u_interlace.z + fieldLine * 2;
	gl_FragColor = outputPixel(int(gl_FragCoord.x), outputY);
#else
	int outputY = u_pcrtc[1].x - 1 - int(gl_FragCoord.y);
	gl_FragColor = outputPixel(int(gl_FragCoord.x), outputY);
#endif
}
