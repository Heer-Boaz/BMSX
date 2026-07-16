/*
 * libretro.h - Libretro API header
 *
 * This is a minimal version of the libretro API header.
 * For the full version, see: https://github.com/libretro/libretro-common
 *
 * Copyright (C) 2010-2020 The RetroArch team
 * SPDX-License-Identifier: MIT
 */

#ifndef LIBRETRO_H__
#define LIBRETRO_H__

#include <stdint.h>
#include <stddef.h>
#include <limits.h>
#include <stdbool.h>

#ifndef RETRO_CALLCONV
#  if defined(__GNUC__) && defined(__i386__) && !defined(__x86_64__)
#    define RETRO_CALLCONV __attribute__((cdecl))
#  elif defined(_MSC_VER) && defined(_M_X86) && !defined(_M_X64)
#    define RETRO_CALLCONV __cdecl
#  else
#    define RETRO_CALLCONV
#  endif
#endif

#ifndef RETRO_API
#  if defined(_WIN32) || defined(__CYGWIN__) || defined(__MINGW32__)
#    ifdef RETRO_IMPORT_SYMBOLS
#      ifdef __GNUC__
#        define RETRO_API RETRO_CALLCONV __attribute__((__dllimport__))
#      else
#        define RETRO_API RETRO_CALLCONV __declspec(dllimport)
#      endif
#    else
#      ifdef __GNUC__
#        define RETRO_API RETRO_CALLCONV __attribute__((__dllexport__))
#      else
#        define RETRO_API RETRO_CALLCONV __declspec(dllexport)
#      endif
#    endif
#  else
#    if defined(__GNUC__) && __GNUC__ >= 4
#      define RETRO_API RETRO_CALLCONV __attribute__((__visibility__("default")))
#    else
#      define RETRO_API RETRO_CALLCONV
#    endif
#  endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define RETRO_API_VERSION 1

/* Used for checking API/ABI mismatches */
#define RETRO_ENVIRONMENT_SET_ROTATION 1
#define RETRO_ENVIRONMENT_GET_OVERSCAN 2 /* Obsolete */
#define RETRO_ENVIRONMENT_GET_CAN_DUPE 3
#define RETRO_ENVIRONMENT_SET_MESSAGE 6
#define RETRO_ENVIRONMENT_SHUTDOWN 7
#define RETRO_ENVIRONMENT_SET_PERFORMANCE_LEVEL 8
#define RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY 9
#define RETRO_ENVIRONMENT_SET_PIXEL_FORMAT 10
#define RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS 11
#define RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK 12
#define RETRO_ENVIRONMENT_SET_DISK_CONTROL_INTERFACE 13
#define RETRO_ENVIRONMENT_SET_HW_RENDER 14
#define RETRO_ENVIRONMENT_GET_VARIABLE 15
#define RETRO_ENVIRONMENT_SET_VARIABLES 16
#define RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE 17
#define RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME 18
#define RETRO_ENVIRONMENT_GET_LIBRETRO_PATH 19
#define RETRO_ENVIRONMENT_SET_AUDIO_CALLBACK 22
#define RETRO_ENVIRONMENT_SET_FRAME_TIME_CALLBACK 21
#define RETRO_ENVIRONMENT_GET_RUMBLE_INTERFACE 23
#define RETRO_ENVIRONMENT_GET_INPUT_DEVICE_CAPABILITIES 24
#define RETRO_ENVIRONMENT_GET_LOG_INTERFACE 27
#define RETRO_ENVIRONMENT_GET_PERF_INTERFACE 28
#define RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIRECTORY 30
#define RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY 31
#define RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO 32
#define RETRO_ENVIRONMENT_SET_PROC_ADDRESS_CALLBACK 33
#define RETRO_ENVIRONMENT_SET_SUBSYSTEM_INFO 34
#define RETRO_ENVIRONMENT_SET_CONTROLLER_INFO 35
#define RETRO_ENVIRONMENT_SET_MEMORY_MAPS 36
#define RETRO_ENVIRONMENT_SET_GEOMETRY 37
#define RETRO_ENVIRONMENT_GET_USERNAME 38
#define RETRO_ENVIRONMENT_GET_LANGUAGE 39
#define RETRO_ENVIRONMENT_GET_CURRENT_SOFTWARE_FRAMEBUFFER 40
#define RETRO_ENVIRONMENT_SET_SERIALIZATION_QUIRKS 87
#define RETRO_ENVIRONMENT_GET_VFS_INTERFACE 45
#define RETRO_ENVIRONMENT_GET_AUDIO_VIDEO_ENABLE 47
#define RETRO_ENVIRONMENT_GET_FASTFORWARDING 51
#define RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION 52
#define RETRO_ENVIRONMENT_SET_CORE_OPTIONS 53
#define RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL 54
#define RETRO_ENVIRONMENT_SET_CORE_OPTIONS_DISPLAY 55
#define RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2 67
#define RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL 68
#define RETRO_ENVIRONMENT_SET_VARIABLE 70

