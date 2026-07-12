precision highp float;

attribute vec2 a_position;
attribute vec4 a_color;
attribute vec2 a_texcoord;
attribute float a_uvPlaneEnable;
attribute vec4 a_uvPlane01;
attribute vec4 a_uvPlane23;
attribute vec2 a_uvPlane4;
varying vec4 v_color;
varying vec2 v_texcoord;
varying float v_uvPlaneEnable;
varying vec4 v_uvPlane01;
varying vec4 v_uvPlane23;
varying vec2 v_uvPlane4;

void main() {
	vec2 rasterPosition = a_position + vec2(0.5);
	vec2 clip = vec2((rasterPosition.x / 512.0) - 1.0, 1.0 - (rasterPosition.y / 256.0));
	gl_Position = vec4(clip, 0.0, 1.0);
	v_color = a_color;
	v_texcoord = a_texcoord;
	v_uvPlaneEnable = a_uvPlaneEnable;
	v_uvPlane01 = a_uvPlane01;
	v_uvPlane23 = a_uvPlane23;
	v_uvPlane4 = a_uvPlane4;
}
