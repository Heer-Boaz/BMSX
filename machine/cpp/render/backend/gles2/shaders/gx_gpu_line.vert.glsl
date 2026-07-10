precision highp float;

attribute vec2 a_position;
attribute vec2 a_lineStart;
attribute vec2 a_lineEnd;
attribute vec3 a_color0;
attribute vec3 a_color1;
varying vec2 v_lineStart;
varying vec2 v_lineEnd;
varying vec3 v_colorBase;
varying vec3 v_colorStep;

void main() {
	vec2 clip = vec2((a_position.x / 512.0) - 1.0, 1.0 - (a_position.y / 256.0));
	gl_Position = vec4(clip, 0.0, 1.0);
	v_lineStart = a_lineStart;
	v_lineEnd = a_lineEnd;
	vec3 color0 = floor(a_color0 * 255.0 + 0.5);
	vec3 colorDelta = floor(a_color1 * 255.0 + 0.5) - color0;
	float steps = max(abs(a_lineEnd.x - a_lineStart.x), abs(a_lineEnd.y - a_lineStart.y));
	v_colorBase = color0 * 4096.0 + 2048.0;
	v_colorStep = vec3(0.0);
	if (steps > 0.0) {
		v_colorStep = sign(colorDelta) * floor(abs(colorDelta) * 4096.0 / steps);
	}
}
