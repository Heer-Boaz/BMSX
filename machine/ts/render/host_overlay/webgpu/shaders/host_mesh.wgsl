struct Instance { clip_from_model: mat4x4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> instance: Instance;
@group(1) @binding(0) var bitmap: texture_2d<f32>;
struct TexturedVertex { @builtin(position) position: vec4<f32>, @location(0) affine_uv: vec3<f32> };
@vertex fn vertex_main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
 return instance.clip_from_model * vec4<f32>(position,1.0);
}
@vertex fn vertex_textured(@location(0) position: vec3<f32>, @location(1) uv: vec2<f32>) -> TexturedVertex {
 let clip=instance.clip_from_model * vec4<f32>(position,1.0);
 // Match the GLES affine interpolator through homogeneous clipping as well.
 return TexturedVertex(clip, vec3<f32>(uv*clip.w,clip.w));
}
@fragment fn fragment_main() -> @location(0) vec4<f32> {
 if(instance.color.a==0.0) { discard; }
 return vec4<f32>(instance.color.rgb*instance.color.a,instance.color.a);
}
@fragment fn fragment_textured(input: TexturedVertex) -> @location(0) vec4<f32> {
 let size=vec2<i32>(textureDimensions(bitmap));
 let uv=input.affine_uv.xy/input.affine_uv.z;
 let point=clamp(vec2<i32>(uv*vec2<f32>(size)),vec2<i32>(0),size-vec2<i32>(1));
 let texel=textureLoad(bitmap,point,0)*instance.color;
 if(texel.a==0.0) { discard; }
 return vec4<f32>(texel.rgb*texel.a,texel.a);
}
