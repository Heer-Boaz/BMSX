#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_source;
uniform sampler2D u_vram;
uniform uint u_checkMaskBit;
uniform uint u_setMaskBit;
uniform uint u_destinationYBase;
#ifdef GX_GPU_CPU_UPLOAD_SOURCE
uniform uvec4 u_upload;
#endif
flat in ivec2 v_sourceOffset;
out vec4 outputColor;

uint rawSourceLogicalWord(ivec2 logicalCoord) {
#ifdef GX_GPU_CPU_UPLOAD_SOURCE
	uint logicalX = uint(logicalCoord.x - int(u_upload.x)) & uint(GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
	uint logicalY = uint(logicalCoord.y - int(u_upload.y)) & (u_upload.w - 1u);
	uint pixelIndex = logicalY * u_upload.z + logicalX;
	ivec2 wrapped = ivec2(
		int(pixelIndex % uint(GX_GPU_VRAM_X_ADDRESS_PERIOD)),
		int(pixelIndex / uint(GX_GPU_VRAM_X_ADDRESS_PERIOD))
	);
#else
	ivec2 wrapped = logicalCoord & ivec2(GX_GPU_VRAM_X_ADDRESS_PERIOD - 1, GX_GPU_VRAM_TEXTURE_ROW_MASK);
#endif
	vec4 rawPixel = texelFetch(u_source, wrapped, 0);
	uvec2 bytes = uvec2(rawPixel.rg * 255.0 + 0.5);
	return bytes.x | (bytes.y << 8u);
}

uint rawVramStorageWord(ivec2 storageCoord) {
	vec4 rawPixel = texelFetch(u_vram, storageCoord & ivec2(GX_GPU_VRAM_X_ADDRESS_PERIOD - 1, GX_GPU_VRAM_TEXTURE_ROW_MASK), 0);
	uvec2 bytes = uvec2(rawPixel.rg * 255.0 + 0.5);
	return bytes.x | (bytes.y << 8u);
}

uvec3 decodeRgb555To5(uint word) {
	return uvec3(word & 0x1fu, (word >> 5u) & 0x1fu, (word >> 10u) & 0x1fu);
}

vec4 encodeRgb555(uvec3 color5, uint outputMaskBit) {
	uint word = color5.r | (color5.g << 5u) | (color5.b << 10u) | (outputMaskBit << 15u);
	return vec4(float(word & 0xffu) / 255.0, float(word >> 8u) / 255.0, 0.0, 1.0);
}

void main() {
	ivec2 storageCoord = ivec2(gl_FragCoord.xy);
	ivec2 destinationLogical = storageCoord + ivec2(0, int(u_destinationYBase));
	uint sourceWord = rawSourceLogicalWord(destinationLogical + v_sourceOffset);
	if (u_checkMaskBit != 0u && (rawVramStorageWord(storageCoord) & 0x8000u) != 0u) {
		discard;
	}
	uint outputMaskBit = u_setMaskBit != 0u ? 1u : sourceWord >> 15u;
	outputColor = encodeRgb555(decodeRgb555To5(sourceWord), outputMaskBit);
}
