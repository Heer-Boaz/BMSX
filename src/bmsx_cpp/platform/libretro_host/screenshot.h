#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

typedef struct {
	uint32_t* frames;
	size_t frame_count;
	size_t capacity;
} ScreenshotConfig;

// Parse JSON config file with format: { "frames": [10, 50, 100] }
bool screenshot_config_load(const char* filename, ScreenshotConfig* config);

// Free config memory
void screenshot_config_free(ScreenshotConfig* config);

// Check if current frame should be captured
bool screenshot_should_capture(const ScreenshotConfig* config, uint32_t current_frame);

// Save RGBA buffer as PPM file (simple format, no libpng dependency)
bool screenshot_save_ppm(const char* filename, uint32_t width, uint32_t height, const uint8_t* rgba_data);

// Get output directory from config or use default
const char* screenshot_get_output_dir(void);
