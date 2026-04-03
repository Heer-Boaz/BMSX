#pragma once

#include <stdbool.h>
#include <stdint.h>

void input_timeline_bind_keyboard_event(void (*emit_input_event)(const char* code, bool down));
void input_timeline_configure(const char* explicit_timeline_path, const char* rom_folder, const char* game_path, uint64_t frame_usec);
void input_timeline_tick_frame(void);
void input_timeline_shutdown(void);

