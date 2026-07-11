struct DeviceQuantizeUniforms {
	source: vec4<f32>,
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

fn bayer4x4Raw(pixel: vec2<f32>) -> f32 {
	let wrapped = pixel - floor(pixel * 0.25) * 4.0;
	let low = wrapped - floor(wrapped * 0.5) * 2.0;
	let high = (wrapped - low) * 0.5;
	return abs(low.x - low.y) * 8.0 + low.y * 4.0 + abs(high.x - high.y) * 2.0 + high.y;
}

fn quantizeOrderedConditional(signal: vec3<f32>, levels: vec3<f32>, threshold: f32) -> vec3<f32> {
	let value = signal * levels;
	let quantized = floor(value);
	return (quantized + step(vec3<f32>(threshold), value - quantized)) / levels;
}

@fragment
fn main(@builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
	let targetResolution = u.source.xy * u.source.z;
	let sourceMax = u.source.xy - vec2<f32>(1.0);
	let glPosition = vec2<f32>(position.x, targetResolution.y - position.y);
	let sourcePixel = floor(glPosition / targetResolution * sourceMax + vec2<f32>(0.5));
	let threshold = (bayer4x4Raw(sourcePixel) + 0.5) * (1.0 / 16.0);
	var signal = linearToSignal(textureSample(u_texture, u_sampler, uv).rgb);
	if (u.source.w == 1.0) {
		signal = quantizeOrderedConditional(signal, vec3<f32>(31.0, 63.0, 31.0), threshold);
	} else if (u.source.w == 2.0) {
		signal = quantizeOrderedConditional(signal, vec3<f32>(7.0, 15.0, 7.0), threshold);
	}
	return vec4<f32>(signalToLinear(signal), 1.0);
}
