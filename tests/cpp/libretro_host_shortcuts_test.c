#include "host_shortcuts.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "libretro.h"

static void require(bool condition, const char* message) {
	if (!condition) {
		fprintf(stderr, "%s\n", message);
		exit(1);
	}
}

static void test_deferred_short_and_hold(void) {
	const uint32_t select = 1u << RETRO_DEVICE_ID_JOYPAD_SELECT;
	const uint32_t start = 1u << RETRO_DEVICE_ID_JOYPAD_START;
	const uint32_t terminal = 1u << RETRO_DEVICE_ID_JOYPAD_L;
	const uint32_t targets = start | terminal;
	const uint32_t chord = select | start;
	const uint32_t release_orders[] = {select, start, 0u};
	for (unsigned index = 0; index < 3; ++index) {
		BmsxHostShortcutState state = {0};
		BmsxHostShortcutResult result = bmsx_host_shortcuts_update(
			&state, chord, select, targets, start, 500.0, 100.0);
		require(result.routed_buttons == 0u && result.just_pressed_targets == 0u
			&& result.short_pressed_targets == 0u && result.long_pressed_targets == 0u,
			"a deferred target is captured without an immediate command");
		result = bmsx_host_shortcuts_update(
			&state, release_orders[index], select, targets, start, 500.0, 599.0);
		require(result.routed_buttons == 0u && result.short_pressed_targets == start
			&& result.long_pressed_targets == 0u,
			"releasing either component below the deadline reports one short press");
		result = bmsx_host_shortcuts_update(
			&state, release_orders[index], select, targets, start, 500.0, 900.0);
		require(result.short_pressed_targets == 0u && result.long_pressed_targets == 0u,
			"the remaining component cannot report another command");
	}

	BmsxHostShortcutState state = {0};
	bmsx_host_shortcuts_update(&state, chord, select, targets, start, 500.0, 100.0);
	BmsxHostShortcutResult result = bmsx_host_shortcuts_update(
		&state, chord, select, targets, start, 500.0, 599.0);
	require(result.short_pressed_targets == 0u && result.long_pressed_targets == 0u,
		"the complete chord is still pending at 499 milliseconds");
	result = bmsx_host_shortcuts_update(
		&state, chord, select, targets, start, 500.0, 600.0);
	require(result.long_pressed_targets == start && result.short_pressed_targets == 0u,
		"the complete chord reports long at exactly 500 milliseconds");
	result = bmsx_host_shortcuts_update(
		&state, chord | terminal, select, targets, start, 500.0, 1600.0);
	require(result.long_pressed_targets == 0u && result.just_pressed_targets == terminal,
		"a reported hold does not repeat or delay another immediate shortcut");
	result = bmsx_host_shortcuts_update(
		&state, 0u, select, targets, start, 500.0, 1700.0);
	require(result.long_pressed_targets == 0u && result.short_pressed_targets == 0u,
		"releasing a long press cannot also report short");

	for (unsigned index = 0; index < 3; ++index) {
		state = (BmsxHostShortcutState){0};
		bmsx_host_shortcuts_update(&state, chord, select, targets, start, 500.0, 100.0);
		result = bmsx_host_shortcuts_update(
			&state, release_orders[index], select, targets, start, 500.0, 900.0);
		require(result.long_pressed_targets == start && result.short_pressed_targets == 0u,
			"a sparse release poll after the deadline is long, not short");
	}
}

static void test_deferred_cancellation_and_retarget(void) {
	const uint32_t select = 1u << RETRO_DEVICE_ID_JOYPAD_SELECT;
	const uint32_t start = 1u << RETRO_DEVICE_ID_JOYPAD_START;
	const uint32_t terminal = 1u << RETRO_DEVICE_ID_JOYPAD_L;
	const uint32_t targets = start | terminal;
	const uint32_t chord = select | start;
	for (unsigned retarget = 0; retarget < 2; ++retarget) {
		BmsxHostShortcutState state = {0};
		bmsx_host_shortcuts_update(&state, chord, select, targets, start, 500.0, 100.0);
		if (retarget) bmsx_host_shortcuts_retarget(&state, chord, select, start);
		else bmsx_host_shortcuts_cancel_gesture(&state);
		BmsxHostShortcutResult result = bmsx_host_shortcuts_update(
			&state, chord, select, start, start, 500.0, 900.0);
		require(result.routed_buttons == 0u && result.short_pressed_targets == 0u
			&& result.long_pressed_targets == 0u,
			"cancel or retarget discards the pending press while retaining capture");
		result = bmsx_host_shortcuts_update(
			&state, 0u, select, start, start, 500.0, 1000.0);
		require(result.short_pressed_targets == 0u && result.long_pressed_targets == 0u,
			"a canceled press cannot report on later physical release");
		bmsx_host_shortcuts_update(&state, chord, select, start, start, 500.0, 1100.0);
		result = bmsx_host_shortcuts_update(
			&state, 0u, select, start, start, 500.0, 1200.0);
		require(result.short_pressed_targets == start && result.long_pressed_targets == 0u,
			"a canceled source rearms after real up");
	}

	BmsxHostShortcutState state = {0};
	bmsx_host_shortcuts_update(&state, start, select, targets, start, 500.0, 100.0);
	bmsx_host_shortcuts_update(&state, chord, select, targets, start, 500.0, 200.0);
	BmsxHostShortcutResult result = bmsx_host_shortcuts_update(
		&state, chord, select, targets, start, 500.0, 1000.0);
	require(result.short_pressed_targets == 0u && result.long_pressed_targets == 0u,
		"the deferred target held before its modifier cannot become a hold");
	result = bmsx_host_shortcuts_update(
		&state, 0u, select, targets, start, 500.0, 1100.0);
	require(result.short_pressed_targets == 0u && result.long_pressed_targets == 0u,
		"a blocked preheld target cannot become a short release either");
}

