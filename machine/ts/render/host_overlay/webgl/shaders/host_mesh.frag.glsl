#version 300 es
precision highp float;
uniform vec4 color;
out vec4 output_color;
void main(){ if(color.a==0.0) discard; output_color=vec4(color.rgb*color.a,color.a); }
