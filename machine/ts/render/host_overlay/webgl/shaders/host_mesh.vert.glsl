#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec2 texcoord;
uniform mat4 clip_from_model;
// Cancel perspective interpolation, including at homogeneous clip intersections.
// GLSL ES has no noperspective qualifier.
out vec3 affine_uv;
void main(){ vec4 p=clip_from_model*vec4(position,1.0); gl_Position=vec4(p.xy,2.0*p.z-p.w,p.w); affine_uv=vec3(texcoord*p.w,p.w); }
