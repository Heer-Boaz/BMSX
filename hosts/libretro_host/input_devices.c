#define _GNU_SOURCE

#include "input_devices.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#ifdef BMSX_LIBRETRO_HOST_SDL
#include <SDL.h>
#endif
#include <linux/input.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

#include "host_fatal.h"
#include "keyboard_input.h"
#include "video_presenter.h"

enum {
	kMaximumInputDevices = KEYBOARD_INPUT_EVDEV_SOURCE_COUNT,
	kRetroMouseIdX = 0,
	kRetroMouseIdY = 1,
	kRetroMouseIdLeft = 2,
	kRetroMouseIdRight = 3,
	kRetroMouseIdWheelUp = 4,
	kRetroMouseIdWheelDown = 5,
	kRetroMouseIdMiddle = 6,
	kRetroMouseIdButton4 = 9,
	kRetroMouseIdButton5 = 10,
	kRetroPointerIdX = 0,
	kRetroPointerIdY = 1,
	kRetroPointerIdPressed = 2,
	kMouseButtonPrimary = 1 << 0,
	kMouseButtonSecondary = 1 << 1,
	kMouseButtonAux = 1 << 2,
	kMouseButtonBack = 1 << 3,
	kMouseButtonForward = 1 << 4,
};

static const uint64_t kExitComboHoldMilliseconds = 2000;

typedef struct InputDevice {
	const char* path;
	int fd;
	int32_t hat_x;
	int32_t hat_y;
	int32_t hat_x_min;
	int32_t hat_x_max;
	int32_t hat_y_min;
	int32_t hat_y_max;
	int32_t abs_x;
	int32_t abs_y;
	int32_t abs_x_min;
	int32_t abs_x_max;
	int32_t abs_y_min;
	int32_t abs_y_max;
	bool hat_x_valid;
	bool hat_y_valid;
	bool has_hat;
	bool has_abs_xy;
	uint16_t pad_state;
} InputDevice;

typedef struct InputDevices {
	BmsxInputDriverKind driver;
	const BmsxVideoSurface* surface;
	InputDevice devices[kMaximumInputDevices];
	char paths[kMaximumInputDevices][64];
	size_t device_count;
	uint16_t pad_state;
	int32_t mouse_absolute_x;
	int32_t mouse_absolute_y;
	int32_t mouse_delta_x;
	int32_t mouse_delta_y;
	int32_t mouse_wheel_y;
	uint8_t mouse_buttons;
	bool mouse_position_valid;
	int16_t pointer_x;
	int16_t pointer_y;
	bool pointer_inside_game_viewport;
	uint64_t exit_combo_start_milliseconds;
	bool quit_requested;
#ifdef BMSX_LIBRETRO_HOST_SDL
	SDL_GameController* controller;
	SDL_JoystickID controller_id;
	bool focused;
#endif
} InputDevices;

static InputDevices g_input_devices;

static uint64_t monotonic_milliseconds(void) {
	struct timespec time;
	clock_gettime(CLOCK_MONOTONIC, &time);
	return (uint64_t)time.tv_sec * 1000ull + (uint64_t)time.tv_nsec / 1000000ull;
}

static int clamp_int(int value, int minimum, int maximum) {
	if (value < minimum) return minimum;
	if (value > maximum) return maximum;
	return value;
}

static void reset_mouse_frame_state(void) {
	g_input_devices.mouse_delta_x = 0;
	g_input_devices.mouse_delta_y = 0;
	g_input_devices.mouse_wheel_y = 0;
}

static void clamp_mouse_position_to_surface(void) {
	InputDevices* input = &g_input_devices;
	input->mouse_absolute_x = clamp_int(
			input->mouse_absolute_x,
			0,
			input->surface->width - 1);
	input->mouse_absolute_y = clamp_int(
			input->mouse_absolute_y,
			0,
			input->surface->height - 1);
}

static void add_mouse_relative_delta(int x, int y) {
	InputDevices* input = &g_input_devices;
	input->mouse_delta_x += x;
	input->mouse_delta_y += y;
	if (!input->mouse_position_valid) {
		input->mouse_absolute_x = 0;
		input->mouse_absolute_y = 0;
		input->mouse_position_valid = true;
	}
	input->mouse_absolute_x += x;
	input->mouse_absolute_y += y;
	clamp_mouse_position_to_surface();
}

