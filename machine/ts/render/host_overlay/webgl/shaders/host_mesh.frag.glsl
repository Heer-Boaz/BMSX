#version 300 es
precision highp float;
uniform vec3 color;
out vec4 output_color;
void main(){ output_color=vec4(color,1.0); }
