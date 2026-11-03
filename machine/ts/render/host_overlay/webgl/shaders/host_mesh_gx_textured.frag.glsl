#version 300 es
precision highp float;
precision highp int;
uniform vec4 color;
uniform sampler2D bitmap;
in vec3 affine_uv;
out vec4 output_color;
void main() {
 vec4 texel=texture(bitmap,affine_uv.xy/affine_uv.z);
 if(texel.a==0.0) discard;
 uvec3 texture5=uvec3(texel.rgb*255.0+0.5)>>3;
 uvec3 rgb5=min((texture5*uvec3(color.rgb))>>7,uvec3(31));
 output_color=vec4(vec3((rgb5<<3)|(rgb5>>2))/255.0,1.0);
}
