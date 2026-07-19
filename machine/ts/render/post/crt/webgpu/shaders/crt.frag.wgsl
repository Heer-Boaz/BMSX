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
const K_NORM = 1.0 / 256.0;
const ONE_THIRD = 1.0 / 3.0;
const TWO_THIRDS = 2.0 / 3.0;
const BLACK_CUTOFF = 0.015;
const BLACK_SOFT = 0.060;
const SCANLINE_DEPTH = 0.07;

struct BlurContrast {
	center: vec3<f32>,
	blurred: vec3<f32>,
	contrast: f32,
};

fn enabled(flag: f32) -> bool {
	return flag != 0.0;
}

fn hashNoise(uv: vec2<f32>, t: f32) -> f32 {
	let wrappedUV = uv - vec2<f32>(vec2<u32>(uv / vec2<f32>(1024.0))) * vec2<f32>(1024.0);
	let wrappedT = t - f32(u32(t / 4096.0)) * 4096.0;
	var p = vec3<f32>(wrappedUV * 0.1, wrappedT * 0.0001);
	p = fract(p * vec3<f32>(12.9898, 78.233, 43758.5453));
	p += dot(p, p.yzx + vec3<f32>(19.19));
	return fract((p.x + p.y) * p.z);
}

fn sampleColor(uv: vec2<f32>) -> vec3<f32> {
	return textureSample(u_texture, u_sampler, uv).rgb;
}

// Nearest filtering collapses the half-texel 5x5 binomial taps into these
// exact 3x3 phase-dependent weights.
fn applyBlurAndContrast(uv: vec2<f32>, sourcePixel: vec2<f32>) -> BlurContrast {
	let upperHalf = step(vec2<f32>(0.5), fract(sourcePixel));
	let blurBefore = mix(vec2<f32>(5.0), vec2<f32>(1.0), upperHalf);
	let blurAfter = mix(vec2<f32>(1.0), vec2<f32>(5.0), upperHalf);
	let contrastBefore = vec2<f32>(1.0) - upperHalf;
	let contrastAfter = upperHalf;
	var blurred = vec3<f32>(0.0);
	var neighborhood = vec3<f32>(0.0);

	{
		let left = sampleColor(uv - u.src.zw);
		let center = sampleColor(uv + vec2<f32>(0.0, -u.src.w));
		let right = sampleColor(uv + vec2<f32>(u.src.z, -u.src.w));
		blurred += (left * blurBefore.x + center * 10.0 + right * blurAfter.x) * blurBefore.y;
		neighborhood += (left * contrastBefore.x + center * 2.0 + right * contrastAfter.x) * contrastBefore.y;
	}

	let centerColor = sampleColor(uv);
	{
		let left = sampleColor(uv + vec2<f32>(-u.src.z, 0.0));
		let right = sampleColor(uv + vec2<f32>(u.src.z, 0.0));
		blurred += (left * blurBefore.x + centerColor * 10.0 + right * blurAfter.x) * 10.0;
		neighborhood += (left * contrastBefore.x + centerColor * 2.0 + right * contrastAfter.x) * 2.0;
	}

	{
		let left = sampleColor(uv + vec2<f32>(-u.src.z, u.src.w));
		let center = sampleColor(uv + vec2<f32>(0.0, u.src.w));
		let right = sampleColor(uv + u.src.zw);
		blurred += (left * blurBefore.x + center * 10.0 + right * blurAfter.x) * blurAfter.y;
		neighborhood += (left * contrastBefore.x + center * 2.0 + right * contrastAfter.x) * contrastAfter.y;
	}

	return BlurContrast(
		centerColor,
		blurred * K_NORM,
		abs(dot(centerColor, LUMA) - dot(neighborhood - centerColor, LUMA) * 0.125),
	);
}

fn applyScanlines(colorLinear: vec3<f32>, sourceY: f32) -> vec3<f32> {
	let phase = 1.0 - 2.0 * step(0.5, fract(sourceY * 0.5));
	let lum = dot(colorLinear, LUMA);
	let amplitude = mix(SCANLINE_DEPTH, 0.12, lum);
	var m = 1.0 - amplitude * (0.5 - 0.5 * phase);
	m /= 1.0 - 0.5 * amplitude;
	let k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
	return colorLinear * (1.0 + k * (m - 1.0));
}

