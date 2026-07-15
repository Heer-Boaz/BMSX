#version 300 es
precision highp float;

uniform sampler2D u_character_cells;
uniform sampler2D u_character_glyphs;
uniform sampler2D u_character_palette;
uniform vec2 u_resolution;

out vec4 outputColor;

void main() {
	ivec2 pixel = ivec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
	if (pixel.x >= 640 || pixel.y >= 480) {
		discard;
	}
	ivec2 cellPosition = ivec2(pixel.x / 4, pixel.y / 6);
	ivec3 cell = ivec3(texelFetch(u_character_cells, cellPosition, 0).rgb * 255.0 + 0.5);
	ivec2 glyphPosition = ivec2((cell.r & 15) * 4 + (pixel.x & 3), (cell.r >> 4) * 6 + pixel.y % 6);
	float glyphPixel = texelFetch(u_character_glyphs, glyphPosition, 0).r;
	int paletteIndex = glyphPixel >= 0.5 ? cell.g : cell.b;
	vec4 color = texelFetch(u_character_palette, ivec2(paletteIndex, 0), 0);
	if (color.a < 0.5) {
		discard;
	}
	outputColor = color;
}
