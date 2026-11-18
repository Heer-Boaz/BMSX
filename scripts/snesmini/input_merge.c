#include "input_merge.h"

#include <errno.h>
#include <unistd.h>

static bool write_event(SnesInputMerge* input, unsigned type, unsigned code, int value) {
	const struct input_event event = {.type = type, .code = code, .value = value};
	const unsigned char* bytes = (const unsigned char*)&event;
	size_t written = 0;
	while (written < sizeof(event)) {
		const ssize_t count = write(input->output, bytes + written, sizeof(event) - written);
		if (count < 0 && errno == EINTR) continue;
		if (count <= 0) return false;
		written += (size_t)count;
	}
	input->dirty = true;
	return true;
}

bool snes_input_merge_key(SnesInputMerge* input, SnesInputSource source, unsigned code, bool down) {
	const bool before = input->keys[SNES_INPUT_PHYSICAL][code] || input->keys[SNES_INPUT_REMOTE][code];
	input->keys[source][code] = down;
	const bool after = input->keys[SNES_INPUT_PHYSICAL][code] || input->keys[SNES_INPUT_REMOTE][code];
	return before == after || write_event(input, EV_KEY, code, after);
}

bool snes_input_merge_sync(SnesInputMerge* input) {
	if (!input->dirty) return true;
	if (!write_event(input, EV_SYN, SYN_REPORT, 0)) return false;
	input->dirty = false;
	return true;
}

bool snes_input_merge_event(SnesInputMerge* input, SnesInputSource source, const struct input_event* event) {
	switch (event->type) {
		case EV_KEY:
			return snes_input_merge_key(input, source, event->code, event->value != 0);
		case EV_ABS:
			return source != SNES_INPUT_PHYSICAL || write_event(input, EV_ABS, event->code, event->value);
		case EV_SYN:
			return event->code != SYN_REPORT || snes_input_merge_sync(input);
		default:
			return true;
	}
}
