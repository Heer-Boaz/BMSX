#pragma once

#include <stdbool.h>
#include <stdint.h>

void input_timeline_configure(const char* explicit_timeline_path, const char* rom_folder, const char* game_path, uint64_t frame_usec);
void input_timeline_dispatch_before_run(uint64_t accepted_presentation_count);
bool input_timeline_consume_presented_capture(uint64_t presentation_ordinal, uint64_t* out_frame);
bool input_timeline_is_active(void);
bool input_timeline_should_auto_quit(uint64_t completed_frame, uint64_t trailing_frames);
void input_timeline_shutdown(void);
