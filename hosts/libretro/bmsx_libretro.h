#ifndef BMSX_LIBRETRO_H
#define BMSX_LIBRETRO_H

#include <stdbool.h>
#include <stdint.h>

#include "libretro.h"

#ifdef __cplusplus
extern "C" {
#endif

/* BMSX private environment commands use one 16-command family per interface. */
#define BMSX_ENVIRONMENT_GET_SUPERVISOR_REQUEST_INTERFACE_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x4251u)
#define BMSX_ENVIRONMENT_SET_GX_UPLOAD_PROFILE_INTERFACE_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x4261u)
#define BMSX_ENVIRONMENT_SET_EXECUTION_DOMAIN_INTERFACE_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x4271u)
#define BMSX_ENVIRONMENT_GET_AUDIO_TRANSPORT_INTERFACE \
	(RETRO_ENVIRONMENT_PRIVATE | 0x4281u)
#define BMSX_ENVIRONMENT_SET_INPUT_LIFECYCLE_INTERFACE_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x4291u)
#define BMSX_SUBSYSTEM_DUAL_CARTRIDGE 1u

typedef bool (RETRO_CALLCONV *bmsx_supervisor_request_line_t)(void);

typedef struct BmsxSupervisorRequestInterfaceV1 {
	bmsx_supervisor_request_line_t request_line_high;
} BmsxSupervisorRequestInterfaceV1;

typedef struct BmsxGxUploadProfileFrameV1 {
	uint64_t render_frame_serial;
	uint64_t cpu_to_vram_commands;
	uint64_t logical_bytes;
	uint64_t host_calls;
	uint64_t host_bytes;
	uint64_t cpu_nanoseconds;
	uint64_t max_command_nanoseconds;
} BmsxGxUploadProfileFrameV1;

typedef bool (RETRO_CALLCONV *bmsx_read_gx_upload_profile_frame_t)(
	uint64_t after_render_frame_serial,
	BmsxGxUploadProfileFrameV1* frame);

typedef struct BmsxGxUploadProfileInterfaceV1 {
	bmsx_read_gx_upload_profile_frame_t read_frame;
} BmsxGxUploadProfileInterfaceV1;

typedef int32_t (RETRO_CALLCONV *bmsx_read_execution_domain_id_t)(void);

typedef struct BmsxExecutionDomainInterfaceV1 {
	bmsx_read_execution_domain_id_t read_active_domain_id;
} BmsxExecutionDomainInterfaceV1;

typedef void (RETRO_CALLCONV *bmsx_set_audio_transport_suspended_t)(bool suspended);

typedef struct BmsxAudioTransportInterface {
	bmsx_set_audio_transport_suspended_t set_suspended;
} BmsxAudioTransportInterface;

typedef void (RETRO_CALLCONV *bmsx_cancel_keyboard_input_t)(void);
typedef void (RETRO_CALLCONV *bmsx_cancel_gamepad_input_t)(unsigned port);

/* Published by retro_init and revoked with null callbacks before retro_deinit.
 * Frontends call synchronously before synthetic releases caused by focus loss
 * or device removal. A normal physical button/key release is not cancellation.
 * The keyboard is the merged physical-keyboard source; gamepad ports are the
 * same zero-based ports supplied to the standard input callbacks. */
typedef struct BmsxInputLifecycleInterfaceV1 {
	bmsx_cancel_keyboard_input_t cancel_keyboard;
	bmsx_cancel_gamepad_input_t cancel_gamepad;
} BmsxInputLifecycleInterfaceV1;

#ifdef __cplusplus
}
#endif

#endif
