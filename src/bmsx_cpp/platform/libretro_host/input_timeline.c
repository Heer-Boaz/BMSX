#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <sys/stat.h>
#include <unistd.h>

#include "input_timeline.h"
#include "screenshot.h"

enum { kTestInputCodeMax = 64 };
enum { kInputTimelinePathBuffer = 1024 };
enum { kJsonKeyBuffer = 64 };

typedef struct {
	uint64_t frame;
	char code[kTestInputCodeMax];
	bool down;
} TestInputEvent;

typedef struct {
	const char* ptr;
	const char* end;
	const char* source;
} JsonCursor;

typedef struct {
	char code[kTestInputCodeMax];
	bool down;
} TimelineEvent;

typedef struct {
	uint64_t frame;
} TimelineCaptureEvent;

static void timeline_logf(const char* format, ...);

static TestInputEvent* g_test_input_events = NULL;
static size_t g_test_input_event_count = 0;
static size_t g_test_input_event_capacity = 0;
static size_t g_test_input_event_next = 0;
static TimelineCaptureEvent* g_test_capture_events = NULL;
static size_t g_test_capture_event_count = 0;
static size_t g_test_capture_event_capacity = 0;
static size_t g_test_capture_event_next = 0;
static uint64_t g_frame_counter = 0;
static uint64_t g_timeline_last_frame = 0;
static bool g_timeline_active = false;
static void (*g_emit_keyboard_event)(const char* code, bool down) = NULL;

static uint64_t ms_to_frame_index(uint64_t milliseconds, uint64_t frame_usec) {
	if (frame_usec == 0) {
		return 0;
	}
	const long double scaled = (long double)milliseconds * 1000.0L;
	return (uint64_t)llroundl(scaled / (long double)frame_usec);
}

static uint64_t frame_to_ms_rounded(uint64_t frame, uint64_t frame_usec) {
	if (frame == 0) {
		return 0;
	}
	const long double scaled = (long double)frame * (long double)frame_usec;
	return (uint64_t)llroundl(scaled / 1000.0L);
}

static int compare_test_input_events(const void* a, const void* b) {
	const TestInputEvent* lhs = (const TestInputEvent*)a;
	const TestInputEvent* rhs = (const TestInputEvent*)b;
	if (lhs->frame < rhs->frame) {
		return -1;
	}
	if (lhs->frame > rhs->frame) {
		return 1;
	}
	return 0;
}

static int compare_test_capture_events(const void* a, const void* b) {
	const TimelineCaptureEvent* lhs = (const TimelineCaptureEvent*)a;
	const TimelineCaptureEvent* rhs = (const TimelineCaptureEvent*)b;
	if (lhs->frame < rhs->frame) {
		return -1;
	}
	if (lhs->frame > rhs->frame) {
		return 1;
	}
	return 0;
}

static void* read_file_bytes(const char* path, size_t* out_size) {
	int fd = open(path, O_RDONLY);
	if (fd < 0) {
		timeline_logf("Failed to open '%s': %s", path, strerror(errno));
		exit(1);
	}
	struct stat st;
	if (fstat(fd, &st) != 0) {
		timeline_logf("fstat('%s') failed: %s", path, strerror(errno));
		exit(1);
	}
	if (st.st_size <= 0) {
		timeline_logf("Timeline file is empty: '%s'", path);
		exit(1);
	}
	const size_t size = (size_t)st.st_size;
	void* buf = malloc(size);
	if (!buf) {
		timeline_logf("malloc(%zu) failed for '%s'", size, path);
		exit(1);
	}
	size_t off = 0;
	while (off < size) {
		ssize_t n = read(fd, (uint8_t*)buf + off, size - off);
		if (n < 0) {
			timeline_logf("read('%s') failed: %s", path, strerror(errno));
			exit(1);
		}
		if (n == 0) {
			timeline_logf("Unexpected EOF while reading '%s'", path);
			exit(1);
		}
		off += (size_t)n;
	}
	close(fd);
	*out_size = size;
	return buf;
}

static bool file_exists(const char* path) {
	struct stat st;
	return path && stat(path, &st) == 0 && S_ISREG(st.st_mode);
}