int main(void) {
	const uint32_t left_shoulder = 1u << RETRO_DEVICE_ID_JOYPAD_L;
	const uint32_t start = 1u << RETRO_DEVICE_ID_JOYPAD_START;
	const uint32_t select = 1u << RETRO_DEVICE_ID_JOYPAD_SELECT;
	const uint32_t a = 1u << RETRO_DEVICE_ID_JOYPAD_A;
	const uint32_t x = 1u << RETRO_DEVICE_ID_JOYPAD_X;
	const uint32_t targets = left_shoulder | start;
	BmsxHostShortcutState state = {0};
	BmsxHostShortcutResult result;

	result = bmsx_host_shortcuts_update(&state, select, select, targets, 0u, 0.0, 0.0);
	require(result.routed_buttons == 0u && result.active_targets == 0u,
		"the reserved modifier is hidden before a command is selected");
	result = bmsx_host_shortcuts_update(
		&state,
		select | left_shoulder | a,
		select,
		targets, 0u, 0.0, 0.0);
	require(result.routed_buttons == a &&
		result.active_targets == left_shoulder &&
		result.just_pressed_targets == left_shoulder,
		"a target pressed after the modifier activates once and remains host-owned");
	result = bmsx_host_shortcuts_update(
		&state,
		select | left_shoulder,
		select,
		targets, 0u, 0.0, 0.0);
	require(result.just_pressed_targets == 0u && result.active_targets == left_shoulder,
		"a held shortcut does not produce another activation edge");
	result = bmsx_host_shortcuts_update(&state, left_shoulder, select, targets, 0u, 0.0, 0.0);
	require(result.routed_buttons == 0u && result.active_targets == 0u,
		"a target remains hidden after the modifier is released");
	result = bmsx_host_shortcuts_update(&state, 0u, select, targets, 0u, 0.0, 0.0);
	require(result.routed_buttons == 0u && !state.captured,
		"full release rearms host control routing");

	state = (BmsxHostShortcutState){0};
	result = bmsx_host_shortcuts_update(&state, left_shoulder, select, targets, 0u, 0.0, 0.0);
	require(result.routed_buttons == left_shoulder,
		"a command target remains ordinary input before the modifier");
	result = bmsx_host_shortcuts_update(
		&state,
		select | left_shoulder,
		select,
		targets, 0u, 0.0, 0.0);
	require(result.routed_buttons == 0u && result.active_targets == 0u,
		"a target held before the modifier cannot become a host command");
	result = bmsx_host_shortcuts_update(&state, left_shoulder, select, targets, 0u, 0.0, 0.0);
	require(result.routed_buttons == 0u,
		"the blocked target cannot ghost into guest input on modifier release");
	bmsx_host_shortcuts_update(&state, 0u, select, targets, 0u, 0.0, 0.0);
	result = bmsx_host_shortcuts_update(&state, left_shoulder, select, targets, 0u, 0.0, 0.0);
	require(result.routed_buttons == left_shoulder,
		"the target becomes ordinary input again after release");

	state = (BmsxHostShortcutState){0};
	result = bmsx_host_shortcuts_update(
		&state,
		select | start,
		select,
		targets, 0u, 0.0, 0.0);
	require(result.just_pressed_targets == start,
		"a simultaneous modifier and target press activates the command");

	state = (BmsxHostShortcutState){0};
	result = bmsx_host_shortcuts_update(
		&state,
		select | x,
		select,
		targets | x, 0u, 0.0, 0.0);
	require(result.just_pressed_targets == x,
		"the keyboard shortcut opens from the ordinary host target set");
	bmsx_host_shortcuts_retarget(&state, select | x, select, x);
	result = bmsx_host_shortcuts_update(&state, select | x, select, x, 0u, 0.0, 0.0);
	require(result.active_targets == 0u && result.just_pressed_targets == 0u,
		"retargeting blocks the held opening chord");

	bmsx_host_shortcuts_retarget(
		&state,
		select | left_shoulder,
		select,
		targets | x);
	result = bmsx_host_shortcuts_update(
		&state,
		select | left_shoulder,
		select,
		targets | x, 0u, 0.0, 0.0);
	require(result.active_targets == 0u,
		"restoring targets cannot activate a shoulder button that was already held");
	bmsx_host_shortcuts_update(&state, 0u, select, targets | x, 0u, 0.0, 0.0);
	result = bmsx_host_shortcuts_update(
		&state,
		select | left_shoulder,
		select,
		targets | x, 0u, 0.0, 0.0);
	require(result.just_pressed_targets == left_shoulder,
		"the restored target rearms after a full release");

	test_deferred_short_and_hold();
	test_deferred_cancellation_and_retarget();
	return 0;
}