static void update_pointer_from_surface(void) {
	InputDevices* input = &g_input_devices;
	if (!input->mouse_position_valid) {
		input->pointer_x = 0;
		input->pointer_y = 0;
		input->pointer_inside_game_viewport = false;
		return;
	}
	video_presenter_map_surface_point(
			input->mouse_absolute_x,
			input->mouse_absolute_y,
			&input->pointer_x,
			&input->pointer_y,
			&input->pointer_inside_game_viewport);
}

static uint8_t map_evdev_key_to_mouse(uint16_t code) {
	switch (code) {
		case BTN_LEFT:
			return kMouseButtonPrimary;
		case BTN_RIGHT:
			return kMouseButtonSecondary;
		case BTN_MIDDLE:
			return kMouseButtonAux;
		case BTN_SIDE:
			return kMouseButtonBack;
		case BTN_EXTRA:
			return kMouseButtonForward;
		default:
			return 0;
	}
}

static uint16_t map_evdev_key_to_pad(uint16_t code) {
	switch (code) {
		case KEY_UP:
		case KEY_KP8:
#ifdef BTN_TRIGGER_HAPPY3
		case BTN_TRIGGER_HAPPY3:
#endif
		case BTN_DPAD_UP:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		case KEY_DOWN:
		case KEY_KP2:
#ifdef BTN_TRIGGER_HAPPY4
		case BTN_TRIGGER_HAPPY4:
#endif
		case BTN_DPAD_DOWN:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		case KEY_LEFT:
		case KEY_KP4:
#ifdef BTN_TRIGGER_HAPPY1
		case BTN_TRIGGER_HAPPY1:
#endif
		case BTN_DPAD_LEFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
		case KEY_RIGHT:
		case KEY_KP6:
#ifdef BTN_TRIGGER_HAPPY2
		case BTN_TRIGGER_HAPPY2:
#endif
		case BTN_DPAD_RIGHT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
		case BTN_TL:
		case KEY_LEFTSHIFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L);
		case BTN_TR:
		case KEY_RIGHTSHIFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R);
		case BTN_TL2:
		case KEY_LEFTCTRL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L2);
		case BTN_TR2:
		case KEY_RIGHTCTRL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R2);
		case BTN_START:
		case KEY_ENTER:
		case KEY_KPENTER:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START);
		case BTN_SELECT:
		case KEY_BACKSPACE:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);
		case KEY_Q:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L3);
		case KEY_E:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R3);
		case KEY_X:
		case BTN_SOUTH:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A);
		case KEY_C:
		case BTN_EAST:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B);
		case KEY_Z:
		case BTN_NORTH:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X);
		case KEY_S:
		case BTN_WEST:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y);
		default:
			return 0;
	}
}

static bool read_absolute_axis(
		InputDevice* device,
		unsigned code,
		int32_t* minimum,
		int32_t* maximum) {
	struct input_absinfo axis;
	if (ioctl(device->fd, EVIOCGABS(code), &axis) != 0) {
		return false;
	}
	*minimum = axis.minimum;
	*maximum = axis.maximum;
	return true;
}

static void open_evdev_device(const char* path) {
	InputDevices* input = &g_input_devices;
	const int fd = open(path, O_RDONLY | O_NONBLOCK);
	if (fd < 0) {
		fprintf(stderr, "[libretro-host] Failed to open %s: %s\n", path, strerror(errno));
		return;
	}
	InputDevice device = {
		.fd = fd,
		.hat_x_min = INT32_MAX,
		.hat_x_max = INT32_MIN,
		.hat_y_min = INT32_MAX,
		.hat_y_max = INT32_MIN,
		.abs_x_min = INT32_MIN,
		.abs_x_max = INT32_MAX,
		.abs_y_min = INT32_MIN,
		.abs_y_max = INT32_MAX,
	};
	snprintf(
			input->paths[input->device_count],
			sizeof(input->paths[input->device_count]),
			"%s",
			path);
	device.path = input->paths[input->device_count];
	device.hat_x_valid = read_absolute_axis(
			&device,
			ABS_HAT0X,
			&device.hat_x_min,
			&device.hat_x_max);
	device.hat_y_valid = read_absolute_axis(
			&device,
			ABS_HAT0Y,
			&device.hat_y_min,
			&device.hat_y_max);
	device.has_hat = device.hat_x_valid || device.hat_y_valid;
	const bool has_absolute_x = read_absolute_axis(
			&device,
			ABS_X,
			&device.abs_x_min,
			&device.abs_x_max);
	const bool has_absolute_y = read_absolute_axis(
			&device,
			ABS_Y,
			&device.abs_y_min,
			&device.abs_y_max);
	device.has_abs_xy = has_absolute_x && has_absolute_y;
	input->devices[input->device_count++] = device;
	fprintf(stderr, "[libretro-host] input %s opened\n", path);
}