static void timeline_logf(const char* format, ...) {
	const char* prefix = "[itl] ";
	va_list args;
	fprintf(stderr, "%s", prefix);
	va_start(args, format);
	vfprintf(stderr, format, args);
	va_end(args);
	fputc('\n', stderr);
}

static void timeline_parse_error(const JsonCursor* cursor, const char* format, va_list args) {
	size_t line = 1;
	size_t column = 1;
	for (const char* p = cursor->source; p < cursor->ptr; ++p) {
		if (*p == '\n') {
			++line;
			column = 1;
		} else {
			++column;
		}
	}
	const char* preview = cursor->ptr;
	while (preview > cursor->source && *(preview - 1) != '\n') {
		--preview;
	}
	fprintf(stderr, "[itl] ");
	vfprintf(stderr, format, args);
	fprintf(stderr, " (%s:%zu:%zu): ...%.*s\n", cursor->source, line, column, (int)(cursor->ptr - preview), preview);
}

static void timeline_parse_errorf(const JsonCursor* cursor, const char* format, ...) {
	va_list args;
	va_start(args, format);
	timeline_parse_error(cursor, format, args);
	va_end(args);
}

static void sort_test_input_events(void) {
	if (g_test_input_event_count > 1) {
		qsort(g_test_input_events, g_test_input_event_count, sizeof(g_test_input_events[0]), compare_test_input_events);
	}
}

static void add_test_input_event(uint64_t frame, const char* code, bool down) {
	if (!code || !code[0]) {
		return;
	}
	if (g_test_input_event_count >= g_test_input_event_capacity) {
		size_t next = g_test_input_event_capacity > 0 ? (g_test_input_event_capacity * 2ull) : 64ull;
		void* next_buf = realloc(g_test_input_events, next * sizeof(TestInputEvent));
		if (!next_buf) {
			timeline_logf("Failed to allocate test input events");
			exit(1);
		}
		g_test_input_events = (TestInputEvent*)next_buf;
		g_test_input_event_capacity = next;
	}
	snprintf(g_test_input_events[g_test_input_event_count].code, sizeof(g_test_input_events[g_test_input_event_count].code), "%s", code);
	g_test_input_events[g_test_input_event_count].frame = frame;
	g_test_input_events[g_test_input_event_count].down = down;
	++g_test_input_event_count;
}

static void add_test_capture_event(uint64_t frame) {
	if (g_test_capture_event_count >= g_test_capture_event_capacity) {
		size_t next = g_test_capture_event_capacity > 0 ? (g_test_capture_event_capacity * 2ull) : 64ull;
		void* next_buf = realloc(g_test_capture_events, next * sizeof(TimelineCaptureEvent));
		if (!next_buf) {
			timeline_logf("Failed to allocate capture events");
			exit(1);
		}
		g_test_capture_events = (TimelineCaptureEvent*)next_buf;
		g_test_capture_event_capacity = next;
	}
	g_test_capture_events[g_test_capture_event_count].frame = frame;
	++g_test_capture_event_count;
}

static void json_cursor_skip_ws(JsonCursor* cursor) {
	while (cursor->ptr < cursor->end && isspace((unsigned char)*cursor->ptr)) {
		++cursor->ptr;
	}
}

static bool json_cursor_consume(JsonCursor* cursor, char c) {
	json_cursor_skip_ws(cursor);
	if (cursor->ptr < cursor->end && *cursor->ptr == c) {
		++cursor->ptr;
		return true;
	}
	return false;
}

static bool json_cursor_ensure(JsonCursor* cursor, char c) {
	if (!json_cursor_consume(cursor, c)) {
		timeline_parse_errorf(cursor, "expected '%c'", c);
		return false;
	}
	return true;
}

