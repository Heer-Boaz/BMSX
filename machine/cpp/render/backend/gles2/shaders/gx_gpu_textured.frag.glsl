precision highp float;

uniform sampler2D u_vram;
uniform vec2 u_texPageBase;
uniform vec2 u_clutBase;
uniform vec2 u_textureWindowAnd;
uniform vec2 u_textureWindowOr;
uniform float u_textureMode;
uniform float u_rawTexture;
varying vec4 v_color;
varying vec2 v_texcoord;

const vec2 VRAM_SIZE = vec2(1024.0, 512.0);

float bitAnd8(float a, float b) {
	float result = 0.0;
	float bit = 1.0;
	for (int index = 0; index < 8; index += 1) {
		float abit = mod(floor(a / bit), 2.0);
		float bbit = mod(floor(b / bit), 2.0);
		result += bit * floor(abit * bbit + 0.5);
		bit *= 2.0;
	}
	return result;
}

vec2 applyTextureWindow(vec2 texcoord) {
	vec2 coord = floor(texcoord);
	return vec2(
		bitAnd8(coord.x, u_textureWindowAnd.x) + u_textureWindowOr.x,
		bitAnd8(coord.y, u_textureWindowAnd.y) + u_textureWindowOr.y
	);
}

float rawVramWord(vec2 coord) {
	vec2 wrapped = mod(coord, VRAM_SIZE);
	vec2 storageCoord = vec2(wrapped.x, VRAM_SIZE.y - 1.0 - wrapped.y);
	vec4 rawPixel = texture2D(u_vram, (storageCoord + vec2(0.5)) / VRAM_SIZE);
	float lowByte = floor(rawPixel.r * 255.0 + 0.5);
	float highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

vec3 decodeRgb555(float word) {
	float r5 = mod(word, 32.0);
	float g5 = mod(floor(word / 32.0), 32.0);
	float b5 = mod(floor(word / 1024.0), 32.0);
	vec3 color5 = vec3(r5, g5, b5);
	return (color5 * 8.0 + floor(color5 / 4.0)) / 255.0;
}

float palette4Index(float word, float u) {
	float subpixel = mod(u, 4.0);
	return mod(floor(word / exp2(subpixel * 4.0)), 16.0);
}

float palette8Index(float word, float u) {
	float subpixel = mod(u, 2.0);
	return mod(floor(word / exp2(subpixel * 8.0)), 256.0);
}

vec4 samplePsxTexture(vec2 texcoord) {
	vec2 windowed = applyTextureWindow(texcoord);
	float textureWord;
	if (u_textureMode < 0.5) {
		vec2 wordCoord = vec2(u_texPageBase.x + floor(windowed.x / 4.0), u_texPageBase.y + windowed.y);
		textureWord = rawVramWord(wordCoord);
		float paletteIndex = palette4Index(textureWord, windowed.x);
		float paletteWord = rawVramWord(vec2(u_clutBase.x + paletteIndex, u_clutBase.y));
		return vec4(decodeRgb555(paletteWord), paletteWord == 0.0 ? 0.0 : 1.0);
	}
	if (u_textureMode < 1.5) {
		vec2 wordCoord = vec2(u_texPageBase.x + floor(windowed.x / 2.0), u_texPageBase.y + windowed.y);
		textureWord = rawVramWord(wordCoord);
		float paletteIndex = palette8Index(textureWord, windowed.x);
		float paletteWord = rawVramWord(vec2(u_clutBase.x + paletteIndex, u_clutBase.y));
		return vec4(decodeRgb555(paletteWord), paletteWord == 0.0 ? 0.0 : 1.0);
	}
	textureWord = rawVramWord(u_texPageBase + windowed);
	return vec4(decodeRgb555(textureWord), textureWord == 0.0 ? 0.0 : 1.0);
}

void main() {
	vec4 textureColor = samplePsxTexture(v_texcoord);
	if (textureColor.a < 0.5) {
		discard;
	}
	vec3 rgb = textureColor.rgb;
	if (u_rawTexture < 0.5) {
		rgb = min(rgb * v_color.rgb * 2.0, vec3(1.0));
	}
	vec3 color5 = floor((rgb * 255.0) / 8.0);
	float lowByte = mod(color5.r + color5.g * 32.0, 256.0);
	float highByte = floor(color5.g / 8.0) + color5.b * 4.0;
	gl_FragColor = vec4(lowByte / 255.0, highByte / 255.0, 0.0, 1.0);
}
