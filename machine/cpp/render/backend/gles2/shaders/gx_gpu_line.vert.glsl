precision highp float;
precision highp int;

attribute vec2 a_position;
attribute vec2 a_lineStart;
attribute vec2 a_lineEnd;
attribute vec3 a_color0;
attribute vec3 a_color1;
varying vec2 v_lineStart;
varying vec2 v_lineEnd;
varying vec3 v_colorBase;
varying vec3 v_colorStep;

int absolute(int value) {
	return value < 0 ? -value : value;
}

int signedUnit(int value) {
	return value < 0 ? -1 : (value > 0 ? 1 : 0);
}

void main() {
	vec2 clip = vec2(
		a_position.x * 2.0 / float(GX_GPU_VRAM_X_ADDRESS_PERIOD) - 1.0,
		a_position.y * 2.0 / float(GX_GPU_VRAM_Y_ADDRESS_PERIOD) - 1.0
	);
	gl_Position = vec4(clip, 0.0, 1.0);
	ivec2 lineStart = ivec2(a_lineStart);
	ivec2 lineEnd = ivec2(a_lineEnd);
	ivec3 color0 = ivec3(a_color0 * 255.0 + 0.5);
	ivec3 colorDelta = ivec3(a_color1 * 255.0 + 0.5) - color0;
	ivec2 delta = lineEnd - lineStart;
	int absX = absolute(delta.x);
	int absY = absolute(delta.y);
	int steps = absX > absY ? absX : absY;
	ivec3 colorStep = ivec3(0);
	if (steps > 0) {
		colorStep = ivec3(
			signedUnit(colorDelta.x) * absolute(colorDelta.x) * 4096 / steps,
			signedUnit(colorDelta.y) * absolute(colorDelta.y) * 4096 / steps,
			signedUnit(colorDelta.z) * absolute(colorDelta.z) * 4096 / steps
		);
	}
	v_lineStart = vec2(lineStart);
	v_lineEnd = vec2(lineEnd);
	v_colorBase = vec3(color0 * 4096 + ivec3(2048));
	v_colorStep = vec3(colorStep);
}
