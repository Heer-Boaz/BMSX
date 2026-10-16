#define _GNU_SOURCE

#include <SDL.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include "host_shortcuts.h"

static uint32_t sdl_buttons;
static SDL_Event queued_event;
static bool event_queued;
static unsigned keyboard_cancellations;
static unsigned gamepad_cancellations;
static unsigned synthetic_releases;
static unsigned controller_closes;
static uint16_t pad_at_cancellation;
static bool expect_synthetic_release = true;
static BmsxHostShortcutState keyboard_shortcuts;
static BmsxHostShortcutState gamepad_shortcuts;
static uint32_t keyboard_buttons;

static void test_controller_close(SDL_GameController* controller);
static void test_pump_events(void) {}
static int test_poll_event(SDL_Event* event) {
	if (!event_queued) return 0;
	*event = queued_event;
	event_queued = false;
	return 1;
}

static Uint8 test_controller_button(SDL_GameController* controller, SDL_GameControllerButton button) {
	(void)controller;
	return (sdl_buttons & (1u << button)) != 0u;
}

// Exercise the shipping adapters without exporting their private mapping state.
// Only SDL's hardware query is replaced; its actual mapping table is unchanged.
#define SDL_GameControllerGetButton test_controller_button
#define SDL_GameControllerClose test_controller_close
#define SDL_PumpEvents test_pump_events
#define SDL_PollEvent test_poll_event
#include "../../hosts/libretro_host/input_devices.c"
#undef SDL_GameControllerGetButton
#undef SDL_GameControllerClose
#undef SDL_PumpEvents
#undef SDL_PollEvent

static void require(bool condition, const char* message) {
	if (!condition) {
		fprintf(stderr, "%s\n", message);
		exit(1);
	}
}

static void RETRO_CALLCONV cancel_keyboard(void) {
	require(synthetic_releases == 0, "keyboard lifecycle cancellation precedes every synthetic key up");
	++keyboard_cancellations;
	bmsx_host_shortcuts_cancel_gesture(&keyboard_shortcuts);
}

static void RETRO_CALLCONV cancel_gamepad(unsigned port) {
	require(port == 0, "the standalone controller producer cancels its actual port zero");
	pad_at_cancellation = g_input_devices.pad_state;
	++gamepad_cancellations;
	bmsx_host_shortcuts_cancel_gesture(&gamepad_shortcuts);
}

static void RETRO_CALLCONV keyboard_event(bool down, unsigned key, uint32_t character, uint16_t modifiers) {
	(void)character; (void)modifiers;
	const uint32_t button = key == RETROK_RCTRL ? 1u << RETRO_DEVICE_ID_JOYPAD_SELECT
		: key == RETROK_RALT ? 1u << RETRO_DEVICE_ID_JOYPAD_START : 0u;
	if (down) keyboard_buttons |= button;
	else keyboard_buttons &= ~button;
	if (!down && expect_synthetic_release) {
		require(keyboard_cancellations == 1, "a source cancels its keyboard gesture once before releasing keys");
		++synthetic_releases;
	}
}

static BmsxHostShortcutResult sample_keyboard(double now_ms) {
	keyboard_input_mark_sampled();
	const uint32_t select = 1u << RETRO_DEVICE_ID_JOYPAD_SELECT;
	const uint32_t start = 1u << RETRO_DEVICE_ID_JOYPAD_START;
	return bmsx_host_shortcuts_update(&keyboard_shortcuts, keyboard_buttons,
		select, start, start, 500.0, now_ms);
}

static void test_controller_close(SDL_GameController* controller) {
	(void)controller;
	require(gamepad_cancellations == 1, "controller removal cancels before closing its SDL handle");
	++controller_closes;
}