static bool json_parse_string(JsonCursor* cursor, char* out, size_t out_size) {
	json_cursor_skip_ws(cursor);
	if (cursor->ptr >= cursor->end || *cursor->ptr != '"') {
		return false;
	}
	++cursor->ptr;
	size_t out_len = 0;
	while (cursor->ptr < cursor->end) {
		const unsigned char c = (unsigned char)*cursor->ptr++;
		if (c == '"') {
			if (out && out_size > 0) {
				out[out_len] = '\0';
			}
			return true;
		}
		unsigned char decoded = c;
		if (c == '\\') {
			if (cursor->ptr >= cursor->end) {
				return false;
			}
			unsigned char esc = (unsigned char)*cursor->ptr++;
			switch (esc) {
				case '"': decoded = '"'; break;
				case '\\': decoded = '\\'; break;
				case '/': decoded = '/'; break;
				case 'b': decoded = '\b'; break;
				case 'f': decoded = '\f'; break;
				case 'n': decoded = '\n'; break;
				case 'r': decoded = '\r'; break;
				case 't': decoded = '\t'; break;
				case 'u': {
					if (cursor->ptr + 4 > cursor->end) {
						return false;
					}
					uint16_t code = 0;
					for (int i = 0; i < 4; ++i) {
						const char h = cursor->ptr[i];
						uint8_t value = 0;
						if (h >= '0' && h <= '9') {
							value = (uint8_t)(h - '0');
						} else if (h >= 'A' && h <= 'F') {
							value = (uint8_t)(10 + (h - 'A'));
						} else if (h >= 'a' && h <= 'f') {
							value = (uint8_t)(10 + (h - 'a'));
						} else {
							return false;
						}
						code = (uint16_t)(code * 16u + value);
						cursor->ptr += 1;
					}
					decoded = code <= 0x7Fu ? (unsigned char)code : '?';
					break;
				}
				default:
					decoded = esc;
					break;
			}
		}
		if (out_size == 0 || out == NULL) {
			continue;
		}
		if (out_len + 1 >= out_size) {
			timeline_parse_errorf(cursor, "string too long");
			return false;
		}
		out[out_len++] = (char)decoded;
	}
	return false;
}

static bool json_skip_string(JsonCursor* cursor) {
	return json_parse_string(cursor, NULL, 0);
}

static bool json_parse_bool(JsonCursor* cursor, bool* out_bool) {
	json_cursor_skip_ws(cursor);
	if (cursor->ptr + 4 <= cursor->end && memcmp(cursor->ptr, "true", 4) == 0) {
		cursor->ptr += 4;
		*out_bool = true;
		return true;
	}
	if (cursor->ptr + 5 <= cursor->end && memcmp(cursor->ptr, "false", 5) == 0) {
		cursor->ptr += 5;
		*out_bool = false;
		return true;
	}
	return false;
}

static bool json_parse_number(JsonCursor* cursor, double* out_number) {
	json_cursor_skip_ws(cursor);
	char* end = NULL;
	double value = strtod(cursor->ptr, &end);
	if (cursor->ptr == end || !end) {
		return false;
	}
	cursor->ptr = end;
	*out_number = value;
	return true;
}

static bool json_skip_value(JsonCursor* cursor);

static bool json_skip_array(JsonCursor* cursor) {
	if (!json_cursor_ensure(cursor, '[')) {
		return false;
	}
	json_cursor_skip_ws(cursor);
	if (json_cursor_consume(cursor, ']')) {
		return true;
	}
	for (;;) {
		if (!json_skip_value(cursor)) {
			return false;
		}
		json_cursor_skip_ws(cursor);
		if (json_cursor_consume(cursor, ',')) {
			continue;
		}
		return json_cursor_consume(cursor, ']');
	}
}

static bool json_skip_object(JsonCursor* cursor) {
	if (!json_cursor_ensure(cursor, '{')) {
		return false;
	}
	json_cursor_skip_ws(cursor);
	if (json_cursor_consume(cursor, '}')) {
		return true;
	}
	for (;;) {
		char key[kJsonKeyBuffer];
		if (!json_parse_string(cursor, key, sizeof(key))) {
			timeline_parse_errorf(cursor, "expected object key");
			return false;
		}
		if (!json_cursor_ensure(cursor, ':')) {
			return false;
		}
		if (!json_skip_value(cursor)) {
			timeline_parse_errorf(cursor, "invalid value for key '%s'", key);
			return false;
		}
		json_cursor_skip_ws(cursor);
		if (json_cursor_consume(cursor, ',')) {
			continue;
		}
		return json_cursor_consume(cursor, '}');
	}
}

