#define _GNU_SOURCE

#include <dirent.h>
#include <limits.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#ifdef BMSX_LIBRETRO_HOST_SDL
#include <SDL.h>
#endif
#include <linux/input.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <ucontext.h>

#include "libretro.h"
#include "audio_output.h"
#include "core_options.h"
#include "frame_pacer.h"
#include "frame_timing.h"
#include "host_fatal.h"
#include "input_timeline.h"
#include "keyboard_input.h"
#include "video_context.h"
#include "video_presenter.h"

#define BMSX_HOST_USEC_PER_SECOND 1000000ull
#define BMSX_HOST_NSEC_PER_SECOND 1000000000ull

typedef struct LibretroCore {
	void* handle;

	void (*retro_set_environment)(retro_environment_t);
	void (*retro_set_video_refresh)(retro_video_refresh_t);
	void (*retro_set_audio_sample)(retro_audio_sample_t);
	void (*retro_set_audio_sample_batch)(retro_audio_sample_batch_t);
	void (*retro_set_input_poll)(retro_input_poll_t);
	void (*retro_set_input_state)(retro_input_state_t);

	void (*retro_init)(void);
	void (*retro_deinit)(void);
	unsigned (*retro_api_version)(void);
	void (*retro_get_system_info)(struct retro_system_info*);
	void (*retro_get_system_av_info)(struct retro_system_av_info*);
	void (*retro_set_controller_port_device)(unsigned, unsigned);

	void (*retro_reset)(void);
	void (*retro_run)(void);

	bool (*retro_load_game)(const struct retro_game_info*);
	void (*retro_unload_game)(void);
	unsigned (*retro_get_region)(void);

	size_t (*retro_serialize_size)(void);
	bool (*retro_serialize)(void*, size_t);
	bool (*retro_unserialize)(const void*, size_t);

	void* (*retro_get_memory_data)(unsigned);
	size_t (*retro_get_memory_size)(unsigned);

	void (*retro_cheat_reset)(void);
	void (*retro_cheat_set)(unsigned, bool, const char*);
} LibretroCore;

typedef struct InputDev {
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
} InputDev;

static volatile sig_atomic_t g_should_quit = 0;
enum { kInputTimelineAutoQuitGraceFrames = 0 };
static bool g_input_debug = false;
static const uint64_t kExitComboHoldMs = 2000;
static char g_system_dir[1024] = "";
static char g_save_dir[1024] = "";
static LibretroCore* g_core = NULL;
static BmsxCoreOptions g_core_options;

#ifdef BMSX_LIBRETRO_HOST_SDL
static bool g_use_sdl = false;
static SDL_GameController* g_sdl_gamepad = NULL;
static SDL_JoystickID g_sdl_gamepad_id = -1;
static uint16_t g_sdl_pad_state = 0;
static bool g_sdl_focused = true;
#endif

static uint64_t g_frame_usec = 0;
static uint64_t g_frame_ns = 0;
static uint64_t g_max_run_frames = 0;
static uint64_t g_run_frame_count = 0;
static struct retro_frame_time_callback g_frame_time_cb = {0};
static bool g_has_frame_time_cb = false;

static BmsxFrameTimingState g_frame_timing = {
	.warmup_frames = 500u,
};

