#include "keyboard_input.h"

#include <linux/input.h>
#include <string.h>

#define KEYBOARD_INPUT_MAPPINGS(X) \
	X(KEY_F1, SDL_SCANCODE_F1, "F1", RETROK_F1) \
	X(KEY_F2, SDL_SCANCODE_F2, "F2", RETROK_F2) \
	X(KEY_F3, SDL_SCANCODE_F3, "F3", RETROK_F3) \
	X(KEY_F4, SDL_SCANCODE_F4, "F4", RETROK_F4) \
	X(KEY_F5, SDL_SCANCODE_F5, "F5", RETROK_F5) \
	X(KEY_F6, SDL_SCANCODE_F6, "F6", RETROK_F6) \
	X(KEY_F7, SDL_SCANCODE_F7, "F7", RETROK_F7) \
	X(KEY_F8, SDL_SCANCODE_F8, "F8", RETROK_F8) \
	X(KEY_F9, SDL_SCANCODE_F9, "F9", RETROK_F9) \
	X(KEY_F10, SDL_SCANCODE_F10, "F10", RETROK_F10) \
	X(KEY_F11, SDL_SCANCODE_F11, "F11", RETROK_F11) \
	X(KEY_F12, SDL_SCANCODE_F12, "F12", RETROK_F12) \
	X(KEY_UP, SDL_SCANCODE_UP, "ArrowUp", RETROK_UP) \
	X(KEY_DOWN, SDL_SCANCODE_DOWN, "ArrowDown", RETROK_DOWN) \
	X(KEY_LEFT, SDL_SCANCODE_LEFT, "ArrowLeft", RETROK_LEFT) \
	X(KEY_RIGHT, SDL_SCANCODE_RIGHT, "ArrowRight", RETROK_RIGHT) \
	X(KEY_PAGEUP, SDL_SCANCODE_PAGEUP, "PageUp", RETROK_PAGEUP) \
	X(KEY_PAGEDOWN, SDL_SCANCODE_PAGEDOWN, "PageDown", RETROK_PAGEDOWN) \
	X(KEY_HOME, SDL_SCANCODE_HOME, "Home", RETROK_HOME) \
	X(KEY_END, SDL_SCANCODE_END, "End", RETROK_END) \
	X(KEY_INSERT, SDL_SCANCODE_INSERT, "Insert", RETROK_INSERT) \
	X(KEY_DELETE, SDL_SCANCODE_DELETE, "Delete", RETROK_DELETE) \
	X(KEY_BACKSPACE, SDL_SCANCODE_BACKSPACE, "Backspace", RETROK_BACKSPACE) \
	X(KEY_ENTER, SDL_SCANCODE_RETURN, "Enter", RETROK_RETURN) \
	X(KEY_KPENTER, SDL_SCANCODE_KP_ENTER, "NumpadEnter", RETROK_KP_ENTER) \
	X(KEY_TAB, SDL_SCANCODE_TAB, "Tab", RETROK_TAB) \
	X(KEY_ESC, SDL_SCANCODE_ESCAPE, "Escape", RETROK_ESCAPE) \
	X(KEY_SPACE, SDL_SCANCODE_SPACE, "Space", RETROK_SPACE) \
	X(KEY_LEFTSHIFT, SDL_SCANCODE_LSHIFT, "ShiftLeft", RETROK_LSHIFT) \
	X(KEY_RIGHTSHIFT, SDL_SCANCODE_RSHIFT, "ShiftRight", RETROK_RSHIFT) \
	X(KEY_LEFTCTRL, SDL_SCANCODE_LCTRL, "ControlLeft", RETROK_LCTRL) \
	X(KEY_RIGHTCTRL, SDL_SCANCODE_RCTRL, "ControlRight", RETROK_RCTRL) \
	X(KEY_LEFTALT, SDL_SCANCODE_LALT, "AltLeft", RETROK_LALT) \
	X(KEY_RIGHTALT, SDL_SCANCODE_RALT, "AltRight", RETROK_RALT) \
	X(KEY_LEFTMETA, SDL_SCANCODE_LGUI, "MetaLeft", RETROK_LMETA) \
	X(KEY_RIGHTMETA, SDL_SCANCODE_RGUI, "MetaRight", RETROK_RMETA) \
	X(KEY_A, SDL_SCANCODE_A, "KeyA", RETROK_a) \
	X(KEY_B, SDL_SCANCODE_B, "KeyB", RETROK_b) \
	X(KEY_C, SDL_SCANCODE_C, "KeyC", RETROK_c) \
	X(KEY_D, SDL_SCANCODE_D, "KeyD", RETROK_d) \
	X(KEY_E, SDL_SCANCODE_E, "KeyE", RETROK_e) \
	X(KEY_F, SDL_SCANCODE_F, "KeyF", RETROK_f) \
	X(KEY_G, SDL_SCANCODE_G, "KeyG", RETROK_g) \
	X(KEY_H, SDL_SCANCODE_H, "KeyH", RETROK_h) \
	X(KEY_I, SDL_SCANCODE_I, "KeyI", RETROK_i) \
	X(KEY_J, SDL_SCANCODE_J, "KeyJ", RETROK_j) \
	X(KEY_K, SDL_SCANCODE_K, "KeyK", RETROK_k) \
	X(KEY_L, SDL_SCANCODE_L, "KeyL", RETROK_l) \
	X(KEY_M, SDL_SCANCODE_M, "KeyM", RETROK_m) \
	X(KEY_N, SDL_SCANCODE_N, "KeyN", RETROK_n) \
	X(KEY_O, SDL_SCANCODE_O, "KeyO", RETROK_o) \
	X(KEY_P, SDL_SCANCODE_P, "KeyP", RETROK_p) \
	X(KEY_Q, SDL_SCANCODE_Q, "KeyQ", RETROK_q) \
	X(KEY_R, SDL_SCANCODE_R, "KeyR", RETROK_r) \
	X(KEY_S, SDL_SCANCODE_S, "KeyS", RETROK_s) \
	X(KEY_T, SDL_SCANCODE_T, "KeyT", RETROK_t) \
	X(KEY_U, SDL_SCANCODE_U, "KeyU", RETROK_u) \
	X(KEY_V, SDL_SCANCODE_V, "KeyV", RETROK_v) \
	X(KEY_W, SDL_SCANCODE_W, "KeyW", RETROK_w) \
	X(KEY_X, SDL_SCANCODE_X, "KeyX", RETROK_x) \
	X(KEY_Y, SDL_SCANCODE_Y, "KeyY", RETROK_y) \
	X(KEY_Z, SDL_SCANCODE_Z, "KeyZ", RETROK_z) \
	X(KEY_0, SDL_SCANCODE_0, "Digit0", RETROK_0) \
	X(KEY_1, SDL_SCANCODE_1, "Digit1", RETROK_1) \
	X(KEY_2, SDL_SCANCODE_2, "Digit2", RETROK_2) \
	X(KEY_3, SDL_SCANCODE_3, "Digit3", RETROK_3) \
	X(KEY_4, SDL_SCANCODE_4, "Digit4", RETROK_4) \
	X(KEY_5, SDL_SCANCODE_5, "Digit5", RETROK_5) \
	X(KEY_6, SDL_SCANCODE_6, "Digit6", RETROK_6) \
	X(KEY_7, SDL_SCANCODE_7, "Digit7", RETROK_7) \
	X(KEY_8, SDL_SCANCODE_8, "Digit8", RETROK_8) \
	X(KEY_9, SDL_SCANCODE_9, "Digit9", RETROK_9) \
	X(KEY_MINUS, SDL_SCANCODE_MINUS, "Minus", RETROK_MINUS) \
	X(KEY_EQUAL, SDL_SCANCODE_EQUALS, "Equal", RETROK_EQUALS) \
	X(KEY_LEFTBRACE, SDL_SCANCODE_LEFTBRACKET, "BracketLeft", RETROK_LEFTBRACKET) \
	X(KEY_RIGHTBRACE, SDL_SCANCODE_RIGHTBRACKET, "BracketRight", RETROK_RIGHTBRACKET) \
	X(KEY_BACKSLASH, SDL_SCANCODE_BACKSLASH, "Backslash", RETROK_BACKSLASH) \
	X(KEY_SEMICOLON, SDL_SCANCODE_SEMICOLON, "Semicolon", RETROK_SEMICOLON) \
	X(KEY_APOSTROPHE, SDL_SCANCODE_APOSTROPHE, "Quote", RETROK_QUOTE) \
	X(KEY_COMMA, SDL_SCANCODE_COMMA, "Comma", RETROK_COMMA) \
	X(KEY_DOT, SDL_SCANCODE_PERIOD, "Period", RETROK_PERIOD) \
	X(KEY_SLASH, SDL_SCANCODE_SLASH, "Slash", RETROK_SLASH) \
	X(KEY_GRAVE, SDL_SCANCODE_GRAVE, "Backquote", RETROK_BACKQUOTE)