#define RETRO_NUM_CORE_OPTION_VALUES_MAX 128

#define RETRO_SERIALIZATION_QUIRK_INCOMPLETE (1ULL << 0)
#define RETRO_SERIALIZATION_QUIRK_MUST_INITIALIZE (1ULL << 1)
#define RETRO_SERIALIZATION_QUIRK_CORE_VARIABLE_SIZE (1ULL << 2)
#define RETRO_SERIALIZATION_QUIRK_FRONT_VARIABLE_SIZE (1ULL << 3)
#define RETRO_SERIALIZATION_QUIRK_SINGLE_SESSION (1ULL << 4)
#define RETRO_SERIALIZATION_QUIRK_ENDIAN_DEPENDENT (1ULL << 5)
#define RETRO_SERIALIZATION_QUIRK_PLATFORM_DEPENDENT (1ULL << 6)

/* Pixel formats */
enum retro_pixel_format {
	RETRO_PIXEL_FORMAT_0RGB1555 = 0,
	RETRO_PIXEL_FORMAT_XRGB8888 = 1,
	RETRO_PIXEL_FORMAT_RGB565   = 2,
	RETRO_PIXEL_FORMAT_UNKNOWN  = INT_MAX
};

/* Input device IDs */
#define RETRO_DEVICE_NONE         0
#define RETRO_DEVICE_JOYPAD       1
#define RETRO_DEVICE_MOUSE        2
#define RETRO_DEVICE_KEYBOARD     3
#define RETRO_DEVICE_LIGHTGUN     4
#define RETRO_DEVICE_ANALOG       5
#define RETRO_DEVICE_POINTER      6

/* Joypad buttons */
#define RETRO_DEVICE_ID_JOYPAD_B        0
#define RETRO_DEVICE_ID_JOYPAD_Y        1
#define RETRO_DEVICE_ID_JOYPAD_SELECT   2
#define RETRO_DEVICE_ID_JOYPAD_START    3
#define RETRO_DEVICE_ID_JOYPAD_UP       4
#define RETRO_DEVICE_ID_JOYPAD_DOWN     5
#define RETRO_DEVICE_ID_JOYPAD_LEFT     6
#define RETRO_DEVICE_ID_JOYPAD_RIGHT    7
#define RETRO_DEVICE_ID_JOYPAD_A        8
#define RETRO_DEVICE_ID_JOYPAD_X        9
#define RETRO_DEVICE_ID_JOYPAD_L       10
#define RETRO_DEVICE_ID_JOYPAD_R       11
#define RETRO_DEVICE_ID_JOYPAD_L2      12
#define RETRO_DEVICE_ID_JOYPAD_R2      13
#define RETRO_DEVICE_ID_JOYPAD_L3      14
#define RETRO_DEVICE_ID_JOYPAD_R3      15
#define RETRO_DEVICE_ID_JOYPAD_MASK    256

/* Analog indices */
#define RETRO_DEVICE_INDEX_ANALOG_LEFT   0
#define RETRO_DEVICE_INDEX_ANALOG_RIGHT  1
#define RETRO_DEVICE_INDEX_ANALOG_BUTTON 2
#define RETRO_DEVICE_ID_ANALOG_X         0
#define RETRO_DEVICE_ID_ANALOG_Y         1

/* Memory types */
#define RETRO_MEMORY_MASK        0xff
#define RETRO_MEMORY_SAVE_RAM    0
#define RETRO_MEMORY_RTC         1
#define RETRO_MEMORY_SYSTEM_RAM  2
#define RETRO_MEMORY_VIDEO_RAM   3

/* Game type flags */
#define RETRO_GAME_TYPE_MAIN_GAME 0

/* Region flags */
#define RETRO_REGION_NTSC  0
#define RETRO_REGION_PAL   1

