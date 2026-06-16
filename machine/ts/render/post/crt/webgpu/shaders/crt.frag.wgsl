struct CRTUniforms {
	src: vec4<f32>,
	flags0: vec4<f32>,
	flags1: vec4<f32>,
	params: vec4<f32>,
	colorBleed: vec4<f32>,
	glowColor: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: CRTUniforms;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

const LUMA = vec3<f32>(0.299, 0.587, 0.114);
const APERTURE_STRENGTH = 0.08;
const FRINGING_BASE_PX = 0.8;
const FRINGING_QUAD_COEF = 2.5;
const FRINGING_CONTRAST_COEF = 0.4;
const FRINGING_MIX = 0.11;
const FRINGING_OFFSET = 0.5;
const BLUR_FOOTPRINT_PX = 0.5;
const K_NORM = 1.0 / 256.0;
const BLACK_CUTOFF = 0.015;
const BLACK_SOFT = 0.060;
const SCANLINE_DEPTH = 0.07;

struct BlurContrast {
	blurred: vec3<f32>,
	contrast: f32,
};

fn enabled(flag: f32) -> bool {
	return flag != 0.0;
}


fn hashNoise(uv: vec2<f32>, t: f32) -> f32 {
	let wrappedUV = uv - floor(uv / vec2<f32>(1024.0)) * vec2<f32>(1024.0);
	let wrappedT = t - floor(t / 4096.0) * 4096.0;
	var p = vec3<f32>(wrappedUV * 0.1, wrappedT * 0.0001);
	p = fract(p * vec3<f32>(12.9898, 78.233, 43758.5453));
	p += dot(p, p.yzx + vec3<f32>(19.19));
	return fract((p.x + p.y) * p.z);
}

fn sampleColor(uv: vec2<f32>) -> vec3<f32> {
	return textureSample(u_texture, u_sampler, uv).rgb;
}

fn applyBlurAndContrast(uv: vec2<f32>, texel: vec2<f32>, footprintPx: f32) -> BlurContrast {
	let stepUV = texel * footprintPx;
	var accum = vec3<f32>(0.0);
	var centerLum = 0.0;
	var neighLum = 0.0;
	var s: vec3<f32>;

	s = sampleColor(uv + vec2<f32>(-2.0, -2.0) * stepUV); accum += s * 1.0;
	s = sampleColor(uv + vec2<f32>(-1.0, -2.0) * stepUV); accum += s * 4.0;
	s = sampleColor(uv + vec2<f32>(0.0, -2.0) * stepUV); accum += s * 6.0;
	s = sampleColor(uv + vec2<f32>(1.0, -2.0) * stepUV); accum += s * 4.0;
	s = sampleColor(uv + vec2<f32>(2.0, -2.0) * stepUV); accum += s * 1.0;

	s = sampleColor(uv + vec2<f32>(-2.0, -1.0) * stepUV); accum += s * 4.0;
	s = sampleColor(uv + vec2<f32>(-1.0, -1.0) * stepUV); accum += s * 16.0; neighLum += dot(s, LUMA);
	s = sampleColor(uv + vec2<f32>(0.0, -1.0) * stepUV); accum += s * 24.0; neighLum += dot(s, LUMA);
	s = sampleColor(uv + vec2<f32>(1.0, -1.0) * stepUV); accum += s * 16.0; neighLum += dot(s, LUMA);
	s = sampleColor(uv + vec2<f32>(2.0, -1.0) * stepUV); accum += s * 4.0;

	s = sampleColor(uv + vec2<f32>(-2.0, 0.0) * stepUV); accum += s * 6.0;
	s = sampleColor(uv + vec2<f32>(-1.0, 0.0) * stepUV); accum += s * 24.0; neighLum += dot(s, LUMA);
	s = sampleColor(uv); accum += s * 36.0; centerLum = dot(s, LUMA);
	s = sampleColor(uv + vec2<f32>(1.0, 0.0) * stepUV); accum += s * 24.0; neighLum += dot(s, LUMA);
	s = sampleColor(uv + vec2<f32>(2.0, 0.0) * stepUV); accum += s * 6.0;

	s = sampleColor(uv + vec2<f32>(-2.0, 1.0) * stepUV); accum += s * 4.0;
	s = sampleColor(uv + vec2<f32>(-1.0, 1.0) * stepUV); accum += s * 16.0; neighLum += dot(s, LUMA);
	s = sampleColor(uv + vec2<f32>(0.0, 1.0) * stepUV); accum += s * 24.0; neighLum += dot(s, LUMA);
	s = sampleColor(uv + vec2<f32>(1.0, 1.0) * stepUV); accum += s * 16.0; neighLum += dot(s, LUMA);
	s = sampleColor(uv + vec2<f32>(2.0, 1.0) * stepUV); accum += s * 4.0;

	s = sampleColor(uv + vec2<f32>(-2.0, 2.0) * stepUV); accum += s * 1.0;
	s = sampleColor(uv + vec2<f32>(-1.0, 2.0) * stepUV); accum += s * 4.0;
	s = sampleColor(uv + vec2<f32>(0.0, 2.0) * stepUV); accum += s * 6.0;
	s = sampleColor(uv + vec2<f32>(1.0, 2.0) * stepUV); accum += s * 4.0;
	s = sampleColor(uv + vec2<f32>(2.0, 2.0) * stepUV); accum += s * 1.0;

	return BlurContrast(accum * K_NORM, abs(centerLum - neighLum * 0.125));
}

fn applyScanlines(colorLinear: vec3<f32>, uv: vec2<f32>, srcPxRes: vec2<f32>) -> vec3<f32> {
	let row = floor(uv.y * srcPxRes.y);
	let phase = cos(3.14159265359 * row);
	let lum = dot(colorLinear, LUMA);
	let amplitude = mix(SCANLINE_DEPTH, 0.12, lum);
	var m = 1.0 - amplitude * (0.5 - 0.5 * phase);
	m /= 1.0 - 0.5 * amplitude;
	let k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
	return colorLinear * (1.0 + k * (m - 1.0));
}

fn applyApertureMask(colorLinear: vec3<f32>, uv: vec2<f32>, srcPxRes: vec2<f32>) -> vec3<f32> {
	let x = floor(uv.x * srcPxRes.x);
	let p = x - floor(x / 3.0) * 3.0;
	let r = step(0.5, 1.0 - abs(p - 0.0));
	let g = step(0.5, 1.0 - abs(p - 1.0));
	let b = step(0.5, 1.0 - abs(p - 2.0));
	let mask = vec3<f32>(1.0) + APERTURE_STRENGTH * (vec3<f32>(r, g, b) * 2.0 - vec3<f32>(1.0));
	let lum = dot(colorLinear, LUMA);
	let k = sqrt(smoothstep(0.0, 0.25, lum));
	return colorLinear * (1.0 + k * (mask - vec3<f32>(1.0)));
}

fn applyFringing(color: vec3<f32>, uv: vec2<f32>, texel: vec2<f32>, contrast: f32, mixAmount: f32) -> vec3<f32> {
	let dUV = uv - vec2<f32>(FRINGING_OFFSET);
	let d = length(dUV) / length(vec2<f32>(0.5));
	var dir = vec2<f32>(1.0, 0.0);
	if (d > 0.0) {
		dir = dUV / d;
	}
	let shiftPx = FRINGING_BASE_PX + FRINGING_QUAD_COEF * (d * d) + FRINGING_CONTRAST_COEF * contrast;
	let shiftUV = dir * (shiftPx * texel);
	let fringed = vec3<f32>(
		sampleColor(uv + shiftUV).r,
		sampleColor(uv).g,
		sampleColor(uv - shiftUV).b,
	);
	return mix(color, fringed, mixAmount);
}

fn applyNoise(color: vec3<f32>, uv: vec2<f32>, srcPxRes: vec2<f32>) -> vec3<f32> {
	let ySrc = uv.y * srcPxRes.y;
	let time = u.src.w;
	let lineNoise = hashNoise(vec2<f32>(0.0, floor(ySrc) + time * 30.0), 0.0) - 0.5;
	let pixNoise = hashNoise(uv * srcPxRes + vec2<f32>(u.flags0.x), time) - 0.5;
	let lum = dot(color, LUMA);
	let n = mix(pixNoise, lineNoise, 0.35);
	let k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
	let amp = u.params.x * mix(0.2, 1.0, 1.0 - lum);
	return color * (n * amp * k);
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
	let srcPxRes = u.src.xy * u.src.z;
	let texel = vec2<f32>(1.0) / srcPxRes;
	var color = sampleColor(uv);

	if (enabled(u.flags0.z)) {
		color += u.colorBleed.rgb;
	}

	var bc: BlurContrast;
	if (enabled(u.flags1.x) || enabled(u.flags1.z) || enabled(u.flags1.w) || enabled(u.flags0.w)) {
		bc = applyBlurAndContrast(uv, texel, BLUR_FOOTPRINT_PX);
	} else {
		bc = BlurContrast(color, 0.0);
	}

	let edge = smoothstep(0.01, 0.05, bc.contrast);

	if (enabled(u.flags1.x)) {
		let blurK = mix(0.25, 1.0, 1.0 - edge) * u.params.y;
		color = mix(color, bc.blurred, blurK);
	}

	if (enabled(u.flags1.z)) {
		color = applyFringing(color, uv, texel, bc.contrast, FRINGING_MIX * edge);
	}

	if (enabled(u.flags0.w)) {
		let scanlined = applyScanlines(color, uv, srcPxRes);
		color = mix(scanlined, color, edge);
	}

	if (enabled(u.flags1.w)) {
		let aperture = applyApertureMask(color, uv, srcPxRes);
		color = mix(aperture, color, edge);
	}

	if (enabled(u.flags1.y)) {
		let brightness = dot(color, LUMA);
		let k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, brightness);
		color += u.glowColor.rgb * brightness * k;
	}

	if (enabled(u.flags0.y)) {
		color += applyNoise(color, uv, srcPxRes);
	}

	let keep = smoothstep(BLACK_CUTOFF, BLACK_SOFT, dot(color, LUMA));
	color *= keep;
	return vec4<f32>(color, 1.0);
}
