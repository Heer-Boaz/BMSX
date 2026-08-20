#ifndef BMSX_LIBRETRO_HOST_SUPERVISOR_CHORD_H
#define BMSX_LIBRETRO_HOST_SUPERVISOR_CHORD_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

uint32_t bmsx_supervisor_chord_update(
		bool* active,
		uint32_t pad_state,
		uint32_t chord_mask);

#ifdef __cplusplus
}
#endif

#endif