/* Keyboard keycodes */
enum retro_key {
	RETROK_UNKNOWN = 0,
	RETROK_FIRST = 0,
	RETROK_BACKSPACE = 8,
	RETROK_TAB = 9,
	RETROK_CLEAR = 12,
	RETROK_RETURN = 13,
	RETROK_PAUSE = 19,
	RETROK_ESCAPE = 27,
	RETROK_SPACE = 32,
	RETROK_EXCLAIM = 33,
	RETROK_QUOTEDBL = 34,
	RETROK_HASH = 35,
	RETROK_DOLLAR = 36,
	RETROK_AMPERSAND = 38,
	RETROK_QUOTE = 39,
	RETROK_LEFTPAREN = 40,
	RETROK_RIGHTPAREN = 41,
	RETROK_ASTERISK = 42,
	RETROK_PLUS = 43,
	RETROK_COMMA = 44,
	RETROK_MINUS = 45,
	RETROK_PERIOD = 46,
	RETROK_SLASH = 47,
	RETROK_0 = 48,
	RETROK_1 = 49,
	RETROK_2 = 50,
	RETROK_3 = 51,
	RETROK_4 = 52,
	RETROK_5 = 53,
	RETROK_6 = 54,
	RETROK_7 = 55,
	RETROK_8 = 56,
	RETROK_9 = 57,
	RETROK_COLON = 58,
	RETROK_SEMICOLON = 59,
	RETROK_LESS = 60,
	RETROK_EQUALS = 61,
	RETROK_GREATER = 62,
	RETROK_QUESTION = 63,
	RETROK_AT = 64,
	RETROK_LEFTBRACKET = 91,
	RETROK_BACKSLASH = 92,
	RETROK_RIGHTBRACKET = 93,
	RETROK_CARET = 94,
	RETROK_UNDERSCORE = 95,
	RETROK_BACKQUOTE = 96,
	RETROK_a = 97,
	RETROK_b = 98,
	RETROK_c = 99,
	RETROK_d = 100,
	RETROK_e = 101,
	RETROK_f = 102,
	RETROK_g = 103,
	RETROK_h = 104,
	RETROK_i = 105,
	RETROK_j = 106,
	RETROK_k = 107,
	RETROK_l = 108,
	RETROK_m = 109,
	RETROK_n = 110,
	RETROK_o = 111,
	RETROK_p = 112,
	RETROK_q = 113,
	RETROK_r = 114,
	RETROK_s = 115,
	RETROK_t = 116,
	RETROK_u = 117,
	RETROK_v = 118,
	RETROK_w = 119,
	RETROK_x = 120,
	RETROK_y = 121,
	RETROK_z = 122,
	RETROK_LEFTBRACE = 123,
	RETROK_BAR = 124,
	RETROK_RIGHTBRACE = 125,
	RETROK_TILDE = 126,
	RETROK_DELETE = 127,

	RETROK_KP0 = 256,
	RETROK_KP1 = 257,
	RETROK_KP2 = 258,
	RETROK_KP3 = 259,
	RETROK_KP4 = 260,
	RETROK_KP5 = 261,
	RETROK_KP6 = 262,
	RETROK_KP7 = 263,
	RETROK_KP8 = 264,
	RETROK_KP9 = 265,
	RETROK_KP_PERIOD = 266,
	RETROK_KP_DIVIDE = 267,
	RETROK_KP_MULTIPLY = 268,
	RETROK_KP_MINUS = 269,
	RETROK_KP_PLUS = 270,
	RETROK_KP_ENTER = 271,
	RETROK_KP_EQUALS = 272,

	RETROK_UP = 273,
	RETROK_DOWN = 274,
	RETROK_RIGHT = 275,
	RETROK_LEFT = 276,
	RETROK_INSERT = 277,
	RETROK_HOME = 278,
	RETROK_END = 279,
	RETROK_PAGEUP = 280,
	RETROK_PAGEDOWN = 281,

	RETROK_F1 = 282,
	RETROK_F2 = 283,
	RETROK_F3 = 284,
	RETROK_F4 = 285,
	RETROK_F5 = 286,
	RETROK_F6 = 287,
	RETROK_F7 = 288,
	RETROK_F8 = 289,
	RETROK_F9 = 290,
	RETROK_F10 = 291,
	RETROK_F11 = 292,
	RETROK_F12 = 293,
	RETROK_F13 = 294,
	RETROK_F14 = 295,
	RETROK_F15 = 296,

	RETROK_NUMLOCK = 300,
	RETROK_CAPSLOCK = 301,
	RETROK_SCROLLOCK = 302,
	RETROK_RSHIFT = 303,
	RETROK_LSHIFT = 304,
	RETROK_RCTRL = 305,
	RETROK_LCTRL = 306,
	RETROK_RALT = 307,
	RETROK_LALT = 308,
	RETROK_RMETA = 309,
	RETROK_LMETA = 310,
	RETROK_LSUPER = 311,
	RETROK_RSUPER = 312,
	RETROK_MODE = 313,
	RETROK_COMPOSE = 314,

