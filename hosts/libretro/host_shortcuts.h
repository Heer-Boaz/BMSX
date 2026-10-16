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
	uint8_t deferred_phase;
	double deferred_deadline_ms;
} BmsxHostShortcutState;

typedef struct BmsxHostShortcutResult {
	uint32_t routed_buttons;
	uint32_t active_targets;
	uint32_t just_pressed_targets;
	uint32_t short_pressed_targets;
	uint32_t long_pressed_targets;
} BmsxHostShortcutResult;

/* deferred_target is either zero or one target bit. A deferred press reports
 * short on release before its deadline, or long once at/after the deadline.
 * now_ms belongs to the host's monotonic input clock, not emulated time. */
BmsxHostShortcutResult bmsx_host_shortcuts_update(
		BmsxHostShortcutState* state,
		uint32_t buttons,
		uint32_t modifier,
		uint32_t targets,
		uint32_t deferred_target,
		double hold_duration_ms,
		double now_ms);

/* Cancellation is not a physical release and must not emit a short press. */
void bmsx_host_shortcuts_cancel_gesture(BmsxHostShortcutState* state);

void bmsx_host_shortcuts_retarget(
		BmsxHostShortcutState* state,
		uint32_t buttons,
		uint32_t modifier,
		uint32_t targets);

#ifdef __cplusplus
}
#endif

#endif