static bool json_skip_value(JsonCursor* cursor) {
	json_cursor_skip_ws(cursor);
	if (cursor->ptr >= cursor->end) {
		return false;
	}
	switch (*cursor->ptr) {
		case '{':
			return json_skip_object(cursor);
		case '[':
			return json_skip_array(cursor);
		case '"':
			return json_skip_string(cursor);
		case 't':
			return json_cursor_consume(cursor, 't') &&
				cursor->ptr + 3 <= cursor->end &&
				memcmp(cursor->ptr, "rue", 3) == 0 &&
				((cursor->ptr += 3), true);
		case 'f':
			return json_cursor_consume(cursor, 'f') &&
				cursor->ptr + 4 <= cursor->end &&
				memcmp(cursor->ptr, "alse", 4) == 0 &&
				((cursor->ptr += 4), true);
		case 'n':
			return json_cursor_consume(cursor, 'n') &&
				cursor->ptr + 3 <= cursor->end &&
				memcmp(cursor->ptr, "ull", 3) == 0 &&
				((cursor->ptr += 3), true);
		default:
			if ((*cursor->ptr == '-' && cursor->ptr + 1 < cursor->end && isdigit((unsigned char)cursor->ptr[1])) ||
				isdigit((unsigned char)*cursor->ptr)) {
				double dummy = 0.0;
				return json_parse_number(cursor, &dummy);
			}
			return false;
	}
}

static bool parse_timeline_event(JsonCursor* cursor, TimelineEvent* entry) {
	bool event_is_button = false;
	bool has_type = false;
	bool has_code = false;
	bool has_down = false;
	char code[kJsonKeyBuffer];
	char key[kJsonKeyBuffer];
	bool down = false;

	if (!json_cursor_ensure(cursor, '{')) {
		return false;
	}
	json_cursor_skip_ws(cursor);
	if (json_cursor_consume(cursor, '}')) {
		return false;
	}
	for (;;) {
		if (!json_parse_string(cursor, key, sizeof(key))) {
			return false;
		}
		if (!json_cursor_ensure(cursor, ':')) {
			return false;
		}
		if (strcmp(key, "type") == 0) {
			char type[kJsonKeyBuffer];
			if (!json_parse_string(cursor, type, sizeof(type))) {
				return false;
			}
			has_type = true;
			event_is_button = strcmp(type, "button") == 0;
		} else if (strcmp(key, "code") == 0) {
			if (!json_parse_string(cursor, code, sizeof(code))) {
				return false;
			}
			has_code = true;
		} else if (strcmp(key, "down") == 0) {
			if (!json_parse_bool(cursor, &down)) {
				return false;
			}
			has_down = true;
		} else {
			if (!json_skip_value(cursor)) {
				return false;
			}
		}
		json_cursor_skip_ws(cursor);
		if (json_cursor_consume(cursor, ',')) {
			continue;
		}
		if (!json_cursor_consume(cursor, '}')) {
			return false;
		}
		if (!has_type || !event_is_button || !has_code || !has_down) {
			return false;
		}
		if (event_is_button) {
			snprintf(entry->code, sizeof(entry->code), "%s", code);
			entry->down = down;
		}
		return true;
	}
}

