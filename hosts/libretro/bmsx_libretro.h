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
#define BMSX_ENVIRONMENT_SET_GX_UPLOAD_PROFILE_INTERFACE_V2 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x4262u)
#define BMSX_ENVIRONMENT_SET_EXECUTION_DOMAIN_INTERFACE_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x4271u)
#define BMSX_ENVIRONMENT_GET_AUDIO_TRANSPORT_INTERFACE \
	(RETRO_ENVIRONMENT_PRIVATE | 0x4281u)
#define BMSX_ENVIRONMENT_SET_INPUT_LIFECYCLE_INTERFACE_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x4291u)
#define BMSX_ENVIRONMENT_SET_NATIVE_COMPILATION_PROFILE_INTERFACE_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x42a1u)
#define BMSX_ENVIRONMENT_SET_NATIVE_COMPILATION_PROFILE_INTERFACE_V2 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x42a2u)
#define BMSX_ENVIRONMENT_SET_SHUTDOWN_REASON_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x42b1u)
#define BMSX_ENVIRONMENT_SET_EXECUTION_PROFILE_INTERFACE \
	(RETRO_ENVIRONMENT_PRIVATE | 0x42c2u)
#define BMSX_ENVIRONMENT_SET_GUEST_PROGRESS_INTERFACE_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x42d1u)
/* The frontend writes a bool. When true, retro_run never starts a second
 * guest tick after completing the first; a partial tick remains pending. */
#define BMSX_ENVIRONMENT_GET_SINGLE_GUEST_TICK_V1 \
	(RETRO_ENVIRONMENT_PRIVATE | 0x42d2u)
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

/* One core run on the active GLES backend. CPU-to-VRAM payload and host GL
 * transfers are distinct from the hybrid backend's scanout and texture upload.
 * Times are caller-side elapsed intervals, not GPU completion times. */
typedef struct BmsxGxUploadProfileFrameV2 {
	uint64_t render_frame_serial;
	uint64_t cpu_to_vram_commands;
	uint64_t logical_bytes;
	uint64_t host_calls;
	uint64_t host_bytes;
	uint64_t elapsed_nanoseconds;
	uint64_t max_command_nanoseconds;
	uint64_t software_scanout_pixels;
	uint64_t software_scanout_nanoseconds;
	uint64_t scanout_upload_calls;
	uint64_t scanout_upload_bytes;
	uint64_t scanout_upload_nanoseconds;
} BmsxGxUploadProfileFrameV2;

typedef bool (RETRO_CALLCONV *bmsx_read_gx_upload_profile_frame_t)(
	uint64_t after_render_frame_serial,
	BmsxGxUploadProfileFrameV2* frame);

typedef struct BmsxGxUploadProfileInterfaceV2 {
	bmsx_read_gx_upload_profile_frame_t read_frame;
} BmsxGxUploadProfileInterfaceV2;

/* Cumulative CPU-lifetime counters, not a per-presentation sample. code_bytes
 * counts published native code bytes, not process RSS. Peak/max fields and
 * their raw guest identity are lifetime maxima. Read after content load and
 * before unload. Offered by native cores
 * only; accepting the interface enables measurement for loaded runtimes. */
typedef struct BmsxNativeCompilationProfileV1 {
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
	/* V1 builds counted either whole-cache flushes or individual evictions.
	 * V2 always counts individual capacity-evicted regions. */
	uint64_t capacity_events;
	uint64_t capacity_retired_code_bytes;
	int32_t max_prepare_domain;
	uint32_t max_prepare_cartridge_slot;
	uint32_t max_prepare_root_pc;
	uint32_t max_prepare_page_pc;
} BmsxNativeCompilationProfileV1;

typedef void (RETRO_CALLCONV *bmsx_read_native_compilation_profile_v1_t)(
	BmsxNativeCompilationProfileV1* profile);

typedef struct BmsxNativeCompilationProfileInterfaceV1 {
	bmsx_read_native_compilation_profile_v1_t read_profile;
} BmsxNativeCompilationProfileInterfaceV1;

/* Completed includes cancelled jobs. Work is accounted when the CPU collects
 * the result; background elapsed time can overlap foreground host execution. */
typedef struct BmsxNativeCompilationProfileV2 {
	BmsxNativeCompilationProfileV1 counters;
	uint64_t background_completed;
	uint64_t background_cancelled;
	uint64_t background_nanoseconds;
} BmsxNativeCompilationProfileV2;

typedef void (RETRO_CALLCONV *bmsx_read_native_compilation_profile_v2_t)(
	BmsxNativeCompilationProfileV2* profile);

typedef struct BmsxNativeCompilationProfileInterfaceV2 {
	bmsx_read_native_compilation_profile_v2_t read_profile;
} BmsxNativeCompilationProfileInterfaceV2;

/* Offered only by BMSX_DIAGNOSTIC_CPU_SLICES cores. Read synchronously after
 * content load and before unload. Reading has no execution or reset effects.
 * Scheduler position is raw signed machine time: reset/restore can move it
 * backwards. The remaining fields are host-only CPU-lifetime measurements,
 * never reset or restored with machine state.
 * Cycles are CPU::runUntilDepth budget
 * consumption, not host time or a count of retired instructions.
 *
 * NativeOrigin includes shared C++ semantics reached from generated execution;
 * InterpreterRuntime includes
 * remaining scheduler CPU work such as exception unwinding and pending
 * completions. Their sum is cpu_slice_consumed_cycles, not host CPU time.
 * Opcode counts are admitted semantic attempts (faulting instructions count;
 * fetch faults and native-admission retries do not). */
typedef struct BmsxExecutionProfile {
	int64_t scheduler_now_cycles;
	uint64_t cpu_slice_count;
	int64_t cpu_slice_consumed_cycles;
	int64_t cpu_native_origin_cycles;
	int64_t cpu_interpreter_runtime_cycles;
	uint64_t native_call_count;
	uint64_t native_setfield_count;
	uint64_t native_concat_count;
	uint64_t native_concatn_count;
	uint64_t interpreter_call_count;
	uint64_t interpreter_setfield_count;
	uint64_t interpreter_concat_count;
	uint64_t interpreter_concatn_count;
} BmsxExecutionProfile;

typedef void (RETRO_CALLCONV *bmsx_read_execution_profile_t)(BmsxExecutionProfile* profile);

typedef struct BmsxExecutionProfileInterface {
	bmsx_read_execution_profile_t read_profile;
} BmsxExecutionProfileInterface;

typedef int32_t (RETRO_CALLCONV *bmsx_read_execution_domain_id_t)(void);

typedef struct BmsxExecutionDomainInterfaceV1 {
	bmsx_read_execution_domain_id_t read_active_domain_id;
} BmsxExecutionDomainInterfaceV1;

/* Read synchronously with content loaded, outside retro_run. Positions are
 * machine state; reset or restore can move them backwards. */
typedef struct BmsxGuestProgressV1 {
	int64_t tick_sequence;
	int64_t scheduler_cycles;
} BmsxGuestProgressV1;

typedef void (RETRO_CALLCONV *bmsx_read_guest_progress_t)(BmsxGuestProgressV1* progress);

typedef struct BmsxGuestProgressInterfaceV1 {
	bmsx_read_guest_progress_t read_progress;
} BmsxGuestProgressInterfaceV1;

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
