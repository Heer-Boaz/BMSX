#version 300 es
precision highp float;

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

in vec2 a_position;
#if GX_GPU_FIXED_COLOR_PLANE
in vec4 a_uvPlane01;
in vec4 a_uvPlane23;
in vec2 a_uvPlane4;
in vec4 a_colorPlane0;
in vec4 a_colorPlane1;
in vec4 a_colorPlane2;
in vec3 a_colorPlane3;
out vec4 v_uvPlane01;
out vec4 v_uvPlane23;
out vec2 v_uvPlane4;
out vec4 v_colorPlane0;
out vec4 v_colorPlane1;
out vec4 v_colorPlane2;
out vec3 v_colorPlane3;
#else
in vec4 a_color;
in vec2 a_texcoord;
in float a_uvPlaneEnable;
in vec4 a_uvPlane01;
in vec4 a_uvPlane23;
in vec2 a_uvPlane4;
out vec4 v_color;
out vec2 v_texcoord;
out float v_uvPlaneEnable;
out vec4 v_uvPlane01;
out vec4 v_uvPlane23;
out vec2 v_uvPlane4;
#endif

void main() {
	vec2 rasterPosition = a_position + vec2(0.5);
	vec2 clip = vec2((rasterPosition.x / 512.0) - 1.0, 1.0 - (rasterPosition.y / 256.0));
	gl_Position = vec4(clip, 0.0, 1.0);
#if GX_GPU_FIXED_COLOR_PLANE
	v_uvPlane01 = a_uvPlane01;
	v_uvPlane23 = a_uvPlane23;
	v_uvPlane4 = a_uvPlane4;
	v_colorPlane0 = a_colorPlane0;
	v_colorPlane1 = a_colorPlane1;
	v_colorPlane2 = a_colorPlane2;
	v_colorPlane3 = a_colorPlane3;
#else
	v_color = a_color;
	v_texcoord = a_texcoord;
	v_uvPlaneEnable = a_uvPlaneEnable;
	v_uvPlane01 = a_uvPlane01;
	v_uvPlane23 = a_uvPlane23;
	v_uvPlane4 = a_uvPlane4;
#endif
}
