#version 300 es
precision highp float;
precision highp int;

in vec2 a_position;
in vec2 a_lineStart;
in vec2 a_lineEnd;
in vec3 a_color0;
in vec3 a_color1;
flat out ivec2 v_lineStart;
flat out ivec2 v_lineEnd;
flat out ivec3 v_colorBase;
flat out ivec3 v_colorStep;

void main() {
	vec2 clip = vec2((a_position.x / 512.0) - 1.0, (a_position.y / 512.0) - 1.0);
	gl_Position = vec4(clip, 0.0, 1.0);
	v_lineStart = ivec2(a_lineStart);
	v_lineEnd = ivec2(a_lineEnd);
	ivec3 color0 = ivec3(a_color0 * 255.0 + 0.5);
	ivec3 colorDelta = ivec3(a_color1 * 255.0 + 0.5) - color0;
	ivec2 delta = v_lineEnd - v_lineStart;
	int steps = max(abs(delta.x), abs(delta.y));
	v_colorBase = color0 * 4096 + ivec3(2048);
	v_colorStep = ivec3(0);
	if (steps > 0) {
		v_colorStep = sign(colorDelta) * (abs(colorDelta) * 4096 / steps);
	}
}
