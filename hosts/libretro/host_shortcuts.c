#include "host_shortcuts.h"

enum {
	DEFERRED_IDLE,
	DEFERRED_PENDING,
	DEFERRED_REPORTED,
	DEFERRED_CANCELLED,
};

BmsxHostShortcutResult bmsx_host_shortcuts_update(
		BmsxHostShortcutState* state,
		uint32_t buttons,
		uint32_t modifier,
		uint32_t targets,
		uint32_t deferred_target,
		double hold_duration_ms,
		double now_ms) {
	const uint32_t just_pressed = buttons & ~state->previous_buttons;
	state->previous_buttons = buttons;

	if (!state->captured && (buttons & modifier) != 0u) {
		state->captured = true;
		state->blocked_targets = (buttons & targets) & ~just_pressed;
	}
	if (!state->captured) {
		state->active_targets = 0u;
		state->deferred_phase = DEFERRED_IDLE;
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
	BmsxHostShortcutResult result = {
		.routed_buttons = buttons & ~(modifier | targets),
		.active_targets = active_targets,
		.just_pressed_targets = just_pressed_targets & ~deferred_target,
	};
	if ((just_pressed_targets & deferred_target) != 0u
		&& state->deferred_phase == DEFERRED_IDLE) {
		state->deferred_phase = DEFERRED_PENDING;
		state->deferred_deadline_ms = now_ms + hold_duration_ms;
	}
	if (state->deferred_phase == DEFERRED_PENDING) {
		/* Classify the elapsed press before handling release: a sparse poll
		 * after the deadline is still a long press, never a menu tap. */
		if (now_ms >= state->deferred_deadline_ms) {
			result.long_pressed_targets = deferred_target;
			state->deferred_phase = DEFERRED_REPORTED;
		} else if ((active_targets & deferred_target) == 0u) {
			result.short_pressed_targets = deferred_target;
			state->deferred_phase = DEFERRED_IDLE;
		}
	}
	if ((active_targets & deferred_target) == 0u) {
		state->deferred_phase = DEFERRED_IDLE;
	}
	if ((buttons & modifier) == 0u && held_targets == 0u) {
		state->captured = false;
		state->blocked_targets = 0u;
	}
	return result;
}

void bmsx_host_shortcuts_cancel_gesture(BmsxHostShortcutState* state) {
	if (state->deferred_phase != DEFERRED_IDLE) {
		state->deferred_phase = DEFERRED_CANCELLED;
	}
}

void bmsx_host_shortcuts_retarget(
		BmsxHostShortcutState* state,
		uint32_t buttons,
		uint32_t modifier,
		uint32_t targets) {
	/* Retargeting blocks the physically held targets below. */
	state->deferred_phase = DEFERRED_IDLE;
	state->previous_buttons = buttons;
	state->blocked_targets = buttons & targets;
	state->active_targets = 0u;
	state->captured = (buttons & modifier) != 0u;
}