static void open_evdev_devices(void) {
	InputDevices* input = &g_input_devices;
	DIR* directory = opendir("/dev/input");
	if (directory) {
		struct dirent* entry = NULL;
		while ((entry = readdir(directory)) != NULL) {
			if (strncmp(entry->d_name, "event", 5) != 0) {
				continue;
			}
			char path[64];
			const size_t prefix_length = sizeof("/dev/input/") - 1;
			const size_t maximum_name_length =
					sizeof(path) - prefix_length - 1;
			snprintf(
					path,
					sizeof(path),
					"/dev/input/%.*s",
					(int)maximum_name_length,
					entry->d_name);
			open_evdev_device(path);
			if (input->device_count == kMaximumInputDevices) {
				break;
			}
		}
		closedir(directory);
	}
	if (!input->device_count) {
		static const char* paths[] = {
			"/dev/input/event0",
			"/dev/input/event1",
			"/dev/input/event2",
			"/dev/input/event3",
		};
		for (size_t index = 0; index < sizeof(paths) / sizeof(paths[0]); ++index) {
			open_evdev_device(paths[index]);
			if (input->device_count == kMaximumInputDevices) {
				break;
			}
		}
	}
	if (!input->device_count) {
		host_fatal(
				"No input devices opened. Are you running as root / "
				"do you have permissions for /dev/input/event*?");
	}
}

static void finalize_pad_state(uint16_t pad_state) {
	InputDevices* input = &g_input_devices;
	input->pad_state = pad_state;
	const bool exit_combo_down =
			(pad_state & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START)) &&
			(pad_state & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT)) &&
			(pad_state & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L)) &&
			(pad_state & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R));
	if (!exit_combo_down) {
		input->exit_combo_start_milliseconds = 0;
		return;
	}
	const uint64_t now = monotonic_milliseconds();
	if (!input->exit_combo_start_milliseconds) {
		input->exit_combo_start_milliseconds = now;
		return;
	}
	if (now - input->exit_combo_start_milliseconds >=
			kExitComboHoldMilliseconds) {
		fprintf(
				stderr,
				"[libretro-host] exit combo held %llums, exiting\n",
				(unsigned long long)(
					now - input->exit_combo_start_milliseconds));
		input->quit_requested = true;
		input->exit_combo_start_milliseconds = 0;
	}
}

static void apply_evdev_hat(InputDevice* device, uint16_t* pad_state) {
	if (device->hat_x_valid &&
			device->hat_x_min <= device->hat_x_max &&
			device->hat_x_min != device->hat_x_max) {
		const int64_t midpoint = (int64_t)device->hat_x_min + device->hat_x_max;
		const int64_t position = (int64_t)device->hat_x * 2;
		if (position < midpoint) {
			*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
		}
		if (position > midpoint) {
			*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
		}
	} else {
		if (device->hat_x < 0) {
			*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
		}
		if (device->hat_x > 0) {
			*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
		}
	}
	if (device->hat_y_valid &&
			device->hat_y_min <= device->hat_y_max &&
			device->hat_y_min != device->hat_y_max) {
		const int64_t midpoint = (int64_t)device->hat_y_min + device->hat_y_max;
		const int64_t position = (int64_t)device->hat_y * 2;
		if (position < midpoint) {
			*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		}
		if (position > midpoint) {
			*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		}
	} else {
		if (device->hat_y < 0) {
			*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		}
		if (device->hat_y > 0) {
			*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		}
	}
}

