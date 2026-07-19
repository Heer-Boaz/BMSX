struct ReadbackUniforms {
	params: vec4<u32>,
	vram_y_address_extension_word: u32,
	_padding0: u32,
	_padding1: u32,
	_padding2: u32,
};

@group(0) @binding(0) var<uniform> u: ReadbackUniforms;
@group(0) @binding(1) var u_vram: texture_2d<f32>;

struct VSOut {
	@builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
	var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
	var out: VSOut;
	out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
	return out;
}

fn readRawPixel(transferCoord: vec2<u32>) -> vec2<f32> {
	let x = (u.params.x + transferCoord.x) & 1023u;
	let yAddressMask = select(511u, 1023u, u.vram_y_address_extension_word != 0u);
	let logicalY = (u.params.y + transferCoord.y) & yAddressMask;
	return textureLoad(u_vram, vec2<i32>(i32(x), i32(logicalY)), 0).rg;
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let wordIndex = u32(position.y) * u.params.w + u32(position.x);
	let firstPixelIndex = wordIndex * 2u;
	let row = firstPixelIndex / u.params.z;
	let column = firstPixelIndex - row * u.params.z;
	var secondColumn = column + 1u;
	let rowAdvance = select(0u, 1u, secondColumn >= u.params.z);
	secondColumn -= rowAdvance * u.params.z;
	let firstPixel = readRawPixel(vec2<u32>(column, row));
	let secondPixel = readRawPixel(vec2<u32>(secondColumn, row + rowAdvance));
	return vec4<f32>(firstPixel, secondPixel);
}
