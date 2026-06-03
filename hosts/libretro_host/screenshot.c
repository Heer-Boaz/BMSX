#include "screenshot.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <zlib.h>

enum { kScreenshotDirMax = 1024 };
enum { kScreenshotPathMax = 4096 };
enum { kPngSignatureSize = 8 };

static char g_screenshot_dir[kScreenshotDirMax] = "./screenshots";

static bool screenshot_write_all(FILE* file, const void* data, size_t size) {
	return fwrite(data, 1, size, file) == size;
}

static void screenshot_write_be32(uint8_t* out, uint32_t value) {
	out[0] = (uint8_t)(value >> 24);
	out[1] = (uint8_t)(value >> 16);
	out[2] = (uint8_t)(value >> 8);
	out[3] = (uint8_t)(value >> 0);
}

static bool screenshot_write_png_chunk(FILE* file, const char* type, const uint8_t* data, uint32_t length) {
	uint8_t length_bytes[4];
	screenshot_write_be32(length_bytes, length);
	if (!screenshot_write_all(file, length_bytes, sizeof(length_bytes))) {
		return false;
	}
	if (!screenshot_write_all(file, type, 4)) {
		return false;
	}
	if (length > 0 && (!data || !screenshot_write_all(file, data, length))) {
		return false;
	}
	uLong crc = crc32(0L, Z_NULL, 0);
	crc = crc32(crc, (const Bytef*)type, 4);
	if (length > 0) {
		crc = crc32(crc, data, length);
	}
	uint8_t crc_bytes[4];
	screenshot_write_be32(crc_bytes, (uint32_t)crc);
	return screenshot_write_all(file, crc_bytes, sizeof(crc_bytes));
}

void screenshot_set_output_dir(const char* output_dir) {
	snprintf(g_screenshot_dir, sizeof(g_screenshot_dir), "%s", output_dir);
}

bool screenshot_save_png(const char* filename, uint32_t width, uint32_t height, const uint8_t* rgba_data) {
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

	const size_t row_bytes = (size_t)width * 4u;
	const size_t raw_bytes = ((size_t)width * 4u + 1u) * (size_t)height;
	uint8_t* raw = (uint8_t*)malloc(raw_bytes);
	if (!raw) {
		fclose(f);
		fprintf(stderr, "[SCREENSHOT] Failed to allocate PNG scanlines: %zu bytes\n", raw_bytes);
		return false;
	}
	for (uint32_t y = 0; y < height; ++y) {
		const size_t dst_row = (size_t)y * (row_bytes + 1u);
		const uint32_t src_y = height - 1u - y;
		raw[dst_row] = 0;
		memcpy(raw + dst_row + 1u, rgba_data + ((size_t)src_y * row_bytes), row_bytes);
	}

	uLongf compressed_bytes = compressBound((uLong)raw_bytes);
	uint8_t* compressed = (uint8_t*)malloc((size_t)compressed_bytes);
	if (!compressed) {
		free(raw);
		fclose(f);
		fprintf(stderr, "[SCREENSHOT] Failed to allocate PNG buffer: %lu bytes\n", (unsigned long)compressed_bytes);
		return false;
	}
	const int compress_result = compress2(compressed, &compressed_bytes, raw, (uLong)raw_bytes, Z_BEST_SPEED);
	free(raw);
	if (compress_result != Z_OK) {
		free(compressed);
		fclose(f);
		fprintf(stderr, "[SCREENSHOT] PNG compression failed for %s (zlib=%d)\n", full_path, compress_result);
		return false;
	}

	static const uint8_t kPngSignature[kPngSignatureSize] = { 137, 80, 78, 71, 13, 10, 26, 10 };
	uint8_t ihdr[13];
	screenshot_write_be32(ihdr + 0, width);
	screenshot_write_be32(ihdr + 4, height);
	ihdr[8] = 8;
	ihdr[9] = 6;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	bool ok = true;
	ok = ok && screenshot_write_all(f, kPngSignature, sizeof(kPngSignature));
	ok = ok && screenshot_write_png_chunk(f, "IHDR", ihdr, sizeof(ihdr));
	ok = ok && screenshot_write_png_chunk(f, "IDAT", compressed, (uint32_t)compressed_bytes);
	ok = ok && screenshot_write_png_chunk(f, "IEND", NULL, 0);
	free(compressed);
	if (!ok) {
		fclose(f);
		fprintf(stderr, "[SCREENSHOT] Failed to write PNG data: %s\n", full_path);
		return false;
	}
	
	fclose(f);
	fprintf(stderr, "[SCREENSHOT] Saved: %s\n", full_path);
	return true;
}

const char* screenshot_get_output_dir(void) {
	return g_screenshot_dir;
}
