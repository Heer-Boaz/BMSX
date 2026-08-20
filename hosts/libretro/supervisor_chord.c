#include "supervisor_chord.h"

uint32_t bmsx_supervisor_chord_update(
		bool* active,
		uint32_t pad_state,
		uint32_t chord_mask) {
	if (*active) {
		if ((pad_state & chord_mask) != 0u) {
			return pad_state & ~chord_mask;
		}
		*active = false;
	}
	if ((pad_state & chord_mask) == chord_mask) {
		*active = true;
		return pad_state & ~chord_mask;
	}
	return pad_state;
}