static BmsxVideoSurface* g_video_surface = NULL;
enum { kMaxInputDevs = KEYBOARD_INPUT_EVDEV_SOURCE_COUNT };
static InputDev g_input_devs[kMaxInputDevs];
static char g_input_paths[kMaxInputDevs][64];
static size_t g_input_dev_count = 0;
static uint16_t g_pad_state_raw = 0;
static uint16_t g_pad_state_port0 = 0;
enum {
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
static int32_t g_mouse_abs_x = 0;
static int32_t g_mouse_abs_y = 0;
static int32_t g_mouse_delta_x = 0;
static int32_t g_mouse_delta_y = 0;
static int32_t g_mouse_wheel_y = 0;
static uint8_t g_mouse_buttons = 0;
static bool g_mouse_position_valid = false;
static int16_t g_pointer_x = 0;
static int16_t g_pointer_y = 0;
static bool g_pointer_inside_game_viewport = false;
#ifdef BMSX_LIBRETRO_HOST_SDL
static uint8_t map_sdl_mouse_buttons(uint32_t buttons);
static void set_mouse_absolute_position(int x, int y, bool update_delta);
#endif
static void clamp_mouse_position_to_framebuffer(void);
static void crash_handler(int sig, siginfo_t* si, void* ctx_) {
#if defined(__arm__)
	ucontext_t* uc = (ucontext_t*)ctx_;
	unsigned long pc = uc->uc_mcontext.arm_pc;
	unsigned long sp = uc->uc_mcontext.arm_sp;
	fprintf(stderr, "\nCRASH sig=%d addr=%p pc=%08lx lr=%08lx sp=%08lx\n",
			sig, si->si_addr, pc, (unsigned long)uc->uc_mcontext.arm_lr, sp);
#elif defined(__aarch64__)
	ucontext_t* uc = (ucontext_t*)ctx_;
	unsigned long pc = uc->uc_mcontext.pc;
	unsigned long sp = uc->uc_mcontext.sp;
	fprintf(stderr, "\nCRASH sig=%d addr=%p pc=%016lx sp=%016lx\n",
			sig, si->si_addr, pc, sp);
#else
	(void)ctx_;
	fprintf(stderr, "\nCRASH sig=%d addr=%p\n", sig, si->si_addr);
#endif

	fflush(stderr);
	_Exit(128 + sig);
}

static void install_crash_handlers(void) {
	struct sigaction sa;
	sa.sa_sigaction = crash_handler;
	sigemptyset(&sa.sa_mask);
	sa.sa_flags = SA_SIGINFO | SA_RESETHAND;

	sigaction(SIGSEGV, &sa, NULL);
	sigaction(SIGBUS,  &sa, NULL);
	sigaction(SIGILL,  &sa, NULL);
	sigaction(SIGABRT, &sa, NULL);
}

static void on_signal(int signum) {
	(void)signum;
	g_should_quit = 1;
}

static void host_log(enum retro_log_level level, const char* fmt, ...) {
	const char* prefix = "INFO";
	switch (level) {
		case RETRO_LOG_DEBUG: prefix = "DEBUG"; break;
		case RETRO_LOG_INFO: prefix = "INFO"; break;
		case RETRO_LOG_WARN: prefix = "WARN"; break;
		case RETRO_LOG_ERROR: prefix = "ERROR"; break;
		default: break;
	}
	fprintf(stderr, "[libretro-host][%s] ", prefix);
	va_list ap;
	va_start(ap, fmt);
	vfprintf(stderr, fmt, ap);
	va_end(ap);
}

static uint64_t monotonic_ns(void);
static uint64_t monotonic_ms(void);
static void set_host_timing(const struct retro_system_timing* timing);
#ifdef BMSX_LIBRETRO_HOST_SDL
static void poll_input_devices_sdl(void);
#endif

#ifdef BMSX_LIBRETRO_HOST_SDL
static void sdl_open_first_controller(void) {
	const int num = SDL_NumJoysticks();
	for (int i = 0; i < num; ++i) {
		if (!SDL_IsGameController(i)) {
			continue;
		}
		g_sdl_gamepad = SDL_GameControllerOpen(i);
		if (!g_sdl_gamepad) {
			continue;
		}
		SDL_Joystick* joy = SDL_GameControllerGetJoystick(g_sdl_gamepad);
		g_sdl_gamepad_id = SDL_JoystickInstanceID(joy);
		fprintf(stderr, "[libretro-host] SDL gamepad: %s\n", SDL_GameControllerName(g_sdl_gamepad));
		return;
	}
}

static void sdl_update_mouse_position(void) {
	int window_x = 0;
	int window_y = 0;
	const uint32_t mouse_state = SDL_GetMouseState(&window_x, &window_y);
	g_mouse_buttons = map_sdl_mouse_buttons(mouse_state);
	int surface_x = 0;
	int surface_y = 0;
	if (bmsx_video_context_window_point_to_surface(
			window_x,
			window_y,
			&surface_x,
			&surface_y)) {
		set_mouse_absolute_position(surface_x, surface_y, true);
		video_presenter_map_surface_point(
				surface_x,
				surface_y,
				&g_pointer_x,
				&g_pointer_y,
				&g_pointer_inside_game_viewport);
	}
}
#endif

static bool environ_cb(unsigned cmd, void* data) {
	switch (cmd) {
		case RETRO_ENVIRONMENT_GET_LOG_INTERFACE: {
			struct retro_log_callback* cb = (struct retro_log_callback*)data;
			cb->log = host_log;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
			return true;
		case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY: {
			const char** out = (const char**)data;
			*out = g_system_dir;
			return true;
		}
		case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: {
			const char** out = (const char**)data;
			*out = g_save_dir[0] ? g_save_dir : g_system_dir;
			return true;
		}
		case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: {
			unsigned* version = (unsigned*)data;
			*version = 2;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
			bmsx_core_options_register_v2(&g_core_options, (const struct retro_core_options_v2*)data);
			return false;
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL: {
			const struct retro_core_options_v2_intl* definitions = (const struct retro_core_options_v2_intl*)data;
			bmsx_core_options_register_v2(&g_core_options, definitions ? definitions->us : NULL);
			return false;
		}
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL: {
			const struct retro_core_options_intl* definitions = (const struct retro_core_options_intl*)data;
			bmsx_core_options_register_v1(&g_core_options, definitions ? definitions->us : NULL);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
			bmsx_core_options_register_v1(&g_core_options, (const struct retro_core_option_definition*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_VARIABLES:
			bmsx_core_options_register_legacy(&g_core_options, (const struct retro_variable*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_VARIABLE: {
			return bmsx_core_options_set_variable(&g_core_options, (const struct retro_variable*)data);
		}
		case RETRO_ENVIRONMENT_GET_VARIABLE: {
			return bmsx_core_options_get(&g_core_options, (struct retro_variable*)data);
		}
		case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: {
			bool* updated = (bool*)data;
			*updated = bmsx_core_options_take_updated(&g_core_options);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_MESSAGE: {
			video_presenter_post_message((const struct retro_message*)data);
			return true;
		}
		case RETRO_ENVIRONMENT_GET_CAN_DUPE: {
			bool* can_dupe = (bool*)data;
			*can_dupe = true;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
			return true;
		case RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK:
			keyboard_input_set_callback(*(const struct retro_keyboard_callback*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_GEOMETRY:
			video_presenter_update_geometry((const struct retro_game_geometry*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO: {
			const struct retro_system_av_info* info = (const struct retro_system_av_info*)data;
			video_presenter_update_av_info(info);
			set_host_timing(&info->timing);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
			return video_presenter_accept_pixel_format(
					*(const enum retro_pixel_format*)data);
		case RETRO_ENVIRONMENT_SET_HW_RENDER:
			return video_presenter_negotiate_hw_render(
					(struct retro_hw_render_callback*)data);
		case RETRO_ENVIRONMENT_SET_FRAME_TIME_CALLBACK: {
			const struct retro_frame_time_callback* cb = (const struct retro_frame_time_callback*)data;
			g_frame_time_cb = *cb;
			g_has_frame_time_cb = cb->callback != NULL;
			return true;
		}
		case RETRO_ENVIRONMENT_SHUTDOWN:
			g_should_quit = 1;
			return true;
	default:
			return false;
	}
}


static int clamp_int(int value, int min_value, int max_value) {
	if (value < min_value) return min_value;
	if (value > max_value) return max_value;
	return value;
}

static void reset_mouse_frame_state(void) {
	g_mouse_delta_x = 0;
	g_mouse_delta_y = 0;
	g_mouse_wheel_y = 0;
}

static void clamp_mouse_position_to_framebuffer(void) {
	g_mouse_abs_x = clamp_int(g_mouse_abs_x, 0, g_video_surface->width - 1);
	g_mouse_abs_y = clamp_int(g_mouse_abs_y, 0, g_video_surface->height - 1);
}

#ifdef BMSX_LIBRETRO_HOST_SDL
static void set_mouse_absolute_position(int x, int y, bool update_delta) {
	const bool had_prev = g_mouse_position_valid;
	const int prev_x = g_mouse_abs_x;
	const int prev_y = g_mouse_abs_y;
	g_mouse_abs_x = x;
	g_mouse_abs_y = y;
	g_mouse_position_valid = true;
	clamp_mouse_position_to_framebuffer();
	if (update_delta && had_prev) {
		g_mouse_delta_x = g_mouse_abs_x - prev_x;
		g_mouse_delta_y = g_mouse_abs_y - prev_y;
	}
}
#endif

static void add_mouse_relative_delta(int dx, int dy) {
	g_mouse_delta_x += dx;
	g_mouse_delta_y += dy;
	if (!g_mouse_position_valid) {
		g_mouse_abs_x = 0;
		g_mouse_abs_y = 0;
		g_mouse_position_valid = true;
	}
	g_mouse_abs_x += dx;
	g_mouse_abs_y += dy;
	clamp_mouse_position_to_framebuffer();
}

static void update_pointer_from_surface(void) {
	if (!g_mouse_position_valid) {
		g_pointer_x = 0;
		g_pointer_y = 0;
		g_pointer_inside_game_viewport = false;
		return;
	}
	video_presenter_map_surface_point(
			g_mouse_abs_x,
			g_mouse_abs_y,
			&g_pointer_x,
			&g_pointer_y,
			&g_pointer_inside_game_viewport);
}

static uint8_t map_ev_key_to_mouse(uint16_t code) {
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

static uint16_t map_ev_key_to_pad(uint16_t code) {
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
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L);
		case BTN_TR:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R);
		case KEY_LEFTSHIFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L);
		case KEY_RIGHTSHIFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R);
		case BTN_TL2:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L2);
		case BTN_TR2:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R2);

		case BTN_START:
		case KEY_ENTER:
		case KEY_KPENTER:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START);
		case BTN_SELECT:
		case KEY_BACKSPACE:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);
		case KEY_LEFTCTRL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L2);
		case KEY_RIGHTCTRL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R2);

		case KEY_Q:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L3);
		case KEY_E:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R3);

		case KEY_X:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A);
		case KEY_C:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B);
		case KEY_Z:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X);
		case KEY_S:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y);