static bool parse_timeline_entry(JsonCursor* cursor, uint64_t frame_usec, uint64_t* out_last_ms, bool* out_has_last_ms, size_t index) {
	uint64_t frame = 0;
	uint64_t ms_value = 0;
	uint64_t delay_ms = 0;
	uint64_t repeat = 0;
	uint64_t repeat_every_frames = 0;
	uint64_t repeat_every_ms = 0;
	bool has_frame = false;
	bool has_ms = false;
	bool has_delay = false;
	bool has_repeat = false;
	bool has_repeat_every_frames = false;
	bool has_repeat_every_ms = false;
	bool has_capture = false;
	TimelineEvent event_entry;
	char key[kJsonKeyBuffer];

	memset(&event_entry, 0, sizeof(event_entry));
	if (!json_cursor_ensure(cursor, '{')) {
		return false;
	}
	json_cursor_skip_ws(cursor);
	if (json_cursor_consume(cursor, '}')) {
		return false;
	}
	for (;;) {
		if (!json_parse_string(cursor, key, sizeof(key))) {
			return false;
		}
		if (!json_cursor_ensure(cursor, ':')) {
			return false;
		}
		if (strcmp(key, "frame") == 0 || strcmp(key, "ms") == 0 || strcmp(key, "timeMs") == 0 ||
				strcmp(key, "delayMs") == 0 || strcmp(key, "repeat") == 0 ||
				strcmp(key, "repeatEveryFrames") == 0 || strcmp(key, "repeatEveryMs") == 0) {
			double number = 0.0;
			if (!json_parse_number(cursor, &number)) {
				timeline_parse_errorf(cursor, "entry %zu: failed to parse numeric field '%s'", index, key);
				return false;
			}
			uint64_t rounded = (uint64_t)llround(number);
			if (strcmp(key, "frame") == 0) {
				has_frame = true;
				frame = rounded;
			} else if (strcmp(key, "ms") == 0 || strcmp(key, "timeMs") == 0) {
				has_ms = true;
				ms_value = rounded;
			} else if (strcmp(key, "delayMs") == 0) {
				has_delay = true;
				delay_ms = rounded;
			} else if (strcmp(key, "repeat") == 0) {
				has_repeat = true;
				repeat = rounded;
			} else if (strcmp(key, "repeatEveryFrames") == 0) {
				has_repeat_every_frames = true;
				repeat_every_frames = rounded;
			} else if (strcmp(key, "repeatEveryMs") == 0) {
				has_repeat_every_ms = true;
				repeat_every_ms = rounded;
			}
		} else if (strcmp(key, "capture") == 0) {
			bool capture = false;
			if (!json_parse_bool(cursor, &capture)) {
				timeline_parse_errorf(cursor, "entry %zu: failed to parse boolean field '%s'", index, key);
				return false;
			}
			has_capture = capture;
		} else if (strcmp(key, "event") == 0) {
			if (!parse_timeline_event(cursor, &event_entry)) {
				timeline_parse_errorf(cursor, "entry %zu has unsupported or malformed event", index);
				event_entry.code[0] = '\0';
			}
		} else {
			if (!json_skip_value(cursor)) {
				return false;
			}
		}
		json_cursor_skip_ws(cursor);
		if (json_cursor_consume(cursor, ',')) {
			continue;
		}
		if (!json_cursor_ensure(cursor, '}')) {
			return false;
		}
		break;
	}

	if (!event_entry.code[0] && !has_capture) {
		return true;
	}

	uint64_t base_ms = 0;
	if (has_ms) {
		base_ms = ms_value;
	} else if (has_frame) {
		base_ms = frame_to_ms_rounded(frame, frame_usec);
	} else if (has_delay && *out_has_last_ms) {
		base_ms = *out_last_ms + delay_ms;
	} else {
		timeline_parse_errorf(cursor, "entry %zu has no valid timing field", index);
		return false;
	}

	uint64_t interval_ms = 0;
	uint64_t repeats = 1;
	if (has_repeat) {
		repeats = repeat + 1;
		if (!has_repeat_every_ms && !has_repeat_every_frames) {
			timeline_parse_errorf(cursor, "entry %zu uses repeat without repeat interval", index);
			return false;
		}
		interval_ms = has_repeat_every_ms ? repeat_every_ms : frame_to_ms_rounded(repeat_every_frames, frame_usec);
	}
	for (uint64_t step = 0; step < repeats; ++step) {
		const uint64_t scheduled_ms = base_ms + (step * interval_ms);
		const uint64_t frame_index = ms_to_frame_index(scheduled_ms, frame_usec);
		if (event_entry.code[0]) {
			add_test_input_event(frame_index, event_entry.code, event_entry.down);
		}
		if (has_capture) {
			add_test_capture_event(frame_index);
		}
	}
	*out_last_ms = base_ms;
	*out_has_last_ms = true;
	return true;
}

