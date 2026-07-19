#version 300 es
precision highp float;
precision highp int;

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

in vec2 a_position;
uniform float u_rasterPhase;
#if GX_GPU_FIXED_COLOR_PLANE
in uvec3 a_colorPlaneBase;
in uvec3 a_colorPlaneStepX;
in uvec3 a_colorPlaneStepY;
flat out uvec3 v_colorPlaneBase;
flat out uvec3 v_colorPlaneStepX;
flat out uvec3 v_colorPlaneStepY;
#else
in vec4 a_color;
out vec4 v_color;
#endif

void main() {
	vec2 rasterPosition = a_position + vec2(u_rasterPhase);
	vec2 clip = vec2((rasterPosition.x / 512.0) - 1.0, (rasterPosition.y / 512.0) - 1.0);
	gl_Position = vec4(clip, 0.0, 1.0);
#if GX_GPU_FIXED_COLOR_PLANE
	v_colorPlaneBase = a_colorPlaneBase;
	v_colorPlaneStepX = a_colorPlaneStepX;
	v_colorPlaneStepY = a_colorPlaneStepY;
#else
	v_color = a_color;
#endif
}
