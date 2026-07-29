struct ScanoutUniforms {
	circuit: array<vec4<u32>, 5>,
	interlace: vec4<u32>,
	background: vec4<u32>,
};

override storagePath: u32 = 6u;
override linearGx16: bool = false;
override doubleAlpha: bool = false;
override interlacedField: bool = false;
override gxGpuVramXAddressPeriod: u32;
override gxGpuVramAddressWordMask: u32;
override gxGpuVramPhysicalWordMask: u32;

@group(0) @binding(0) var<uniform> u: ScanoutUniforms;
@group(0) @binding(1) var u_vram: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
	var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
	return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}

fn rawWordAtAddress(address: u32) -> u32 {
	let wrappedAddress = address & gxGpuVramPhysicalWordMask;
	let rawPixel = textureLoad(u_vram, vec2<i32>(
		i32(wrappedAddress % gxGpuVramXAddressPeriod),
		i32(wrappedAddress / gxGpuVramXAddressPeriod)), 0);
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
	return (baseWord + (page << 12u) + (block << 7u) + (column << 1u)) & gxGpuVramAddressWordMask;
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
	return (baseWord + (page << 12u) + (block << 7u) + localMemoryColumn16(pageX, pageY)) & gxGpuVramAddressWordMask;
}

fn localMemoryAddressGpu24(baseWord: u32, pagesPerRow: u32, pixelX: u32, y: u32, word: u32) -> u32 {
	return localMemoryAddress16(baseWord, pagesPerRow, ((pixelX * 3u) >> 1u) + word, y, false);
}

fn circuitPixel(outputX: u32, outputY: u32) -> vec4<u32> {
	if (linearGx16) {
		let sourceX = u.circuit[0].w + outputX - u.circuit[1].y;
		let sourceY = u.circuit[3].w
			+ ((outputY - u.circuit[3].z) >> select(0u, 1u, interlacedField)) * u.circuit[4].x;
		return rgb555Pixel(rawWordAtAddress(u.circuit[0].x + sourceY * u.circuit[0].y + sourceX));
	}
	let sourceXNumerator = u.circuit[2].x + (outputX - u.circuit[1].y) * u.circuit[2].z;
	let sourceX = u.circuit[0].w + ((sourceXNumerator * u.circuit[3].x) >> 18u);
	let sourceY = u.circuit[1].x
		+ ((((outputY - u.circuit[1].z) * u.circuit[1].w) >> 18u) * u.circuit[2].w)
		+ u.circuit[2].y;
	switch storagePath {
		case 0u: {
			let address = localMemoryAddress32(u.circuit[0].x, u.circuit[0].z, sourceX, sourceY);
			let low = rawWordAtAddress(address);
			let high = rawWordAtAddress(address + 1u);
			return vec4<u32>(low & 0xffu, low >> 8u, high & 0xffu, high >> 8u);
		}
		case 1u: {
			let address = localMemoryAddress32(u.circuit[0].x, u.circuit[0].z, sourceX, sourceY);
			let low = rawWordAtAddress(address);
			let high = rawWordAtAddress(address + 1u);
			return vec4<u32>(low & 0xffu, low >> 8u, high & 0xffu, 128u);
		}
		case 2u: {
			return rgb555Pixel(rawWordAtAddress(localMemoryAddress16(
				u.circuit[0].x, u.circuit[0].z, sourceX, sourceY, false)));
		}
		case 3u: {
			return rgb555Pixel(rawWordAtAddress(localMemoryAddress16(
				u.circuit[0].x, u.circuit[0].z, sourceX, sourceY, true)));
		}
		case 4u: {
			let first = rawWordAtAddress(localMemoryAddressGpu24(u.circuit[0].x, u.circuit[0].z, sourceX, sourceY, 0u));
			let second = rawWordAtAddress(localMemoryAddressGpu24(u.circuit[0].x, u.circuit[0].z, sourceX, sourceY, 1u));
			let rgb = select(
				first | ((second & 0xffu) << 16u),
				(first >> 8u) | (second << 8u),
				(sourceX & 1u) != 0u);
			return vec4<u32>(rgb & 0xffu, (rgb >> 8u) & 0xffu, (rgb >> 16u) & 0xffu, 128u);
		}
		case 5u: {
			return rgb555Pixel(rawWordAtAddress(u.circuit[0].x + sourceY * u.circuit[0].y + sourceX));
		}
		case 6u: {
			return vec4<u32>(0u);
		}
		default: {
			return vec4<u32>(storagePath & 0xffu, (storagePath >> 8u) & 0xffu, 0xffu, 0xffu);
		}
	}
}

fn outputPixel(outputX: u32, outputY: u32) -> vec4<f32> {
	var pixel = circuitPixel(outputX, outputY);
	if (doubleAlpha) {
		pixel.a = min(pixel.a << 1u, 255u);
	}
	return vec4<f32>(pixel) / 255.0;
}

@fragment
fn fs_circuit(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	return outputPixel(u32(position.x), u32(position.y));
}

@fragment
fn fs_interlaced_field(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let fieldLine = u32(position.y) - u.interlace.w;
	return outputPixel(u32(position.x), u.interlace.z + fieldLine * 2u);
}

@fragment
fn fs_background() -> @location(0) vec4<f32> {
	return vec4<f32>(u.background) / 255.0;
}

@fragment
fn fs_interlaced_weave(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let outputY = u32(position.y);
	let field = outputY & 1u;
	let fieldLine = outputY >> 1u;
	let fieldOffset = select(0u, u.interlace.x, field != 0u);
	return textureLoad(u_vram, vec2<i32>(i32(u32(position.x)), i32(fieldOffset + fieldLine)), 0);
}