static void parse_input_timeline_file(const char* timeline_path, uint64_t frame_usec) {
	size_t timeline_size = 0;
	char* timeline_raw = (char*)read_file_bytes(timeline_path, &timeline_size);
	JsonCursor cursor = { timeline_raw, timeline_raw + timeline_size, timeline_path };
	uint64_t last_timing_ms = 0;
	bool has_last_timing_ms = false;
	size_t entry_index = 0;

	g_test_input_event_count = 0;
	g_test_input_event_next = 0;
	free(g_test_input_events);
	g_test_input_events = NULL;
	g_test_input_event_capacity = 0;
	g_test_capture_event_count = 0;
	g_test_capture_event_next = 0;
	free(g_test_capture_events);
	g_test_capture_events = NULL;
	g_test_capture_event_capacity = 0;
	g_frame_counter = 0;
	g_timeline_last_frame = 0;
	g_timeline_active = false;

	json_cursor_skip_ws(&cursor);
	if (!json_cursor_ensure(&cursor, '[')) {
		timeline_parse_errorf(&cursor, "expected array at top level");
		free(timeline_raw);
		exit(1);
	}
	json_cursor_skip_ws(&cursor);
	if (json_cursor_consume(&cursor, ']')) {
		free(timeline_raw);
		timeline_logf("Timeline '%s' is empty.", timeline_path);
		return;
	}
	for (;;) {
		if (!parse_timeline_entry(&cursor, frame_usec, &last_timing_ms, &has_last_timing_ms, entry_index)) {
			timeline_parse_errorf(&cursor, "failed to parse entry %zu", entry_index);
			free(timeline_raw);
			exit(1);
		}
		++entry_index;
		json_cursor_skip_ws(&cursor);
		if (json_cursor_consume(&cursor, ',')) {
			continue;
		}
		if (!json_cursor_consume(&cursor, ']')) {
			timeline_parse_errorf(&cursor, "expected ']' after timeline entries");
			free(timeline_raw);
			exit(1);
		}
		break;
	}
	if (g_test_input_event_count == 0 && g_test_capture_event_count == 0) {
		timeline_logf("Timeline '%s' contains no input events or captures.", timeline_path);
	}
	sort_test_input_events();
	if (g_test_capture_event_count > 1) {
		qsort(g_test_capture_events, g_test_capture_event_count, sizeof(g_test_capture_events[0]), compare_test_capture_events);
	}
	if (g_test_input_event_count > 0) {
		g_timeline_last_frame = g_test_input_events[g_test_input_event_count - 1].frame;
		g_timeline_active = true;
	}
	if (g_test_capture_event_count > 0) {
		const uint64_t last_capture_frame = g_test_capture_events[g_test_capture_event_count - 1].frame;
		if (!g_timeline_active || last_capture_frame > g_timeline_last_frame) {
			g_timeline_last_frame = last_capture_frame;
		}
		g_timeline_active = true;
	}
	if (g_timeline_active) {
		timeline_logf("Loaded timeline '%s' with %zu input events, %zu captures, last frame %llu.",
				timeline_path,
				g_test_input_event_count,
				g_test_capture_event_count,
				(unsigned long long)g_timeline_last_frame);
	}
	free(timeline_raw);
}

static bool derive_input_timeline_path(const char* rom_folder, char* out, size_t out_size) {
	if (!rom_folder || !out || out_size == 0) {
		return false;
	}
	int written = snprintf(out, out_size, "src/carts/%s/test/%s_demo.json", rom_folder, rom_folder);
	return written > 0 && (size_t)written < out_size && access(out, F_OK) == 0;
}

static bool derive_screenshot_output_dir(const char* timeline_path, char* out, size_t out_size) {
	const char* slash = strrchr(timeline_path, '/');
	if (!slash) {
		int written = snprintf(out, out_size, "./screenshots");
		return written > 0 && (size_t)written < out_size;
	}
	if (slash == timeline_path) {
		int written = snprintf(out, out_size, "/screenshots");
		return written > 0 && (size_t)written < out_size;
	}
	int written = snprintf(out, out_size, "%.*s/screenshots", (int)(slash - timeline_path), timeline_path);
	return written > 0 && (size_t)written < out_size;
}

static bool extract_rom_folder_from_path(const char* game_path, char* out, size_t out_size) {
	if (!game_path || !out || out_size == 0) {
		return false;
	}
	const char* base = strrchr(game_path, '/');
	if (base) {
		base += 1;
	} else {
		base = game_path;
	}
	size_t len = strlen(base);
	if (len == 0) {
		return false;
	}
	const char* dbg_rom = ".debug.rom";
	const char* rom = ".rom";
	const size_t dbg_rom_len = 10;
	const size_t rom_len = 4;
	if (len > dbg_rom_len && strcmp(base + len - dbg_rom_len, dbg_rom) == 0) {
		len -= dbg_rom_len;
	} else if (len > rom_len && strcmp(base + len - rom_len, rom) == 0) {
		len -= rom_len;
	} else {
		return false;
	}
	if (len == 0 || len >= out_size) {
		return false;
	}
	snprintf(out, out_size, "%.*s", (int)len, base);
	return true;
}