static void apply_evdev_absolute_axes(InputDevice* device, uint16_t* pad_state) {
	const int32_t x_range = device->abs_x_max - device->abs_x_min;
	const int32_t y_range = device->abs_y_max - device->abs_y_min;
	if (x_range <= 0 || y_range <= 0) {
		return;
	}
	const int32_t x_midpoint = device->abs_x_min + x_range / 2;
	const int32_t y_midpoint = device->abs_y_min + y_range / 2;
	const int32_t x_deadzone = x_range / 8;
	const int32_t y_deadzone = y_range / 8;
	if (device->abs_x < x_midpoint - x_deadzone) {
		*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
	}
	if (device->abs_x > x_midpoint + x_deadzone) {
		*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
	}
	if (device->abs_y < y_midpoint - y_deadzone) {
		*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
	}
	if (device->abs_y > y_midpoint + y_deadzone) {
		*pad_state |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
	}
}

static void poll_evdev_devices(void) {
	InputDevices* input = &g_input_devices;
	uint16_t pad_state = 0;
	reset_mouse_frame_state();
	for (size_t index = 0; index < input->device_count; ++index) {
		InputDevice* device = &input->devices[index];
		if (device->fd < 0) {
			continue;
		}
		struct input_event event;
		for (;;) {
			const ssize_t bytes = read(device->fd, &event, sizeof(event));
			if (bytes < 0) {
				if (errno == EAGAIN || errno == EWOULDBLOCK) {
					break;
				}
				host_fatal(
						"read(%s) failed: %s",
						device->path,
						strerror(errno));
			}
			if (!bytes) {
				keyboard_input_release_source(
						KEYBOARD_INPUT_SOURCE_EVDEV_FIRST + (unsigned)index);
				close(device->fd);
				device->fd = -1;
				device->pad_state = 0;
				break;
			}
			if ((size_t)bytes != sizeof(event)) {
				host_fatal("Short read from %s: %zd", device->path, bytes);
			}
			if (event.type == EV_KEY) {
				const enum retro_key keyboard_key =
						keyboard_input_key_from_evdev(event.code);
				if (keyboard_key != RETROK_UNKNOWN &&
						(event.value == 0 || event.value == 1)) {
					keyboard_input_post(
							KEYBOARD_INPUT_SOURCE_EVDEV_FIRST +
								(unsigned)index,
							keyboard_key,
							event.value != 0);
				}
				const uint8_t mouse_button =
						map_evdev_key_to_mouse(event.code);
				if (mouse_button) {
					if (event.value) {
						input->mouse_buttons |= mouse_button;
					} else {
						input->mouse_buttons &= (uint8_t)~mouse_button;
					}
				}
				const uint16_t pad_button = map_evdev_key_to_pad(event.code);
				if (pad_button) {
					if (event.value) {
						device->pad_state |= pad_button;
					} else {
						device->pad_state &= (uint16_t)~pad_button;
					}
				}
			} else if (event.type == EV_ABS) {
				switch (event.code) {
					case ABS_HAT0X:
						device->hat_x = event.value;
						device->has_hat = true;
						break;
					case ABS_HAT0Y:
						device->hat_y = event.value;
						device->has_hat = true;
						break;
					case ABS_X:
						device->abs_x = event.value;
						device->has_abs_xy = true;
						break;
					case ABS_Y:
						device->abs_y = event.value;
						device->has_abs_xy = true;
						break;
					default:
						break;
				}
			} else if (event.type == EV_REL) {
				switch (event.code) {
					case REL_X:
						add_mouse_relative_delta(event.value, 0);
						break;
					case REL_Y:
						add_mouse_relative_delta(0, event.value);
						break;
					case REL_WHEEL:
						input->mouse_wheel_y -= event.value;
						break;
					default:
						break;
				}
			}
		}
		pad_state |= device->pad_state;
		if (device->has_hat) {
			apply_evdev_hat(device, &pad_state);
		} else if (device->has_abs_xy) {
			apply_evdev_absolute_axes(device, &pad_state);
		}
	}
	update_pointer_from_surface();
	finalize_pad_state(pad_state);
}

#ifdef BMSX_LIBRETRO_HOST_SDL
typedef struct SdlKeyboardPadBinding {
	SDL_Scancode scancode;
	uint16_t pad_button;
} SdlKeyboardPadBinding;

