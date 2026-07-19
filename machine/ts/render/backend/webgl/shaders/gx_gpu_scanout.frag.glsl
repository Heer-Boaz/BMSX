#version 300 es
precision highp float;
precision highp int;

out vec4 outputColor;

uniform sampler2D u_vram;
uniform uvec4 u_pcrtc[11];
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

bool circuitContainsOutput(uvec4 display, uvec4 extent, uint outputX, uint outputY) {
	return outputX >= display.y
		&& outputY >= display.z
		&& outputX < extent.x
		&& outputY < extent.y;
}

uvec4 circuitPixel(uvec4 framebuffer, uvec4 display, uvec4 extentPhase, uvec4 sampling, uint outputX, uint outputY) {
#if defined(GX_GPU_SCANOUT_GX16)
	uint sourceX = framebuffer.w + outputX - display.y;
#if defined(GX_GPU_INTERLACED_FIELD)
	uint sourceY = display.x + ((outputY - display.z) >> 1u) * sampling.y + extentPhase.w;
#else
	uint sourceY = display.x + outputY - display.z;
#endif
	return rgb555Pixel(rawWordAtAddress(framebuffer.x + sourceY * framebuffer.y + sourceX));
#else
	uint sourceXNumerator = extentPhase.z + (outputX - display.y) * sampling.x;
	uint sourceYNumerator = outputY - display.z;
	uint sourceX = framebuffer.w + ((sourceXNumerator * sampling.z) >> 18u);
	uint sourceY = display.x
		+ (((sourceYNumerator * display.w) >> 18u) * sampling.y)
		+ extentPhase.w;
	uint pagesPerRow = framebuffer.y >> 6u;
	if (framebuffer.z == 0u || framebuffer.z == 1u) {
		uint address = localMemoryAddress32(framebuffer.x, pagesPerRow, sourceX, sourceY);
		uint low = rawWordAtAddress(address);
		uint high = rawWordAtAddress(address + 1u);
		uint alpha = framebuffer.z == 0u ? high >> 8u : 128u;
		return uvec4(low & 0xffu, low >> 8u, high & 0xffu, alpha);
	}
	if (framebuffer.z == 2u || framebuffer.z == 3u) {
		uint address = localMemoryAddress16(framebuffer.x, pagesPerRow, sourceX, sourceY, framebuffer.z == 3u);
		return rgb555Pixel(rawWordAtAddress(address));
	}
	if (framebuffer.z == 4u) {
		uint first = rawWordAtAddress(localMemoryAddressGpu24(framebuffer.x, pagesPerRow, sourceX, sourceY, 0u));
		uint second = rawWordAtAddress(localMemoryAddressGpu24(framebuffer.x, pagesPerRow, sourceX, sourceY, 1u));
		uint rgb = (sourceX & 1u) == 0u
			? first | ((second & 0xffu) << 16u)
			: (first >> 8u) | (second << 8u);
		return uvec4(rgb & 0xffu, (rgb >> 8u) & 0xffu, (rgb >> 16u) & 0xffu, 128u);
	}
	if (framebuffer.z == 5u) {
		return rgb555Pixel(rawWordAtAddress(framebuffer.x + sourceY * framebuffer.y + sourceX));
	}
	return uvec4(0u);
#endif
}

uvec4 mergedPixel(uint outputX, uint outputY) {
	uvec4 under = uvec4(u_pcrtc[1].yzw, 0u);
	bool circuit2ContainsOutput = u_pcrtc[0].y != 0u
		&& circuitContainsOutput(u_pcrtc[8], u_pcrtc[9], outputX, outputY);
	if (circuit2ContainsOutput) {
		uvec4 circuit2 = circuitPixel(u_pcrtc[7], u_pcrtc[8], u_pcrtc[9], u_pcrtc[10], outputX, outputY);
		if (u_pcrtc[2].y != 0u) under.rgb = circuit2.rgb;
		if (u_pcrtc[0].w != 0u) under.a = circuit2.a;
	}
	if (u_pcrtc[0].x == 0u || !circuitContainsOutput(u_pcrtc[4], u_pcrtc[5], outputX, outputY)) {
		return under;
	}
	uvec4 circuit1 = circuitPixel(u_pcrtc[3], u_pcrtc[4], u_pcrtc[5], u_pcrtc[6], outputX, outputY);
	uint alpha = u_pcrtc[0].z != 0u ? u_pcrtc[2].x : min(circuit1.a << 1u, 255u);
	uint inverseAlpha = 255u - alpha;
	uvec3 rgb = (circuit1.rgb * uvec3(alpha) + under.rgb * uvec3(inverseAlpha) + uvec3(127u)) / uvec3(255u);
	return uvec4(rgb, u_pcrtc[0].w != 0u ? under.a : circuit1.a);
}

vec4 outputPixel(uint outputX, uint outputY) {
#if defined(GX_GPU_SCANOUT_GX16_DIRECT)
	return vec4(circuitPixel(u_pcrtc[3], u_pcrtc[4], u_pcrtc[5], u_pcrtc[6], outputX, outputY)) / 255.0;
#else
	return vec4(mergedPixel(outputX, outputY)) / 255.0;
#endif
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
	uint outputY = u_pcrtc[1].x - 1u - uint(gl_FragCoord.y);
	outputColor = outputPixel(uint(gl_FragCoord.x), outputY);
#endif
}