	RETROK_HELP = 315,
	RETROK_PRINT = 316,
	RETROK_SYSREQ = 317,
	RETROK_BREAK = 318,
	RETROK_MENU = 319,
	RETROK_POWER = 320,
	RETROK_EURO = 321,
	RETROK_UNDO = 322,
	RETROK_OEM_102 = 323,

	RETROK_BROWSER_BACK = 324,
	RETROK_BROWSER_FORWARD = 325,
	RETROK_BROWSER_REFRESH = 326,
	RETROK_BROWSER_STOP = 327,
	RETROK_BROWSER_SEARCH = 328,
	RETROK_BROWSER_FAVORITES = 329,
	RETROK_BROWSER_HOME = 330,
	RETROK_VOLUME_MUTE = 331,
	RETROK_VOLUME_DOWN = 332,
	RETROK_VOLUME_UP = 333,
	RETROK_MEDIA_NEXT = 334,
	RETROK_MEDIA_PREV = 335,
	RETROK_MEDIA_STOP = 336,
	RETROK_MEDIA_PLAY_PAUSE = 337,
	RETROK_LAUNCH_MAIL = 338,
	RETROK_LAUNCH_MEDIA = 339,
	RETROK_LAUNCH_APP1 = 340,
	RETROK_LAUNCH_APP2 = 341,

	RETROK_LAST,
	RETROK_DUMMY = INT_MAX
};

enum retro_mod {
	RETROKMOD_NONE = 0x0000,
	RETROKMOD_SHIFT = 0x01,
	RETROKMOD_CTRL = 0x02,
	RETROKMOD_ALT = 0x04,
	RETROKMOD_META = 0x08,
	RETROKMOD_NUMLOCK = 0x10,
	RETROKMOD_CAPSLOCK = 0x20,
	RETROKMOD_SCROLLOCK = 0x40,
	RETROKMOD_DUMMY = INT_MAX
};

struct retro_message {
	const char *msg;
	unsigned frames;
};

struct retro_system_info {
	const char *library_name;
	const char *library_version;
	const char *valid_extensions;
	bool need_fullpath;
	bool block_extract;
};

struct retro_game_geometry {
	unsigned base_width;
	unsigned base_height;
	unsigned max_width;
	unsigned max_height;
	float aspect_ratio;
};

struct retro_system_timing {
	double fps;
	double sample_rate;
};

struct retro_system_av_info {
	struct retro_game_geometry geometry;
	struct retro_system_timing timing;
};

struct retro_variable {
	const char *key;
	const char *value;
};

struct retro_core_option_value {
	const char *value;
	const char *label;
};

struct retro_core_option_definition {
	const char *key;
	const char *desc;
	const char *info;
	struct retro_core_option_value values[RETRO_NUM_CORE_OPTION_VALUES_MAX];
	const char *default_value;
};

struct retro_core_options_intl {
	struct retro_core_option_definition *us;
	struct retro_core_option_definition *local;
};

struct retro_core_option_v2_category {
	const char *key;
	const char *desc;
	const char *info;
};

struct retro_core_option_v2_definition {
	const char *key;
	const char *desc;
	const char *desc_categorized;
	const char *info;
	const char *info_categorized;
	const char *category_key;
	struct retro_core_option_value values[RETRO_NUM_CORE_OPTION_VALUES_MAX];
	const char *default_value;
};

struct retro_core_options_v2 {
	struct retro_core_option_v2_category *categories;
	struct retro_core_option_v2_definition *definitions;
};

struct retro_core_options_v2_intl {
	struct retro_core_options_v2 *us;
	struct retro_core_options_v2 *local;
};

struct retro_game_info {
	const char *path;
	const void *data;
	size_t size;
	const char *meta;
};

struct retro_input_descriptor {
	unsigned port;
	unsigned device;
	unsigned index;
	unsigned id;
	const char *description;
};

enum retro_log_level {
	RETRO_LOG_DEBUG = 0,
	RETRO_LOG_INFO,
	RETRO_LOG_WARN,
	RETRO_LOG_ERROR,
	RETRO_LOG_DUMMY = INT_MAX
};

struct retro_log_callback {
	void (*log)(enum retro_log_level level, const char *fmt, ...);
};

enum retro_rumble_effect {
	RETRO_RUMBLE_STRONG = 0,
	RETRO_RUMBLE_WEAK = 1,
	RETRO_RUMBLE_DUMMY = INT_MAX
};

struct retro_rumble_interface {
	bool (*set_rumble_state)(unsigned port, enum retro_rumble_effect effect, uint16_t strength);
};

