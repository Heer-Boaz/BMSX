precision highp float;
precision highp int;

uniform sampler2D u_vram;
uniform ivec4 u_circuit[5];
uniform ivec4 u_interlace;

int wrapPowerOfTwo(int value, int period) {
	int wrapped = value - (value / period) * period;
	return wrapped < 0 ? wrapped + period : wrapped;
}

int rawWordAtAddress(int address) {
	int wrappedAddress = wrapPowerOfTwo(address, GX_GPU_VRAM_INSTALLED_WORDS);
	int logicalX = wrappedAddress
		- (wrappedAddress / GX_GPU_VRAM_X_ADDRESS_PERIOD) * GX_GPU_VRAM_X_ADDRESS_PERIOD;
	int logicalY = wrappedAddress / GX_GPU_VRAM_X_ADDRESS_PERIOD;
	vec2 texcoord = vec2(
		(float(logicalX) + 0.5) / float(GX_GPU_VRAM_X_ADDRESS_PERIOD),
		(float(logicalY) + 0.5) / float(GX_GPU_VRAM_TEXTURE_ROWS));
	vec4 rawPixel = texture2D(u_vram, texcoord);
	ivec4 nibbles = ivec4(rawPixel * 15.0 + 0.5);
	return nibbles.r * 4096 + nibbles.g * 256 + nibbles.b * 16 + nibbles.a;
}

int rawGx16WordAtAddress(int address) {
	int wrappedAddress = address - (address / GX_GPU_VRAM_INSTALLED_WORDS) * GX_GPU_VRAM_INSTALLED_WORDS;
	int logicalY = wrappedAddress / GX_GPU_VRAM_X_ADDRESS_PERIOD;
	int logicalX = wrappedAddress - logicalY * GX_GPU_VRAM_X_ADDRESS_PERIOD;
	vec2 texcoord = vec2(
		(float(logicalX) + 0.5) / float(GX_GPU_VRAM_X_ADDRESS_PERIOD),
		(float(logicalY) + 0.5) / float(GX_GPU_VRAM_TEXTURE_ROWS));
	vec4 rawPixel = texture2D(u_vram, texcoord);
	ivec4 nibbles = ivec4(rawPixel * 15.0 + 0.5);
	return nibbles.r * 4096 + nibbles.g * 256 + nibbles.b * 16 + nibbles.a;
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
	return wrapPowerOfTwo(
		baseWord + wrapPowerOfTwo(page, 256) * 4096 + block * 128 + column * 2,
		GX_GPU_VRAM_ADDRESS_WORD_COUNT);
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
	return wrapPowerOfTwo(
		baseWord + wrapPowerOfTwo(page, 256) * 4096 + block * 128 + localMemoryColumn16(pageX, pageY),
		GX_GPU_VRAM_ADDRESS_WORD_COUNT);
}

int localMemoryAddressGpu24(int baseWord, int pagesPerRow, int pixelX, int y, int word) {
	return localMemoryAddress16(baseWord, pagesPerRow, (pixelX * 3) / 2 + word, y, false);
}

ivec4 circuitPixel(int outputX, int outputY) {
#if defined(GX_GPU_SCANOUT_LINEAR_GX16)
	int sourceX = u_circuit[0].w + outputX - u_circuit[1].y;
#if defined(GX_GPU_INTERLACED_FIELD)
	int sourceY = u_circuit[3].w + ((outputY - u_circuit[3].z) / 2) * u_circuit[4].x;
#else
	int sourceY = u_circuit[3].w + outputY - u_circuit[3].z;
#endif
	return rgb555Pixel(rawGx16WordAtAddress(u_circuit[0].x + sourceY * u_circuit[0].y + sourceX));
#else
	int sourceXNumerator = u_circuit[2].x + (outputX - u_circuit[1].y) * u_circuit[2].z;
	int sourceX = u_circuit[0].w + (sourceXNumerator * u_circuit[3].x) / 262144;
	int sourceY = u_circuit[1].x
		+ (((outputY - u_circuit[1].z) * u_circuit[1].w) / 262144) * u_circuit[2].w
		+ u_circuit[2].y;
#if GX_GPU_SCANOUT_STORAGE_PATH == 0
	int address = localMemoryAddress32(u_circuit[0].x, u_circuit[0].z, sourceX, sourceY);
	int low = rawWordAtAddress(address);
	int high = rawWordAtAddress(address + 1);
	return ivec4(low - (low / 256) * 256, low / 256, high - (high / 256) * 256, high / 256);
#elif GX_GPU_SCANOUT_STORAGE_PATH == 1
	int address = localMemoryAddress32(u_circuit[0].x, u_circuit[0].z, sourceX, sourceY);
	int low = rawWordAtAddress(address);
	int high = rawWordAtAddress(address + 1);
	return ivec4(low - (low / 256) * 256, low / 256, high - (high / 256) * 256, 128);
#elif GX_GPU_SCANOUT_STORAGE_PATH == 2
	return rgb555Pixel(rawWordAtAddress(localMemoryAddress16(
		u_circuit[0].x, u_circuit[0].z, sourceX, sourceY, false)));
#elif GX_GPU_SCANOUT_STORAGE_PATH == 3
	return rgb555Pixel(rawWordAtAddress(localMemoryAddress16(
		u_circuit[0].x, u_circuit[0].z, sourceX, sourceY, true)));
#elif GX_GPU_SCANOUT_STORAGE_PATH == 4
	int first = rawWordAtAddress(localMemoryAddressGpu24(u_circuit[0].x, u_circuit[0].z, sourceX, sourceY, 0));
	int second = rawWordAtAddress(localMemoryAddressGpu24(u_circuit[0].x, u_circuit[0].z, sourceX, sourceY, 1));
	if (sourceX - (sourceX / 2) * 2 == 0) {
		return ivec4(first - (first / 256) * 256, first / 256, second - (second / 256) * 256, 128);
	}
	return ivec4(first / 256, second - (second / 256) * 256, second / 256, 128);
#elif GX_GPU_SCANOUT_STORAGE_PATH == 5
	return rgb555Pixel(rawWordAtAddress(u_circuit[0].x + sourceY * u_circuit[0].y + sourceX));
#elif GX_GPU_SCANOUT_STORAGE_PATH == 6
	return ivec4(0);
#else
#error Unsupported GX GPU scanout storage path
#endif
#endif
}

vec4 outputPixel(int outputX, int outputY) {
	ivec4 pixel = circuitPixel(outputX, outputY);
#if defined(GX_GPU_SCANOUT_DOUBLE_ALPHA)
	pixel.a = pixel.a * 2 > 255 ? 255 : pixel.a * 2;
#endif
	return vec4(pixel) / 255.0;
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
	int outputY = u_circuit[3].y - 1 - int(gl_FragCoord.y);
	gl_FragColor = outputPixel(int(gl_FragCoord.x), outputY);
#endif
}
