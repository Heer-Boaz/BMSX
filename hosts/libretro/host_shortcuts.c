#include "host_shortcuts.h"

BmsxHostShortcutResult bmsx_host_shortcuts_update(
		BmsxHostShortcutState* state,
		uint32_t buttons,
		uint32_t modifier,
		uint32_t targets) {
	const uint32_t just_pressed = buttons & ~state->previous_buttons;
	state->previous_buttons = buttons;

	if (!state->captured && (buttons & modifier) != 0u) {
		state->captured = true;
		state->blocked_targets = (buttons & targets) & ~just_pressed;
	}
	if (!state->captured) {
		state->active_targets = 0u;
		return (BmsxHostShortcutResult){
			.routed_buttons = buttons,
		};
	}

	const uint32_t held_targets = buttons & targets;
	state->blocked_targets &= held_targets;
	uint32_t active_targets = 0u;
	if ((buttons & modifier) != 0u) {
		active_targets = held_targets & ~state->blocked_targets;
	} else {
		state->blocked_targets |= held_targets;
	}
	const uint32_t just_pressed_targets = active_targets & ~state->active_targets;
	state->active_targets = active_targets;
	const BmsxHostShortcutResult result = {
		.routed_buttons = buttons & ~(modifier | targets),
		.active_targets = active_targets,
		.just_pressed_targets = just_pressed_targets,
	};
	if ((buttons & modifier) == 0u && held_targets == 0u) {
		state->captured = false;
		state->blocked_targets = 0u;
	}
	return result;
}
