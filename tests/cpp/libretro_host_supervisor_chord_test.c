#include "supervisor_chord.h"

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
	const uint16_t down = (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
	const uint16_t select = (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);
	const uint16_t a = (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A);
	bool request_line_high = false;

	require(
		bmsx_supervisor_chord_update(&request_line_high, down) == down &&
			!request_line_high,
		"a partial chord remains ordinary gameplay");
	require(
		bmsx_supervisor_chord_update(
			&request_line_high,
			(uint16_t)(down | select | a)) == a &&
			request_line_high,
		"the completed chord raises the line and consumes only its buttons");
	require(
		bmsx_supervisor_chord_update(&request_line_high, select) == 0u &&
			request_line_high,
		"the chord remains consumed until every constituent is released");
	require(
		bmsx_supervisor_chord_update(&request_line_high, 0u) == 0u &&
			!request_line_high,
		"full release lowers and rearms the supervisor line");
	require(
		bmsx_supervisor_chord_update(
			&request_line_high,
			(uint16_t)(down | select)) == 0u &&
			request_line_high,
		"a rearmed chord raises the supervisor line again");
	require(
		bmsx_supervisor_chord_update(&request_line_high, 0u) == 0u &&
			!request_line_high,
		"focus or device loss releases an active chord through raw zero state");

	return 0;
}
