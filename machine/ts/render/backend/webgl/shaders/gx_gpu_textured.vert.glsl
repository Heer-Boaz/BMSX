#version 300 es
precision highp float;
precision highp int;

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

in vec2 a_position;
in uvec2 a_uvPlaneBase;
in uvec2 a_uvPlaneStepX;
in uvec2 a_uvPlaneStepY;
uniform float u_rasterPhase;
flat out uvec2 v_uvPlaneBase;
flat out uvec2 v_uvPlaneStepX;
flat out uvec2 v_uvPlaneStepY;
#if GX_GPU_FIXED_COLOR_PLANE
in uvec3 a_colorPlaneBase;
in uvec3 a_colorPlaneStepX;
in uvec3 a_colorPlaneStepY;
flat out uvec3 v_colorPlaneBase;
flat out uvec3 v_colorPlaneStepX;
flat out uvec3 v_colorPlaneStepY;
#else
in vec3 a_color;
out vec3 v_color;
#endif

void main() {
	vec2 rasterPosition = a_position + vec2(u_rasterPhase);
	vec2 clip = vec2((rasterPosition.x / 512.0) - 1.0, (rasterPosition.y / 512.0) - 1.0);
	gl_Position = vec4(clip, 0.0, 1.0);
	v_uvPlaneBase = a_uvPlaneBase;
	v_uvPlaneStepX = a_uvPlaneStepX;
	v_uvPlaneStepY = a_uvPlaneStepY;
#if GX_GPU_FIXED_COLOR_PLANE
	v_colorPlaneBase = a_colorPlaneBase;
	v_colorPlaneStepX = a_colorPlaneStepX;
	v_colorPlaneStepY = a_colorPlaneStepY;
#else
	v_color = a_color;
#endif
}