fn applyApertureMask(colorLinear: vec3<f32>, sourceX: f32) -> vec3<f32> {
	let p = fract(sourceX * ONE_THIRD);
	let greenOrBlue = step(ONE_THIRD, p);
	let blue = step(TWO_THIRDS, p);
	let active = vec3<f32>(1.0 - greenOrBlue, greenOrBlue - blue, blue);
	let maskDelta = APERTURE_STRENGTH * (active * 2.0 - vec3<f32>(1.0));
	let lum = dot(colorLinear, LUMA);
	let k = sqrt(smoothstep(0.0, 0.25, lum));
	return colorLinear * (vec3<f32>(1.0) + k * maskDelta);
}

fn applyFringing(color: vec3<f32>, uv: vec2<f32>, centerGreen: f32, contrast: f32, mixAmount: f32) -> vec3<f32> {
	let dUV = uv - vec2<f32>(FRINGING_OFFSET);
	let d = length(dUV) / length(vec2<f32>(0.5));
	var dir = vec2<f32>(1.0, 0.0);
	if (d > 0.0) {
		dir = dUV / d;
	}
	let shiftPx = FRINGING_BASE_PX + FRINGING_QUAD_COEF * (d * d) + FRINGING_CONTRAST_COEF * contrast;
	let shiftUV = dir * (shiftPx * u.src.zw);
	let fringed = vec3<f32>(
		sampleColor(uv + shiftUV).r,
		centerGreen,
		sampleColor(uv - shiftUV).b,
	);
	return mix(color, fringed, mixAmount);
}

fn applyNoise(color: vec3<f32>, sourcePixel: vec2<f32>) -> vec3<f32> {
	let time = u.params.z;
	let lineNoise = hashNoise(vec2<f32>(0.0, f32(u32(sourcePixel.y)) + time * 30.0), 0.0) - 0.5;
	let pixNoise = hashNoise(sourcePixel + vec2<f32>(u.flags0.x), time) - 0.5;
	let lum = dot(color, LUMA);
	let n = mix(pixNoise, lineNoise, 0.35);
	let k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
	let amp = u.params.x * mix(0.2, 1.0, 1.0 - lum);
	return color * (n * amp * k);
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
	let sourcePixel = uv * u.src.xy;
	var bc: BlurContrast;
	if (enabled(u.flags1.x) || enabled(u.flags1.z) || enabled(u.flags1.w) || enabled(u.flags0.w)) {
		bc = applyBlurAndContrast(uv, sourcePixel);
	} else {
		let center = sampleColor(uv);
		bc = BlurContrast(center, center, 0.0);
	}
	var color = bc.center;

	if (enabled(u.flags0.z)) {
		color += u.colorBleed.rgb;
	}

	let edge = smoothstep(0.01, 0.05, bc.contrast);

	if (enabled(u.flags1.x)) {
		let blurK = mix(0.25, 1.0, 1.0 - edge) * u.params.y;
		color = mix(color, bc.blurred, blurK);
	}

	if (enabled(u.flags1.z)) {
		color = applyFringing(color, uv, bc.center.g, bc.contrast, FRINGING_MIX * edge);
	}

	if (enabled(u.flags0.w)) {
		let scanlined = applyScanlines(color, sourcePixel.y);
		color = mix(scanlined, color, edge);
	}

	if (enabled(u.flags1.w)) {
		let aperture = applyApertureMask(color, sourcePixel.x);
		color = mix(aperture, color, edge);
	}

	if (enabled(u.flags1.y)) {
		let brightness = dot(color, LUMA);
		let k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, brightness);
		color += u.glowColor.rgb * brightness * k;
	}

	if (enabled(u.flags0.y)) {
		color += applyNoise(color, sourcePixel);
	}

	let keep = smoothstep(BLACK_CUTOFF, BLACK_SOFT, dot(color, LUMA));
	color *= keep;
	return vec4<f32>(color, 1.0);
}
