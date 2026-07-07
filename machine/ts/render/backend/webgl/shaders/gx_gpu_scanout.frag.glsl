#version 300 es
precision highp float;

uniform sampler2D u_vram;
uniform float u_displayModeWord;
uniform float u_displayStartWord;
uniform float u_horizontalDisplayRangeWord;
uniform float u_verticalDisplayRangeWord;
in vec2 v_texcoord;
out vec4 outputColor;

const vec2 VRAM_SIZE = vec2(1024.0, 512.0);
const float DISPLAY_MODE_RGB24_BIT = 16.0;
const float DISPLAY_MODE_PAL_BIT = 8.0;
const float DISPLAY_MODE_VERTICAL_RESOLUTION_BIT = 4.0;
const float DISPLAY_MODE_VERTICAL_INTERLACE_BIT = 32.0;
const float DISPLAY_MODE_HORIZONTAL_RESOLUTION_2_BIT = 64.0;
const float PSX_HORIZONTAL_CYCLES_PER_320_LINE = 2560.0;
const float NTSC_OVERSCAN_LEFT = 608.0;
const float PAL_OVERSCAN_LEFT = 638.0;
const float NTSC_OVERSCAN_TOP = 16.0;
const float PAL_OVERSCAN_TOP = 35.0;

float rawWordFromPixel(vec4 rawPixel) {
	float lowByte = floor(rawPixel.r * 255.0 + 0.5);
	float highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

float rawWordAtLogical(float x, float y) {
	vec2 vramCoord = vec2(mod(x, VRAM_SIZE.x), mod(y, VRAM_SIZE.y));
	vec2 texcoord = vec2((vramCoord.x + 0.5) / VRAM_SIZE.x, 1.0 - (vramCoord.y + 0.5) / VRAM_SIZE.y);
	return rawWordFromPixel(texture(u_vram, texcoord));
}

float truncateToInteger(float value) {
	if (value < 0.0) {
		return -floor(-value);
	}
	return floor(value);
}

bool displayModeBit(float bitValue) {
	return mod(floor(u_displayModeWord / bitValue), 2.0) > 0.5;
}

float displayStartX() {
	return mod(u_displayStartWord, 1024.0);
}

float displayStartY() {
	return mod(floor(u_displayStartWord / 1024.0), 512.0);
}

float displayScreenWidth() {
	float horizontalResolution1 = mod(floor(u_displayModeWord), 4.0);
	bool horizontalResolution2 = displayModeBit(DISPLAY_MODE_HORIZONTAL_RESOLUTION_2_BIT);
	if (horizontalResolution1 < 0.5) {
		if (horizontalResolution2) {
			return 368.0;
		}
		return 256.0;
	}
	if (horizontalResolution1 < 1.5) {
		if (horizontalResolution2) {
			return 384.0;
		}
		return 320.0;
	}
	if (horizontalResolution1 < 2.5) {
		return 512.0;
	}
	return 640.0;
}

float displayScreenHeight() {
	bool highVerticalResolution = displayModeBit(DISPLAY_MODE_VERTICAL_RESOLUTION_BIT);
	if (displayModeBit(DISPLAY_MODE_PAL_BIT)) {
		if (highVerticalResolution) {
			return 512.0;
		}
		return 256.0;
	}
	if (highVerticalResolution) {
		return 480.0;
	}
	return 240.0;
}

vec3 rgb555ToRgb8(float word) {
	float lowByte = mod(word, 256.0);
	float highByte = floor(word / 256.0);
	float r5 = mod(lowByte, 32.0);
	float g5 = floor(lowByte / 32.0) + mod(highByte, 4.0) * 8.0;
	float b5 = mod(floor(highByte / 4.0), 32.0);
	vec3 color5 = vec3(r5, g5, b5);
	return color5 * 8.0 + floor(color5 / 4.0);
}

vec3 rgb888AtSourcePixel(float sourceX, float sourceY) {
	float wordX = displayStartX() + floor(sourceX * 1.5);
	float outputX = floor(sourceX);
	float word0 = rawWordAtLogical(wordX, sourceY);
	float word1 = rawWordAtLogical(wordX + 1.0, sourceY);
	float low0 = mod(word0, 256.0);
	float high0 = floor(word0 / 256.0);
	float low1 = mod(word1, 256.0);
	float high1 = floor(word1 / 256.0);
	if (mod(outputX, 2.0) < 0.5) {
		return vec3(low0, high0, low1);
	}
	return vec3(high0, low1, high1);
}

vec3 displayRgb() {
	float screenWidth = displayScreenWidth();
	float screenHeight = displayScreenHeight();
	float screenX = floor(v_texcoord.x * screenWidth);
	float screenY = floor(v_texcoord.y * screenHeight);

	float horizontalStart = mod(u_horizontalDisplayRangeWord, 4096.0);
	float horizontalEnd = mod(floor(u_horizontalDisplayRangeWord / 4096.0), 4096.0);
	float verticalStart = mod(u_verticalDisplayRangeWord, 1024.0);
	float verticalEnd = mod(floor(u_verticalDisplayRangeWord / 1024.0), 1024.0);

	float overscanLeft = NTSC_OVERSCAN_LEFT;
	float overscanTop = NTSC_OVERSCAN_TOP;
	if (displayModeBit(DISPLAY_MODE_PAL_BIT)) {
		overscanLeft = PAL_OVERSCAN_LEFT;
		overscanTop = PAL_OVERSCAN_TOP;
	}

	float originLeft = truncateToInteger(((horizontalStart - overscanLeft) * screenWidth) / PSX_HORIZONTAL_CYCLES_PER_320_LINE);
	float sourceSkipX = 0.0;
	float columns = truncateToInteger(((horizontalEnd - horizontalStart) * screenWidth) / PSX_HORIZONTAL_CYCLES_PER_320_LINE);
	if (originLeft < 0.0) {
		sourceSkipX = -originLeft;
		columns += originLeft;
		originLeft = 0.0;
	}
	float maxColumns = screenWidth - originLeft;
	if (columns > maxColumns) {
		columns = maxColumns;
	}

	float originTop = verticalStart - overscanTop;
	float sourceSkipY = 0.0;
	float lines = verticalEnd - verticalStart;
	if (originTop < 0.0) {
		sourceSkipY = -originTop;
		lines += originTop;
		originTop = 0.0;
	}
	if (displayModeBit(DISPLAY_MODE_VERTICAL_INTERLACE_BIT)) {
		lines *= 2.0;
	}
	float maxLines = screenHeight - originTop;
	if (lines > maxLines) {
		lines = maxLines;
	}

	if (screenX < originLeft || screenY < originTop || screenX >= originLeft + columns || screenY >= originTop + lines) {
		return vec3(0.0, 0.0, 0.0);
	}

	float sourceX = sourceSkipX + screenX - originLeft;
	float sourceY = displayStartY() + sourceSkipY + screenY - originTop;
	if (displayModeBit(DISPLAY_MODE_RGB24_BIT)) {
		return rgb888AtSourcePixel(sourceX, sourceY);
	}
	return rgb555ToRgb8(rawWordAtLogical(displayStartX() + sourceX, sourceY));
}

void main() {
	vec3 rgb8 = displayRgb();
	outputColor = vec4(rgb8 / 255.0, 1.0);
}
