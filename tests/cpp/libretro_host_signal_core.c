#include "bmsx_libretro.h"

#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static retro_environment_t environment;
static uint64_t frames;

static void RETRO_CALLCONV read_stale_profile(void* output) {
	(void)output;
	_exit(99); // The current frontend must reject this obsolete command before any read.
}

static void RETRO_CALLCONV read_current_profile(BmsxExecutionProfile* output) {
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

void retro_set_environment(retro_environment_t callback) { environment = callback; }
void retro_set_video_refresh(retro_video_refresh_t callback) { (void)callback; }
void retro_set_audio_sample(retro_audio_sample_t callback) { (void)callback; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t callback) { (void)callback; }
void retro_set_input_poll(retro_input_poll_t callback) { (void)callback; }
void retro_set_input_state(retro_input_state_t callback) { (void)callback; }
void retro_init(void) {
	const char* profile = getenv("BMSX_TEST_EXECUTION_PROFILE");
	if (profile && strcmp(profile, "stale") == 0) {
		const unsigned stale_command = RETRO_ENVIRONMENT_PRIVATE | 0x42c1u;
		struct { void (RETRO_CALLCONV *read_profile)(void*); } interface = {read_stale_profile};
		environment(stale_command, &interface);
	} else if (profile && strcmp(profile, "current") == 0) {
		BmsxExecutionProfileInterface interface = {read_current_profile};
		environment(BMSX_ENVIRONMENT_SET_EXECUTION_PROFILE_INTERFACE, &interface);
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
	++frames;
	static bool ready;
	if (!ready) {
		if (write(STDOUT_FILENO, "R", 1) != 1) _exit(1);
		ready = true;
	}
}
bool retro_load_game(const struct retro_game_info* info) { (void)info; return true; }
bool retro_load_game_special(unsigned type, const struct retro_game_info* info, size_t count) {
	(void)type; (void)info; (void)count; return true;
}
void retro_unload_game(void) {}
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
