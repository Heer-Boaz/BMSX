#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_lineStart;
in vec2 a_lineEnd;
in vec3 a_color0;
in vec3 a_color1;
uniform float u_rasterRowOrigin;
out vec2 v_lineStart;
out vec2 v_lineEnd;
out vec3 v_colorBase;
out vec3 v_colorStep;

void main() {
	vec2 rasterPosition = vec2(a_position.x, a_position.y - u_rasterRowOrigin);
	vec2 clip = vec2((rasterPosition.x / 512.0) - 1.0, 1.0 - (rasterPosition.y / 256.0));
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
