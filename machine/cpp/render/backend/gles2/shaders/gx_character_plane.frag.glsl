precision mediump float;

uniform sampler2D u_character_cells;
uniform sampler2D u_character_glyphs;
uniform sampler2D u_character_palette;
uniform vec2 u_resolution;

void main() {
	vec2 pixel = floor(vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y));
	if (pixel.x >= 640.0 || pixel.y >= 480.0) {
		discard;
	}
	vec2 cell_position = floor(pixel / vec2(4.0, 6.0));
	vec3 cell = floor(texture2D(u_character_cells, (cell_position + 0.5) / vec2(256.0, 80.0)).rgb * 255.0 + 0.5);
	vec2 glyph_position = vec2(mod(cell.r, 16.0) * 4.0 + mod(pixel.x, 4.0), floor(cell.r / 16.0) * 6.0 + mod(pixel.y, 6.0));
	float glyph_pixel = texture2D(u_character_glyphs, (glyph_position + 0.5) / vec2(64.0, 96.0)).r;
	float palette_index = glyph_pixel >= 0.5 ? cell.g : cell.b;
	vec4 color = texture2D(u_character_palette, vec2((palette_index + 0.5) / 64.0, 0.5));
	if (color.a < 0.5) {
		discard;
	}
	gl_FragColor = color;
}
