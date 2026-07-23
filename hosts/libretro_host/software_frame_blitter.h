#pragma once

#include <stddef.h>

#include "video_context.h"

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
		size_t source_pitch);
