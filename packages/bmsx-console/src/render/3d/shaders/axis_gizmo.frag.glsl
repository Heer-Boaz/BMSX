#version 300 es
precision mediump float;

in vec3 v_color;
out vec4 outputColor;

void main() {
	outputColor = vec4(v_color, 1.0);
}

