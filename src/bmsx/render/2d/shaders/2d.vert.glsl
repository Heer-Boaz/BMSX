#version 300 es
precision mediump float;

in vec2 a_corner;

in vec2 i_pos;
in vec2 i_size;
in vec2 i_uv0;
in vec2 i_uv1;
in float i_z;
in uint i_atlas_id;
in float i_fx;
in vec4 i_color;

uniform float u_scale;
uniform vec4 u_parallax_rig; // (vy, scale, impact, impact_t)

// Frame-shared UBO (std140). Only first fields are used in this shader.
layout(std140) uniform FrameUniforms {
	vec2 u_offscreenSize;
	vec2 u_logicalSize;
	vec4 u_timeDelta; // x=time, y=delta, z,w unused
	mat4 u_view;
	mat4 u_proj;
	vec4 u_cameraPos; // xyz, w pad
	vec4 u_ambient_frame; // rgb,intensity (kept for block parity with FS)
};

out vec2 v_texcoord;
out vec4 v_color_override;
flat out uint v_atlas_id;

float wobble(float t) {
	return sin(t * 2.2) * 0.5 + sin(t * 1.1 + 1.7) * 0.5;
}

void main() {
	float depth = smoothstep(0.0, 1.0, i_z);
	float weight = (i_fx * 2.0 - 1.0) * depth;
	float dy_px = wobble(u_timeDelta.x) * u_parallax_rig.x * weight;
	float baseScale = 1.0 + (u_parallax_rig.y - 1.0) * weight;
	float impactSign = sign(u_parallax_rig.z);
	float impactWeight = max(0.0, weight * impactSign);
	float pulse = exp(-8.0 * u_parallax_rig.w) * abs(u_parallax_rig.z) * impactWeight;
	float parallaxScale = baseScale + pulse;

	vec2 center = i_pos + i_size * 0.5;
	vec2 pos = i_pos + a_corner * i_size;
	vec2 parallaxPos = (pos - center) * parallaxScale + center + vec2(0.0, dy_px);
	vec2 scaledPosition = parallaxPos * u_scale;
	vec2 clipSpace = ((scaledPosition / u_logicalSize) * 2.0 - 1.0) * vec2(1.0, -1.0);

	gl_Position = vec4(clipSpace, i_z, 1.0);
	v_texcoord = mix(i_uv0, i_uv1, a_corner);
	v_color_override = i_color;
	v_atlas_id = i_atlas_id;
}
