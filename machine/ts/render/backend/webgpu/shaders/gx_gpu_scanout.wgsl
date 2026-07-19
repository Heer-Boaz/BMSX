struct ScanoutUniforms {
	pcrtc: array<vec4<u32>, 8>,
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

fn rawByteAtAddress(address: u32) -> u32 {
	let wrappedAddress = address & 0x1fffffu;
	let word = rawWordAtAddress(wrappedAddress >> 1u);
	return select(word & 0xffu, word >> 8u, (wrappedAddress & 1u) != 0u);
}

fn rgb555Pixel(word: u32) -> vec4<u32> {
	let color5 = vec3<u32>(word & 0x1fu, (word >> 5u) & 0x1fu, (word >> 10u) & 0x1fu);
	let rgb8 = color5 * vec3<u32>(8u) + color5 / vec3<u32>(4u);
	return vec4<u32>(rgb8, select(0u, 128u, (word & 0x8000u) != 0u));
}

fn circuitContainsOutput(display: vec4<u32>, extent: vec4<u32>, outputX: u32, outputY: u32) -> bool {
	return outputX >= display.y
		&& outputY >= display.z
		&& outputX < extent.y
		&& outputY < extent.z;
}

fn circuitPixel(
	framebuffer: vec4<u32>,
	display: vec4<u32>,
	extent: vec4<u32>,
	outputX: u32,
	outputY: u32,
) -> vec4<u32> {
	let sourceX = framebuffer.w + (outputX - display.y) / display.w;
	let sourceY = display.x + (outputY - display.z) / extent.x;
	let pixelOffset = sourceY * framebuffer.y + sourceX;
	if (framebuffer.z == 0u || framebuffer.z == 1u) {
		let address = framebuffer.x + pixelOffset * 2u;
		let low = rawWordAtAddress(address);
		let high = rawWordAtAddress(address + 1u);
		let alpha = select(128u, high >> 8u, framebuffer.z == 0u);
		return vec4<u32>(low & 0xffu, low >> 8u, high & 0xffu, alpha);
	}
	if (framebuffer.z == 18u) {
		let address = (framebuffer.x << 1u) + pixelOffset * 3u;
		return vec4<u32>(rawByteAtAddress(address), rawByteAtAddress(address + 1u), rawByteAtAddress(address + 2u), 128u);
	}
	return rgb555Pixel(rawWordAtAddress(framebuffer.x + pixelOffset));
}

fn mergedPixel(outputX: u32, outputY: u32) -> vec3<u32> {
	var under = u.pcrtc[1].yzw;
	if (u.pcrtc[0].y != 0u && circuitContainsOutput(u.pcrtc[6], u.pcrtc[7], outputX, outputY)) {
		under = circuitPixel(u.pcrtc[5], u.pcrtc[6], u.pcrtc[7], outputX, outputY).rgb;
	}
	if (u.pcrtc[0].x == 0u || !circuitContainsOutput(u.pcrtc[3], u.pcrtc[4], outputX, outputY)) {
		return under;
	}
	let circuit1 = circuitPixel(u.pcrtc[2], u.pcrtc[3], u.pcrtc[4], outputX, outputY);
	var alpha = min(circuit1.a << 1u, 255u);
	if (u.pcrtc[0].z != 0u) {
		alpha = u.pcrtc[1].x;
	}
	let inverseAlpha = 255u - alpha;
	return (circuit1.rgb * vec3<u32>(alpha) + under * vec3<u32>(inverseAlpha) + vec3<u32>(127u)) / vec3<u32>(255u);
}

fn outputPixel(outputX: u32, outputY: u32) -> vec4<f32> {
	return vec4<f32>(vec3<f32>(mergedPixel(outputX, outputY)) / 255.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	return outputPixel(u32(position.x), u32(position.y));
}

@fragment
fn fs_interlaced_field(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let storedY = u32(position.y);
	let field = select(0u, 1u, storedY >= u.interlace.x);
	let fieldLine = storedY - field * u.interlace.x;
	return outputPixel(u32(position.x), field + fieldLine * 2u);
}

@fragment
fn fs_interlaced_weave(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let outputY = u32(position.y);
	let field = outputY & 1u;
	let fieldLine = outputY >> 1u;
	return textureLoad(u_vram, vec2<i32>(i32(u32(position.x)), i32(field * u.interlace.x + fieldLine)), 0);
}
