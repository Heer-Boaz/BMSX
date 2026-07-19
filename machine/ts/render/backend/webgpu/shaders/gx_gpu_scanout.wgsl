struct ScanoutUniforms {
	pcrtc: array<vec4<u32>, 11>,
	interlace: vec4<u32>,
};

@group(0) @binding(0) var<uniform> u: ScanoutUniforms;
@group(0) @binding(1) var u_vram: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
	var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
	return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}

fn rawWordAtAddress(address: u32) -> u32 {
	let wrappedAddress = address & 0xfffffu;
	let rawPixel = textureLoad(u_vram, vec2<i32>(i32(wrappedAddress & 0x3ffu), i32(wrappedAddress >> 10u)), 0);
	let lowByte = u32(rawPixel.r * 255.0 + 0.5);
	let highByte = u32(rawPixel.g * 255.0 + 0.5);
	return lowByte | (highByte << 8u);
}

fn rgb555Pixel(word: u32) -> vec4<u32> {
	let color5 = vec3<u32>(word & 0x1fu, (word >> 5u) & 0x1fu, (word >> 10u) & 0x1fu);
	let rgb8 = color5 * vec3<u32>(8u) + color5 / vec3<u32>(4u);
	return vec4<u32>(rgb8, select(0u, 128u, (word & 0x8000u) != 0u));
}

fn localMemoryAddress32(baseWord: u32, pagesPerRow: u32, x: u32, y: u32) -> u32 {
	let page = (y >> 5u) * pagesPerRow + (x >> 6u);
	let pageX = x & 63u;
	let pageY = y & 31u;
	let blockX = pageX >> 3u;
	let blockY = pageY >> 3u;
	let block = (blockX & 1u)
		| ((blockY & 1u) << 1u)
		| ((blockX & 2u) << 1u)
		| ((blockY & 2u) << 2u)
		| ((blockX & 4u) << 2u);
	let column = (pageX & 1u)
		| ((pageY & 1u) << 1u)
		| ((pageX & 6u) << 1u)
		| ((pageY & 6u) << 3u);
	return (baseWord + (page << 12u) + (block << 7u) + (column << 1u)) & 0xfffffu;
}

fn localMemoryColumn16(pageX: u32, pageY: u32) -> u32 {
	return ((pageX & 1u) << 1u)
		| ((pageX & 2u) << 2u)
		| ((pageX & 4u) << 2u)
		| ((pageX & 8u) >> 3u)
		| ((pageY & 1u) << 2u)
		| ((pageY & 2u) << 4u)
		| ((pageY & 4u) << 4u);
}

fn localMemoryAddress16(baseWord: u32, pagesPerRow: u32, x: u32, y: u32, signedBlocks: bool) -> u32 {
	let page = (y >> 6u) * pagesPerRow + (x >> 6u);
	let pageX = x & 63u;
	let pageY = y & 63u;
	let blockX = pageX >> 4u;
	let blockY = pageY >> 3u;
	var block = ((blockX & 1u) << 1u)
		| (blockY & 1u)
		| ((blockX & 2u) << 2u)
		| ((blockY & 2u) << 1u)
		| ((blockY & 4u) << 2u);
	if (signedBlocks) {
		block = (blockY & 1u)
			| ((blockX & 1u) << 1u)
			| (blockY & 4u)
			| ((blockY & 2u) << 2u)
			| ((blockX & 2u) << 3u);
	}
	return (baseWord + (page << 12u) + (block << 7u) + localMemoryColumn16(pageX, pageY)) & 0xfffffu;
}

fn localMemoryAddressGpu24(baseWord: u32, pagesPerRow: u32, pixelX: u32, y: u32, word: u32) -> u32 {
	return localMemoryAddress16(baseWord, pagesPerRow, ((pixelX * 3u) >> 1u) + word, y, false);
}

fn circuitContainsOutput(display: vec4<u32>, extent: vec4<u32>, outputX: u32, outputY: u32) -> bool {
	return outputX >= display.y
		&& outputY >= display.z
		&& outputX < extent.x
		&& outputY < extent.y;
}

