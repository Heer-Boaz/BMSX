#include "bmsx_libretro.h"

#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static retro_environment_t environment;
static uint64_t frames;
static bool run_timestamps;
static const char* guest_timing;
static BmsxGuestProgressV1 guest_progress;
static bool content_loaded;
static unsigned execution_reads;
static unsigned native_reads;

static void RETRO_CALLCONV read_guest_progress(BmsxGuestProgressV1* output) { *output = guest_progress; }
static int32_t RETRO_CALLCONV read_execution_domain(void) { return frames >= 2u ? 0 : -1; }
static void RETRO_CALLCONV guest_key_event(bool down, unsigned key, uint32_t character, uint16_t modifiers) {
	(void)character;
	(void)modifiers;
	fprintf(stderr, "[signal-core][guest-input] before_run=%llu key=%u down=%u\n",
		(unsigned long long)(frames + 1u), key, (unsigned)down);
}

static void RETRO_CALLCONV read_stale_profile(void* output) {
	(void)output;
	_exit(99); // The current frontend must reject this obsolete command before any read.
}

static void RETRO_CALLCONV read_current_profile(BmsxExecutionProfile* output) {
	if (!content_loaded) _exit(99);
	++execution_reads;
	*output = (BmsxExecutionProfile){
		.scheduler_now_cycles = (int64_t)frames * 100,
		.cpu_slice_count = frames,
		.cpu_slice_consumed_cycles = (int64_t)frames * 100,
		.gc_collections = frames,
		.gc_total_nanoseconds = frames * 1000u,
		.gc_roots_nanoseconds = frames * 100u,
		.gc_trace_nanoseconds = frames * 200u,
		.gc_weak_nanoseconds = frames * 50u,
		.gc_sweep_nanoseconds = frames * 400u,
		.gc_string_reclaim_nanoseconds = frames * 250u,
		.cpu_native_origin_cycles = (int64_t)frames * 60,
		.cpu_interpreter_runtime_cycles = (int64_t)frames * 40,
		.native_newt_count = frames * 2u, .native_call_count = frames * 3u,
		.native_setfield_count = frames * 4u, .native_concat_count = frames, .native_concatn_count = frames,
		.interpreter_newt_count = frames, .interpreter_call_count = frames,
		.interpreter_setfield_count = frames, .interpreter_concat_count = frames, .interpreter_concatn_count = frames,
	};
}

static void RETRO_CALLCONV read_native_v1(BmsxNativeCompilationProfileV1* output) {
	if (!content_loaded) _exit(99);
	++native_reads;
	*output = (BmsxNativeCompilationProfileV1){
		.prepare_requests = 30u + frames * 4u,
		.capacity_events = 20u + frames * 2u,
	};
}

static void RETRO_CALLCONV read_native_v2(BmsxNativeCompilationProfileV2* output) {
	read_native_v1(&output->counters);
	output->background_completed = 10u + frames * 3u;
	output->background_cancelled = 2u + frames;
	output->background_nanoseconds = 5000u + frames * 1234u;
}

