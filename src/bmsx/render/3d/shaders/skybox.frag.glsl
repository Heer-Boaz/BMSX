#version 300 es
precision mediump float;

in vec3 v_texcoord;
uniform samplerCube u_skybox;
out vec4 outputColor;
uniform float u_ditherIntensity;
uniform vec3 u_skyTint;
uniform float u_skyExposure;

const float[16] pattern = float[16](0.0f, 8.0f, 2.0f, 10.0f, 12.0f, 4.0f, 14.0f, 6.0f, 3.0f, 11.0f, 1.0f, 9.0f, 15.0f, 7.0f, 13.0f, 5.0f);

int bayerIndex(ivec2 p){
	ivec2 wrapped = p & ivec2(3);
	return wrapped.x + (wrapped.y << 2);
}

float bayer4x4(ivec2 p){
	return (pattern[bayerIndex(p)] + 0.5f) / 16.0f;
}

vec3 quantize_psx_ordered(vec3 sRGB, ivec2 pix, float guard0_1){
	vec3 levels = vec3(31.0f);
	float threshold = bayer4x4(pix) * clamp(guard0_1, 0.0f, 1.0f);
	return floor(sRGB * levels + threshold) / levels;
}

vec3 srgb_to_linear(vec3 c){ return pow(c, vec3(2.2)); }
vec3 linear_to_srgb(vec3 c){ return pow(max(c, vec3(0.0f)), vec3(1.0f / 2.2f)); }

void main() {
	vec3 texColor = texture(u_skybox, v_texcoord).rgb;
	texColor *= (u_skyTint * u_skyExposure);
	vec3 colorLinear = srgb_to_linear(texColor);

	vec3 colS = clamp(linear_to_srgb(colorLinear), 0.0f, 1.0f);
	float stepSz = 1.0f / 31.0f;
	float lumS = dot(colS, vec3(0.299f, 0.587f, 0.114f));
	float guard = smoothstep(stepSz, 3.0f * stepSz, lumS) * clamp(u_ditherIntensity, 0.0f, 1.0f);
	ivec2 pix = ivec2(gl_FragCoord.xy);
	vec3 qS = quantize_psx_ordered(colS, pix, guard);
	vec3 qL = srgb_to_linear(qS);

	outputColor = vec4(qL, 1.0f);
}