typedef struct SdlControllerPadBinding {
	SDL_GameControllerButton controller_button;
	uint16_t pad_button;
} SdlControllerPadBinding;

static uint8_t map_sdl_mouse_buttons(uint32_t buttons) {
	uint8_t mapped = 0;
	if (buttons & SDL_BUTTON(SDL_BUTTON_LEFT)) mapped |= kMouseButtonPrimary;
	if (buttons & SDL_BUTTON(SDL_BUTTON_RIGHT)) mapped |= kMouseButtonSecondary;
	if (buttons & SDL_BUTTON(SDL_BUTTON_MIDDLE)) mapped |= kMouseButtonAux;
	if (buttons & SDL_BUTTON(SDL_BUTTON_X1)) mapped |= kMouseButtonBack;
	if (buttons & SDL_BUTTON(SDL_BUTTON_X2)) mapped |= kMouseButtonForward;
	return mapped;
}

static void open_sdl_controller(int device_index) {
	InputDevices* input = &g_input_devices;
	input->controller = SDL_GameControllerOpen(device_index);
	if (!input->controller) {
		return;
	}
	SDL_Joystick* joystick =
			SDL_GameControllerGetJoystick(input->controller);
	input->controller_id = SDL_JoystickInstanceID(joystick);
	fprintf(
			stderr,
			"[libretro-host] SDL gamepad: %s\n",
			SDL_GameControllerName(input->controller));
}

static void open_first_sdl_controller(void) {
	const int joystick_count = SDL_NumJoysticks();
	for (int index = 0; index < joystick_count; ++index) {
		if (SDL_IsGameController(index)) {
			open_sdl_controller(index);
			if (g_input_devices.controller) {
				return;
			}
		}
	}
}

static void set_mouse_absolute_position(int x, int y, bool update_delta) {
	InputDevices* input = &g_input_devices;
	const bool had_previous = input->mouse_position_valid;
	const int previous_x = input->mouse_absolute_x;
	const int previous_y = input->mouse_absolute_y;
	input->mouse_absolute_x = x;
	input->mouse_absolute_y = y;
	input->mouse_position_valid = true;
	clamp_mouse_position_to_surface();
	if (update_delta && had_previous) {
		input->mouse_delta_x = input->mouse_absolute_x - previous_x;
		input->mouse_delta_y = input->mouse_absolute_y - previous_y;
	}
}

static void update_sdl_mouse_position(void) {
	InputDevices* input = &g_input_devices;
	int window_x = 0;
	int window_y = 0;
	input->mouse_buttons = map_sdl_mouse_buttons(
			SDL_GetMouseState(&window_x, &window_y));
	int surface_x = 0;
	int surface_y = 0;
	if (!bmsx_video_context_window_point_to_surface(
			window_x,
			window_y,
			&surface_x,
			&surface_y)) {
		return;
	}
	set_mouse_absolute_position(surface_x, surface_y, true);
	video_presenter_map_surface_point(
			surface_x,
			surface_y,
			&input->pointer_x,
			&input->pointer_y,
			&input->pointer_inside_game_viewport);
}

static uint16_t sdl_keyboard_pad_state(void) {
	static const SdlKeyboardPadBinding bindings[] = {
		{SDL_SCANCODE_UP, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP)},
		{SDL_SCANCODE_DOWN, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN)},
		{SDL_SCANCODE_LEFT, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT)},
		{SDL_SCANCODE_RIGHT, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT)},
		{SDL_SCANCODE_LSHIFT, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L)},
		{SDL_SCANCODE_RSHIFT, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R)},
		{SDL_SCANCODE_LCTRL, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L2)},
		{SDL_SCANCODE_RCTRL, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R2)},
		{SDL_SCANCODE_BACKSPACE, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT)},
		{SDL_SCANCODE_RETURN, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START)},
		{SDL_SCANCODE_X, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A)},
		{SDL_SCANCODE_C, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B)},
		{SDL_SCANCODE_Z, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X)},
		{SDL_SCANCODE_S, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y)},
		{SDL_SCANCODE_Q, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L3)},
		{SDL_SCANCODE_E, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R3)},
	};
	const Uint8* keyboard = SDL_GetKeyboardState(NULL);
	uint16_t pad_state = 0;
	for (size_t index = 0;
			index < sizeof(bindings) / sizeof(bindings[0]);
			++index) {
		if (keyboard[bindings[index].scancode]) {
			pad_state |= bindings[index].pad_button;
		}
	}
	return pad_state;
}

