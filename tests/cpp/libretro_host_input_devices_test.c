#define _GNU_SOURCE

#include <SDL.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

static uint32_t sdl_buttons;

static Uint8 test_controller_button(SDL_GameController* controller, SDL_GameControllerButton button) {
	(void)controller;
	return (sdl_buttons & (1u << button)) != 0u;
}

// Exercise the shipping adapters without exporting their private mapping state.
// Only SDL's hardware query is replaced; its actual mapping table is unchanged.
#define SDL_GameControllerGetButton test_controller_button
#include "../../hosts/libretro_host/input_devices.c"
#undef SDL_GameControllerGetButton

static void require(bool condition, const char* message) {
	if (!condition) {
		fprintf(stderr, "%s\n", message);
		exit(1);
	}
}

// Mapping tests never enter the window/presentation owner.
bool bmsx_video_context_refresh_drawable_size(void) { abort(); }
void video_presenter_surface_changed(void) { abort(); }
bool bmsx_video_context_window_point_to_surface(int x, int y, int* surface_x, int* surface_y) {
	(void)x; (void)y; (void)surface_x; (void)surface_y;
	abort();
}
void video_presenter_map_surface_point(int x, int y, int16_t* pointer_x, int16_t* pointer_y, bool* inside) {
	(void)x; (void)y; (void)pointer_x; (void)pointer_y; (void)inside;
	abort();
}

int main(void) {
	const struct {
		uint16_t evdev;
		SDL_GameControllerButton sdl;
		unsigned retro;
	} bindings[] = {
		{BTN_SOUTH, SDL_CONTROLLER_BUTTON_A, RETRO_DEVICE_ID_JOYPAD_B},
		{BTN_EAST, SDL_CONTROLLER_BUTTON_B, RETRO_DEVICE_ID_JOYPAD_A},
		{BTN_WEST, SDL_CONTROLLER_BUTTON_X, RETRO_DEVICE_ID_JOYPAD_Y},
		{BTN_NORTH, SDL_CONTROLLER_BUTTON_Y, RETRO_DEVICE_ID_JOYPAD_X},
		{BTN_DPAD_UP, SDL_CONTROLLER_BUTTON_DPAD_UP, RETRO_DEVICE_ID_JOYPAD_UP},
		{BTN_DPAD_DOWN, SDL_CONTROLLER_BUTTON_DPAD_DOWN, RETRO_DEVICE_ID_JOYPAD_DOWN},
		{BTN_DPAD_LEFT, SDL_CONTROLLER_BUTTON_DPAD_LEFT, RETRO_DEVICE_ID_JOYPAD_LEFT},
		{BTN_DPAD_RIGHT, SDL_CONTROLLER_BUTTON_DPAD_RIGHT, RETRO_DEVICE_ID_JOYPAD_RIGHT},
		{BTN_TL, SDL_CONTROLLER_BUTTON_LEFTSHOULDER, RETRO_DEVICE_ID_JOYPAD_L},
		{BTN_TR, SDL_CONTROLLER_BUTTON_RIGHTSHOULDER, RETRO_DEVICE_ID_JOYPAD_R},
		{BTN_SELECT, SDL_CONTROLLER_BUTTON_BACK, RETRO_DEVICE_ID_JOYPAD_SELECT},
		{BTN_START, SDL_CONTROLLER_BUTTON_START, RETRO_DEVICE_ID_JOYPAD_START},
	};
	uint16_t all_buttons = 0;
	uint32_t all_sdl_buttons = 0;
	for (size_t index = 0; index < sizeof(bindings) / sizeof(bindings[0]); ++index) {
		const uint16_t expected = (uint16_t)(1u << bindings[index].retro);
		require(map_evdev_key_to_pad(bindings[index].evdev) == expected,
			"evdev emits canonical positional RetroPad bits");
		sdl_buttons = 1u << bindings[index].sdl;
		require(sdl_controller_pad_state() == expected,
			"the shipping SDL table emits the same positional RetroPad bits");
		finalize_pad_state(sdl_controller_pad_state());
		for (unsigned button = 0; button < 16; ++button) {
			require(input_devices_state(0, RETRO_DEVICE_JOYPAD, 0, button) == (button == bindings[index].retro),
				"the public frontend callback exposes exactly the mapped button");
		}
		sdl_buttons = 0;
		require(sdl_controller_pad_state() == 0, "releasing a physical SDL button clears its RetroPad contribution");
		finalize_pad_state(sdl_controller_pad_state());
		require(input_devices_state(0, RETRO_DEVICE_JOYPAD, 0, bindings[index].retro) == 0,
			"the public frontend callback releases the mapped button");
		all_buttons |= expected;
		all_sdl_buttons |= 1u << bindings[index].sdl;
	}
	sdl_buttons = all_sdl_buttons;
	require(sdl_controller_pad_state() == all_buttons, "simultaneous SDL buttons retain independent positional bits");
	require(map_evdev_key_to_pad(BTN_TL2) == (1u << RETRO_DEVICE_ID_JOYPAD_L2)
		&& map_evdev_key_to_pad(BTN_TR2) == (1u << RETRO_DEVICE_ID_JOYPAD_R2),
		"evdev trigger positions remain unchanged");
	sdl_buttons = (1u << SDL_CONTROLLER_BUTTON_LEFTSTICK) | (1u << SDL_CONTROLLER_BUTTON_RIGHTSTICK);
	require(sdl_controller_pad_state() == ((1u << RETRO_DEVICE_ID_JOYPAD_L3) | (1u << RETRO_DEVICE_ID_JOYPAD_R3)),
		"SDL stick-click positions remain unchanged");
	puts("LIBRETRO-HOST-INPUT-DEVICES:PASS");
	return 0;
}
