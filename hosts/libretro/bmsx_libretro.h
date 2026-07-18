#ifndef BMSX_LIBRETRO_H
#define BMSX_LIBRETRO_H

#include <stdbool.h>

#include "libretro.h"

#ifdef __cplusplus
extern "C" {
#endif

/* 0x4250 is the BMSX private-command family; the low nibble is the ABI version. */
#define BMSX_ENVIRONMENT_GET_SUPERVISOR_REQUEST_INTERFACE_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x4251u)

typedef bool (RETRO_CALLCONV *bmsx_supervisor_request_line_t)(void);

typedef struct BmsxSupervisorRequestInterfaceV1 {
	bmsx_supervisor_request_line_t request_line_high;
} BmsxSupervisorRequestInterfaceV1;

#ifdef __cplusplus
}
#endif

#endif
