precision highp float;
precision highp int;

uniform sampler2D u_vram;
uniform ivec4 u_readback;
uniform int u_vramYAddressExtensionWord;

vec2 readRawPixel(ivec2 transferCoord) {
	int x = (u_readback.x + transferCoord.x)
		- ((u_readback.x + transferCoord.x) / GX_GPU_VRAM_X_ADDRESS_PERIOD) * GX_GPU_VRAM_X_ADDRESS_PERIOD;
	int yPeriod = u_vramYAddressExtensionWord != 0
		? GX_GPU_VRAM_Y_ADDRESS_PERIOD
		: GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT;
	int logicalY = (u_readback.y + transferCoord.y) - ((u_readback.y + transferCoord.y) / yPeriod) * yPeriod;
	int physicalY = logicalY - (logicalY / GX_GPU_VRAM_TEXTURE_ROWS) * GX_GPU_VRAM_TEXTURE_ROWS;
	vec2 texcoord = vec2(
		(float(x) + 0.5) / float(GX_GPU_VRAM_X_ADDRESS_PERIOD),
		(float(physicalY) + 0.5) / float(GX_GPU_VRAM_TEXTURE_ROWS));
	ivec4 nibbles = ivec4(texture2D(u_vram, texcoord) * 15.0 + 0.5);
	return vec2(nibbles.b * 16 + nibbles.a, nibbles.r * 16 + nibbles.g) / 255.0;
}

void main() {
	ivec2 storageCoord = ivec2(gl_FragCoord.xy);
	int wordIndex = storageCoord.y * u_readback.w + storageCoord.x;
	int firstPixelIndex = wordIndex * 2;
	int row = firstPixelIndex / u_readback.z;
	int column = firstPixelIndex - row * u_readback.z;
	int secondColumn = column + 1;
	int rowAdvance = secondColumn >= u_readback.z ? 1 : 0;
	secondColumn -= rowAdvance * u_readback.z;
	vec2 firstPixel = readRawPixel(ivec2(column, row));
	vec2 secondPixel = readRawPixel(ivec2(secondColumn, row + rowAdvance));
	gl_FragColor = vec4(firstPixel, secondPixel);
}