#define KEYBOARD_INPUT_EVDEV_KEY(evdev, sdl, text, retro) [evdev] = retro,
static const enum retro_key kEvdevKeyMap[KEY_MAX + 1] = {
	KEYBOARD_INPUT_MAPPINGS(KEYBOARD_INPUT_EVDEV_KEY)
};
#undef KEYBOARD_INPUT_EVDEV_KEY

#ifdef BMSX_LIBRETRO_HOST_SDL
#define KEYBOARD_INPUT_SDL_KEY(evdev, sdl, text, retro) [sdl] = retro,
static const enum retro_key kSdlKeyMap[SDL_NUM_SCANCODES] = {
	KEYBOARD_INPUT_MAPPINGS(KEYBOARD_INPUT_SDL_KEY)
};
#undef KEYBOARD_INPUT_SDL_KEY
#endif

typedef struct TimelineKeyMapping {
	const char* code;
	enum retro_key key;
} TimelineKeyMapping;

#define KEYBOARD_INPUT_TIMELINE_KEY(evdev, sdl, text, retro) { text, retro },
static const TimelineKeyMapping kTimelineKeyMap[] = {
	KEYBOARD_INPUT_MAPPINGS(KEYBOARD_INPUT_TIMELINE_KEY)
};
#undef KEYBOARD_INPUT_TIMELINE_KEY
#undef KEYBOARD_INPUT_MAPPINGS

