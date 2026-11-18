#define _GNU_SOURCE

#include <SDL.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <stdbool.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
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
static const char* evdev_name;
static bool evdev_snapshot;
static uint64_t clock_milliseconds = 1000;
static unsigned disconnected_port;

static int test_clock_gettime(clockid_t clock, struct timespec* value) {
	(void)clock;
	value->tv_sec = (time_t)(clock_milliseconds / 1000);
	value->tv_nsec = (long)((clock_milliseconds % 1000) * 1000000);
	return 0;
}

static int test_ioctl(int fd, unsigned long request, ...) {
	(void)fd;
	if (request == EVIOCGNAME(64)) {
		va_list args;
		va_start(args, request);
		char* name = va_arg(args, char*);
		va_end(args);
		return snprintf(name, 64, "%s", evdev_name) + 1;
	}
	if (evdev_snapshot && request == EVIOCGKEY((KEY_MAX + 8) / 8)) {
		va_list args; va_start(args, request);
		uint8_t* keys = va_arg(args, uint8_t*); va_end(args);
		memset(keys, 0, (KEY_MAX + 8) / 8);
		keys[BTN_B / 8] |= 1u << (BTN_B % 8);
		return (KEY_MAX + 8) / 8;
	}
	if (evdev_snapshot && (request == EVIOCGABS(ABS_X) || request == EVIOCGABS(ABS_Y))) {
		va_list args; va_start(args, request);
		struct input_absinfo* axis = va_arg(args, struct input_absinfo*); va_end(args);
		*axis = (struct input_absinfo){.value = request == EVIOCGABS(ABS_X) ? 40 : -40, .minimum = -72, .maximum = 72};
		return 0;
	}
	errno = ENOTTY;
	return -1;
}

static int test_open(const char* path, int flags, ...) {
	return open(strcmp(path, "/dev/input/event199") == 0 ? "/dev/null" : path, flags);
}

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
#define ioctl test_ioctl
#define open test_open
#define clock_gettime test_clock_gettime
#include "../../hosts/libretro_host/input_devices.c"
#undef SDL_GameControllerGetButton
#undef SDL_GameControllerClose
#undef SDL_PumpEvents
#undef SDL_PollEvent
#undef ioctl
#undef open
#undef clock_gettime

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
	pad_at_cancellation = g_input_devices.pad_states[0];
	++gamepad_cancellations;
	bmsx_host_shortcuts_cancel_gesture(&gamepad_shortcuts);
}