		case BTN_SOUTH:
			// SNES mini button wiring reports A/B swapped; map to physical layout.
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A);
		case BTN_EAST:
			// SNES mini button wiring reports A/B swapped; map to physical layout.
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B);
		case BTN_NORTH:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X);
		case BTN_WEST:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y);
		default:
			return 0;
	}
}

#ifdef BMSX_LIBRETRO_HOST_SDL
static uint16_t map_sdl_key_to_pad(SDL_Keycode code) {
	switch (code) {
		case SDLK_UP:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		case SDLK_DOWN:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		case SDLK_LEFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
		case SDLK_RIGHT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);

		case SDLK_LSHIFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L);
		case SDLK_RSHIFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R);

		case SDLK_LCTRL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L2);
		case SDLK_RCTRL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R2);

		case SDLK_q:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L3);
		case SDLK_e:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R3);

		case SDLK_RETURN:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START);
		case SDLK_BACKSPACE:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);

		case SDLK_x:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A);
		case SDLK_c:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B);
		case SDLK_z:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X);
		case SDLK_s:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y);
		default:
			return 0;
	}
}

static uint16_t map_sdl_button_to_pad(uint8_t button) {
	switch (button) {
		case SDL_CONTROLLER_BUTTON_DPAD_UP:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		case SDL_CONTROLLER_BUTTON_DPAD_DOWN:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		case SDL_CONTROLLER_BUTTON_DPAD_LEFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
		case SDL_CONTROLLER_BUTTON_DPAD_RIGHT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);

		case SDL_CONTROLLER_BUTTON_LEFTSHOULDER:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L);
		case SDL_CONTROLLER_BUTTON_RIGHTSHOULDER:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R);

		case SDL_CONTROLLER_BUTTON_START:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START);
		case SDL_CONTROLLER_BUTTON_BACK:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);

		case SDL_CONTROLLER_BUTTON_A:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A);
		case SDL_CONTROLLER_BUTTON_B:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B);
		case SDL_CONTROLLER_BUTTON_X:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X);
		case SDL_CONTROLLER_BUTTON_Y:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y);
		case SDL_CONTROLLER_BUTTON_LEFTSTICK:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L3);
		case SDL_CONTROLLER_BUTTON_RIGHTSTICK:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R3);
		default:
			return 0;
	}
}

static uint8_t map_sdl_mouse_buttons(uint32_t buttons) {
	uint8_t mapped = 0;
	if (buttons & SDL_BUTTON(SDL_BUTTON_LEFT)) mapped |= kMouseButtonPrimary;
	if (buttons & SDL_BUTTON(SDL_BUTTON_RIGHT)) mapped |= kMouseButtonSecondary;
	if (buttons & SDL_BUTTON(SDL_BUTTON_MIDDLE)) mapped |= kMouseButtonAux;
	if (buttons & SDL_BUTTON(SDL_BUTTON_X1)) mapped |= kMouseButtonBack;
	if (buttons & SDL_BUTTON(SDL_BUTTON_X2)) mapped |= kMouseButtonForward;
	return mapped;
}
#endif

static bool input_init_abs_axis(InputDev* dev, unsigned code, int32_t* min_out, int32_t* max_out, bool* has_axis) {
	struct input_absinfo absinfo;
	if (ioctl(dev->fd, EVIOCGABS(code), &absinfo) == 0) {
		if (min_out) *min_out = absinfo.minimum;
		if (max_out) *max_out = absinfo.maximum;
		if (has_axis) *has_axis = true;
		return true;
	}
	return false;
}

static void input_register_device(const char* path) {
	if (g_input_dev_count >= kMaxInputDevs) {
		return;
	}
	int fd = open(path, O_RDONLY | O_NONBLOCK);
	if (fd < 0) {
		fprintf(stderr, "[libretro-host] Failed to open %s: %s\n", path, strerror(errno));
		return;
	}
	InputDev dev;
	memset(&dev, 0, sizeof(dev));
	snprintf(g_input_paths[g_input_dev_count], sizeof(g_input_paths[g_input_dev_count]), "%s", path);
	dev.path = g_input_paths[g_input_dev_count];
	dev.fd = fd;
	dev.hat_x = 0;
	dev.hat_y = 0;
	dev.hat_x_min = INT32_MAX;
	dev.hat_x_max = INT32_MIN;
	dev.hat_y_min = INT32_MAX;
	dev.hat_y_max = INT32_MIN;
	dev.abs_x = 0;
	dev.abs_y = 0;
	dev.abs_x_min = INT32_MIN;
	dev.abs_x_max = INT32_MAX;
	dev.abs_y_min = INT32_MIN;
	dev.abs_y_max = INT32_MAX;
	dev.hat_x_valid = false;
	dev.hat_y_valid = false;
	dev.has_hat = false;
	dev.has_abs_xy = false;
	dev.pad_state = 0;

	dev.hat_x_valid = input_init_abs_axis(&dev, ABS_HAT0X, &dev.hat_x_min, &dev.hat_x_max, &dev.has_hat);
	dev.hat_y_valid = input_init_abs_axis(&dev, ABS_HAT0Y, &dev.hat_y_min, &dev.hat_y_max, &dev.has_hat);
	input_init_abs_axis(&dev, ABS_X, &dev.abs_x_min, &dev.abs_x_max, &dev.has_abs_xy);
	input_init_abs_axis(&dev, ABS_Y, &dev.abs_y_min, &dev.abs_y_max, &dev.has_abs_xy);

	g_input_devs[g_input_dev_count++] = dev;
	fprintf(stderr, "[libretro-host] input %s opened\n", path);
}