static void test_lifecycle_cancellation(void) {
	const uint16_t menu_chord = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_START);
	keyboard_input_set_callback((struct retro_keyboard_callback){keyboard_event});
	keyboard_input_set_cancel_callback(cancel_keyboard);
	input_devices_set_cancel_gamepad_callback(cancel_gamepad);
	g_input_devices = (InputDevices){.pad_state = menu_chord, .focused = true};
	keyboard_input_post(KEYBOARD_INPUT_SOURCE_SDL, RETROK_RCTRL, true);
	keyboard_input_post(KEYBOARD_INPUT_SOURCE_SDL, RETROK_RALT, true);
	const SDL_WindowEvent lost_focus = {.event = SDL_WINDOWEVENT_FOCUS_LOST};
	handle_sdl_window_event(&lost_focus);
	require(keyboard_cancellations == 1 && synthetic_releases == 2,
		"SDL focus loss cancels before its merged keyboard source emits synthetic key releases");
	require(gamepad_cancellations == 1 && pad_at_cancellation == menu_chord && !g_input_devices.focused,
		"SDL focus loss cancels the pending controller source before the poll publishes neutral state");
	keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_SDL);
	require(keyboard_cancellations == 1, "releasing an already empty keyboard source cannot cancel another source");

	keyboard_cancellations = gamepad_cancellations = synthetic_releases = 0;
	static int controller_token;
	g_input_devices.controller = (SDL_GameController*)&controller_token;
	g_input_devices.controller_id = 23;
	g_input_devices.pad_state = menu_chord;
	queued_event = (SDL_Event){.cdevice = {.type = SDL_CONTROLLERDEVICEREMOVED, .which = 23}};
	event_queued = true;
	poll_sdl_devices();
	require(gamepad_cancellations == 1 && controller_closes == 1
		&& pad_at_cancellation == menu_chord && g_input_devices.pad_state == 0,
		"SDL controller removal cancels before handle close and before its neutral poll snapshot");
	require(keyboard_cancellations == 0, "removing the SDL gamepad leaves the independent keyboard gesture alone");

	keyboard_cancellations = gamepad_cancellations = synthetic_releases = 0;
	int pipe_fds[2];
	require(pipe(pipe_fds) == 0, "evdev close test owns a real disposable descriptor");
	g_input_devices.devices[0] = (InputDevice){.fd = pipe_fds[0], .pad_state = menu_chord};
	g_input_devices.pad_state = menu_chord;
	keyboard_input_post(KEYBOARD_INPUT_SOURCE_EVDEV_FIRST, RETROK_RCTRL, true);
	keyboard_input_post(KEYBOARD_INPUT_SOURCE_EVDEV_FIRST, RETROK_RALT, true);
	close_evdev_device(&g_input_devices.devices[0], 0);
	close(pipe_fds[1]);
	require(gamepad_cancellations == 1 && keyboard_cancellations == 1 && synthetic_releases == 2
		&& g_input_devices.devices[0].fd == -1 && g_input_devices.devices[0].pad_state == 0,
		"evdev device removal cancels its contributing pad and keyboard before synthetic release");

	keyboard_cancellations = gamepad_cancellations = synthetic_releases = 0;
	require(pipe(pipe_fds) == 0, "empty evdev close test owns a descriptor");
	g_input_devices.devices[0] = (InputDevice){.fd = pipe_fds[0]};
	close_evdev_device(&g_input_devices.devices[0], 0);
	close(pipe_fds[1]);
	require(gamepad_cancellations == 0 && keyboard_cancellations == 0,
		"closing an empty unrelated evdev node does not cancel another source's gesture");
	keyboard_input_set_cancel_callback(NULL);
	input_devices_set_cancel_gamepad_callback(NULL);
}