fn circuitPixel(
	framebuffer: vec4<u32>,
	display: vec4<u32>,
	extentPhase: vec4<u32>,
	sampling: vec4<u32>,
	outputX: u32,
	outputY: u32,
) -> vec4<u32> {
	let sourceXNumerator = extentPhase.z + (outputX - display.y) * sampling.x;
	let sourceYNumerator = outputY - display.z;
	let sourceX = framebuffer.w + ((sourceXNumerator * sampling.z) >> 18u);
	let sourceY = display.x
		+ (((sourceYNumerator * display.w) >> 18u) * sampling.y)
		+ extentPhase.w;
	let pagesPerRow = framebuffer.y >> 6u;
	if (framebuffer.z == 0u || framebuffer.z == 1u) {
		let address = localMemoryAddress32(framebuffer.x, pagesPerRow, sourceX, sourceY);
		let low = rawWordAtAddress(address);
		let high = rawWordAtAddress(address + 1u);
		let alpha = select(128u, high >> 8u, framebuffer.z == 0u);
		return vec4<u32>(low & 0xffu, low >> 8u, high & 0xffu, alpha);
	}
	if (framebuffer.z == 2u || framebuffer.z == 3u) {
		let address = localMemoryAddress16(framebuffer.x, pagesPerRow, sourceX, sourceY, framebuffer.z == 3u);
		return rgb555Pixel(rawWordAtAddress(address));
	}
	if (framebuffer.z == 4u) {
		let first = rawWordAtAddress(localMemoryAddressGpu24(framebuffer.x, pagesPerRow, sourceX, sourceY, 0u));
		let second = rawWordAtAddress(localMemoryAddressGpu24(framebuffer.x, pagesPerRow, sourceX, sourceY, 1u));
		let rgb = select(
			first | ((second & 0xffu) << 16u),
			(first >> 8u) | (second << 8u),
			(sourceX & 1u) != 0u);
		return vec4<u32>(rgb & 0xffu, (rgb >> 8u) & 0xffu, (rgb >> 16u) & 0xffu, 128u);
	}
	if (framebuffer.z == 5u) {
		return rgb555Pixel(rawWordAtAddress(framebuffer.x + sourceY * framebuffer.y + sourceX));
	}
	return vec4<u32>(0u);
}

fn circuitPixelGx16(
	framebuffer: vec4<u32>,
	display: vec4<u32>,
	extentPhase: vec4<u32>,
	sampling: vec4<u32>,
	outputX: u32,
	outputY: u32,
	sourceRowShift: u32,
) -> vec4<u32> {
	let sourceX = framebuffer.w + outputX - display.y;
	let sourceY = display.x
		+ ((outputY - display.z) >> sourceRowShift) * sampling.y
		+ extentPhase.w;
	return rgb555Pixel(rawWordAtAddress(framebuffer.x + sourceY * framebuffer.y + sourceX));
}

fn mergedPixel(outputX: u32, outputY: u32) -> vec4<u32> {
	var under = vec4<u32>(u.pcrtc[1].yzw, 0u);
	let circuit2ContainsOutput = u.pcrtc[0].y != 0u
		&& circuitContainsOutput(u.pcrtc[8], u.pcrtc[9], outputX, outputY);
	if (circuit2ContainsOutput) {
		let circuit2 = circuitPixel(u.pcrtc[7], u.pcrtc[8], u.pcrtc[9], u.pcrtc[10], outputX, outputY);
		if (u.pcrtc[2].y != 0u) {
			under = vec4<u32>(circuit2.rgb, under.a);
		}
		if (u.pcrtc[0].w != 0u) {
			under.a = circuit2.a;
		}
	}
	if (u.pcrtc[0].x == 0u || !circuitContainsOutput(u.pcrtc[4], u.pcrtc[5], outputX, outputY)) {
		return under;
	}
	let circuit1 = circuitPixel(u.pcrtc[3], u.pcrtc[4], u.pcrtc[5], u.pcrtc[6], outputX, outputY);
	var alpha = min(circuit1.a << 1u, 255u);
	if (u.pcrtc[0].z != 0u) {
		alpha = u.pcrtc[2].x;
	}
	let inverseAlpha = 255u - alpha;
	let rgb = (circuit1.rgb * vec3<u32>(alpha) + under.rgb * vec3<u32>(inverseAlpha) + vec3<u32>(127u)) / vec3<u32>(255u);
	return vec4<u32>(rgb, select(circuit1.a, under.a, u.pcrtc[0].w != 0u));
}