static void input_open_default_devices(void) {
	g_input_dev_count = 0;
	DIR* dir = opendir("/dev/input");
	if (dir) {
		struct dirent* ent = NULL;
		while ((ent = readdir(dir)) != NULL) {
			if (strncmp(ent->d_name, "event", 5) != 0) {
				continue;
			}
			char path[64];
			const size_t prefix_len = sizeof("/dev/input/") - 1;
			const size_t max_name = sizeof(path) - prefix_len - 1;
			snprintf(path, sizeof(path), "/dev/input/%.*s", (int)max_name, ent->d_name);
			input_register_device(path);
			if (g_input_dev_count >= kMaxInputDevs) {
				break;
			}
		}
		closedir(dir);
	}

	if (g_input_dev_count == 0) {
		static const char* paths[] = {
			"/dev/input/event0",
			"/dev/input/event1",
			"/dev/input/event2",
			"/dev/input/event3",
		};
		for (size_t i = 0; i < sizeof(paths) / sizeof(paths[0]); ++i) {
			input_register_device(paths[i]);
			if (g_input_dev_count >= kMaxInputDevs) {
				break;
			}
		}
	}
	if (g_input_dev_count == 0) {
		host_fatal("No input devices opened. Are you running as root / do you have permissions for /dev/input/event*?");
	}
}

static void input_finalize(uint16_t merged) {
	g_pad_state_raw = merged;
	static uint64_t combo_start_ms = 0;
	const bool combo_down =
		(g_pad_state_raw & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START)) &&
		(g_pad_state_raw & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT)) &&
		(g_pad_state_raw & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L)) &&
		(g_pad_state_raw & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R));
	if (combo_down) {
		uint64_t now = monotonic_ms();
		if (combo_start_ms == 0) {
			combo_start_ms = now;
		} else if (now - combo_start_ms >= kExitComboHoldMs) {
			fprintf(stderr, "[libretro-host] exit combo held %llums, exiting\n",
				(unsigned long long)(now - combo_start_ms));
			g_should_quit = 1;
			combo_start_ms = 0;
		}
	} else {
		combo_start_ms = 0;
	}
	g_pad_state_port0 = g_pad_state_raw;
}

