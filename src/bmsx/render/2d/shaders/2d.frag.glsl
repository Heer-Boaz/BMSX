#version 300 es
precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;
uniform float u_ditherIntensity;

in vec2 v_texcoord;
in vec4 v_color_override;
flat in uint v_atlas_id;

out vec4 outputColor;
// Frame-shared UBO with ambient
layout(std140) uniform FrameUniforms {
	vec2 u_offscreenSize;
	vec2 u_logicalSize;
	vec4 u_timeDelta; // x=time, y=delta
	mat4 u_view;
	mat4 u_proj;
	vec4 u_cameraPos; // xyz, pad
	vec4 u_ambient_frame; // rgb,intensity
};
// Ambient uniforms kept for future re-enable; disabled for now.
// uniform int u_spriteAmbientEnabled;  // 0/1
// uniform float u_spriteAmbientFactor; // 0..1

const uint ENGINE_ATLAS_ID = 254u;

const float[16] pattern = float[16](
	0.0, 8.0, 2.0, 10.0,
	12.0, 4.0, 14.0, 6.0,
	3.0, 11.0, 1.0, 9.0,
	15.0, 7.0, 13.0, 5.0
);

int bayerIndex(ivec2 p){
	ivec2 wrapped = p & ivec2(3);
	return wrapped.x + (wrapped.y << 2);
}

float bayer4x4(ivec2 p){
	return (pattern[bayerIndex(p)] + 0.5) / 16.0;
}

vec3 quantize_psx_ordered(vec3 sRGB, ivec2 pix, float guard0_1){
	vec3 levels = vec3(31.0);
	float threshold = bayer4x4(pix) * clamp(guard0_1, 0.0, 1.0);
	return floor(sRGB * levels + threshold) / levels;
}

vec3 srgb_to_linear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 linear_to_srgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

void main() {
	vec4 texColor;
	switch (v_atlas_id) {
		case 0u: // Use the first texture if atlas ID is 0
			texColor = texture(u_texture0, v_texcoord);
			break;
		case ENGINE_ATLAS_ID:
			texColor = texture(u_texture2, v_texcoord);
			break;
		case 1u: // Use the second texture if atlas ID is 1
			texColor = texture(u_texture1, v_texcoord);
			break;
		default: // Default to the dynamic atlas for any other atlas ID
			texColor = texture(u_texture1, v_texcoord);
			break;
		}
	texColor *= v_color_override;
	// Ambient sprites disabled; re-enable by restoring the mix below.
	// if (u_spriteAmbientEnabled == 1) {
	// 	float f = clamp(u_spriteAmbientFactor, 0.0, 1.0);
	// 	texColor.rgb *= mix(vec3(1.0), u_ambient_frame.rgb * u_ambient_frame.a, f);
	// }
	float intensity = clamp(u_ditherIntensity, 0.0, 1.0);
	if (intensity > 0.0) {
		vec3 colS = linear_to_srgb(texColor.rgb);
		float stepSz = 1.0 / 31.0;
		float lumS = dot(colS, vec3(0.299, 0.587, 0.114));
		float guard = smoothstep(stepSz, 3.0 * stepSz, lumS) * intensity;
		int jitter = int(fract(u_timeDelta.x * 60.0) * 4.0);
		ivec2 pix = ivec2(gl_FragCoord.xy) + ivec2(jitter);
		vec3 qS = quantize_psx_ordered(colS, pix, guard);
		texColor.rgb = srgb_to_linear(clamp(qS, 0.0, 1.0));
	}
	outputColor = texColor;
}
