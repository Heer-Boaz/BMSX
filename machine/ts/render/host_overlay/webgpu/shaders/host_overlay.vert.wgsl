struct OverlayUniforms {
	logical_size: vec2<f32>,
	padding: vec2<f32>,
};

@group(0) @binding(0) var<uniform> overlay: OverlayUniforms;

struct VertexInput {
	@location(0) origin: vec2<f32>,
	@location(1) axis_x: vec2<f32>,
	@location(2) axis_y: vec2<f32>,
	@location(3) uv0: vec2<f32>,
	@location(4) uv1: vec2<f32>,
	@location(5) texture_kind: u32,
	@location(6) color: vec4<f32>,
};

struct VertexOutput {
	@builtin(position) position: vec4<f32>,
	@location(0) texcoord: vec2<f32>,
	@location(1) color: vec4<f32>,
	@location(2) @interpolate(flat) texture_kind: u32,
};

const QUAD_CORNERS = array<vec2<f32>, 6>(
	vec2<f32>(0.0, 0.0),
	vec2<f32>(0.0, 1.0),
	vec2<f32>(1.0, 0.0),
	vec2<f32>(1.0, 0.0),
	vec2<f32>(0.0, 1.0),
	vec2<f32>(1.0, 1.0),
);

@vertex
fn main(input: VertexInput, @builtin(vertex_index) vertex_index: u32) -> VertexOutput {
	let corner = QUAD_CORNERS[vertex_index];
	let pixel_position = input.origin + input.axis_x * corner.x + input.axis_y * corner.y;
	let normalized_position = pixel_position / overlay.logical_size;
	var output: VertexOutput;
	output.position = vec4<f32>(normalized_position.x * 2.0 - 1.0, 1.0 - normalized_position.y * 2.0, 0.0, 1.0);
	output.texcoord = mix(input.uv0, input.uv1, corner);
	output.color = input.color;
	output.texture_kind = input.texture_kind;
	return output;
}