static void poll_input_devices(void) {
	uint16_t merged = 0;
	reset_mouse_frame_state();
	for (size_t i = 0; i < g_input_dev_count; ++i) {
		InputDev* dev = &g_input_devs[i];
		if (dev->fd < 0) {
			continue;
		}
		struct input_event ev;
		for (;;) {
			ssize_t n = read(dev->fd, &ev, sizeof(ev));
			if (n < 0) {
				if (errno == EAGAIN || errno == EWOULDBLOCK) {
					break;
				}
				host_fatal("read(%s) failed: %s", dev->path, strerror(errno));
			}
			if (n == 0) {
				keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_EVDEV_FIRST + (unsigned)i);
				close(dev->fd);
				dev->fd = -1;
				dev->pad_state = 0;
				break;
			}
			if ((size_t)n != sizeof(ev)) {
				host_fatal("Short read from %s: %zd", dev->path, n);
			}

			if (ev.type == EV_KEY) {
				const enum retro_key keyboard_key = keyboard_input_key_from_evdev(ev.code);
				if (keyboard_key != RETROK_UNKNOWN && (ev.value == 0 || ev.value == 1)) {
					keyboard_input_post(KEYBOARD_INPUT_SOURCE_EVDEV_FIRST + (unsigned)i, keyboard_key, ev.value != 0);
				}
				const uint8_t mouse_button = map_ev_key_to_mouse(ev.code);
				if (mouse_button) {
					if (ev.value) {
						g_mouse_buttons |= mouse_button;
					} else {
						g_mouse_buttons &= (uint8_t)~mouse_button;
					}
				}
				const uint16_t bit = map_ev_key_to_pad(ev.code);
				if (bit) {
					if (ev.value) {
						dev->pad_state |= bit;
					} else {
						dev->pad_state &= (uint16_t)~bit;
					}
				}
			} else if (ev.type == EV_ABS) {
				if (ev.code == ABS_HAT0X) {
					dev->hat_x = ev.value;
					dev->has_hat = true;
				} else if (ev.code == ABS_HAT0Y) {
					dev->hat_y = ev.value;
					dev->has_hat = true;
				} else if (ev.code == ABS_X) {
					dev->abs_x = ev.value;
					dev->has_abs_xy = true;
				} else if (ev.code == ABS_Y) {
					dev->abs_y = ev.value;
					dev->has_abs_xy = true;
				}
			} else if (ev.type == EV_REL) {
				if (ev.code == REL_X) {
					add_mouse_relative_delta(ev.value, 0);
				} else if (ev.code == REL_Y) {
					add_mouse_relative_delta(0, ev.value);
				} else if (ev.code == REL_WHEEL) {
					g_mouse_wheel_y -= ev.value;
				}
			}
		}

		merged |= dev->pad_state;
		if (dev->has_hat) {
			if (dev->hat_x_valid && dev->hat_x_min <= dev->hat_x_max && dev->hat_x_min != dev->hat_x_max) {
				const int64_t mid2 = (int64_t)dev->hat_x_min + (int64_t)dev->hat_x_max;
				const int64_t val2 = (int64_t)dev->hat_x * 2;
				if (val2 < mid2) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
				if (val2 > mid2) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
			} else {
				if (dev->hat_x < 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
				if (dev->hat_x > 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
			}
			if (dev->hat_y_valid && dev->hat_y_min <= dev->hat_y_max && dev->hat_y_min != dev->hat_y_max) {
				const int64_t mid2 = (int64_t)dev->hat_y_min + (int64_t)dev->hat_y_max;
				const int64_t val2 = (int64_t)dev->hat_y * 2;
				if (val2 < mid2) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
				if (val2 > mid2) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
			} else {
				if (dev->hat_y < 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
				if (dev->hat_y > 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
			}
		} else if (dev->has_abs_xy) {
			int32_t x_min = dev->abs_x_min;
			int32_t y_min = dev->abs_y_min;
			int32_t x_range = dev->abs_x_max - x_min;
			int32_t y_range = dev->abs_y_max - y_min;
			if (x_range <= 0 || y_range <= 0) {
				continue;
			}
			int32_t x_mid = x_min + (x_range / 2);
			int32_t y_mid = y_min + (y_range / 2);
			int32_t x_dead = x_range > 0 ? x_range / 8 : 0;
			int32_t y_dead = y_range > 0 ? y_range / 8 : 0;
			if (dev->abs_x < x_mid - x_dead) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
			if (dev->abs_x > x_mid + x_dead) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
			if (dev->abs_y < y_mid - y_dead) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
			if (dev->abs_y > y_mid + y_dead) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		}
	}
	update_pointer_from_surface();
	input_finalize(merged);
}

#ifdef BMSX_LIBRETRO_HOST_SDL
static void poll_input_devices_sdl(void) {
	SDL_Event ev;
	SDL_PumpEvents();
	uint16_t pad_state = 0;
	reset_mouse_frame_state();
	if (g_sdl_focused) {
		const Uint8* keystate = SDL_GetKeyboardState(NULL);
		static const SDL_Keycode keys[] = {
			SDLK_UP,
			SDLK_DOWN,
			SDLK_LEFT,
			SDLK_RIGHT,

			SDLK_LSHIFT,
			SDLK_RSHIFT,
			SDLK_LCTRL,
			SDLK_RCTRL,
			SDLK_BACKSPACE,
			SDLK_RETURN,

			SDLK_x,
			SDLK_c,
			SDLK_z,
			SDLK_s,
			SDLK_q,
			SDLK_e,
		};
		for (size_t i = 0; i < sizeof(keys) / sizeof(keys[0]); ++i) {
			SDL_Scancode sc = SDL_GetScancodeFromKey(keys[i]);
			if (sc != SDL_SCANCODE_UNKNOWN && keystate[sc]) {
				pad_state |= map_sdl_key_to_pad(keys[i]);
			}
		}
		if (g_sdl_gamepad) {
			static const SDL_GameControllerButton buttons[] = {
				SDL_CONTROLLER_BUTTON_DPAD_UP,
				SDL_CONTROLLER_BUTTON_DPAD_DOWN,
				SDL_CONTROLLER_BUTTON_DPAD_LEFT,
				SDL_CONTROLLER_BUTTON_DPAD_RIGHT,
				SDL_CONTROLLER_BUTTON_LEFTSHOULDER,
				SDL_CONTROLLER_BUTTON_RIGHTSHOULDER,
				SDL_CONTROLLER_BUTTON_START,
				SDL_CONTROLLER_BUTTON_BACK,
				SDL_CONTROLLER_BUTTON_A,
				SDL_CONTROLLER_BUTTON_B,
				SDL_CONTROLLER_BUTTON_X,
				SDL_CONTROLLER_BUTTON_Y,
				SDL_CONTROLLER_BUTTON_LEFTSTICK,
				SDL_CONTROLLER_BUTTON_RIGHTSTICK,
			};
			for (size_t i = 0; i < sizeof(buttons) / sizeof(buttons[0]); ++i) {
				if (SDL_GameControllerGetButton(g_sdl_gamepad, buttons[i])) {
					pad_state |= map_sdl_button_to_pad((uint8_t)buttons[i]);
				}
			}
		}
	}
	while (SDL_PollEvent(&ev)) {
		switch (ev.type) {
			case SDL_QUIT:
				g_should_quit = 1;
				break;
			case SDL_KEYDOWN:
			case SDL_KEYUP: {
				if (ev.key.repeat) {
					break;
				}
				const enum retro_key keyboard_key = keyboard_input_key_from_sdl(ev.key.keysym.scancode);
				if (keyboard_key != RETROK_UNKNOWN) {
					keyboard_input_post(KEYBOARD_INPUT_SOURCE_SDL, keyboard_key, ev.type == SDL_KEYDOWN);
				}
				break;
			}
			case SDL_WINDOWEVENT:
				if (ev.window.event == SDL_WINDOWEVENT_FOCUS_LOST) {
					g_sdl_focused = false;
					pad_state = 0;
					g_sdl_pad_state = 0;
					g_mouse_buttons = 0;
					g_mouse_wheel_y = 0;
					keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_SDL);
				} else if (ev.window.event == SDL_WINDOWEVENT_FOCUS_GAINED) {
					g_sdl_focused = true;
				} else if (ev.window.event == SDL_WINDOWEVENT_SIZE_CHANGED ||
						ev.window.event == SDL_WINDOWEVENT_DISPLAY_CHANGED) {
					if (bmsx_video_context_refresh_drawable_size()) {
						video_presenter_surface_changed();
						clamp_mouse_position_to_framebuffer();
					}
				}
				break;
			case SDL_CONTROLLERDEVICEADDED:
				if (!g_sdl_gamepad && SDL_IsGameController(ev.cdevice.which)) {
					g_sdl_gamepad = SDL_GameControllerOpen(ev.cdevice.which);
					if (g_sdl_gamepad) {
						SDL_Joystick* joy = SDL_GameControllerGetJoystick(g_sdl_gamepad);
						g_sdl_gamepad_id = SDL_JoystickInstanceID(joy);
						fprintf(stderr, "[libretro-host] SDL gamepad: %s\n", SDL_GameControllerName(g_sdl_gamepad));
					}
				}
				break;
			case SDL_CONTROLLERDEVICEREMOVED:
				if (g_sdl_gamepad && ev.cdevice.which == g_sdl_gamepad_id) {
					SDL_GameControllerClose(g_sdl_gamepad);
					g_sdl_gamepad = NULL;
					g_sdl_gamepad_id = -1;
					g_sdl_pad_state = 0;
				}
				break;
			case SDL_MOUSEWHEEL: {
				int wheel_y = ev.wheel.y;
				if (ev.wheel.direction == SDL_MOUSEWHEEL_FLIPPED) {
					wheel_y = -wheel_y;
				}
				g_mouse_wheel_y -= wheel_y;
				break;
			}
			default:
				break;
		}
	}
	if (g_sdl_focused) {
		sdl_update_mouse_position();
	}
	g_sdl_pad_state = pad_state;
	input_finalize(g_sdl_pad_state);
}
#endif

static void input_poll_cb(void) {
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		poll_input_devices_sdl();
		return;
	}
#endif
	poll_input_devices();
}

static uint64_t monotonic_ns(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (uint64_t)ts.tv_sec * BMSX_HOST_NSEC_PER_SECOND + (uint64_t)ts.tv_nsec;
}

static uint64_t monotonic_ms(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (uint64_t)ts.tv_sec * 1000ull + (uint64_t)ts.tv_nsec / BMSX_HOST_USEC_PER_SECOND;
}

static void set_host_timing(const struct retro_system_timing* timing) {
	g_frame_usec = (uint64_t)((double)BMSX_HOST_USEC_PER_SECOND / timing->fps + 0.5);
	g_frame_ns = (uint64_t)((double)BMSX_HOST_NSEC_PER_SECOND / timing->fps + 0.5);
}

static int16_t input_state_cb(unsigned port, unsigned device, unsigned index, unsigned id) {
	(void)index;
	if (port != 0) {
		return 0;
	}
	if (device == RETRO_DEVICE_JOYPAD) {
		return (g_pad_state_port0 & (uint16_t)(1u << id)) ? 1 : 0;
	}
	if (device == RETRO_DEVICE_MOUSE) {
		switch (id) {
			case kRetroMouseIdX:
				return (int16_t)g_mouse_delta_x;
			case kRetroMouseIdY:
				return (int16_t)g_mouse_delta_y;
			case kRetroMouseIdLeft:
				return (g_mouse_buttons & kMouseButtonPrimary) ? 1 : 0;
			case kRetroMouseIdRight:
				return (g_mouse_buttons & kMouseButtonSecondary) ? 1 : 0;
			case kRetroMouseIdWheelUp:
				return g_mouse_wheel_y < 0 ? (int16_t)(-g_mouse_wheel_y) : 0;
			case kRetroMouseIdWheelDown:
				return g_mouse_wheel_y > 0 ? (int16_t)g_mouse_wheel_y : 0;
			case kRetroMouseIdMiddle:
				return (g_mouse_buttons & kMouseButtonAux) ? 1 : 0;
			case kRetroMouseIdButton4:
				return (g_mouse_buttons & kMouseButtonBack) ? 1 : 0;
			case kRetroMouseIdButton5:
				return (g_mouse_buttons & kMouseButtonForward) ? 1 : 0;
			default:
				return 0;
		}
	}
	if (device == RETRO_DEVICE_POINTER) {
		switch (id) {
			case kRetroPointerIdX:
				return g_pointer_x;
			case kRetroPointerIdY:
				return g_pointer_y;
			case kRetroPointerIdPressed:
				return g_pointer_inside_game_viewport &&
					(g_mouse_buttons & kMouseButtonPrimary) ? 1 : 0;
			default:
				return 0;
		}
	}
	return 0;
}

static void* read_file(const char* path, size_t* out_size) {
	int fd = open(path, O_RDONLY);
	if (fd < 0) {
		host_fatal("Failed to open %s: %s", path, strerror(errno));
	}
	struct stat st;
	if (fstat(fd, &st) != 0) {
		host_fatal("fstat(%s) failed: %s", path, strerror(errno));
	}
	if (st.st_size <= 0) {
		host_fatal("File is empty: %s", path);
	}
	size_t size = (size_t)st.st_size;
	void* buf = malloc(size);
	if (!buf) {
		host_fatal("malloc(%zu) failed", size);
	}
	size_t off = 0;
	while (off < size) {
		ssize_t n = read(fd, (uint8_t*)buf + off, size - off);
		if (n < 0) {
			host_fatal("read(%s) failed: %s", path, strerror(errno));
		}
		if (n == 0) {
			host_fatal("Unexpected EOF while reading %s", path);
		}
		off += (size_t)n;
	}
	close(fd);
	*out_size = size;
	return buf;
}

static void load_symbol(void* handle, const char* name, void* out_fn_ptr) {
	void* sym = dlsym(handle, name);
	if (!sym) {
		host_fatal("Missing symbol %s: %s", name, dlerror());
	}
	memcpy(out_fn_ptr, &sym, sizeof(sym));
}

static void load_core(LibretroCore* core, const char* path) {
	memset(core, 0, sizeof(*core));
	core->handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
	if (!core->handle) {
		host_fatal("dlopen(%s) failed: %s", path, dlerror());
	}

	load_symbol(core->handle, "retro_set_environment", &core->retro_set_environment);
	load_symbol(core->handle, "retro_set_video_refresh", &core->retro_set_video_refresh);
	load_symbol(core->handle, "retro_set_audio_sample", &core->retro_set_audio_sample);
	load_symbol(core->handle, "retro_set_audio_sample_batch", &core->retro_set_audio_sample_batch);
	load_symbol(core->handle, "retro_set_input_poll", &core->retro_set_input_poll);
	load_symbol(core->handle, "retro_set_input_state", &core->retro_set_input_state);
	load_symbol(core->handle, "retro_init", &core->retro_init);
	load_symbol(core->handle, "retro_deinit", &core->retro_deinit);
	load_symbol(core->handle, "retro_api_version", &core->retro_api_version);
	load_symbol(core->handle, "retro_get_system_info", &core->retro_get_system_info);
	load_symbol(core->handle, "retro_get_system_av_info", &core->retro_get_system_av_info);
	load_symbol(core->handle, "retro_set_controller_port_device", &core->retro_set_controller_port_device);
	load_symbol(core->handle, "retro_reset", &core->retro_reset);
	load_symbol(core->handle, "retro_run", &core->retro_run);
	load_symbol(core->handle, "retro_load_game", &core->retro_load_game);
	load_symbol(core->handle, "retro_unload_game", &core->retro_unload_game);
	load_symbol(core->handle, "retro_get_region", &core->retro_get_region);
	load_symbol(core->handle, "retro_serialize_size", &core->retro_serialize_size);
	load_symbol(core->handle, "retro_serialize", &core->retro_serialize);
	load_symbol(core->handle, "retro_unserialize", &core->retro_unserialize);
	load_symbol(core->handle, "retro_get_memory_data", &core->retro_get_memory_data);
	load_symbol(core->handle, "retro_get_memory_size", &core->retro_get_memory_size);
	load_symbol(core->handle, "retro_cheat_reset", &core->retro_cheat_reset);
	load_symbol(core->handle, "retro_cheat_set", &core->retro_cheat_set);
}

static void usage(const char* argv0) {
	fprintf(stderr,
			"Usage:\n"
			"  %s --core ./libretro_bmsx.so --no-game [--backend software|gles2] [--video fb|sdl] [--hidden-window] [--system-dir PATH] [--save-dir PATH] [--rom-folder FOLDER] [--input-timeline FILE] [--paced-timeline] [--auto-timeline] [--input-debug] [--no-audio] [--max-frames N] [--gles2-timing-report] [--timing-warmup N] [--crt-postprocessing on|off] [--crt-noise on|off]\n"
			"  %s --core ./libretro_bmsx.so GAME.rom [--backend software|gles2] [--video fb|sdl] [--hidden-window] [--system-dir PATH] [--save-dir PATH] [--rom-folder FOLDER] [--input-timeline FILE] [--paced-timeline] [--auto-timeline] [--input-debug] [--no-audio] [--max-frames N] [--gles2-timing-report] [--timing-warmup N] [--crt-postprocessing on|off] [--crt-noise on|off]\n",
			argv0, argv0);
	exit(2);
}

static const char* required_arg(int argc, char** argv, int* index) {
	if (*index + 1 >= argc) {
		usage(argv[0]);
	}
	return argv[++(*index)];
}

static uint64_t parse_positive_u64_arg(const char* text, const char* option_name) {
	if (!text || !text[0]) {
		host_fatal("%s expects a positive integer", option_name);
	}
	errno = 0;
	char* end = NULL;
	unsigned long long value = strtoull(text, &end, 10);
	if (errno != 0 || end == text || *end != '\0' || value == 0ull) {
		host_fatal("%s expects a positive integer, got '%s'", option_name, text);
	}
	return (uint64_t)value;
}

int main(int argc, char** argv) {
	install_crash_handlers();
	const char* core_path = "./libretro_bmsx.so";
	const char* game_path = NULL;
	bool no_game = false;
	const char* system_dir = "";
	const char* save_dir = "";
	const char* rom_folder = "";
	const char* input_timeline = "";
	bool use_input_timeline = false;
	bool paced_timeline = false;
	bool auto_timeline = false;
	bool audio_disabled = false;
	bool hidden_window = false;
	BmsxVideoContextKind video_context_kind = BMSX_VIDEO_CONTEXT_FBDEV;
	const char* backend = "software";
	const char* video_backend = "fb";

	for (int i = 1; i < argc; ++i) {
		if (strcmp(argv[i], "--core") == 0) {
			core_path = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--no-game") == 0) {
			no_game = true;
			continue;
		}
		if (strcmp(argv[i], "--system-dir") == 0) {
			system_dir = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--save-dir") == 0) {
			save_dir = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--backend") == 0) {
			backend = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--video") == 0) {
			video_backend = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--input-debug") == 0) {
			g_input_debug = true;
			continue;
		}
		if (strcmp(argv[i], "--no-audio") == 0) {
			audio_disabled = true;
			continue;
		}
		if (strcmp(argv[i], "--hidden-window") == 0) {
			hidden_window = true;
			continue;
		}
		if (strcmp(argv[i], "--max-frames") == 0) {
			g_max_run_frames = parse_positive_u64_arg(required_arg(argc, argv, &i), "--max-frames");
			continue;
		}
		if (strcmp(argv[i], "--gles2-timing-report") == 0) {
			g_frame_timing.enabled = true;
			continue;
		}
		if (strcmp(argv[i], "--timing-warmup") == 0) {
			g_frame_timing.warmup_frames = parse_positive_u64_arg(required_arg(argc, argv, &i), "--timing-warmup");
			continue;
		}
		if (strcmp(argv[i], "--crt-postprocessing") == 0) {
			const char* value = required_arg(argc, argv, &i);
			if (strcmp(value, "on") != 0 && strcmp(value, "off") != 0) {
				host_fatal("Invalid --crt-postprocessing %s (expected on|off)", value);
			}
			bmsx_core_options_override(&g_core_options, "bmsx_crt_postprocessing", value);
			continue;
		}
		if (strcmp(argv[i], "--crt-noise") == 0) {
			const char* value = required_arg(argc, argv, &i);
			if (strcmp(value, "on") != 0 && strcmp(value, "off") != 0) {
				host_fatal("Invalid --crt-noise %s (expected on|off)", value);
			}
			bmsx_core_options_override(&g_core_options, "bmsx_crt_noise", value);
			continue;
		}
		if (strcmp(argv[i], "--rom-folder") == 0) {
			rom_folder = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--input-timeline") == 0) {
			use_input_timeline = true;
			input_timeline = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--paced-timeline") == 0) {
			paced_timeline = true;
			continue;
		}
		if (strcmp(argv[i], "--auto-timeline") == 0) {
			auto_timeline = true;
			continue;
		}
		if (argv[i][0] == '-') {
			usage(argv[0]);
		}
		game_path = argv[i];
	}

	if (!no_game && !game_path) {
		usage(argv[0]);
	}
	if (strcmp(backend, "software") != 0 && strcmp(backend, "gles2") != 0) {
		host_fatal("Invalid --backend %s (expected software|gles2)", backend);
	}
	if (g_frame_timing.enabled && strcmp(backend, "gles2") != 0) {
		host_fatal("--gles2-timing-report requires --backend gles2");
	}
	if (strcmp(video_backend, "fb") != 0 && strcmp(video_backend, "sdl") != 0) {
		host_fatal("Invalid --video %s (expected fb|sdl)", video_backend);
	}
	const bool use_sdl_backend = strcmp(video_backend, "sdl") == 0;
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (use_sdl_backend) {
		g_use_sdl = true;
		video_context_kind = strcmp(backend, "gles2") == 0
			? BMSX_VIDEO_CONTEXT_SDL_GLES2
			: BMSX_VIDEO_CONTEXT_SDL_SOFTWARE;
		g_sdl_focused = !hidden_window;
	}
#else
	if (use_sdl_backend) {
		host_fatal("SDL video backend not available in this build");
	}
#endif

	snprintf(g_system_dir, sizeof(g_system_dir), "%s", system_dir);
	snprintf(g_save_dir, sizeof(g_save_dir), "%s", save_dir);
	bmsx_core_options_override(&g_core_options, "bmsx_render_backend", backend);

	signal(SIGINT, on_signal);
	signal(SIGTERM, on_signal);

	LibretroCore core;
	load_core(&core, core_path);
	g_core = &core;

	core.retro_set_environment(environ_cb);
	core.retro_set_video_refresh(video_presenter_refresh);
	core.retro_set_audio_sample(audio_output_sample);
	core.retro_set_audio_sample_batch(audio_output_sample_batch);
	core.retro_set_input_poll(input_poll_cb);
	core.retro_set_input_state(input_state_cb);

	g_video_surface = bmsx_video_context_open(video_context_kind, hidden_window);
	video_presenter_open(g_video_surface, &g_frame_timing);
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		if (SDL_InitSubSystem(SDL_INIT_GAMECONTROLLER) != 0) {
			host_fatal("SDL game-controller initialization failed: %s", SDL_GetError());
		}
		SDL_ShowCursor(SDL_DISABLE);
		sdl_open_first_controller();
	} else
#endif
	{
		input_open_default_devices();
	}

	core.retro_init();
	struct retro_system_av_info av;
	memset(&av, 0, sizeof(av));
	core.retro_get_system_av_info(&av);
	video_presenter_update_av_info(&av);
	set_host_timing(&av.timing);
	video_presenter_activate_core_context();

	struct retro_system_info sysinfo;
	memset(&sysinfo, 0, sizeof(sysinfo));
	core.retro_get_system_info(&sysinfo);
	fprintf(stderr, "[libretro-host] core=%s v%s api=%u\n",
			sysinfo.library_name ? sysinfo.library_name : "(unknown)",
			sysinfo.library_version ? sysinfo.library_version : "(unknown)",
			core.retro_api_version());
	fprintf(stderr, "[libretro-host] need_fullpath=%s\n",
			sysinfo.need_fullpath ? "true" : "false");

	core.retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);

	void* game_buf = NULL;
	size_t game_size = 0;
	struct retro_game_info game_info;
	memset(&game_info, 0, sizeof(game_info));
	bool loaded_ok = false;
	if (no_game) {
		loaded_ok = core.retro_load_game(NULL);
	} else {
		game_info.path = game_path;
		if (!sysinfo.need_fullpath) {
			game_buf = read_file(game_path, &game_size);
			game_info.data = game_buf;
			game_info.size = game_size;
		}
		game_info.meta = NULL;
		loaded_ok = core.retro_load_game(&game_info);
	}
	if (!loaded_ok) {
		host_fatal("retro_load_game failed");
	}
	video_presenter_reset_presentation_timeline();

	memset(&av, 0, sizeof(av));
	core.retro_get_system_av_info(&av);
	video_presenter_update_av_info(&av);
	set_host_timing(&av.timing);
	video_presenter_activate_core_context();
	fprintf(stderr, "[libretro-host] av: base=%ux%u max=%ux%u fps=%.2f sr=%.2f\n",
			av.geometry.base_width, av.geometry.base_height,
			av.geometry.max_width, av.geometry.max_height,
			av.timing.fps, av.timing.sample_rate);

	const int audio_rate = (int)(av.timing.sample_rate + 0.5);
	if (audio_rate <= 0) {
		host_fatal("Invalid audio sample rate: %.2f", av.timing.sample_rate);
	}
	if (audio_disabled) {
		fprintf(stderr, "[libretro-host] audio: disabled\n");
	} else {
		audio_output_open(audio_rate, use_sdl_backend, g_frame_timing.enabled);
	}
	/*
	 * Configure input timelines only when explicitly requested:
	 *  - --input-timeline FILE  (use_input_timeline)
	 *  - --auto-timeline        (auto_timeline)
	 * Previously the code auto-configured timelines whenever a rom_folder or game was present;
	 * make that behavior opt-in via --auto-timeline.
	 */
	if (use_input_timeline || auto_timeline) {
		input_timeline_configure(use_input_timeline ? input_timeline : NULL,
				(rom_folder && rom_folder[0]) ? rom_folder : NULL,
				(game_path && game_path[0]) ? game_path : NULL,
				g_frame_usec);
	}
	const bool unpaced_timeline = input_timeline_is_active() && !paced_timeline;
	const bool audio_master = !audio_disabled && !unpaced_timeline;
	BmsxFramePacer frame_pacer;
	bmsx_frame_pacer_init(&frame_pacer, monotonic_ns(), g_frame_ns);

	while (!g_should_quit) {
		uint64_t now_ns = monotonic_ns();
		if (!unpaced_timeline && !audio_master && now_ns < frame_pacer.next_deadline_ns) {
			struct timespec ts;
			ts.tv_sec = (time_t)(frame_pacer.next_deadline_ns / BMSX_HOST_NSEC_PER_SECOND);
			ts.tv_nsec = (long)(frame_pacer.next_deadline_ns % BMSX_HOST_NSEC_PER_SECOND);
			while (clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &ts, NULL) == EINTR) {
			}
		}
		now_ns = monotonic_ns();
		const BmsxFramePacerDecision pacing = bmsx_frame_pacer_begin(&frame_pacer, now_ns);
		/* Missed deadlines are caught up by subsequent host-loop iterations.
		 * Drop their presentation and advance exactly one machine frame per call. */
		const bool drop_video =
				!unpaced_timeline && !audio_master && pacing.drop_presentation;
		g_frame_timing.record_frame = g_frame_timing.enabled && g_run_frame_count >= g_frame_timing.warmup_frames;
		if (g_has_frame_time_cb) {
			const retro_usec_t frame_time_usec = !unpaced_timeline && pacing.has_elapsed
				? (retro_usec_t)(pacing.elapsed_ns / 1000u)
				: g_frame_time_cb.reference;
			g_frame_time_cb.callback(frame_time_usec);
		}
		input_timeline_dispatch_before_run(video_presenter_presentation_count());
		video_presenter_begin_frame(drop_video);
		const uint64_t run_start_ns = g_frame_timing.record_frame ? monotonic_ns() : 0u;
		core.retro_run();
		const bool presented_frame = video_presenter_end_frame();
		if (g_frame_timing.record_frame) {
			const uint64_t run_ns = monotonic_ns() - run_start_ns;
			bmsx_frame_timing_record(&g_frame_timing.report,
					run_ns,
					g_frame_timing.current_blit_ns,
					g_frame_timing.current_blit_ran,
					g_frame_timing.current_swap_ns,
					g_frame_timing.current_swap_ran,
					drop_video && g_frame_timing.current_video_frame_received,
					!drop_video && presented_frame);
		}
		++g_run_frame_count;
		const uint64_t presentation_count =
				video_presenter_presentation_count();
		if (g_max_run_frames == 0 && presentation_count > 1u &&
				input_timeline_should_auto_quit(
					presentation_count - 2u,
					kInputTimelineAutoQuitGraceFrames)) {
			fprintf(stderr, "[libretro-host] input timeline completed, exiting\n");
			g_should_quit = 1;
		}
		if (g_max_run_frames > 0 && g_run_frame_count >= g_max_run_frames) {
			fprintf(stderr, "[libretro-host] max frames reached (%llu), exiting\n",
					(unsigned long long)g_run_frame_count);
			g_should_quit = 1;
		}
		now_ns = monotonic_ns();
		bmsx_frame_pacer_complete(&frame_pacer, now_ns, !unpaced_timeline && !audio_master, g_frame_ns);
	}
	if (g_frame_timing.enabled) {
		bmsx_frame_timing_print(&g_frame_timing.report, g_frame_timing.warmup_frames);
	}

	video_presenter_destroy_core_context();
	input_timeline_shutdown();
	keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_SDL);
	for (unsigned source = 0; source < KEYBOARD_INPUT_EVDEV_SOURCE_COUNT; source += 1u) {
		keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_EVDEV_FIRST + source);
	}
	core.retro_unload_game();
	core.retro_deinit();
	video_presenter_close();
	if (!audio_disabled) {
		audio_output_close();
	}
	for (size_t i = 0; i < g_input_dev_count; ++i) {
		if (g_input_devs[i].fd >= 0) {
			close(g_input_devs[i].fd);
		}
	}
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		if (g_sdl_gamepad) {
			SDL_GameControllerClose(g_sdl_gamepad);
			g_sdl_gamepad = NULL;
			g_sdl_gamepad_id = -1;
		}
		SDL_QuitSubSystem(SDL_INIT_GAMECONTROLLER);
	}
#endif
	bmsx_video_context_close();
	g_video_surface = NULL;
	if (game_buf) {
		free(game_buf);
	}
	if (core.handle) {
		dlclose(core.handle);
	}
	bmsx_core_options_destroy(&g_core_options);
	return 0;
}
