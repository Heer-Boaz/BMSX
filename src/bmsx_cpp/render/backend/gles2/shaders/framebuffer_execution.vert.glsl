precision highp float;

attribute vec2 a_corner;

attribute vec2 i_origin;
attribute vec2 i_axis_x;
attribute vec2 i_axis_y;
attribute vec2 i_uv0;
attribute vec2 i_uv1;
attribute float i_z;
attribute float i_surface_id;
attribute float i_fx;
attribute vec4 i_color;

uniform float u_scale;
uniform vec2 u_logical_size;
uniform float u_time;
uniform vec4 u_parallax_rig; // (vy, scale, impact, impact_t)
uniform vec4 u_parallax_rig2; // (bias_px, parallax_strength, scale_strength, flip_strength)
uniform float u_parallax_flip_window;

varying vec2 v_texcoord;
varying vec4 v_color_override;
varying float v_surface_id;

float wobble(float t) {
	return sin(t * 2.2) * 0.5 + sin(t * 1.1 + 1.7) * 0.5;
}

void main() {
	float depth = smoothstep(0.0, 1.0, i_z);
	float dir = sign(i_fx);
	float weight = abs(i_fx) * depth;
	float wob = wobble(u_time);
	float dy_px = (u_parallax_rig2.x + wob * u_parallax_rig.x) * weight * u_parallax_rig2.y * dir;
	float flipWindowSeconds = max(u_parallax_flip_window, 0.0001);
	float hold = 0.2 * flipWindowSeconds;
	float flipU = clamp((u_parallax_rig.w - hold) / max(flipWindowSeconds - hold, 0.0001), 0.0, 1.0);
	float flipWindow = 1.0 - smoothstep(0.0, 1.0, flipU);
	float flip = mix(1.0, -1.0, flipWindow * u_parallax_rig2.w);
	dy_px *= flip;
	float baseScale = 1.0 + (u_parallax_rig.y - 1.0) * weight * u_parallax_rig2.z;
	float impactSign = sign(u_parallax_rig.z);
	float impactMask = max(0.0, dir * impactSign);
	float pulse = exp(-8.0 * u_parallax_rig.w) * abs(u_parallax_rig.z) * weight * impactMask;
	float parallaxScale = baseScale + pulse;

	vec2 center = i_origin + (i_axis_x + i_axis_y) * 0.5;
	vec2 pos = i_origin + i_axis_x * a_corner.x + i_axis_y * a_corner.y;
	vec2 parallaxPos = (pos - center) * parallaxScale + center + vec2(0.0, dy_px);
	vec2 scaledPosition = parallaxPos * u_scale;
	vec2 clipSpace = ((scaledPosition / u_logical_size) * 2.0 - 1.0) * vec2(1.0, -1.0);

	gl_Position = vec4(clipSpace, 0.0, 1.0);
	v_texcoord = mix(i_uv0, i_uv1, a_corner);
	v_color_override = i_color;
	v_surface_id = i_surface_id;
}