enum {
	KEYBOARD_INPUT_WORD_BITS = 64,
	KEYBOARD_INPUT_WORD_COUNT = (RETROK_LAST + KEYBOARD_INPUT_WORD_BITS - 1) / KEYBOARD_INPUT_WORD_BITS,
};

static struct retro_keyboard_callback g_keyboard_callback;
static uint64_t g_source_pressed[KEYBOARD_INPUT_SOURCE_COUNT][KEYBOARD_INPUT_WORD_COUNT];
static uint8_t g_key_source_count[RETROK_LAST];

void keyboard_input_set_callback(struct retro_keyboard_callback callback) {
	g_keyboard_callback = callback;
	memset(g_source_pressed, 0, sizeof(g_source_pressed));
	memset(g_key_source_count, 0, sizeof(g_key_source_count));
}

void keyboard_input_post(unsigned source, enum retro_key key, bool down) {
	const unsigned word_index = (unsigned)key / KEYBOARD_INPUT_WORD_BITS;
	const uint64_t mask = UINT64_C(1) << ((unsigned)key & (KEYBOARD_INPUT_WORD_BITS - 1));
	uint64_t* source_word = &g_source_pressed[source][word_index];
	const bool source_down = (*source_word & mask) != 0;
	if (source_down == down) {
		return;
	}
	if (down) {
		*source_word |= mask;
		g_key_source_count[key] += 1u;
		if (g_key_source_count[key] == 1u) {
			g_keyboard_callback.callback(true, (unsigned)key, 0, RETROKMOD_NONE);
		}
		return;
	}
	*source_word &= ~mask;
	g_key_source_count[key] -= 1u;
	if (g_key_source_count[key] == 0u) {
		g_keyboard_callback.callback(false, (unsigned)key, 0, RETROKMOD_NONE);
	}
}

void keyboard_input_release_source(unsigned source) {
	for (unsigned key = RETROK_FIRST; key < RETROK_LAST; key += 1u) {
		const unsigned word_index = key / KEYBOARD_INPUT_WORD_BITS;
		const uint64_t mask = UINT64_C(1) << (key & (KEYBOARD_INPUT_WORD_BITS - 1));
		if ((g_source_pressed[source][word_index] & mask) != 0) {
			keyboard_input_post(source, (enum retro_key)key, false);
		}
	}
}

enum retro_key keyboard_input_key_from_evdev(uint16_t code) {
	if (code > KEY_MAX) {
		return RETROK_UNKNOWN;
	}
	return kEvdevKeyMap[code];
}

#ifdef BMSX_LIBRETRO_HOST_SDL
enum retro_key keyboard_input_key_from_sdl(SDL_Scancode scancode) {
	return kSdlKeyMap[scancode];
}
#endif

enum retro_key keyboard_input_key_from_timeline_code(const char* code) {
	for (size_t index = 0; index < sizeof(kTimelineKeyMap) / sizeof(kTimelineKeyMap[0]); index += 1u) {
		if (strcmp(kTimelineKeyMap[index].code, code) == 0) {
			return kTimelineKeyMap[index].key;
		}
	}
	return RETROK_UNKNOWN;
}
