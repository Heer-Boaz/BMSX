#include "software_frame_blitter.h"

#include <stdint.h>
#include <string.h>

#include "host_fatal.h"
#include "video_pixels.h"

static inline void blit_integer_xrgb8888(
		BmsxVideoSurface* surface,
		int destination_x,
		int destination_y,
		unsigned scale,
		uint32_t* restrict expanded_row,
		const uint8_t* restrict source,
		unsigned source_width,
		unsigned source_height,
		size_t source_pitch) {
	if (scale == 1u) {
		for (unsigned y = 0; y < source_height; ++y) {
			memcpy(
					surface->pixels +
						(size_t)(destination_y + (int)y) * (size_t)surface->stride +
						(size_t)destination_x * sizeof(uint32_t),
					source + (size_t)y * source_pitch,
					(size_t)source_width * sizeof(uint32_t));
		}
		return;
	}

	const size_t row_bytes = (size_t)source_width * scale * sizeof(uint32_t);
	for (unsigned source_y = 0; source_y < source_height; ++source_y) {
		const uint32_t* source_row = (const uint32_t*)(
				source + (size_t)source_y * source_pitch);
		uint32_t* expanded_pixel = expanded_row;
		for (unsigned source_x = 0; source_x < source_width; ++source_x) {
			const uint32_t pixel = source_row[source_x];
			for (unsigned repeat_x = 0; repeat_x < scale; ++repeat_x) {
				*expanded_pixel++ = pixel;
			}
		}
		for (unsigned repeat_y = 0; repeat_y < scale; ++repeat_y) {
			memcpy(
					surface->pixels +
						(size_t)(destination_y + (int)(source_y * scale + repeat_y)) *
							(size_t)surface->stride +
						(size_t)destination_x * sizeof(uint32_t),
					expanded_row,
					row_bytes);
		}
	}
}

static inline void blit_integer_rgb565(
		BmsxVideoSurface* surface,
		int destination_x,
		int destination_y,
		unsigned scale,
		uint16_t* restrict expanded_row,
		const uint8_t* restrict source,
		unsigned source_width,
		unsigned source_height,
		size_t source_pitch) {
	if (scale == 1u) {
		for (unsigned y = 0; y < source_height; ++y) {
			const uint32_t* source_row = (const uint32_t*)(
					source + (size_t)y * source_pitch);
			uint16_t* target = (uint16_t*)(
					surface->pixels +
					(size_t)(destination_y + (int)y) * (size_t)surface->stride) +
					destination_x;
			for (unsigned x = 0; x < source_width; ++x) {
				target[x] = bmsx_xrgb8888_to_rgb565(source_row[x]);
			}
		}
		return;
	}

	const size_t row_bytes = (size_t)source_width * scale * sizeof(uint16_t);
	for (unsigned source_y = 0; source_y < source_height; ++source_y) {
		const uint32_t* source_row = (const uint32_t*)(
				source + (size_t)source_y * source_pitch);
		uint16_t* expanded_pixel = expanded_row;
		for (unsigned source_x = 0; source_x < source_width; ++source_x) {
			const uint16_t pixel = bmsx_xrgb8888_to_rgb565(source_row[source_x]);
			for (unsigned repeat_x = 0; repeat_x < scale; ++repeat_x) {
				*expanded_pixel++ = pixel;
			}
		}
		for (unsigned repeat_y = 0; repeat_y < scale; ++repeat_y) {
			memcpy(
					surface->pixels +
						(size_t)(destination_y + (int)(source_y * scale + repeat_y)) *
							(size_t)surface->stride +
						(size_t)destination_x * sizeof(uint16_t),
					expanded_row,
					row_bytes);
		}
	}
}

static inline void blit_integer(
		BmsxVideoSurface* surface,
		int destination_x,
		int destination_y,
		unsigned scale,
		void* restrict expanded_row,
		const uint8_t* restrict source,
		unsigned source_width,
		unsigned source_height,
		size_t source_pitch) {
	switch (surface->bits_per_pixel) {
		case 32:
			blit_integer_xrgb8888(
					surface, destination_x, destination_y, scale,
					expanded_row, source, source_width, source_height, source_pitch);
			return;
		case 16:
			blit_integer_rgb565(
					surface, destination_x, destination_y, scale,
					expanded_row, source, source_width, source_height, source_pitch);
			return;
		default:
			host_fatal("Unsupported video surface bpp: %d", surface->bits_per_pixel);
	}
}