static uint16_t sdl_controller_pad_state(void) {
	static const SdlControllerPadBinding bindings[] = {
		{SDL_CONTROLLER_BUTTON_DPAD_UP, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP)},
		{SDL_CONTROLLER_BUTTON_DPAD_DOWN, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN)},
		{SDL_CONTROLLER_BUTTON_DPAD_LEFT, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT)},
		{SDL_CONTROLLER_BUTTON_DPAD_RIGHT, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT)},
		{SDL_CONTROLLER_BUTTON_LEFTSHOULDER, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L)},
		{SDL_CONTROLLER_BUTTON_RIGHTSHOULDER, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R)},
		{SDL_CONTROLLER_BUTTON_START, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START)},
		{SDL_CONTROLLER_BUTTON_BACK, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT)},
		{SDL_CONTROLLER_BUTTON_A, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A)},
		{SDL_CONTROLLER_BUTTON_B, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B)},
		{SDL_CONTROLLER_BUTTON_X, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X)},
		{SDL_CONTROLLER_BUTTON_Y, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y)},
		{SDL_CONTROLLER_BUTTON_LEFTSTICK, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L3)},
		{SDL_CONTROLLER_BUTTON_RIGHTSTICK, (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R3)},
	};
	InputDevices* input = &g_input_devices;
	uint16_t pad_state = 0;
	for (size_t index = 0;
			index < sizeof(bindings) / sizeof(bindings[0]);
			++index) {
		if (SDL_GameControllerGetButton(
				input->controller,
				bindings[index].controller_button)) {
			pad_state |= bindings[index].pad_button;
		}
	}
	return pad_state;
}

static void handle_sdl_window_event(const SDL_WindowEvent* event) {
	InputDevices* input = &g_input_devices;
	switch (event->event) {
		case SDL_WINDOWEVENT_FOCUS_LOST:
			input->focused = false;
			input->mouse_buttons = 0;
			input->mouse_wheel_y = 0;
			keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_SDL);
			break;
		case SDL_WINDOWEVENT_FOCUS_GAINED:
			input->focused = true;
			break;
		case SDL_WINDOWEVENT_SIZE_CHANGED:
		case SDL_WINDOWEVENT_DISPLAY_CHANGED:
			if (bmsx_video_context_refresh_drawable_size()) {
				video_presenter_surface_changed();
				clamp_mouse_position_to_surface();
			}
			break;
		default:
			break;
	}
}

static void poll_sdl_devices(void) {
	InputDevices* input = &g_input_devices;
	SDL_PumpEvents();
	reset_mouse_frame_state();
	SDL_Event event;
	while (SDL_PollEvent(&event)) {
		switch (event.type) {
			case SDL_QUIT:
				input->quit_requested = true;
				break;
			case SDL_KEYDOWN:
			case SDL_KEYUP:
				if (!event.key.repeat) {
					const enum retro_key keyboard_key =
							keyboard_input_key_from_sdl(
								event.key.keysym.scancode);
					if (keyboard_key != RETROK_UNKNOWN) {
						keyboard_input_post(
								KEYBOARD_INPUT_SOURCE_SDL,
								keyboard_key,
								event.type == SDL_KEYDOWN);
					}
				}
				break;
			case SDL_WINDOWEVENT:
				handle_sdl_window_event(&event.window);
				break;
			case SDL_CONTROLLERDEVICEADDED:
				if (!input->controller &&
						SDL_IsGameController(event.cdevice.which)) {
					open_sdl_controller(event.cdevice.which);
				}
				break;
			case SDL_CONTROLLERDEVICEREMOVED:
				if (input->controller &&
						event.cdevice.which == input->controller_id) {
					SDL_GameControllerClose(input->controller);
					input->controller = NULL;
					input->controller_id = -1;
				}
				break;
			case SDL_MOUSEWHEEL: {
				int wheel_y = event.wheel.y;
				if (event.wheel.direction == SDL_MOUSEWHEEL_FLIPPED) {
					wheel_y = -wheel_y;
				}
				input->mouse_wheel_y -= wheel_y;
				break;
			}
			default:
				break;
		}
	}
	if (input->focused) {
		update_sdl_mouse_position();
	}
	uint16_t pad_state = 0;
	if (input->focused) {
		pad_state = sdl_keyboard_pad_state();
		if (input->controller) {
			pad_state |= sdl_controller_pad_state();
		}
	}
	finalize_pad_state(pad_state);
}
#endif

