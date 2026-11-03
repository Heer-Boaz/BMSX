#version 300 es
precision highp float;
uniform vec4 color;
uniform sampler2D bitmap;
in vec3 affine_uv;
out vec4 output_color;
void main(){ vec4 texel=texture(bitmap,affine_uv.xy/affine_uv.z)*color; if(texel.a==0.0) discard; output_color=vec4(texel.rgb*texel.a,texel.a); }
