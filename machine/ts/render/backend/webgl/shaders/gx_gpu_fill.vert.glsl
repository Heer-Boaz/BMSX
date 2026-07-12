#version 300 es
precision highp float;

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

in vec2 a_position;
#if GX_GPU_FIXED_COLOR_PLANE
in vec4 a_colorPlane0;
in vec4 a_colorPlane1;
in vec4 a_colorPlane2;
in vec3 a_colorPlane3;
out vec4 v_colorPlane0;
out vec4 v_colorPlane1;
out vec4 v_colorPlane2;
out vec3 v_colorPlane3;
#else
in vec4 a_color;
out vec4 v_color;
#endif

void main() {
	vec2 rasterPosition = a_position + vec2(0.5);
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
