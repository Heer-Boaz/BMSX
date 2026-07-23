#include "software_frame_blitter.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "video_pixels.h"

#define CHECK(condition) do { \
	if (!(condition)) { \
		fprintf(stderr, "CHECK failed at %s:%d: %s\n", __FILE__, __LINE__, #condition); \
		return 1; \
	} \
} while (0)

static int test_integer_xrgb8888(void) {
	const uint32_t source[] = {
		0x00112233u, 0x00445566u, 0x00FFFFFFu,
		0x00778899u, 0x00AABBCCu, 0x00FFFFFFu,
	};
	uint32_t pixels[8 * 8];
	uint32_t expanded_row[6];
	for (size_t index = 0; index < sizeof(pixels) / sizeof(pixels[0]); ++index) {
		pixels[index] = 0xDEADBEEFu;
	}
	BmsxVideoSurface surface = {
		.pixels = (uint8_t*)pixels,
		.width = 8,
		.height = 8,
		.bits_per_pixel = 32,
		.stride = 8 * (int)sizeof(uint32_t),
	};
	bmsx_software_frame_blit_xrgb8888(
			&surface,
			1,
			1,
			6,
			6,
			3,
			expanded_row,
			source,
			2,
			2,
			3 * sizeof(uint32_t));

	for (int y = 0; y < 8; ++y) {
		for (int x = 0; x < 8; ++x) {
			if (x < 1 || x >= 7 || y < 1 || y >= 7) {
				CHECK(pixels[y * 8 + x] == 0xDEADBEEFu);
				continue;
			}
			CHECK(pixels[y * 8 + x] == source[((y - 1) / 3) * 3 + (x - 1) / 3]);
		}
	}
	return 0;
}

static int test_integer_rgb565(void) {
	const uint32_t source[] = {
		0x00FF0000u, 0x0000FF00u,
	};
	uint16_t pixels[6 * 4];
	uint16_t expanded_row[4];
	for (size_t index = 0; index < sizeof(pixels) / sizeof(pixels[0]); ++index) {
		pixels[index] = 0x1234u;
	}
	BmsxVideoSurface surface = {
		.pixels = (uint8_t*)pixels,
		.width = 6,
		.height = 4,
		.bits_per_pixel = 16,
		.stride = 6 * (int)sizeof(uint16_t),
	};
	bmsx_software_frame_blit_xrgb8888(
			&surface,
			1,
			1,
			4,
			2,
			2,
			expanded_row,
			source,
			2,
			1,
			2 * sizeof(uint32_t));

	for (int y = 1; y < 3; ++y) {
		CHECK(pixels[y * 6 + 1] == bmsx_xrgb8888_to_rgb565(source[0]));
		CHECK(pixels[y * 6 + 2] == bmsx_xrgb8888_to_rgb565(source[0]));
		CHECK(pixels[y * 6 + 3] == bmsx_xrgb8888_to_rgb565(source[1]));
		CHECK(pixels[y * 6 + 4] == bmsx_xrgb8888_to_rgb565(source[1]));
	}
	CHECK(pixels[0] == 0x1234u);
	CHECK(pixels[3 * 6 + 5] == 0x1234u);
	return 0;
}

static int test_fractional_scaling(void) {
	const uint32_t source[] = {
		0x00000001u, 0x00000002u, 0x00000003u,
		0x00000004u, 0x00000005u, 0x00000006u,
	};
	uint32_t pixels[5 * 3] = {0};
	uint32_t expanded_row[5];
	BmsxVideoSurface surface = {
		.pixels = (uint8_t*)pixels,
		.width = 5,
		.height = 3,
		.bits_per_pixel = 32,
		.stride = 5 * (int)sizeof(uint32_t),
	};
	bmsx_software_frame_blit_xrgb8888(
			&surface,
			0,
			0,
			5,
			3,
			0,
			expanded_row,
			source,
			3,
			2,
			3 * sizeof(uint32_t));
	const uint32_t expected[] = {
		1, 1, 2, 2, 3,
		1, 1, 2, 2, 3,
		4, 4, 5, 5, 6,
	};
	CHECK(memcmp(pixels, expected, sizeof(expected)) == 0);
	return 0;
}

static int test_integer_scale_selection(void) {
	const uint32_t source[] = {0x00123456u, 0x00ABCDEFu};
	uint32_t pixels32[10 * 5];
	uint16_t pixels16[10 * 5];
	uint32_t expanded_row[10];
	BmsxVideoSurface surface32 = {
		.pixels = (uint8_t*)pixels32,
		.width = 10,
		.height = 5,
		.bits_per_pixel = 32,
		.stride = 10 * (int)sizeof(uint32_t),
	};
	BmsxVideoSurface surface16 = {
		.pixels = (uint8_t*)pixels16,
		.width = 10,
		.height = 5,
		.bits_per_pixel = 16,
		.stride = 10 * (int)sizeof(uint16_t),
	};
	for (unsigned scale = 1; scale <= 5; ++scale) {
		bmsx_software_frame_blit_xrgb8888(
				&surface32,
				0,
				0,
				(int)(2 * scale),
				(int)scale,
				scale,
				expanded_row,
				source,
				2,
				1,
				2 * sizeof(uint32_t));
		bmsx_software_frame_blit_xrgb8888(
				&surface16,
				0,
				0,
				(int)(2 * scale),
				(int)scale,
				scale,
				expanded_row,
				source,
				2,
				1,
				2 * sizeof(uint32_t));
		for (unsigned y = 0; y < scale; ++y) {
			for (unsigned x = 0; x < 2 * scale; ++x) {
				const uint32_t expected = source[x / scale];
				CHECK(pixels32[y * 10 + x] == expected);
				CHECK(pixels16[y * 10 + x] == bmsx_xrgb8888_to_rgb565(expected));
			}
		}
	}
	return 0;
}

int main(void) {
	CHECK(test_integer_xrgb8888() == 0);
	CHECK(test_integer_rgb565() == 0);
	CHECK(test_fractional_scaling() == 0);
	CHECK(test_integer_scale_selection() == 0);
	return 0;
}
