struct DeviceQuantizeUniforms {
	source: vec4<f32>,
	levels: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: DeviceQuantizeUniforms;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

fn linearToSignalChannel(c: f32) -> f32 {
	if (c <= 0.0031308) {
		return c * 12.92;
	}
	return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

fn linearToSignal(c: vec3<f32>) -> vec3<f32> {
	return vec3<f32>(
		linearToSignalChannel(c.r),
		linearToSignalChannel(c.g),
		linearToSignalChannel(c.b),
	);
}

fn signalToLinearChannel(c: f32) -> f32 {
	if (c <= 0.04045) {
		return c / 12.92;
	}
	return pow((c + 0.055) / 1.055, 2.4);
}

fn signalToLinear(c: vec3<f32>) -> vec3<f32> {
	return vec3<f32>(
		signalToLinearChannel(c.r),
		signalToLinearChannel(c.g),
		signalToLinearChannel(c.b),
	);
}

const BAYER_4X4 = array<u32, 16>(
	0u, 8u, 2u, 10u,
	12u, 4u, 14u, 6u,
	3u, 11u, 1u, 9u,
	15u, 7u, 13u, 5u,
);

fn bayer4x4Raw(pixel: vec2<u32>) -> f32 {
	let index = (pixel.x & 3u) | ((pixel.y & 3u) << 2u);
	return f32(BAYER_4X4[index]);
}

fn quantizeOrderedConditional(signal: vec3<f32>, levels: vec3<f32>, threshold: f32) -> vec3<f32> {
	let value = signal * levels;
	let quantized = vec3<f32>(vec3<u32>(value));
	return (quantized + step(vec3<f32>(threshold), value - quantized)) / levels;
}

@fragment
fn main(@builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
	let glPosition = vec2<f32>(position.x, u.source.z - position.y);
	let sourcePixel = vec2<u32>(glPosition * u.source.xy + vec2<f32>(0.5));
	let threshold = (bayer4x4Raw(sourcePixel) + 0.5) * (1.0 / 16.0);
	var signal = linearToSignal(textureSample(u_texture, u_sampler, uv).rgb);
	signal = quantizeOrderedConditional(signal, u.levels.rgb, threshold);
	return vec4<f32>(signalToLinear(signal), 1.0);
}
