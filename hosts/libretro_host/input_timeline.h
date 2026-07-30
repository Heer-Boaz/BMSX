#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "bmsx_libretro.h"

void input_timeline_configure(
		const char* explicit_timeline_path,
		const char* rom_folder,
		const char* game_path,
		uint64_t frame_usec,
		bmsx_read_execution_domain_id_t read_execution_domain_id);
void input_timeline_dispatch_before_run(void);
bool input_timeline_consume_presented_capture(uint64_t* out_frame);
bool input_timeline_is_active(void);
bool input_timeline_should_auto_quit(uint64_t trailing_frames);
void input_timeline_shutdown(void);