static void test_keyups_before_source_cancellation(void) {
	keyboard_input_set_cancel_callback(cancel_keyboard);
	input_devices_set_cancel_gamepad_callback(cancel_gamepad);
	expect_synthetic_release = false;
	const double release_times[] = {200.0, 900.0};
	for (unsigned evdev = 0; evdev < 2; ++evdev) {
		for (unsigned time = 0; time < 2; ++time) {
			keyboard_input_set_callback((struct retro_keyboard_callback){keyboard_event});
			keyboard_shortcuts = (BmsxHostShortcutState){0};
			keyboard_buttons = 0;
			keyboard_cancellations = gamepad_cancellations = synthetic_releases = 0;
			g_input_devices = (InputDevices){0};
			const unsigned source = evdev ? KEYBOARD_INPUT_SOURCE_EVDEV_FIRST : KEYBOARD_INPUT_SOURCE_SDL;
			keyboard_input_post(source, RETROK_RCTRL, true);
			keyboard_input_post(source, RETROK_RALT, true);
			BmsxHostShortcutResult result = sample_keyboard(100.0);
			require(result.short_pressed_targets == 0 && result.long_pressed_targets == 0,
				"the actual shortcut owner retains a complete pending keyboard chord");
			// SDL/evdev may deliver the real key-ups before the lifecycle event
			// in this same producer poll. The core has not sampled their release.
			keyboard_input_post(source, RETROK_RALT, false);
			keyboard_input_post(source, RETROK_RCTRL, false);
			if (evdev) {
				int pipe_fds[2];
				require(pipe(pipe_fds) == 0, "evdev ordering test owns its descriptor");
				g_input_devices.devices[0] = (InputDevice){.fd = pipe_fds[0]};
				close_evdev_device(&g_input_devices.devices[0], 0);
				close(pipe_fds[1]);
			} else {
				const SDL_WindowEvent lost_focus = {.event = SDL_WINDOWEVENT_FOCUS_LOST};
				handle_sdl_window_event(&lost_focus);
			}
			require(keyboard_cancellations == 1,
				"focus loss and EOF cancel an unpublished release even though its source is now empty");
			result = sample_keyboard(release_times[time]);
			require(result.short_pressed_targets == 0 && result.long_pressed_targets == 0,
				"lifecycle after key-ups cannot become a menu tap or an overdue rewind activation");
			keyboard_input_release_source(source);
			require(keyboard_cancellations == 1,
				"the canceled empty source cannot report another lifecycle cancellation");
		}
	}

	keyboard_input_set_callback((struct retro_keyboard_callback){keyboard_event});
	keyboard_shortcuts = (BmsxHostShortcutState){0};
	keyboard_buttons = 0;
	keyboard_cancellations = gamepad_cancellations = synthetic_releases = 0;
	keyboard_input_post(KEYBOARD_INPUT_SOURCE_EVDEV_FIRST, RETROK_RCTRL, true);
	keyboard_input_post(KEYBOARD_INPUT_SOURCE_EVDEV_FIRST, RETROK_RCTRL, false);
	sample_keyboard(0.0);
	keyboard_input_post(KEYBOARD_INPUT_SOURCE_SDL, RETROK_RCTRL, true);
	keyboard_input_post(KEYBOARD_INPUT_SOURCE_SDL, RETROK_RALT, true);
	sample_keyboard(100.0);
	int pipe_fds[2];
	require(pipe(pipe_fds) == 0, "sampled-empty source test owns its descriptor");
	g_input_devices.devices[0] = (InputDevice){.fd = pipe_fds[0]};
	close_evdev_device(&g_input_devices.devices[0], 0);
	close(pipe_fds[1]);
	require(keyboard_cancellations == 0,
		"a previously sampled empty source cannot cancel a different source's pending gesture");
	const BmsxHostShortcutResult result = sample_keyboard(600.0);
	require(result.long_pressed_targets != 0,
		"closing the unrelated sampled-empty source preserves the real pending hold deadline");
	keyboard_input_set_callback((struct retro_keyboard_callback){keyboard_event});
	keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_SDL);
	require(keyboard_cancellations == 0,
		"replacing the keyboard callback resets unpublished-source ownership along with held state");
	keyboard_input_set_cancel_callback(NULL);
	input_devices_set_cancel_gamepad_callback(NULL);
	expect_synthetic_release = true;
}