static void RETRO_CALLCONV record_disconnected_port(unsigned port) {
	disconnected_port = port;
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

static void test_keyboard_device_mappings(void) {
	const struct { unsigned evdev; SDL_Scancode sdl; const char* code; enum retro_key retro; } keys[] = {
		{KEY_CAPSLOCK, SDL_SCANCODE_CAPSLOCK, "CapsLock", RETROK_CAPSLOCK},
		{KEY_SYSRQ, SDL_SCANCODE_PRINTSCREEN, "PrintScreen", RETROK_PRINT},
		{KEY_PAUSE, SDL_SCANCODE_PAUSE, "Pause", RETROK_PAUSE},
		{KEY_NUMLOCK, SDL_SCANCODE_NUMLOCKCLEAR, "NumLock", RETROK_NUMLOCK},
		{KEY_KP1, SDL_SCANCODE_KP_1, "Numpad1", RETROK_KP1},
		{KEY_KPSLASH, SDL_SCANCODE_KP_DIVIDE, "NumpadDivide", RETROK_KP_DIVIDE},
		{KEY_102ND, SDL_SCANCODE_NONUSBACKSLASH, "IntlBackslash", RETROK_OEM_102},
		{KEY_COMPOSE, SDL_SCANCODE_APPLICATION, "ContextMenu", RETROK_MENU},
		{KEY_F15, SDL_SCANCODE_F15, "F15", RETROK_F15},
	};
	for (size_t i = 0; i < sizeof(keys) / sizeof(keys[0]); ++i) {
		require(keyboard_input_key_from_evdev(keys[i].evdev) == keys[i].retro
			&& keyboard_input_key_from_sdl(keys[i].sdl) == keys[i].retro
			&& keyboard_input_key_from_code(keys[i].code) == keys[i].retro,
			"evdev, SDL and physical-code input agree on each keyboard key");
	}
}

static void test_lifecycle_cancellation(void) {
	const uint16_t menu_chord = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_START);
	keyboard_input_set_callback((struct retro_keyboard_callback){keyboard_event});
	keyboard_input_set_cancel_callback(cancel_keyboard);
	input_devices_set_cancel_gamepad_callback(cancel_gamepad);
	g_input_devices = (InputDevices){.pad_states = {menu_chord}, .focused = true};
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
	g_input_devices.pad_states[0] = menu_chord;
	queued_event = (SDL_Event){.cdevice = {.type = SDL_CONTROLLERDEVICEREMOVED, .which = 23}};
	event_queued = true;
	poll_sdl_devices();
	require(gamepad_cancellations == 1 && controller_closes == 1
		&& pad_at_cancellation == menu_chord && g_input_devices.pad_states[0] == 0,
		"SDL controller removal cancels before handle close and before its neutral poll snapshot");
	require(keyboard_cancellations == 0, "removing the SDL gamepad leaves the independent keyboard gesture alone");

	keyboard_cancellations = gamepad_cancellations = synthetic_releases = 0;
	int pipe_fds[2];
	require(pipe(pipe_fds) == 0, "evdev close test owns a real disposable descriptor");
	g_input_devices.devices[0] = (InputDevice){.fd = pipe_fds[0], .pad_state = menu_chord};
	g_input_devices.pad_states[0] = menu_chord;
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
	return bmsx_host_shortcuts_update(&gamepad_shortcuts, g_input_devices.pad_states[0],
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
		require(g_input_devices.pad_states[0] == menu_chord
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
			&& g_input_devices.pad_states[0] == 0 && g_input_devices.devices[0].fd == -1,
			"EOF cancels the previously published pad contribution even after same-poll key-ups clear its latch");
		result = sample_gamepad(release_times[time]);
		require(result.short_pressed_targets == 0 && result.long_pressed_targets == 0,
			"evdev key-up-before-EOF cannot become a menu tap, exact-threshold hold or overdue rewind");
	}
	gamepad_cancellations = 0;
	gamepad_shortcuts = (BmsxHostShortcutState){0};
	g_input_devices = (InputDevices){.pad_states = {menu_chord}};
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

static void test_evdev_controller_layouts(void) {
	// The original Clovercon driver reports Nintendo labels as BTN_A/B/X/Y;
	// ordinary Linux gamepads report their face positions as BTN_SOUTH/EAST/...
	// https://github.com/endrift/clovercon-km/blob/master/clvcon.c
	const struct {
		uint16_t standard;
		uint16_t clovercon;
		unsigned retro;
	} bindings[] = {
		{BTN_SOUTH, BTN_B, RETRO_DEVICE_ID_JOYPAD_B},
		{BTN_EAST, BTN_A, RETRO_DEVICE_ID_JOYPAD_A},
		{BTN_WEST, BTN_Y, RETRO_DEVICE_ID_JOYPAD_Y},
		{BTN_NORTH, BTN_X, RETRO_DEVICE_ID_JOYPAD_X},
		{BTN_DPAD_UP, BTN_TRIGGER_HAPPY3, RETRO_DEVICE_ID_JOYPAD_UP},
		{BTN_DPAD_DOWN, BTN_TRIGGER_HAPPY4, RETRO_DEVICE_ID_JOYPAD_DOWN},
		{BTN_DPAD_LEFT, BTN_TRIGGER_HAPPY1, RETRO_DEVICE_ID_JOYPAD_LEFT},
		{BTN_DPAD_RIGHT, BTN_TRIGGER_HAPPY2, RETRO_DEVICE_ID_JOYPAD_RIGHT},
		{BTN_TL, BTN_TL, RETRO_DEVICE_ID_JOYPAD_L},
		{BTN_TR, BTN_TR, RETRO_DEVICE_ID_JOYPAD_R},
		{BTN_TL2, BTN_TL2, RETRO_DEVICE_ID_JOYPAD_L2},
		{BTN_TR2, BTN_TR2, RETRO_DEVICE_ID_JOYPAD_R2},
		{BTN_SELECT, BTN_SELECT, RETRO_DEVICE_ID_JOYPAD_SELECT},
		{BTN_START, BTN_START, RETRO_DEVICE_ID_JOYPAD_START},
	};
	int pipes[3][2];
	char paths[3][64] = {"/tmp/bmsx-input-0-XXXXXX", "/tmp/bmsx-input-1-XXXXXX", "/tmp/bmsx-input-2-XXXXXX"};
	g_input_devices = (InputDevices){0};
	const char* names[] = {
		"Xbox Wireless Controller", "Nintendo Clovercon - controller1", "Nintendo Clovercon - controller2",
	};
	for (unsigned source = 0; source < 3; ++source) {
		evdev_name = names[source];
		const int file = mkstemp(paths[source]);
		require(file >= 0, "each evdev node has a distinct path");
		close(file);
		evdev_snapshot = source == 2;
		open_evdev_device(paths[source]);
		if (source == 2) {
			require(g_input_devices.devices[source].pad_state == (1u << RETRO_DEVICE_ID_JOYPAD_B)
				&& g_input_devices.devices[source].has_abs_xy
				&& g_input_devices.devices[source].abs_x == 40 && g_input_devices.devices[source].abs_y == -40,
				"a newly opened controller starts with its actual held buttons and axes");
			g_input_devices.devices[source].pad_state = 0;
			g_input_devices.devices[source].abs_x = g_input_devices.devices[source].abs_y = 0;
		}
		evdev_snapshot = false;
		close(g_input_devices.devices[source].fd);
		require(pipe2(pipes[source], O_NONBLOCK) == 0, "each evdev controller has its own event stream");
		g_input_devices.devices[source].fd = pipes[source][0];
	}
	open_evdev_device(paths[0]);
	require(g_input_devices.device_count == 3 && g_input_devices.devices[0].fd == pipes[0][0],
		"initial enumeration and a queued hotplug notification cannot open a source twice");
	for (unsigned source = 0; source < 3; ++source) {
		for (size_t index = 0; index < sizeof(bindings) / sizeof(bindings[0]); ++index) {
			struct input_event event = {
				.type = EV_KEY,
				.code = source ? bindings[index].clovercon : bindings[index].standard,
				.value = 1,
			};
			require(write(pipes[source][1], &event, sizeof(event)) == sizeof(event), "evdev press is delivered");
			poll_evdev_devices();
			for (unsigned button = 0; button < 16; ++button) {
				require(input_devices_state(source == 2 ? 1 : 0, RETRO_DEVICE_JOYPAD, 0, button) == (button == bindings[index].retro),
					"each controller's physical button publishes exactly its positional RetroPad bit");
			}
			event.value = 0;
			require(write(pipes[source][1], &event, sizeof(event)) == sizeof(event), "evdev release is delivered");
			poll_evdev_devices();
			require(g_input_devices.pad_states[source == 2 ? 1 : 0] == 0, "releasing a physical button clears its RetroPad contribution");
		}
	}
	struct input_event press = {.type = EV_KEY, .code = BTN_SOUTH, .value = 1};
	require(write(pipes[0][1], &press, sizeof(press)) == sizeof(press), "standard bottom press is delivered");
	press.code = BTN_B;
	require(write(pipes[1][1], &press, sizeof(press)) == sizeof(press), "Clovercon bottom press is delivered");
	poll_evdev_devices();
	require(g_input_devices.pad_states[0] == (1u << RETRO_DEVICE_ID_JOYPAD_B),
		"different controller encodings combine at the same physical bottom position");
	press.value = 0;
	require(write(pipes[1][1], &press, sizeof(press)) == sizeof(press), "Clovercon bottom release is delivered");
	poll_evdev_devices();
	require(g_input_devices.pad_states[0] == (1u << RETRO_DEVICE_ID_JOYPAD_B),
		"one controller's release does not erase the other's held bottom button");
	press.code = BTN_SOUTH;
	require(write(pipes[0][1], &press, sizeof(press)) == sizeof(press), "standard bottom release is delivered");
	poll_evdev_devices();
	require(g_input_devices.pad_states[0] == 0, "the combined button releases when both sources release");
	struct input_event chord[] = {
		{.type = EV_KEY, .code = BTN_A, .value = 1},
		{.type = EV_KEY, .code = BTN_B, .value = 1},
		{.type = EV_KEY, .code = BTN_X, .value = 1},
		{.type = EV_KEY, .code = BTN_Y, .value = 1},
	};
	require(write(pipes[1][1], chord, sizeof(chord)) == sizeof(chord), "Clovercon face chord is delivered");
	poll_evdev_devices();
	const uint16_t face_buttons = (1u << RETRO_DEVICE_ID_JOYPAD_A) | (1u << RETRO_DEVICE_ID_JOYPAD_B)
		| (1u << RETRO_DEVICE_ID_JOYPAD_X) | (1u << RETRO_DEVICE_ID_JOYPAD_Y);
	require(g_input_devices.pad_states[0] == face_buttons, "Clovercon face buttons remain independent when held together");
	for (size_t index = 0; index < sizeof(chord) / sizeof(chord[0]); ++index) chord[index].value = 0;
	require(write(pipes[1][1], chord, sizeof(chord)) == sizeof(chord), "Clovercon face releases are delivered");
	poll_evdev_devices();
	require(g_input_devices.pad_states[0] == 0, "all Clovercon face buttons release");
	struct input_event select = {.type = EV_KEY, .code = BTN_SELECT, .value = 1};
	struct input_event start = {.type = EV_KEY, .code = BTN_START, .value = 1};
	require(write(pipes[1][1], &select, sizeof(select)) == sizeof(select)
		&& write(pipes[2][1], &start, sizeof(start)) == sizeof(start), "publish buttons on both Clovercons");
	poll_evdev_devices();
	require(g_input_devices.pad_states[0] == (1u << RETRO_DEVICE_ID_JOYPAD_SELECT)
		&& g_input_devices.pad_states[1] == (1u << RETRO_DEVICE_ID_JOYPAD_START),
		"Clovercon players publish independent RetroPad ports and cannot form a split chord");
	disconnected_port = ~0u;
	input_devices_set_cancel_gamepad_callback(record_disconnected_port);
	close(pipes[2][1]);
	poll_evdev_devices();
	require(disconnected_port == 1 && g_input_devices.pad_states[0] == (1u << RETRO_DEVICE_ID_JOYPAD_SELECT)
		&& g_input_devices.pad_states[1] == 0,
		"disconnecting player two cancels only its own core input");
	select.value = 0;
	require(write(pipes[1][1], &select, sizeof(select)) == sizeof(select), "release player one's Select");
	poll_evdev_devices();
	input_devices_set_cancel_gamepad_callback(NULL);
	open_evdev_device(paths[2]);
	require(g_input_devices.device_count == 3 && g_input_devices.devices[2].fd >= 0,
		"a later controller reuses the disconnected source slot");
	input_devices_close();
	close(pipes[0][1]);
	close(pipes[1][1]);
	for (unsigned source = 0; source < 3; ++source) unlink(paths[source]);
}

static void test_evdev_hotplug_notifications(void) {
	char directory[] = "/tmp/bmsx-hotplug-XXXXXX";
	require(mkdtemp(directory) != NULL, "the test owns a temporary input directory");
	char path[128];
	snprintf(path, sizeof(path), "%s/event199", directory);
	const int watch = inotify_init1(IN_NONBLOCK | IN_CLOEXEC);
	require(watch >= 0 && inotify_add_watch(watch, directory, IN_CREATE | IN_MOVED_TO) >= 0,
		"the test receives real Linux device-directory notifications");
	g_input_devices = (InputDevices){.evdev_watch_fd = watch, .evdev_watch_active = true};
	evdev_name = "Nintendo Clovercon - controller2";
	evdev_snapshot = true;
	int file = open(path, O_CREAT | O_WRONLY, 0600);
	require(file >= 0, "the new input node is published"); close(file);
	poll_evdev_hotplug();
	require(g_input_devices.device_count == 1 && g_input_devices.devices[0].pad_port == 1
		&& g_input_devices.devices[0].pad_state == (1u << RETRO_DEVICE_ID_JOYPAD_B),
		"a notification opens the device on its player port with its current held state");
	close_evdev_device(&g_input_devices.devices[0], 0);
	require(unlink(path) == 0, "the old node is removed");
	file = open(path, O_CREAT | O_WRONLY, 0600);
	require(file >= 0, "a replacement input node is published"); close(file);
	poll_evdev_hotplug();
	require(g_input_devices.device_count == 1 && g_input_devices.devices[0].fd >= 0,
		"a later notification reuses the retired source slot");
	evdev_snapshot = false;
	input_devices_close();
	require(unlink(path) == 0 && rmdir(directory) == 0, "the test removes its input nodes");
}

static void test_exit_hold(void) {

	const uint16_t old_combo = (1u << RETRO_DEVICE_ID_JOYPAD_START)
		| (1u << RETRO_DEVICE_ID_JOYPAD_L) | (1u << RETRO_DEVICE_ID_JOYPAD_R);
	clock_milliseconds = 6000;
	finalize_pad_state(old_combo, 0);
	clock_milliseconds = 7999;
	finalize_pad_state(old_combo, 0);
	require(!input_devices_quit_requested(), "the existing exit combo retains its own threshold");
	clock_milliseconds = 8000;
	finalize_pad_state(old_combo, 0);
	require(input_devices_quit_requested(), "the existing exit combo still works");
	g_input_devices = (InputDevices){0};
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
	test_keyboard_device_mappings();
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
		require(map_evdev_key_to_pad(bindings[index].evdev, false) == expected,
			"evdev emits canonical positional RetroPad bits");
		sdl_buttons = 1u << bindings[index].sdl;
		require(sdl_controller_pad_state() == expected,
			"the shipping SDL table emits the same positional RetroPad bits");
		finalize_pad_state(sdl_controller_pad_state(), 0);
		for (unsigned button = 0; button < 16; ++button) {
			require(input_devices_state(0, RETRO_DEVICE_JOYPAD, 0, button) == (button == bindings[index].retro),
				"the public frontend callback exposes exactly the mapped button");
		}
		sdl_buttons = 0;
		require(sdl_controller_pad_state() == 0, "releasing a physical SDL button clears its RetroPad contribution");
		finalize_pad_state(sdl_controller_pad_state(), 0);
		require(input_devices_state(0, RETRO_DEVICE_JOYPAD, 0, bindings[index].retro) == 0,
			"the public frontend callback releases the mapped button");
		all_buttons |= expected;
		all_sdl_buttons |= 1u << bindings[index].sdl;
	}
	sdl_buttons = all_sdl_buttons;
	require(sdl_controller_pad_state() == all_buttons, "simultaneous SDL buttons retain independent positional bits");
	require(map_evdev_key_to_pad(BTN_TL2, false) == (1u << RETRO_DEVICE_ID_JOYPAD_L2)
		&& map_evdev_key_to_pad(BTN_TR2, false) == (1u << RETRO_DEVICE_ID_JOYPAD_R2),
		"evdev trigger positions remain unchanged");
	sdl_buttons = (1u << SDL_CONTROLLER_BUTTON_LEFTSTICK) | (1u << SDL_CONTROLLER_BUTTON_RIGHTSTICK);
	require(sdl_controller_pad_state() == ((1u << RETRO_DEVICE_ID_JOYPAD_L3) | (1u << RETRO_DEVICE_ID_JOYPAD_R3)),
		"SDL stick-click positions remain unchanged");
	test_lifecycle_cancellation();
	test_keyups_before_source_cancellation();
	test_evdev_pad_release_before_eof();
	test_evdev_controller_layouts();
	test_evdev_hotplug_notifications();
	test_exit_hold();
	puts("LIBRETRO-HOST-INPUT-DEVICES:PASS");
	return 0;
}
