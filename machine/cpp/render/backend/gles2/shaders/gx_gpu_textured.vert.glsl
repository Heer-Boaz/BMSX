precision highp float;
precision highp int;

#include "gx_gpu_words.glsl"

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

attribute vec2 a_position;
attribute vec2 a_uvPlaneBase;
attribute vec2 a_uvPlaneStepX;
attribute vec2 a_uvPlaneStepY;
attribute vec4 a_textureSource;
uniform float u_rasterPhase;
varying vec4 v_uvPlaneBase;
varying vec4 v_uvPlaneStepX;
varying vec4 v_uvPlaneStepY;
#if !GX_GPU_FIXED_COLOR_PLANE
varying vec2 v_textureSource;
varying vec2 v_rectangleUv;
#endif
#if GX_GPU_FIXED_COLOR_PLANE
attribute vec3 a_colorPlaneBase;
attribute vec3 a_colorPlaneStepX;
attribute vec3 a_colorPlaneStepY;
varying vec4 v_colorPlane[5];
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
	v_uvPlaneBase = gxSplitPlane(a_uvPlaneBase);
	v_uvPlaneStepX = gxSplitPlane(a_uvPlaneStepX);
	v_uvPlaneStepY = gxSplitPlane(a_uvPlaneStepY);
	ivec4 source = ivec4(a_textureSource);
	int clutColumn = source.z / 16;
	vec2 textureSource = vec2(source.x / 64 + (source.y / 256) * 16
		+ (clutColumn - (clutColumn / 32) * 32) * 128 - 2048,
		source.w + (clutColumn / 32) * 2048 - 2048);
#if GX_GPU_FIXED_COLOR_PLANE
	gxColorPlanePayload(a_colorPlaneBase, a_colorPlaneStepX, a_colorPlaneStepY,
		v_colorPlane[0], v_colorPlane[1], v_colorPlane[2], v_colorPlane[3], v_colorPlane[4]);
	v_colorPlane[4].zw = textureSource;
#else
	v_color = a_color;
	v_textureSource = textureSource;
	// Rectangle steps are exactly 0 or +/-1 texel per pixel. Decode once in
	// the vertex stage and interpolate bounded texel coordinates, not Q12 words.
	ivec2 sx = ivec2(a_uvPlaneStepX), sy = ivec2(a_uvPlaneStepY);
	sx = ivec2(sx.x >= 524288 ? sx.x - 1048576 : sx.x,
		sx.y >= 524288 ? sx.y - 1048576 : sx.y) / 4096;
	sy = ivec2(sy.x >= 524288 ? sy.x - 1048576 : sy.x,
		sy.y >= 524288 ? sy.y - 1048576 : sy.y) / 4096;
	ivec2 base = ivec2(a_uvPlaneBase) / 4096;
	base -= ivec2(sx.x > 0 || sy.x > 0 ? 256 : 0, sx.y > 0 || sy.y > 0 ? 256 : 0);
	vec2 samplePosition = a_position + vec2(u_rasterPhase - 0.5);
	v_rectangleUv = vec2(base) + vec2(sx) * samplePosition.x
		+ vec2(sy) * samplePosition.y + vec2(0.25);
#endif
}
