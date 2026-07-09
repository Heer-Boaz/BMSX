struct ScanoutUniforms {
	params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: ScanoutUniforms;
@group(0) @binding(1) var u_vram: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

struct VSOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
const VRAM_SIZE = vec2<f32>(1024.0, 512.0);
const DISPLAY_MODE_RGB24_BIT = 16.0;
const DISPLAY_MODE_PAL_BIT = 8.0;
const DISPLAY_MODE_VERTICAL_RESOLUTION_BIT = 4.0;
const DISPLAY_MODE_VERTICAL_INTERLACE_BIT = 32.0;
const DISPLAY_MODE_HORIZONTAL_RESOLUTION_2_BIT = 64.0;
const DOT_CLOCK_DIVIDER_256 = 10.0;
const DOT_CLOCK_DIVIDER_320 = 8.0;
const DOT_CLOCK_DIVIDER_512 = 5.0;
const DOT_CLOCK_DIVIDER_640 = 4.0;
const DOT_CLOCK_DIVIDER_368 = 7.0;
const NTSC_OVERSCAN_LEFT = 608.0;
const PAL_OVERSCAN_LEFT = 638.0;
const NTSC_OVERSCAN_TOP = 16.0;
const PAL_OVERSCAN_TOP = 35.0;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
	var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
	var out: VSOut;
	out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
	out.uv = out.position.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
	return out;
}

