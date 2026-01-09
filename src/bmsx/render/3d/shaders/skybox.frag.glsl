#version 300 es
precision mediump float;

in vec3 v_texcoord;
uniform samplerCube u_skybox;
out vec4 outputColor;
uniform vec3 u_skyTint;
uniform float u_skyExposure;

vec3 srgb_to_linear(vec3 c){ return pow(c, vec3(2.2)); }

void main() {
	vec3 texColor = texture(u_skybox, v_texcoord).rgb;
	texColor *= (u_skyTint * u_skyExposure);
	vec3 colorLinear = srgb_to_linear(texColor);
	outputColor = vec4(colorLinear, 1.0f);
}
