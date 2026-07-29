#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_vram;
uniform uvec4 u_readback;
uniform uint u_vramYAddressExtensionWord;
out vec4 outputColor;

vec2 readRawPixel(uvec2 transferCoord) {
	uint x = (u_readback.x + transferCoord.x) & uint(GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
	uint yAddressMask = u_vramYAddressExtensionWord != 0u
		? uint(GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1)
		: uint(GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT - 1);
	uint logicalY = (u_readback.y + transferCoord.y) & yAddressMask;
	return texelFetch(u_vram, ivec2(int(x), int(logicalY & uint(GX_GPU_VRAM_TEXTURE_ROW_MASK))), 0).rg;
}

void main() {
	uvec2 storageCoord = uvec2(gl_FragCoord.xy);
	uint wordIndex = storageCoord.y * u_readback.w + storageCoord.x;
	uint firstPixelIndex = wordIndex * 2u;
	uint row = firstPixelIndex / u_readback.z;
	uint column = firstPixelIndex - row * u_readback.z;
	uint secondColumn = column + 1u;
	uint rowAdvance = secondColumn >= u_readback.z ? 1u : 0u;
	secondColumn -= rowAdvance * u_readback.z;
	vec2 firstPixel = readRawPixel(uvec2(column, row));
	vec2 secondPixel = readRawPixel(uvec2(secondColumn, row + rowAdvance));
	outputColor = vec4(firstPixel, secondPixel);
}