static void blit_scaled_xrgb8888(
		BmsxVideoSurface* surface,
		int destination_x,
		int destination_y,
		int destination_width,
		int destination_height,
		const uint8_t* source,
		unsigned source_width,
		unsigned source_height,
		size_t source_pitch) {
	const uint32_t step_x =
			(uint32_t)(((uint64_t)source_width << 16) / (uint32_t)destination_width);
	const uint32_t step_y =
			(uint32_t)(((uint64_t)source_height << 16) / (uint32_t)destination_height);
	for (int y = 0; y < destination_height; ++y) {
		const uint32_t source_y = (uint32_t)(((uint64_t)y * step_y) >> 16);
		uint32_t* target = (uint32_t*)(
				surface->pixels +
				(size_t)(destination_y + y) * (size_t)surface->stride) +
				destination_x;
		const uint32_t* source_row = (const uint32_t*)(
				source + (size_t)source_y * source_pitch);
		uint32_t source_x = 0;
		for (int x = 0; x < destination_width; ++x) {
			target[x] = source_row[source_x >> 16];
			source_x += step_x;
		}
	}
}

static void blit_scaled_rgb565(
		BmsxVideoSurface* surface,
		int destination_x,
		int destination_y,
		int destination_width,
		int destination_height,
		const uint8_t* source,
		unsigned source_width,
		unsigned source_height,
		size_t source_pitch) {
	const uint32_t step_x =
			(uint32_t)(((uint64_t)source_width << 16) / (uint32_t)destination_width);
	const uint32_t step_y =
			(uint32_t)(((uint64_t)source_height << 16) / (uint32_t)destination_height);
	for (int y = 0; y < destination_height; ++y) {
		const uint32_t source_y = (uint32_t)(((uint64_t)y * step_y) >> 16);
		uint16_t* target = (uint16_t*)(
				surface->pixels +
				(size_t)(destination_y + y) * (size_t)surface->stride) +
				destination_x;
		const uint32_t* source_row = (const uint32_t*)(
				source + (size_t)source_y * source_pitch);
		uint32_t source_x = 0;
		for (int x = 0; x < destination_width; ++x) {
			target[x] = bmsx_xrgb8888_to_rgb565(source_row[source_x >> 16]);
			source_x += step_x;
		}
	}
}

void bmsx_software_frame_blit_xrgb8888(
		BmsxVideoSurface* surface,
		int destination_x,
		int destination_y,
		int destination_width,
		int destination_height,
		unsigned integer_scale,
		void* expanded_row,
		const void* source,
		unsigned source_width,
		unsigned source_height,
		size_t source_pitch) {
	const uint8_t* source_bytes = (const uint8_t*)source;
	if (integer_scale) {
		switch (integer_scale) {
			case 1:
				blit_integer(
						surface, destination_x, destination_y, 1,
						expanded_row, source_bytes,
						source_width, source_height, source_pitch);
				break;
			case 2:
				blit_integer(
						surface, destination_x, destination_y, 2,
						expanded_row, source_bytes,
						source_width, source_height, source_pitch);
				break;
			case 3:
				blit_integer(
						surface, destination_x, destination_y, 3,
						expanded_row, source_bytes,
						source_width, source_height, source_pitch);
				break;
			case 4:
				blit_integer(
						surface, destination_x, destination_y, 4,
						expanded_row, source_bytes,
						source_width, source_height, source_pitch);
				break;
			default:
				blit_integer(
						surface, destination_x, destination_y, integer_scale,
						expanded_row, source_bytes,
						source_width, source_height, source_pitch);
				break;
		}
		return;
	}

	switch (surface->bits_per_pixel) {
		case 32:
			blit_scaled_xrgb8888(
					surface,
					destination_x,
					destination_y,
					destination_width,
					destination_height,
					source_bytes,
					source_width,
					source_height,
					source_pitch);
			return;
		case 16:
			blit_scaled_rgb565(
					surface,
					destination_x,
					destination_y,
					destination_width,
					destination_height,
					source_bytes,
					source_width,
					source_height,
					source_pitch);
			return;
		default:
			host_fatal("Unsupported video surface bpp: %d", surface->bits_per_pixel);
	}
}
