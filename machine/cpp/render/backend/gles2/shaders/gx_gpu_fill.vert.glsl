precision highp float;

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

attribute vec2 a_position;
uniform float u_rasterRowOrigin;
uniform float u_rasterPhase;
#if GX_GPU_FIXED_COLOR_PLANE
attribute vec4 a_colorPlane0;
attribute vec4 a_colorPlane1;
attribute vec4 a_colorPlane2;
attribute vec3 a_colorPlane3;
varying vec4 v_colorPlane0;
varying vec4 v_colorPlane1;
varying vec4 v_colorPlane2;
varying vec3 v_colorPlane3;
#else
attribute vec4 a_color;
varying vec4 v_color;
#endif

void main() {
	vec2 rasterPosition = vec2(a_position.x, a_position.y - u_rasterRowOrigin) + vec2(u_rasterPhase);
	vec2 clip = vec2((rasterPosition.x / 512.0) - 1.0, 1.0 - (rasterPosition.y / 256.0));
	gl_Position = vec4(clip, 0.0, 1.0);
#if GX_GPU_FIXED_COLOR_PLANE
	v_colorPlane0 = a_colorPlane0;
	v_colorPlane1 = a_colorPlane1;
	v_colorPlane2 = a_colorPlane2;
	v_colorPlane3 = a_colorPlane3;
#else
	v_color = a_color;
#endif
}
