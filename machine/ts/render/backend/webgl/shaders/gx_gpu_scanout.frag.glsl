#version 300 es
precision highp float;
precision highp int;

out vec4 outputColor;

uniform sampler2D u_vram;
uniform uvec4 u_pcrtc[8];
uniform uvec4 u_interlace;

uint rawWordAtAddress(uint address) {
	uint wrappedAddress = address & 0xfffffu;
	ivec2 logicalCoord = ivec2(int(wrappedAddress & 0x3ffu), int(wrappedAddress >> 10u));
	vec4 rawPixel = texelFetch(u_vram, logicalCoord, 0);
	uvec2 bytes = uvec2(rawPixel.rg * 255.0 + 0.5);
	return bytes.x | (bytes.y << 8u);
}

uint rawByteAtAddress(uint address) {
	uint wrappedAddress = address & 0x1fffffu;
	uint word = rawWordAtAddress(wrappedAddress >> 1u);
	return (wrappedAddress & 1u) != 0u ? word >> 8u : word & 0xffu;
}

uvec4 rgb555Pixel(uint word) {
	uvec3 color5 = uvec3(word & 0x1fu, (word >> 5u) & 0x1fu, (word >> 10u) & 0x1fu);
	uvec3 rgb8 = color5 * uvec3(8u) + color5 / uvec3(4u);
	return uvec4(rgb8, (word & 0x8000u) != 0u ? 128u : 0u);
}

bool circuitContainsOutput(uvec4 display, uvec4 extent, uint outputX, uint outputY) {
	return outputX >= display.y
		&& outputY >= display.z
		&& outputX < extent.y
		&& outputY < extent.z;
}

uvec4 circuitPixel(uvec4 framebuffer, uvec4 display, uvec4 extent, uint outputX, uint outputY) {
	uint sourceX = framebuffer.w + (outputX - display.y) / display.w;
	uint sourceY = display.x + (outputY - display.z) / extent.x;
	uint pixelOffset = sourceY * framebuffer.y + sourceX;
	if (framebuffer.z == 0u || framebuffer.z == 1u) {
		uint address = framebuffer.x + pixelOffset * 2u;
		uint low = rawWordAtAddress(address);
		uint high = rawWordAtAddress(address + 1u);
		uint alpha = framebuffer.z == 0u ? high >> 8u : 128u;
		return uvec4(low & 0xffu, low >> 8u, high & 0xffu, alpha);
	}
	if (framebuffer.z == 18u) {
		uint address = (framebuffer.x << 1u) + pixelOffset * 3u;
		return uvec4(rawByteAtAddress(address), rawByteAtAddress(address + 1u), rawByteAtAddress(address + 2u), 128u);
	}
	return rgb555Pixel(rawWordAtAddress(framebuffer.x + pixelOffset));
}

uvec3 mergedPixel(uint outputX, uint outputY) {
	uvec3 under = u_pcrtc[1].yzw;
	if (u_pcrtc[0].y != 0u && circuitContainsOutput(u_pcrtc[6], u_pcrtc[7], outputX, outputY)) {
		under = circuitPixel(u_pcrtc[5], u_pcrtc[6], u_pcrtc[7], outputX, outputY).rgb;
	}
	if (u_pcrtc[0].x == 0u || !circuitContainsOutput(u_pcrtc[3], u_pcrtc[4], outputX, outputY)) {
		return under;
	}
	uvec4 circuit1 = circuitPixel(u_pcrtc[2], u_pcrtc[3], u_pcrtc[4], outputX, outputY);
	uint alpha = u_pcrtc[0].z != 0u ? u_pcrtc[1].x : min(circuit1.a << 1u, 255u);
	uint inverseAlpha = 255u - alpha;
	return (circuit1.rgb * uvec3(alpha) + under * uvec3(inverseAlpha) + uvec3(127u)) / uvec3(255u);
}

vec4 outputPixel(uint outputX, uint outputY) {
	return vec4(vec3(mergedPixel(outputX, outputY)) / 255.0, 1.0);
}

void main() {
#if defined(GX_GPU_INTERLACED_WEAVE)
	uint outputY = u_interlace.y - 1u - uint(gl_FragCoord.y);
	uint field = outputY & 1u;
	uint fieldLine = outputY >> 1u;
	uint storedY = field * u_interlace.x + u_interlace.x - 1u - fieldLine;
	outputColor = texelFetch(u_vram, ivec2(int(uint(gl_FragCoord.x)), int(storedY)), 0);
#elif defined(GX_GPU_INTERLACED_FIELD)
	uint storageY = uint(gl_FragCoord.y);
	uint localStorageY = storageY - u_interlace.z * u_interlace.x;
	uint fieldLine = u_interlace.x - 1u - localStorageY;
	uint outputY = u_interlace.z + fieldLine * 2u;
	outputColor = outputPixel(uint(gl_FragCoord.x), outputY);
#else
	uint outputY = u_pcrtc[0].w - 1u - uint(gl_FragCoord.y);
	outputColor = outputPixel(uint(gl_FragCoord.x), outputY);
#endif
}