fn rawWordFromPixel(rawPixel: vec4<f32>) -> f32 {
	let lowByte = floor(rawPixel.r * 255.0 + 0.5);
	let highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

fn rawWordAtLogical(x: f32, y: f32) -> f32 {
	let vramCoord = vec2<f32>(x - floor(x / VRAM_SIZE.x) * VRAM_SIZE.x, y - floor(y / VRAM_SIZE.y) * VRAM_SIZE.y);
	return rawWordFromPixel(textureLoad(u_vram, vec2<i32>(i32(vramCoord.x), i32(vramCoord.y)), 0));
}

fn truncateToInteger(value: f32) -> f32 { return select(floor(value), -floor(-value), value < 0.0); }
fn displayModeWord() -> f32 { return u.params.x; }
fn displayStartWord() -> f32 { return u.params.y; }
fn horizontalDisplayRangeWord() -> f32 { return u.params.z; }
fn verticalDisplayRangeWord() -> f32 { return u.params.w; }
fn displayModeBit(bitValue: f32) -> bool { return (floor(displayModeWord() / bitValue) - floor(floor(displayModeWord() / bitValue) / 2.0) * 2.0) > 0.5; }
fn displayStartX() -> f32 { return displayStartWord() - floor(displayStartWord() / 1024.0) * 1024.0; }
fn displayStartY() -> f32 { return floor(displayStartWord() / 1024.0) - floor(floor(displayStartWord() / 1024.0) / 512.0) * 512.0; }
fn displayScreenWidth() -> f32 {
	let horizontalResolution1 = floor(displayModeWord()) - floor(floor(displayModeWord()) / 4.0) * 4.0;
	let horizontalResolution2 = displayModeBit(DISPLAY_MODE_HORIZONTAL_RESOLUTION_2_BIT);
	if (horizontalResolution1 < 0.5) { return select(256.0, 368.0, horizontalResolution2); }
	if (horizontalResolution1 < 1.5) { return select(320.0, 384.0, horizontalResolution2); }
	if (horizontalResolution1 < 2.5) { return 512.0; }
	return 640.0;
}
fn displayDotClockDivider() -> f32 {
	if (displayModeBit(DISPLAY_MODE_HORIZONTAL_RESOLUTION_2_BIT)) { return DOT_CLOCK_DIVIDER_368; }
	let horizontalResolution1 = floor(displayModeWord()) - floor(floor(displayModeWord()) / 4.0) * 4.0;
	if (horizontalResolution1 < 0.5) { return DOT_CLOCK_DIVIDER_256; }
	if (horizontalResolution1 < 1.5) { return DOT_CLOCK_DIVIDER_320; }
	if (horizontalResolution1 < 2.5) { return DOT_CLOCK_DIVIDER_512; }
	return DOT_CLOCK_DIVIDER_640;
}
fn displayScreenHeight() -> f32 {
	let highVerticalResolution = displayModeBit(DISPLAY_MODE_VERTICAL_RESOLUTION_BIT);
	if (displayModeBit(DISPLAY_MODE_PAL_BIT)) { return select(256.0, 512.0, highVerticalResolution); }
	return select(240.0, 480.0, highVerticalResolution);
}
fn horizontalVisibleColumns(horizontalStart: f32, horizontalEnd: f32, dotClockDivider: f32) -> f32 {
	let columns = truncateToInteger(((horizontalEnd - horizontalStart) / dotClockDivider) + 2.0);
	return columns - (columns - floor(columns / 4.0) * 4.0);
}
fn rgb555ToRgb8(word: f32) -> vec3<f32> {
	let lowByte = word - floor(word / 256.0) * 256.0;
	let highByte = floor(word / 256.0);
	let r5 = lowByte - floor(lowByte / 32.0) * 32.0;
	let g5 = floor(lowByte / 32.0) + (highByte - floor(highByte / 4.0) * 4.0) * 8.0;
	let b5 = floor(highByte / 4.0) - floor(floor(highByte / 4.0) / 32.0) * 32.0;
	let color5 = vec3<f32>(r5, g5, b5);
	return color5 * 8.0 + floor(color5 / 4.0);
}
fn rgb888AtSourcePixel(sourceX: f32, sourceY: f32) -> vec3<f32> {
	let wordX = displayStartX() + floor(sourceX * 1.5);
	let outputX = floor(sourceX);
	let word0 = rawWordAtLogical(wordX, sourceY);
	let word1 = rawWordAtLogical(wordX + 1.0, sourceY);
	let low0 = word0 - floor(word0 / 256.0) * 256.0;
	let high0 = floor(word0 / 256.0);
	let low1 = word1 - floor(word1 / 256.0) * 256.0;
	let high1 = floor(word1 / 256.0);
	if ((outputX - floor(outputX / 2.0) * 2.0) < 0.5) { return vec3<f32>(low0, high0, low1); }
	return vec3<f32>(high0, low1, high1);
}
fn displayRgb(uv: vec2<f32>) -> vec3<f32> {
	let screenWidth = displayScreenWidth();
	let screenHeight = displayScreenHeight();
	let dotClockDivider = displayDotClockDivider();
	let screenX = floor(uv.x * screenWidth);
	let screenY = floor(uv.y * screenHeight);
	let horizontalStart = horizontalDisplayRangeWord() - floor(horizontalDisplayRangeWord() / 4096.0) * 4096.0;
	let horizontalEnd = floor(horizontalDisplayRangeWord() / 4096.0) - floor(floor(horizontalDisplayRangeWord() / 4096.0) / 4096.0) * 4096.0;
	let verticalStart = verticalDisplayRangeWord() - floor(verticalDisplayRangeWord() / 1024.0) * 1024.0;
	let verticalEnd = floor(verticalDisplayRangeWord() / 1024.0) - floor(floor(verticalDisplayRangeWord() / 1024.0) / 1024.0) * 1024.0;
	let overscanLeft = select(NTSC_OVERSCAN_LEFT, PAL_OVERSCAN_LEFT, displayModeBit(DISPLAY_MODE_PAL_BIT));
	let overscanTop = select(NTSC_OVERSCAN_TOP, PAL_OVERSCAN_TOP, displayModeBit(DISPLAY_MODE_PAL_BIT));
	var originLeft = truncateToInteger((horizontalStart - overscanLeft) / dotClockDivider);
	var sourceSkipX = 0.0;
	var columns = horizontalVisibleColumns(horizontalStart, horizontalEnd, dotClockDivider);
	if (originLeft < 0.0) { sourceSkipX = -originLeft; columns += originLeft; originLeft = 0.0; }
	let maxColumns = screenWidth - originLeft;
	if (columns > maxColumns) { columns = maxColumns; }
	var originTop = verticalStart - overscanTop;
	var sourceSkipY = 0.0;
	var lines = verticalEnd - verticalStart;
	if (originTop < 0.0) { sourceSkipY = -originTop; lines += originTop; originTop = 0.0; }
	if (displayModeBit(DISPLAY_MODE_VERTICAL_INTERLACE_BIT)) { lines *= 2.0; }
	let maxLines = screenHeight - originTop;
	if (lines > maxLines) { lines = maxLines; }
	if (screenX < originLeft || screenY < originTop || screenX >= originLeft + columns || screenY >= originTop + lines) { return vec3<f32>(0.0); }
	let sourceX = sourceSkipX + screenX - originLeft;
	let sourceY = displayStartY() + sourceSkipY + screenY - originTop;
	if (displayModeBit(DISPLAY_MODE_RGB24_BIT)) { return rgb888AtSourcePixel(sourceX, sourceY); }
	return rgb555ToRgb8(rawWordAtLogical(displayStartX() + sourceX, sourceY));
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
	let rgb8 = displayRgb(input.uv);
	return vec4<f32>(rgb8 / 255.0, 1.0);
}
