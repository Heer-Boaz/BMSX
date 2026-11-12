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
#define BMSX_ENVIRONMENT_SET_NATIVE_COMPILATION_PROFILE_INTERFACE \
	(RETRO_ENVIRONMENT_PRIVATE | 0x42a1u)
#define BMSX_ENVIRONMENT_SET_SHUTDOWN_REASON_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x42b1u)
#define BMSX_SUBSYSTEM_DUAL_CARTRIDGE 1u

/* Sent immediately before RETRO_ENVIRONMENT_SHUTDOWN. EXIT_GAME asks the
 * frontend to exit without a suspend point; SUSPEND requests one. A frontend
 * may ignore the reason and still receive the standard shutdown request. */
typedef uint32_t BmsxShutdownReasonV1;
enum {
	BMSX_SHUTDOWN_REASON_UNSPECIFIED = 0,
	BMSX_SHUTDOWN_REASON_EXIT_GAME = 1,
	BMSX_SHUTDOWN_REASON_SUSPEND = 2,
};

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

/* Cumulative CPU-lifetime counters, not a per-presentation sample. code_bytes
 * is a live gauge; peak/max fields and their raw guest identity are lifetime
 * maxima. Read after content load and before unload. Offered by native cores
 * only; accepting the interface enables measurement for loaded runtimes. */
typedef struct BmsxNativeCompilationProfile {
	uint64_t prepare_requests;
	uint64_t regions_published;
	uint64_t entries_published;
	uint64_t source_instructions;
	uint64_t emitted_code_bytes;
	uint64_t code_bytes;
	uint64_t peak_code_bytes;
	uint64_t prepare_nanoseconds;
	uint64_t max_prepare_nanoseconds;
	uint64_t discovery_nanoseconds;
	uint64_t retirement_nanoseconds;
	uint64_t compilation_nanoseconds;
	uint64_t merged_regions;
	uint64_t merged_code_bytes;
	uint64_t capacity_flushes;
	uint64_t capacity_retired_code_bytes;
	int32_t max_prepare_domain;
	uint32_t max_prepare_cartridge_slot;
	uint32_t max_prepare_root_pc;
	uint32_t max_prepare_page_pc;
} BmsxNativeCompilationProfile;

typedef void (RETRO_CALLCONV *bmsx_read_native_compilation_profile_t)(
	BmsxNativeCompilationProfile* profile);

typedef struct BmsxNativeCompilationProfileInterface {
	bmsx_read_native_compilation_profile_t read_profile;
} BmsxNativeCompilationProfileInterface;

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
