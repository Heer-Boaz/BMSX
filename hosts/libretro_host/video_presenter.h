#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "frame_timing.h"
#include "libretro.h"
#include "video_context.h"

void video_presenter_open(BmsxVideoSurface* surface, BmsxFrameTimingState* frame_timing);
void video_presenter_close(void);

void video_presenter_update_av_info(const struct retro_system_av_info* av_info);
void video_presenter_update_geometry(const struct retro_game_geometry* geometry);
bool video_presenter_accept_pixel_format(enum retro_pixel_format pixel_format);
bool video_presenter_negotiate_hw_render(struct retro_hw_render_callback* callback);
void video_presenter_activate_core_context(void);
void video_presenter_destroy_core_context(void);

void video_presenter_post_message(const struct retro_message* message);
void video_presenter_surface_changed(void);
void video_presenter_begin_frame(bool drop_presentation);
bool video_presenter_end_frame(void);
void video_presenter_refresh(const void* data, unsigned width, unsigned height, size_t pitch);

uint64_t video_presenter_presentation_count(void);
void video_presenter_reset_presentation_timeline(void);

void video_presenter_map_surface_point(
		int surface_x,
		int surface_y,
		int16_t* pointer_x,
		int16_t* pointer_y,
		bool* inside_game_viewport);
