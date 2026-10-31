struct Instance { clip_from_model: mat4x4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> instance: Instance;
@vertex fn vertex_main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
 return instance.clip_from_model * vec4<f32>(position,1.0);
}
@fragment fn fragment_main() -> @location(0) vec4<f32> { return vec4<f32>(instance.color.rgb,1.0); }