void input_timeline_bind_keyboard_event(void (*emit_input_event)(const char* code, bool down)) {
	g_emit_keyboard_event = emit_input_event;
}

void input_timeline_configure(const char* explicit_timeline_path, const char* rom_folder, const char* game_path, uint64_t frame_usec) {
	char timeline_path[kInputTimelinePathBuffer];
	const char* selected_path = NULL;
	char game_rom_folder[kJsonKeyBuffer];

	if (explicit_timeline_path && explicit_timeline_path[0]) {
		if (!file_exists(explicit_timeline_path)) {
			timeline_logf("Explicit timeline file not found: '%s'", explicit_timeline_path);
			exit(1);
		}
		selected_path = explicit_timeline_path;
	} else {
		if (!rom_folder || !rom_folder[0]) {
			if (game_path && game_path[0]) {
				if (extract_rom_folder_from_path(game_path, game_rom_folder, sizeof(game_rom_folder))) {
					rom_folder = game_rom_folder;
				}
			}
		}
		if (!rom_folder || !rom_folder[0]) {
			timeline_logf("Could not resolve fallback timeline folder (no --rom-folder and unable to infer from game path).");
			return;
		}
		if (!derive_input_timeline_path(rom_folder, timeline_path, sizeof(timeline_path))) {
			timeline_logf("Could not build fallback timeline path for rom-folder '%s'.", rom_folder);
			return;
		}
		if (!file_exists(timeline_path)) {
			timeline_logf("Fallback timeline not found: '%s'", timeline_path);
			return;
		}
		selected_path = timeline_path;
	}

	if (selected_path) {
		char screenshot_dir[kInputTimelinePathBuffer];
		if (!derive_screenshot_output_dir(selected_path, screenshot_dir, sizeof(screenshot_dir))) {
			timeline_logf("Could not derive screenshot output directory from timeline '%s'.", selected_path);
			exit(1);
		}
		screenshot_set_output_dir(screenshot_dir);
		parse_input_timeline_file(selected_path, frame_usec);
	}
}

void input_timeline_tick_frame(void) {
	while (g_test_input_event_next < g_test_input_event_count &&
			g_test_input_events[g_test_input_event_next].frame <= g_frame_counter) {
		const TestInputEvent* event = &g_test_input_events[g_test_input_event_next];
		if (g_emit_keyboard_event) {
			g_emit_keyboard_event(event->code, event->down);
		}
		++g_test_input_event_next;
	}
	++g_frame_counter;
}

bool input_timeline_should_capture_frame(uint32_t frame_number) {
	bool should_capture = false;
	while (g_test_capture_event_next < g_test_capture_event_count &&
			g_test_capture_events[g_test_capture_event_next].frame <= frame_number) {
		should_capture = true;
		++g_test_capture_event_next;
	}
	return should_capture;
}

bool input_timeline_is_active(void) {
	return g_timeline_active;
}

bool input_timeline_should_auto_quit(uint64_t trailing_frames) {
	if (!g_timeline_active) {
		return false;
	}
	if (g_test_input_event_next < g_test_input_event_count) {
		return false;
	}
	if (g_test_capture_event_next < g_test_capture_event_count) {
		return false;
	}
	return g_frame_counter > (g_timeline_last_frame + trailing_frames);
}

void input_timeline_shutdown(void) {
	free(g_test_input_events);
	g_test_input_events = NULL;
	g_test_input_event_count = 0;
	g_test_input_event_capacity = 0;
	g_test_input_event_next = 0;
	free(g_test_capture_events);
	g_test_capture_events = NULL;
	g_test_capture_event_count = 0;
	g_test_capture_event_capacity = 0;
	g_test_capture_event_next = 0;
	g_frame_counter = 0;
	g_timeline_last_frame = 0;
	g_timeline_active = false;
}
