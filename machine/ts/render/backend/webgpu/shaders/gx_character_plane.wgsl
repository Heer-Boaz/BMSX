@group(0) @binding(0) var character_cells: texture_2d<f32>;
@group(0) @binding(1) var character_glyphs: texture_2d<f32>;
@group(0) @binding(2) var character_palette: texture_2d<f32>;

@fragment
fn main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let pixel = vec2<u32>(position.xy);
	if (pixel.x >= 640u || pixel.y >= 480u) {
		discard;
	}
	let cell_position = vec2<i32>(pixel / vec2<u32>(4u, 6u));
	let cell_sample = textureLoad(character_cells, cell_position, 0).rgb;
	let cell = vec3<u32>(cell_sample * 255.0 + 0.5);
	let glyph_position = vec2<i32>(vec2<u32>((cell.r & 15u) * 4u + (pixel.x & 3u), (cell.r >> 4u) * 6u + pixel.y % 6u));
	let glyph_pixel = textureLoad(character_glyphs, glyph_position, 0).r;
	let palette_index = select(cell.b, cell.g, glyph_pixel >= 0.5);
	let color = textureLoad(character_palette, vec2<i32>(i32(palette_index), 0), 0);
	if (color.a < 0.5) {
		discard;
	}
	return color;
}