fn outputPixel(outputX: u32, outputY: u32) -> vec4<f32> {
	return vec4<f32>(mergedPixel(outputX, outputY)) / 255.0;
}

fn mergedPixelGx16(outputX: u32, outputY: u32, sourceRowShift: u32) -> vec4<u32> {
	var under = vec4<u32>(u.pcrtc[1].yzw, 0u);
	let circuit2ContainsOutput = u.pcrtc[0].y != 0u
		&& circuitContainsOutput(u.pcrtc[8], u.pcrtc[9], outputX, outputY);
	if (circuit2ContainsOutput) {
		let circuit2 = circuitPixelGx16(u.pcrtc[7], u.pcrtc[8], u.pcrtc[9], u.pcrtc[10], outputX, outputY, sourceRowShift);
		if (u.pcrtc[2].y != 0u) {
			under = vec4<u32>(circuit2.rgb, under.a);
		}
		if (u.pcrtc[0].w != 0u) {
			under.a = circuit2.a;
		}
	}
	if (u.pcrtc[0].x == 0u || !circuitContainsOutput(u.pcrtc[4], u.pcrtc[5], outputX, outputY)) {
		return under;
	}
	let circuit1 = circuitPixelGx16(u.pcrtc[3], u.pcrtc[4], u.pcrtc[5], u.pcrtc[6], outputX, outputY, sourceRowShift);
	var alpha = min(circuit1.a << 1u, 255u);
	if (u.pcrtc[0].z != 0u) {
		alpha = u.pcrtc[2].x;
	}
	let inverseAlpha = 255u - alpha;
	let rgb = (circuit1.rgb * vec3<u32>(alpha) + under.rgb * vec3<u32>(inverseAlpha) + vec3<u32>(127u)) / vec3<u32>(255u);
	return vec4<u32>(rgb, select(circuit1.a, under.a, u.pcrtc[0].w != 0u));
}

fn outputPixelGx16(outputX: u32, outputY: u32, sourceRowShift: u32) -> vec4<f32> {
	return vec4<f32>(mergedPixelGx16(outputX, outputY, sourceRowShift)) / 255.0;
}

fn outputPixelGx16Direct(outputX: u32, outputY: u32, sourceRowShift: u32) -> vec4<f32> {
	return vec4<f32>(circuitPixelGx16(u.pcrtc[3], u.pcrtc[4], u.pcrtc[5], u.pcrtc[6], outputX, outputY, sourceRowShift)) / 255.0;
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	return outputPixel(u32(position.x), u32(position.y));
}

@fragment
fn fs_gx16(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	return outputPixelGx16(u32(position.x), u32(position.y), 0u);
}

@fragment
fn fs_gx16_direct(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	return outputPixelGx16Direct(u32(position.x), u32(position.y), 0u);
}

@fragment
fn fs_interlaced_field(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let storedY = u32(position.y);
	let field = u.interlace.z;
	let fieldLine = storedY - u.interlace.w;
	return outputPixel(u32(position.x), field + fieldLine * 2u);
}

@fragment
fn fs_interlaced_field_gx16(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let storedY = u32(position.y);
	let field = u.interlace.z;
	let fieldLine = storedY - u.interlace.w;
	return outputPixelGx16(u32(position.x), field + fieldLine * 2u, 1u);
}

@fragment
fn fs_interlaced_field_gx16_direct(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let storedY = u32(position.y);
	let field = u.interlace.z;
	let fieldLine = storedY - u.interlace.w;
	return outputPixelGx16Direct(u32(position.x), field + fieldLine * 2u, 1u);
}

@fragment
fn fs_interlaced_weave(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let outputY = u32(position.y);
	let field = outputY & 1u;
	let fieldLine = outputY >> 1u;
	let fieldOffset = select(0u, u.interlace.x, field != 0u);
	return textureLoad(u_vram, vec2<i32>(i32(u32(position.x)), i32(fieldOffset + fieldLine)), 0);
}