void input_devices_open(
		BmsxInputDriverKind driver,
		bool initial_focus,
		const BmsxVideoSurface* surface) {
	g_input_devices = (InputDevices){
		.driver = driver,
		.surface = surface,
#ifdef BMSX_LIBRETRO_HOST_SDL
		.controller_id = -1,
		.focused = initial_focus,
#endif
	};
	if (driver == BMSX_INPUT_DRIVER_EVDEV) {
		open_evdev_devices();
		return;
	}
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (SDL_InitSubSystem(SDL_INIT_GAMECONTROLLER) != 0) {
		host_fatal(
				"SDL game-controller initialization failed: %s",
				SDL_GetError());
	}
	SDL_ShowCursor(SDL_DISABLE);
	open_first_sdl_controller();
#else
	(void)initial_focus;
	host_fatal("SDL input driver not available in this build");
#endif
}

void input_devices_close(void) {
	InputDevices* input = &g_input_devices;
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (input->driver == BMSX_INPUT_DRIVER_SDL) {
		keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_SDL);
		if (input->controller) {
			SDL_GameControllerClose(input->controller);
		}
		SDL_QuitSubSystem(SDL_INIT_GAMECONTROLLER);
		return;
	}
#endif
	for (size_t index = 0; index < input->device_count; ++index) {
		if (input->devices[index].fd >= 0) {
			keyboard_input_release_source(
					KEYBOARD_INPUT_SOURCE_EVDEV_FIRST + (unsigned)index);
			close(input->devices[index].fd);
		}
	}
}

void input_devices_poll(void) {
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_input_devices.driver == BMSX_INPUT_DRIVER_SDL) {
		poll_sdl_devices();
		return;
	}
#endif
	poll_evdev_devices();
}

int16_t input_devices_state(
		unsigned port,
		unsigned device,
		unsigned index,
		unsigned id) {
	InputDevices* input = &g_input_devices;
	(void)index;
	if (port != 0) {
		return 0;
	}
	if (device == RETRO_DEVICE_JOYPAD) {
		return (input->pad_state & (uint16_t)(1u << id)) ? 1 : 0;
	}
	if (device == RETRO_DEVICE_MOUSE) {
		switch (id) {
			case kRetroMouseIdX:
				return (int16_t)input->mouse_delta_x;
			case kRetroMouseIdY:
				return (int16_t)input->mouse_delta_y;
			case kRetroMouseIdLeft:
				return (input->mouse_buttons & kMouseButtonPrimary) ? 1 : 0;
			case kRetroMouseIdRight:
				return (input->mouse_buttons & kMouseButtonSecondary) ? 1 : 0;
			case kRetroMouseIdWheelUp:
				return input->mouse_wheel_y < 0
					? (int16_t)-input->mouse_wheel_y
					: 0;
			case kRetroMouseIdWheelDown:
				return input->mouse_wheel_y > 0
					? (int16_t)input->mouse_wheel_y
					: 0;
			case kRetroMouseIdMiddle:
				return (input->mouse_buttons & kMouseButtonAux) ? 1 : 0;
			case kRetroMouseIdButton4:
				return (input->mouse_buttons & kMouseButtonBack) ? 1 : 0;
			case kRetroMouseIdButton5:
				return (input->mouse_buttons & kMouseButtonForward) ? 1 : 0;
			default:
				return 0;
		}
	}
	if (device == RETRO_DEVICE_POINTER) {
		switch (id) {
			case kRetroPointerIdX:
				return input->pointer_x;
			case kRetroPointerIdY:
				return input->pointer_y;
			case kRetroPointerIdPressed:
				return input->pointer_inside_game_viewport &&
					(input->mouse_buttons & kMouseButtonPrimary)
					? 1
					: 0;
			default:
				return 0;
		}
	}
	return 0;
}

bool input_devices_quit_requested(void) {
	return g_input_devices.quit_requested;
}
