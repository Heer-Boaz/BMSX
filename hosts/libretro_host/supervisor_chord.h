#ifndef BMSX_LIBRETRO_HOST_SUPERVISOR_CHORD_H
#define BMSX_LIBRETRO_HOST_SUPERVISOR_CHORD_H

#include <stdbool.h>
#include <stdint.h>

uint16_t bmsx_supervisor_chord_update(
		bool* request_line_high,
		uint16_t raw_pad_state);

#endif
