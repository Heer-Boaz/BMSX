precision highp float;
precision highp int;

#include "gx_gpu_words.glsl"
#include "gx_gpu_raster_position.glsl"

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

attribute vec2 a_position;
uniform float u_rasterPhase;
#if GX_GPU_FIXED_COLOR_PLANE
attribute vec3 a_colorPlaneBase;
attribute vec3 a_colorPlaneStepX;
attribute vec3 a_colorPlaneStepY;
varying vec4 v_colorPlane[5];
#else
attribute vec4 a_color;
varying vec4 v_color;
#endif

void main() {
	gl_Position = gxRasterPosition(a_position + vec2(u_rasterPhase));
#if GX_GPU_FIXED_COLOR_PLANE
	gxColorPlanePayload(a_colorPlaneBase, a_colorPlaneStepX, a_colorPlaneStepY,
		v_colorPlane[0], v_colorPlane[1], v_colorPlane[2], v_colorPlane[3], v_colorPlane[4]);
#else
	v_color = a_color;
#endif
}
