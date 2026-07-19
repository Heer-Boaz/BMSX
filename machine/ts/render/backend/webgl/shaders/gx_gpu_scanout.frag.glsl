#version 300 es
precision highp float;
precision highp int;

out vec4 outputColor;

uniform sampler2D u_vram;
uniform uvec4 u_circuit[5];
uniform uvec4 u_interlace;

uint rawWordAtAddress(uint address) {
	uint wrappedAddress = address & 0xfffffu;
	ivec2 logicalCoord = ivec2(int(wrappedAddress & 0x3ffu), int(wrappedAddress >> 10u));
	vec4 rawPixel = texelFetch(u_vram, logicalCoord, 0);
	uvec2 bytes = uvec2(rawPixel.rg * 255.0 + 0.5);
	return bytes.x | (bytes.y << 8u);
}

uvec4 rgb555Pixel(uint word) {
	uvec3 color5 = uvec3(word & 0x1fu, (word >> 5u) & 0x1fu, (word >> 10u) & 0x1fu);
	uvec3 rgb8 = color5 * uvec3(8u) + color5 / uvec3(4u);
	return uvec4(rgb8, (word & 0x8000u) != 0u ? 128u : 0u);
}

uint localMemoryAddress32(uint baseWord, uint pagesPerRow, uint x, uint y) {
	uint page = (y >> 5u) * pagesPerRow + (x >> 6u);
	uint pageX = x & 63u;
	uint pageY = y & 31u;
	uint blockX = pageX >> 3u;
	uint blockY = pageY >> 3u;
	uint block = (blockX & 1u)
		| ((blockY & 1u) << 1u)
		| ((blockX & 2u) << 1u)
		| ((blockY & 2u) << 2u)
		| ((blockX & 4u) << 2u);
	uint column = (pageX & 1u)
		| ((pageY & 1u) << 1u)
		| ((pageX & 6u) << 1u)
		| ((pageY & 6u) << 3u);
	return (baseWord + (page << 12u) + (block << 7u) + (column << 1u)) & 0xfffffu;
}

uint localMemoryColumn16(uint pageX, uint pageY) {
	return ((pageX & 1u) << 1u)
		| ((pageX & 2u) << 2u)
		| ((pageX & 4u) << 2u)
		| ((pageX & 8u) >> 3u)
		| ((pageY & 1u) << 2u)
		| ((pageY & 2u) << 4u)
		| ((pageY & 4u) << 4u);
}

uint localMemoryAddress16(uint baseWord, uint pagesPerRow, uint x, uint y, bool signedBlocks) {
	uint page = (y >> 6u) * pagesPerRow + (x >> 6u);
	uint pageX = x & 63u;
	uint pageY = y & 63u;
	uint blockX = pageX >> 4u;
	uint blockY = pageY >> 3u;
	uint block = signedBlocks
		? (blockY & 1u) | ((blockX & 1u) << 1u) | (blockY & 4u) | ((blockY & 2u) << 2u) | ((blockX & 2u) << 3u)
		: ((blockX & 1u) << 1u) | (blockY & 1u) | ((blockX & 2u) << 2u) | ((blockY & 2u) << 1u) | ((blockY & 4u) << 2u);
	return (baseWord + (page << 12u) + (block << 7u) + localMemoryColumn16(pageX, pageY)) & 0xfffffu;
}

uint localMemoryAddressGpu24(uint baseWord, uint pagesPerRow, uint pixelX, uint y, uint word) {
	return localMemoryAddress16(baseWord, pagesPerRow, ((pixelX * 3u) >> 1u) + word, y, false);
}

