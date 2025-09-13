#version 300 es
precision mediump float;

in vec3 v_texcoord;
uniform samplerCube u_skybox;
out vec4 outputColor;
uniform float u_ditherIntensity;
uniform vec3 u_skyTint;
uniform float u_skyExposure;

const vec3 msx1_palette[16] = vec3[](vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f), vec3(0.24f, 0.67f, 0.24f), vec3(0.33f, 0.76f, 0.33f), vec3(0.33f, 0.33f, 0.76f), vec3(0.43f, 0.43f, 0.86f), vec3(0.24f, 0.67f, 0.67f), vec3(0.47f, 0.76f, 0.76f), vec3(0.76f, 0.33f, 0.33f), vec3(0.76f, 0.43f, 0.43f), vec3(0.67f, 0.67f, 0.24f), vec3(0.76f, 0.76f, 0.33f), vec3(0.24f, 0.47f, 0.24f), vec3(0.67f, 0.33f, 0.67f), vec3(0.76f, 0.76f, 0.76f), vec3(1.0f, 1.0f, 1.0f));
const float[16] pattern = float[16](0.0f, 8.0f, 2.0f, 10.0f, 12.0f, 4.0f, 14.0f, 6.0f, 3.0f, 11.0f, 1.0f, 9.0f, 15.0f, 7.0f, 13.0f, 5.0f);

vec3 quantize(vec3 color, int mode) {
	switch (mode) {
		case 0:
			return color; // No quantization
		case 1: // MSX1: 16 colors
			float minDist = 1e10f;
			vec3 bestColor;
			for (int i = 0; i < 16; i++) {
				float dist = length(color - msx1_palette[i]);
				if (dist < minDist) {
					minDist = dist;
					bestColor = msx1_palette[i];
				}
			}
			return bestColor;
		case 2: // MSX2: 256 colors
			vec3 levels = vec3(7.0f, 7.0f, 3.0f);
			return floor(color * levels + 0.5f) / levels;
		case 3: // Playstation (PSX): 15-bit color
			vec3 psxLevels = vec3(31.0f, 31.0f, 31.0f);
			return floor(color * psxLevels + 0.5f) / psxLevels;
		default:
			return color; // Default case, no quantization
	}
}

float bayer(vec2 pos) {
	int x = int(mod(pos.x, 4.0f));
	int y = int(mod(pos.y, 4.0f));
	int index = x + y * 4;
	return (pattern[index] / 16.0f - 0.5f) * u_ditherIntensity;
}

void main() {
	vec4 texColor = texture(u_skybox, v_texcoord);
	texColor.rgb *= (u_skyTint * u_skyExposure);

	// Apply dithering
	vec3 col = quantize(texColor.xyz, 3);
	col += bayer(gl_FragCoord.xy);

	outputColor = vec4(clamp(col, 0.0f, 1.0f), 1.0f);
}
