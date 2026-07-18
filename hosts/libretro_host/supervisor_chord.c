#include "supervisor_chord.h"

#include "libretro.h"

enum {
	kSupervisorChordMask =
		(1u << RETRO_DEVICE_ID_JOYPAD_DOWN) |
		(1u << RETRO_DEVICE_ID_JOYPAD_SELECT),
};

uint16_t bmsx_supervisor_chord_update(
		bool* request_line_high,
		uint16_t raw_pad_state) {
	if (*request_line_high) {
		if ((raw_pad_state & kSupervisorChordMask) != 0u) {
			return raw_pad_state & (uint16_t)~kSupervisorChordMask;
		}
		*request_line_high = false;
	}
	if ((raw_pad_state & kSupervisorChordMask) == kSupervisorChordMask) {
		*request_line_high = true;
		return raw_pad_state & (uint16_t)~kSupervisorChordMask;
	}
	return raw_pad_state;
}
