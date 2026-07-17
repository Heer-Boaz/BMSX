precision highp float;

uniform sampler2D u_vram;
uniform vec4 u_readback;
uniform float u_vramYAddressExtensionWord;

const vec2 VRAM_SIZE = vec2(1024.0, 512.0);

vec2 readRawPixel(vec2 transferCoord) {
	vec2 logical = u_readback.xy + transferCoord;
	float yPeriod = mix(VRAM_SIZE.y, VRAM_SIZE.y * 2.0, step(0.5, u_vramYAddressExtensionWord));
	logical.x = mod(logical.x, VRAM_SIZE.x);
	logical.y = mod(logical.y, yPeriod);
	float installed = 1.0 - step(VRAM_SIZE.y, logical.y);
	logical.y = mod(logical.y, VRAM_SIZE.y);
	vec2 texcoord = vec2((logical.x + 0.5) / VRAM_SIZE.x, 1.0 - (logical.y + 0.5) / VRAM_SIZE.y);
	return texture2D(u_vram, texcoord).rg * installed;
}

void main() {
	float wordIndex = floor(gl_FragCoord.y) * u_readback.w + floor(gl_FragCoord.x);
	float firstPixelIndex = wordIndex * 2.0;
	float row = floor(firstPixelIndex / u_readback.z);
	float column = firstPixelIndex - row * u_readback.z;
	float secondColumn = column + 1.0;
	float rowAdvance = step(u_readback.z, secondColumn);
	secondColumn -= rowAdvance * u_readback.z;
	vec2 firstPixel = readRawPixel(vec2(column, row));
	vec2 secondPixel = readRawPixel(vec2(secondColumn, row + rowAdvance));
	gl_FragColor = vec4(firstPixel, secondPixel);
}