uvec4 circuitPixel(uint outputX, uint outputY) {
#if defined(GX_GPU_SCANOUT_LINEAR_GX16)
	uint sourceX = u_circuit[0].w + outputX - u_circuit[1].y;
#if defined(GX_GPU_INTERLACED_FIELD)
	uint sourceY = u_circuit[3].w + ((outputY - u_circuit[3].z) >> 1u) * u_circuit[4].x;
#else
	uint sourceY = u_circuit[3].w + outputY - u_circuit[3].z;
#endif
	return rgb555Pixel(rawWordAtAddress(u_circuit[0].x + sourceY * u_circuit[0].y + sourceX));
#else
	uint sourceXNumerator = u_circuit[2].x + (outputX - u_circuit[1].y) * u_circuit[2].z;
	uint sourceX = u_circuit[0].w + ((sourceXNumerator * u_circuit[3].x) >> 18u);
	uint sourceY = u_circuit[1].x
		+ ((((outputY - u_circuit[1].z) * u_circuit[1].w) >> 18u) * u_circuit[2].w)
		+ u_circuit[2].y;
#if GX_GPU_SCANOUT_STORAGE_PATH == 0
	uint address = localMemoryAddress32(u_circuit[0].x, u_circuit[0].z, sourceX, sourceY);
	uint low = rawWordAtAddress(address);
	uint high = rawWordAtAddress(address + 1u);
	return uvec4(low & 0xffu, low >> 8u, high & 0xffu, high >> 8u);
#elif GX_GPU_SCANOUT_STORAGE_PATH == 1
	uint address = localMemoryAddress32(u_circuit[0].x, u_circuit[0].z, sourceX, sourceY);
	uint low = rawWordAtAddress(address);
	uint high = rawWordAtAddress(address + 1u);
	return uvec4(low & 0xffu, low >> 8u, high & 0xffu, 128u);
#elif GX_GPU_SCANOUT_STORAGE_PATH == 2
	return rgb555Pixel(rawWordAtAddress(localMemoryAddress16(
		u_circuit[0].x, u_circuit[0].z, sourceX, sourceY, false)));
#elif GX_GPU_SCANOUT_STORAGE_PATH == 3
	return rgb555Pixel(rawWordAtAddress(localMemoryAddress16(
		u_circuit[0].x, u_circuit[0].z, sourceX, sourceY, true)));
#elif GX_GPU_SCANOUT_STORAGE_PATH == 4
	uint first = rawWordAtAddress(localMemoryAddressGpu24(u_circuit[0].x, u_circuit[0].z, sourceX, sourceY, 0u));
	uint second = rawWordAtAddress(localMemoryAddressGpu24(u_circuit[0].x, u_circuit[0].z, sourceX, sourceY, 1u));
	uint rgb = (sourceX & 1u) == 0u
		? first | ((second & 0xffu) << 16u)
		: (first >> 8u) | (second << 8u);
	return uvec4(rgb & 0xffu, (rgb >> 8u) & 0xffu, (rgb >> 16u) & 0xffu, 128u);
#elif GX_GPU_SCANOUT_STORAGE_PATH == 5
	return rgb555Pixel(rawWordAtAddress(u_circuit[0].x + sourceY * u_circuit[0].y + sourceX));
#else
	return uvec4(0u);
#endif
#endif
}

vec4 outputPixel(uint outputX, uint outputY) {
	uvec4 pixel = circuitPixel(outputX, outputY);
#if defined(GX_GPU_SCANOUT_DOUBLE_ALPHA)
	pixel.a = min(pixel.a << 1u, 255u);
#endif
	return vec4(pixel) / 255.0;
}

void main() {
#if defined(GX_GPU_INTERLACED_WEAVE)
	uint outputY = u_interlace.y - 1u - uint(gl_FragCoord.y);
	uint field = outputY & 1u;
	uint fieldLine = outputY >> 1u;
	uint fieldHeight = field == 0u ? u_interlace.x : u_interlace.w;
	uint fieldOffset = field == 0u ? 0u : u_interlace.x;
	uint storedY = fieldOffset + fieldHeight - 1u - fieldLine;
	outputColor = texelFetch(u_vram, ivec2(int(uint(gl_FragCoord.x)), int(storedY)), 0);
#elif defined(GX_GPU_INTERLACED_FIELD)
	uint storageY = uint(gl_FragCoord.y);
	uint localStorageY = storageY - u_interlace.w;
	uint fieldLine = u_interlace.x - 1u - localStorageY;
	uint outputY = u_interlace.z + fieldLine * 2u;
	outputColor = outputPixel(uint(gl_FragCoord.x), outputY);
#else
	uint outputY = u_circuit[3].y - 1u - uint(gl_FragCoord.y);
	outputColor = outputPixel(uint(gl_FragCoord.x), outputY);
#endif
}
