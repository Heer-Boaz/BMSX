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

int main(void) {
	const uint32_t left_shoulder = 1u << RETRO_DEVICE_ID_JOYPAD_L;
	const uint32_t start = 1u << RETRO_DEVICE_ID_JOYPAD_START;
	const uint32_t select = 1u << RETRO_DEVICE_ID_JOYPAD_SELECT;
	const uint32_t a = 1u << RETRO_DEVICE_ID_JOYPAD_A;
	const uint32_t x = 1u << RETRO_DEVICE_ID_JOYPAD_X;
	const uint32_t targets = left_shoulder | start;
	BmsxHostShortcutState state = {0};
	BmsxHostShortcutResult result;

	result = bmsx_host_shortcuts_update(&state, select, select, targets);
	require(result.routed_buttons == 0u && result.active_targets == 0u,
		"the reserved modifier is hidden before a command is selected");
	result = bmsx_host_shortcuts_update(
		&state,
		select | left_shoulder | a,
		select,
		targets);
	require(result.routed_buttons == a &&
		result.active_targets == left_shoulder &&
		result.just_pressed_targets == left_shoulder,
		"a target pressed after the modifier activates once and remains host-owned");
	result = bmsx_host_shortcuts_update(
		&state,
		select | left_shoulder,
		select,
		targets);
	require(result.just_pressed_targets == 0u && result.active_targets == left_shoulder,
		"a held shortcut does not produce another activation edge");
	result = bmsx_host_shortcuts_update(&state, left_shoulder, select, targets);
	require(result.routed_buttons == 0u && result.active_targets == 0u,
		"a target remains hidden after the modifier is released");
	result = bmsx_host_shortcuts_update(&state, 0u, select, targets);
	require(result.routed_buttons == 0u && !state.captured,
		"full release rearms host control routing");

	state = (BmsxHostShortcutState){0};
	result = bmsx_host_shortcuts_update(&state, left_shoulder, select, targets);
	require(result.routed_buttons == left_shoulder,
		"a command target remains ordinary input before the modifier");
	result = bmsx_host_shortcuts_update(
		&state,
		select | left_shoulder,
		select,
		targets);
	require(result.routed_buttons == 0u && result.active_targets == 0u,
		"a target held before the modifier cannot become a host command");
	result = bmsx_host_shortcuts_update(&state, left_shoulder, select, targets);
	require(result.routed_buttons == 0u,
		"the blocked target cannot ghost into guest input on modifier release");
	bmsx_host_shortcuts_update(&state, 0u, select, targets);
	result = bmsx_host_shortcuts_update(&state, left_shoulder, select, targets);
	require(result.routed_buttons == left_shoulder,
		"the target becomes ordinary input again after release");

	state = (BmsxHostShortcutState){0};
	result = bmsx_host_shortcuts_update(
		&state,
		select | start,
		select,
		targets);
	require(result.just_pressed_targets == start,
		"a simultaneous modifier and target press activates the command");

	state = (BmsxHostShortcutState){0};
	result = bmsx_host_shortcuts_update(
		&state,
		select | x,
		select,
		targets | x);
	require(result.just_pressed_targets == x,
		"the keyboard shortcut opens from the ordinary host target set");
	bmsx_host_shortcuts_retarget(&state, select | x, select, x);
	result = bmsx_host_shortcuts_update(&state, select | x, select, x);
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
		targets | x);
	require(result.active_targets == 0u,
		"restoring targets cannot activate a shoulder button that was already held");
	bmsx_host_shortcuts_update(&state, 0u, select, targets | x);
	result = bmsx_host_shortcuts_update(
		&state,
		select | left_shoulder,
		select,
		targets | x);
	require(result.just_pressed_targets == left_shoulder,
		"the restored target rearms after a full release");

	return 0;
}
