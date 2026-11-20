// Drawing-area scissoring must not round a new vertex into an integer edge.
// The viewport extends beyond VRAM to keep the original endpoints.
vec4 gxRasterPosition(vec2 position) {
	vec2 clip = (position - vec2(float(GX_GPU_RASTER_VIEWPORT_CENTER)))
		* (2.0 / float(GX_GPU_RASTER_VIEWPORT_EXTENT));
	return vec4(clip, 0.0, 1.0);
}
