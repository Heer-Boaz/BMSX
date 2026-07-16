#pragma once

#include "libretro.h"

#include <stdint.h>

#ifdef BMSX_LIBRETRO_HOST_SDL
#include <SDL.h>
#endif

enum {
	KEYBOARD_INPUT_SOURCE_TIMELINE = 0,
	KEYBOARD_INPUT_SOURCE_SDL = 1,
	KEYBOARD_INPUT_SOURCE_EVDEV_FIRST = 2,
	KEYBOARD_INPUT_EVDEV_SOURCE_COUNT = 16,
	KEYBOARD_INPUT_SOURCE_COUNT = KEYBOARD_INPUT_SOURCE_EVDEV_FIRST + KEYBOARD_INPUT_EVDEV_SOURCE_COUNT,
};

void keyboard_input_set_callback(struct retro_keyboard_callback callback);
void keyboard_input_post(unsigned source, enum retro_key key, bool down);
void keyboard_input_release_source(unsigned source);
enum retro_key keyboard_input_key_from_evdev(uint16_t code);
#ifdef BMSX_LIBRETRO_HOST_SDL
enum retro_key keyboard_input_key_from_sdl(SDL_Scancode scancode);
#endif
enum retro_key keyboard_input_key_from_timeline_code(const char* code);
