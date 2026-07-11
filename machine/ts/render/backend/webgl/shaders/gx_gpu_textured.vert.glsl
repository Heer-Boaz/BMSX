#version 300 es
precision highp float;

in vec2 a_position;
in vec4 a_color;
in vec2 a_texcoord;
uniform float u_uvPlaneEnable;
uniform vec4 u_uvPlaneBase01;
uniform vec4 u_uvPlaneBase23;
uniform vec4 u_uvPlaneStepX01;
uniform vec4 u_uvPlaneStepX23;
uniform vec4 u_uvPlaneStepY01;
uniform vec4 u_uvPlaneStepY23;
uniform vec4 u_uvPlaneDigit4BaseStepX;
uniform vec4 u_uvPlaneDigit4StepYOrigin;
out vec4 v_color;
out vec2 v_texcoord;
out vec4 v_uvPlane01;
out vec4 v_uvPlane23;
out vec2 v_uvPlane4;

void main() {
	vec2 rasterPosition = a_position + vec2(0.5);
	vec2 clip = vec2((rasterPosition.x / 512.0) - 1.0, 1.0 - (rasterPosition.y / 256.0));
	gl_Position = vec4(clip, 0.0, 1.0);
	v_color = a_color;
	v_texcoord = a_texcoord;
	if (u_uvPlaneEnable > 0.5) {
		vec2 local = a_position - u_uvPlaneDigit4StepYOrigin.zw;
		v_uvPlane01 = u_uvPlaneBase01 + u_uvPlaneStepX01 * local.x + u_uvPlaneStepY01 * local.y;
		v_uvPlane23 = u_uvPlaneBase23 + u_uvPlaneStepX23 * local.x + u_uvPlaneStepY23 * local.y;
		v_uvPlane4 = u_uvPlaneDigit4BaseStepX.xy + u_uvPlaneDigit4BaseStepX.zw * local.x + u_uvPlaneDigit4StepYOrigin.xy * local.y;
	} else {
		v_uvPlane01 = vec4(0.0);
		v_uvPlane23 = vec4(0.0);
		v_uvPlane4 = vec2(0.0);
	}
}
