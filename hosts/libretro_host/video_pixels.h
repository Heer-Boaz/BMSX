#pragma once

#include <stdint.h>

static inline uint16_t bmsx_xrgb8888_to_rgb565(uint32_t pixel) {
	return (uint16_t)(
			((pixel & 0x00F80000u) >> 8) |
			((pixel & 0x0000FC00u) >> 5) |
			((pixel & 0x000000F8u) >> 3));
}

static inline uint32_t bmsx_rgb565_to_xrgb8888(uint16_t pixel) {
	const uint8_t red5 = (uint8_t)((pixel >> 11) & 0x1F);
	const uint8_t green6 = (uint8_t)((pixel >> 5) & 0x3F);
	const uint8_t blue5 = (uint8_t)(pixel & 0x1F);
	const uint8_t red = (uint8_t)((red5 << 3) | (red5 >> 2));
	const uint8_t green = (uint8_t)((green6 << 2) | (green6 >> 4));
	const uint8_t blue = (uint8_t)((blue5 << 3) | (blue5 >> 2));
	return (uint32_t)((red << 16) | (green << 8) | blue);
}
