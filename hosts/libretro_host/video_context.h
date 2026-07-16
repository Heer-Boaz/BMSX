#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef enum BmsxVideoContextKind {
	BMSX_VIDEO_CONTEXT_FBDEV,
	BMSX_VIDEO_CONTEXT_SDL_SOFTWARE,
	BMSX_VIDEO_CONTEXT_SDL_GLES2,
} BmsxVideoContextKind;

typedef struct BmsxVideoSurface {
	uint8_t* pixels;
	int width;
	int height;
	int bits_per_pixel;
	int stride;
} BmsxVideoSurface;

BmsxVideoSurface* bmsx_video_context_open(
		BmsxVideoContextKind kind,
		bool hidden_window);
void bmsx_video_context_close(void);

bool bmsx_video_context_enable_gles2(void);
void* bmsx_video_context_get_gl_proc(const char* name);
void bmsx_video_context_swap_buffers(void);

#ifdef BMSX_LIBRETRO_HOST_SDL
bool bmsx_video_context_prepare_software_frame(unsigned width, unsigned height);
bool bmsx_video_context_refresh_drawable_size(void);
void bmsx_video_context_present_software(void);
bool bmsx_video_context_window_point_to_surface(
		int window_x,
		int window_y,
		int* surface_x,
		int* surface_y);
#endif
