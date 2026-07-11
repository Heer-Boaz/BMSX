struct VSOut {
	@builtin(position) position: vec4<f32>,
	@location(0) uv: vec2<f32>,
};

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
	var positions = array<vec2<f32>, 3>(
		vec2<f32>(-1.0, -3.0),
		vec2<f32>(3.0, 1.0),
		vec2<f32>(-1.0, 1.0),
	);
	var out: VSOut;
	out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
	out.uv = out.position.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
	return out;
}
