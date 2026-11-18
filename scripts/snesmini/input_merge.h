#pragma once

#include <linux/input.h>
#include <stdbool.h>

/* The virtual pad publishes the union of the physical and remote sources. */
typedef enum SnesInputSource {
	SNES_INPUT_PHYSICAL,
	SNES_INPUT_REMOTE,
	SNES_INPUT_SOURCE_COUNT,
} SnesInputSource;

typedef struct SnesInputMerge {
	int output;
	bool keys[SNES_INPUT_SOURCE_COUNT][KEY_MAX + 1];
	bool dirty;
} SnesInputMerge;

bool snes_input_merge_key(SnesInputMerge* input, SnesInputSource source, unsigned code, bool down);
bool snes_input_merge_event(SnesInputMerge* input, SnesInputSource source, const struct input_event* event);
bool snes_input_merge_sync(SnesInputMerge* input);
