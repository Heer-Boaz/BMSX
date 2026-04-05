#include "screenshot.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

enum { kScreenshotDirMax = 1024 };
enum { kScreenshotPathMax = 4096 };

static char g_screenshot_dir[kScreenshotDirMax] = "./screenshots";

void screenshot_set_output_dir(const char* output_dir) {
	snprintf(g_screenshot_dir, sizeof(g_screenshot_dir), "%s", output_dir);
}

bool screenshot_save_ppm(const char* filename, uint32_t width, uint32_t height, const uint8_t* rgba_data) {
	if (!filename || width == 0 || height == 0 || !rgba_data) return false;
	
	// Ensure output directory exists
	mkdir(g_screenshot_dir, 0755);
	
	char full_path[kScreenshotPathMax];
	const size_t dir_len = strlen(g_screenshot_dir);
	const size_t file_len = strlen(filename);
	if (dir_len + 1 + file_len >= sizeof(full_path)) {
		fprintf(stderr, "[SCREENSHOT] Output path is too long: %s/%s\n", g_screenshot_dir, filename);
		return false;
	}
	memcpy(full_path, g_screenshot_dir, dir_len);
	full_path[dir_len] = '/';
	memcpy(full_path + dir_len + 1, filename, file_len + 1);
	
	FILE* f = fopen(full_path, "wb");
	if (!f) {
		fprintf(stderr, "[SCREENSHOT] Failed to open output file: %s\n", full_path);
		return false;
	}
	
	// PPM P6 format (binary RGB)
	fprintf(f, "P6\n");
	fprintf(f, "%u %u\n", width, height);
	fprintf(f, "255\n");
	
	// Convert RGBA to RGB and write (bottom-to-top from glReadPixels → flip to top-to-bottom for PPM)
	for (int32_t y = (int32_t)height - 1; y >= 0; y--) {
		for (uint32_t x = 0; x < width; x++) {
			size_t idx = ((uint32_t)y * width + x) * 4;
			uint8_t r = rgba_data[idx + 0];
			uint8_t g = rgba_data[idx + 1];
			uint8_t b = rgba_data[idx + 2];
			fputc(r, f);
			fputc(g, f);
			fputc(b, f);
		}
	}
	
	fclose(f);
	fprintf(stderr, "[SCREENSHOT] Saved: %s\n", full_path);
	return true;
}

const char* screenshot_get_output_dir(void) {
	return g_screenshot_dir;
}
