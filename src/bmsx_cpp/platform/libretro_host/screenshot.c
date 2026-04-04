#include "screenshot.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <sys/stat.h>
#include <sys/types.h>

static const char* g_screenshot_dir = "./screenshots";

bool screenshot_config_load(const char* filename, ScreenshotConfig* config) {
	if (!filename || !config) return false;
	
	memset(config, 0, sizeof(*config));
	config->capacity = 16;
	config->frames = malloc(sizeof(uint32_t) * config->capacity);
	if (!config->frames) return false;
	
	FILE* f = fopen(filename, "r");
	if (!f) {
		fprintf(stderr, "[SCREENSHOT] Config file not found: %s\n", filename);
		return false;
	}
	
	// Very basic JSON parser - look for "frames": [ ... ]
	char buffer[65536];
	size_t bytes_read = fread(buffer, 1, sizeof(buffer) - 1, f);
	fclose(f);
	if (bytes_read == 0) {
		fprintf(stderr, "[SCREENSHOT] Empty config file\n");
		return false;
	}
	buffer[bytes_read] = '\0';
	
	// Find "frames" array
	const char* frames_ptr = strstr(buffer, "\"frames\"");
	if (!frames_ptr) {
		fprintf(stderr, "[SCREENSHOT] No 'frames' field in config\n");
		return false;
	}
	
	// Find opening bracket
	const char* bracket = strchr(frames_ptr, '[');
	if (!bracket) {
		fprintf(stderr, "[SCREENSHOT] No opening bracket in frames array\n");
		return false;
	}
	
	// Parse numbers until closing bracket
	const char* p = bracket + 1;
	while (*p && *p != ']') {
		while (*p && !isdigit(*p) && *p != ']') p++;
		if (*p == ']') break;
		
		uint32_t frame_num = 0;
		while (isdigit(*p)) {
			frame_num = frame_num * 10 + (*p - '0');
			p++;
		}
		
		if (config->frame_count >= config->capacity) {
			config->capacity *= 2;
			uint32_t* new_frames = realloc(config->frames, sizeof(uint32_t) * config->capacity);
			if (!new_frames) {
				fprintf(stderr, "[SCREENSHOT] Memory allocation failed\n");
				return false;
			}
			config->frames = new_frames;
		}
		
		config->frames[config->frame_count++] = frame_num;
		fprintf(stderr, "[SCREENSHOT] Will capture frame %u\n", frame_num);
	}
	
	if (config->frame_count == 0) {
		fprintf(stderr, "[SCREENSHOT] No frame numbers found in config\n");
		return false;
	}
	
	fprintf(stderr, "[SCREENSHOT] Loaded config: will capture %zu frames\n", config->frame_count);
	return true;
}

void screenshot_config_free(ScreenshotConfig* config) {
	if (!config) return;
	if (config->frames) {
		free(config->frames);
		config->frames = NULL;
	}
	config->frame_count = 0;
	config->capacity = 0;
}

bool screenshot_should_capture(const ScreenshotConfig* config, uint32_t current_frame) {
	if (!config || config->frame_count == 0) return false;
	for (size_t i = 0; i < config->frame_count; i++) {
		if (config->frames[i] == current_frame) return true;
	}
	return false;
}

bool screenshot_save_ppm(const char* filename, uint32_t width, uint32_t height, const uint8_t* rgba_data) {
	if (!filename || width == 0 || height == 0 || !rgba_data) return false;
	
	// Ensure output directory exists
	mkdir(g_screenshot_dir, 0755);
	
	char full_path[512];
	snprintf(full_path, sizeof(full_path), "%s/%s", g_screenshot_dir, filename);
	
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
