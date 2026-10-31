#version 300 es
precision highp float;
layout(location=0) in vec3 position;
uniform mat4 clip_from_model;
void main(){ vec4 p=clip_from_model*vec4(position,1.0); gl_Position=vec4(p.xy,2.0*p.z-p.w,p.w); }