static BmsxHostShortcutResult sample_gamepad(double now_ms) {
	const uint32_t select = 1u << RETRO_DEVICE_ID_JOYPAD_SELECT;
	const uint32_t start = 1u << RETRO_DEVICE_ID_JOYPAD_START;
	return bmsx_host_shortcuts_update(&gamepad_shortcuts, g_input_devices.pad_state,
		select, start, start, 500.0, now_ms);
}

static void test_evdev_pad_release_before_eof(void) {
	input_devices_set_cancel_gamepad_callback(cancel_gamepad);
	const double release_times[] = {599.0, 600.0, 900.0};
	const uint16_t menu_chord = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_START);
	for (unsigned time = 0; time < 3; ++time) {
		gamepad_cancellations = 0;
		gamepad_shortcuts = (BmsxHostShortcutState){0};
		int pipe_fds[2];
		require(pipe2(pipe_fds, O_NONBLOCK) == 0, "evdev pad ordering test owns a nonblocking event pipe");
		g_input_devices = (InputDevices){.device_count = 1};
		g_input_devices.devices[0] = (InputDevice){.fd = pipe_fds[0]};
		const struct input_event presses[] = {
			{.type = EV_KEY, .code = BTN_SELECT, .value = 1},
			{.type = EV_KEY, .code = BTN_START, .value = 1},
		};
		require(write(pipe_fds[1], presses, sizeof(presses)) == sizeof(presses), "the pipe publishes complete evdev button-down events");
		poll_evdev_devices();
		require(g_input_devices.pad_state == menu_chord
			&& g_input_devices.devices[0].published_pad_state == menu_chord,
			"a live evdev poll retains each device's actual published button contribution");
		BmsxHostShortcutResult result = sample_gamepad(100.0);
		require(result.short_pressed_targets == 0 && result.long_pressed_targets == 0,
			"the actual C shortcut owner retains the evdev pad's pending chord");
		const struct input_event releases[] = {
			{.type = EV_KEY, .code = BTN_SELECT, .value = 0},
			{.type = EV_KEY, .code = BTN_START, .value = 0},
		};
		require(write(pipe_fds[1], releases, sizeof(releases)) == sizeof(releases), "the pipe publishes key-ups immediately followed by EOF");
		close(pipe_fds[1]);
		poll_evdev_devices();
		require(gamepad_cancellations == 1 && pad_at_cancellation == menu_chord
			&& g_input_devices.pad_state == 0 && g_input_devices.devices[0].fd == -1,
			"EOF cancels the previously published pad contribution even after same-poll key-ups clear its latch");
		result = sample_gamepad(release_times[time]);
		require(result.short_pressed_targets == 0 && result.long_pressed_targets == 0,
			"evdev key-up-before-EOF cannot become a menu tap, exact-threshold hold or overdue rewind");
	}
	gamepad_cancellations = 0;
	gamepad_shortcuts = (BmsxHostShortcutState){0};
	g_input_devices = (InputDevices){.pad_state = menu_chord};
	sample_gamepad(100.0);
	int pipe_fds[2];
	require(pipe(pipe_fds) == 0, "unrelated empty pad node owns its descriptor");
	g_input_devices.devices[0] = (InputDevice){.fd = pipe_fds[0]};
	close_evdev_device(&g_input_devices.devices[0], 0);
	close(pipe_fds[1]);
	require(gamepad_cancellations == 0 && sample_gamepad(600.0).long_pressed_targets != 0,
		"closing a truly empty evdev node cannot cancel a different contributing device's hold");
	input_devices_set_cancel_gamepad_callback(NULL);
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
	test_lifecycle_cancellation();
	test_keyups_before_source_cancellation();
	test_evdev_pad_release_before_eof();
	puts("LIBRETRO-HOST-INPUT-DEVICES:PASS");
	return 0;
}