void retro_set_environment(retro_environment_t callback) { environment = callback; }
void retro_set_video_refresh(retro_video_refresh_t callback) { (void)callback; }
void retro_set_audio_sample(retro_audio_sample_t callback) { (void)callback; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t callback) { (void)callback; }
void retro_set_input_poll(retro_input_poll_t callback) { (void)callback; }
void retro_set_input_state(retro_input_state_t callback) { (void)callback; }
void retro_init(void) {
	run_timestamps = getenv("BMSX_TEST_RUN_TIMESTAMPS") != NULL;
	guest_timing = getenv("BMSX_TEST_GUEST_TIMING");
	if (guest_timing != NULL) {
		BmsxExecutionDomainInterfaceV1 domain = {read_execution_domain};
		BmsxGuestProgressInterfaceV1 progress = {read_guest_progress};
		struct retro_keyboard_callback keyboard = {guest_key_event};
		environment(BMSX_ENVIRONMENT_SET_EXECUTION_DOMAIN_INTERFACE_V1, &domain);
		environment(BMSX_ENVIRONMENT_SET_GUEST_PROGRESS_INTERFACE_V1, &progress);
		environment(RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK, &keyboard);
		if (strcmp(guest_timing, "unbound") != 0) {
			bool single_guest_tick = false;
			if (!environment(BMSX_ENVIRONMENT_GET_SINGLE_GUEST_TICK_V1, &single_guest_tick) || !single_guest_tick) _exit(98);
		}
	}
	const char* profile = getenv("BMSX_TEST_EXECUTION_PROFILE");
	if (profile && strcmp(profile, "stale") == 0) {
		const unsigned stale_command = RETRO_ENVIRONMENT_PRIVATE | 0x42c1u;
		struct { void (RETRO_CALLCONV *read_profile)(void*); } interface = {read_stale_profile};
		environment(stale_command, &interface);
	} else if (profile && strcmp(profile, "current") == 0) {
		BmsxExecutionProfileInterface interface = {read_current_profile};
		environment(BMSX_ENVIRONMENT_SET_EXECUTION_PROFILE_INTERFACE, &interface);
	}
	const char* native_profile = getenv("BMSX_TEST_NATIVE_COMPILATION_PROFILE");
	if (native_profile && strcmp(native_profile, "v2") != 0) {
		BmsxNativeCompilationProfileInterfaceV1 interface = {read_native_v1};
		environment(BMSX_ENVIRONMENT_SET_NATIVE_COMPILATION_PROFILE_INTERFACE_V1, &interface);
	}
	if (native_profile && strcmp(native_profile, "v1") != 0) {
		BmsxNativeCompilationProfileInterfaceV2 interface = {read_native_v2};
		environment(BMSX_ENVIRONMENT_SET_NATIVE_COMPILATION_PROFILE_INTERFACE_V2, &interface);
	}
}
void retro_deinit(void) { if (write(STDOUT_FILENO, "D", 1) != 1) _exit(1); }
unsigned retro_api_version(void) { return RETRO_API_VERSION; }
void retro_get_system_info(struct retro_system_info* info) {
	memset(info, 0, sizeof(*info));
	info->library_name = "signal test";
	info->library_version = "1";
}
void retro_get_system_av_info(struct retro_system_av_info* info) {
	memset(info, 0, sizeof(*info));
	info->geometry.base_width = info->geometry.max_width = 16;
	info->geometry.base_height = info->geometry.max_height = 16;
	info->geometry.aspect_ratio = 1.0f;
	info->timing.fps = 60;
	info->timing.sample_rate = 48000;
}
void retro_set_controller_port_device(unsigned port, unsigned device) { (void)port; (void)device; }
void retro_reset(void) {}
void retro_run(void) {
	struct timespec start, end;
	if (run_timestamps && clock_gettime(CLOCK_MONOTONIC, &start) != 0) _exit(2);
	++frames;
	if (guest_timing != NULL) {
		switch (frames) {
			case 3: break; // Before the warmup tick.
			case 5: { // A measured maintenance-only host call.
				struct timespec delay = {0, 16000000};
				nanosleep(&delay, NULL);
				break;
			}
			case 6: guest_progress.scheduler_cycles += 10; break; // Partial guest tick.
			case 7:
				if (strcmp(guest_timing, "multiple") == 0) ++guest_progress.tick_sequence;
				/* fall through */
			default:
				++guest_progress.tick_sequence;
				guest_progress.scheduler_cycles = guest_progress.tick_sequence * 100;
				break;
		}
	}
	static bool ready;
	if (!ready) {
		if (write(STDOUT_FILENO, "R", 1) != 1) _exit(1);
		ready = true;
	}
	if (run_timestamps) {
		if (clock_gettime(CLOCK_MONOTONIC, &end) != 0) _exit(2);
		fprintf(stderr, "[signal-core][run-interval] host_frame=%llu start_ns=%llu end_ns=%llu\n",
			(unsigned long long)(frames - 1u),
			(unsigned long long)start.tv_sec * 1000000000u + start.tv_nsec,
			(unsigned long long)end.tv_sec * 1000000000u + end.tv_nsec);
	}
}
bool retro_load_game(const struct retro_game_info* info) { (void)info; content_loaded = true; return true; }
bool retro_load_game_special(unsigned type, const struct retro_game_info* info, size_t count) {
	(void)type; (void)info; (void)count; content_loaded = true; return true;
}
void retro_unload_game(void) {
	content_loaded = false;
	if (execution_reads != 0u || native_reads != 0u)
		fprintf(stderr, "[signal-core][profile-reads] execution=%u native=%u\n", execution_reads, native_reads);
}
unsigned retro_get_region(void) { return RETRO_REGION_NTSC; }
size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void* data, size_t size) { (void)data; (void)size; return false; }
bool retro_unserialize(const void* data, size_t size) { (void)data; (void)size; return false; }
void* retro_get_memory_data(unsigned id) { (void)id; return NULL; }
size_t retro_get_memory_size(unsigned id) { (void)id; return 0; }
void retro_cheat_reset(void) {}
void retro_cheat_set(unsigned index, bool enabled, const char* code) {
	(void)index; (void)enabled; (void)code;
}