typedef int64_t retro_usec_t;
typedef void (*retro_frame_time_callback_t)(retro_usec_t usec);

struct retro_frame_time_callback {
	retro_frame_time_callback_t callback;
	unsigned reference;
};

/* Pass this to retro_video_refresh_t if rendering to hardware. */
#define RETRO_HW_FRAME_BUFFER_VALID ((void*)-1)

typedef void (RETRO_CALLCONV *retro_proc_address_t)(void);
typedef retro_proc_address_t (RETRO_CALLCONV *retro_hw_get_proc_address_t)(const char *sym);
typedef uintptr_t (RETRO_CALLCONV *retro_hw_get_current_framebuffer_t)(void);
typedef void (RETRO_CALLCONV *retro_hw_context_reset_t)(void);

enum retro_hw_context_type {
	RETRO_HW_CONTEXT_NONE             = 0,
	RETRO_HW_CONTEXT_OPENGL           = 1,
	RETRO_HW_CONTEXT_OPENGLES2        = 2,
	RETRO_HW_CONTEXT_OPENGL_CORE      = 3,
	RETRO_HW_CONTEXT_OPENGLES3        = 4,
	RETRO_HW_CONTEXT_OPENGLES_VERSION = 5,
	RETRO_HW_CONTEXT_VULKAN           = 6,
	RETRO_HW_CONTEXT_D3D11            = 7,
	RETRO_HW_CONTEXT_D3D10            = 8,
	RETRO_HW_CONTEXT_D3D12            = 9,
	RETRO_HW_CONTEXT_D3D9             = 10,
	RETRO_HW_CONTEXT_DUMMY = INT_MAX
};

struct retro_hw_render_callback {
	enum retro_hw_context_type context_type;
	retro_hw_context_reset_t context_reset;
	retro_hw_get_current_framebuffer_t get_current_framebuffer;
	retro_hw_get_proc_address_t get_proc_address;
	bool depth;
	bool stencil;
	bool bottom_left_origin;
	unsigned version_major;
	unsigned version_minor;
	bool cache_context;
	retro_hw_context_reset_t context_destroy;
	bool debug_context;
};

/* Callbacks */
typedef bool (*retro_environment_t)(unsigned cmd, void *data);
typedef void (*retro_video_refresh_t)(const void *data, unsigned width, unsigned height, size_t pitch);
typedef void (*retro_audio_sample_t)(int16_t left, int16_t right);
typedef size_t (*retro_audio_sample_batch_t)(const int16_t *data, size_t frames);
typedef void (*retro_input_poll_t)(void);
typedef int16_t (*retro_input_state_t)(unsigned port, unsigned device, unsigned index, unsigned id);
typedef void (RETRO_CALLCONV *retro_keyboard_event_t)(bool down, unsigned keycode, uint32_t character, uint16_t key_modifiers);

struct retro_keyboard_callback {
	retro_keyboard_event_t callback;
};

/* API functions */
RETRO_API void retro_set_environment(retro_environment_t);
RETRO_API void retro_set_video_refresh(retro_video_refresh_t);
RETRO_API void retro_set_audio_sample(retro_audio_sample_t);
RETRO_API void retro_set_audio_sample_batch(retro_audio_sample_batch_t);
RETRO_API void retro_set_input_poll(retro_input_poll_t);
RETRO_API void retro_set_input_state(retro_input_state_t);

RETRO_API void retro_init(void);
RETRO_API void retro_deinit(void);

RETRO_API unsigned retro_api_version(void);

RETRO_API void retro_get_system_info(struct retro_system_info *info);
RETRO_API void retro_get_system_av_info(struct retro_system_av_info *info);

RETRO_API void retro_set_controller_port_device(unsigned port, unsigned device);

RETRO_API void retro_reset(void);
RETRO_API void retro_run(void);

RETRO_API size_t retro_serialize_size(void);
RETRO_API bool retro_serialize(void *data, size_t size);
RETRO_API bool retro_unserialize(const void *data, size_t size);

RETRO_API void retro_cheat_reset(void);
RETRO_API void retro_cheat_set(unsigned index, bool enabled, const char *code);

RETRO_API bool retro_load_game(const struct retro_game_info *game);
RETRO_API bool retro_load_game_special(unsigned game_type, const struct retro_game_info *info, size_t num_info);
RETRO_API void retro_unload_game(void);

RETRO_API unsigned retro_get_region(void);

RETRO_API void *retro_get_memory_data(unsigned id);
RETRO_API size_t retro_get_memory_size(unsigned id);

#ifdef __cplusplus
}
#endif

#endif /* LIBRETRO_H__ */
