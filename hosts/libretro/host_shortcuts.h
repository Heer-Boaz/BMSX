#ifndef BMSX_LIBRETRO_HOST_SHORTCUTS_H
#define BMSX_LIBRETRO_HOST_SHORTCUTS_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct BmsxHostShortcutState {
	uint32_t previous_buttons;
	uint32_t blocked_targets;
	uint32_t active_targets;
	bool captured;
} BmsxHostShortcutState;

typedef struct BmsxHostShortcutResult {
	uint32_t routed_buttons;
	uint32_t active_targets;
	uint32_t just_pressed_targets;
} BmsxHostShortcutResult;

BmsxHostShortcutResult bmsx_host_shortcuts_update(
		BmsxHostShortcutState* state,
		uint32_t buttons,
		uint32_t modifier,
		uint32_t targets);

void bmsx_host_shortcuts_retarget(
		BmsxHostShortcutState* state,
		uint32_t buttons,
		uint32_t modifier,
		uint32_t targets);

#ifdef __cplusplus
}
#endif

#endif
