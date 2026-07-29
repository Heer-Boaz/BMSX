precision highp float;

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

attribute vec2 a_position;
attribute vec2 a_uvPlaneBase;
attribute vec2 a_uvPlaneStepX;
attribute vec2 a_uvPlaneStepY;
attribute vec4 a_textureSource;
uniform float u_rasterPhase;
varying vec2 v_uvPlaneBase;
varying vec2 v_uvPlaneStepX;
varying vec2 v_uvPlaneStepY;
varying vec4 v_textureSource;
#if GX_GPU_FIXED_COLOR_PLANE
attribute vec3 a_colorPlaneBase;
attribute vec3 a_colorPlaneStepX;
attribute vec3 a_colorPlaneStepY;
varying vec3 v_colorPlaneBase;
varying vec3 v_colorPlaneStepX;
varying vec3 v_colorPlaneStepY;
#else
attribute vec3 a_color;
varying vec3 v_color;
#endif

void main() {
	vec2 rasterPosition = a_position + vec2(u_rasterPhase);
	vec2 clip = vec2(
		rasterPosition.x * 2.0 / float(GX_GPU_VRAM_X_ADDRESS_PERIOD) - 1.0,
		rasterPosition.y * 2.0 / float(GX_GPU_VRAM_Y_ADDRESS_PERIOD) - 1.0
	);
	gl_Position = vec4(clip, 0.0, 1.0);
	v_uvPlaneBase = a_uvPlaneBase;
	v_uvPlaneStepX = a_uvPlaneStepX;
	v_uvPlaneStepY = a_uvPlaneStepY;
	v_textureSource = a_textureSource;
#if GX_GPU_FIXED_COLOR_PLANE
	v_colorPlaneBase = a_colorPlaneBase;
	v_colorPlaneStepX = a_colorPlaneStepX;
	v_colorPlaneStepY = a_colorPlaneStepY;
#else
	v_color = a_color;
#endif
}
