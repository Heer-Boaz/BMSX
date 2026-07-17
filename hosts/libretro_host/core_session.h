#ifndef BMSX_LIBRETRO_HOST_CORE_SESSION_H
#define BMSX_LIBRETRO_HOST_CORE_SESSION_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "core_options.h"
#include "libretro.h"

typedef struct BmsxLibretroApi {
	void (*retro_set_environment)(retro_environment_t);
	void (*retro_set_video_refresh)(retro_video_refresh_t);
	void (*retro_set_audio_sample)(retro_audio_sample_t);
	void (*retro_set_audio_sample_batch)(retro_audio_sample_batch_t);
	void (*retro_set_input_poll)(retro_input_poll_t);
	void (*retro_set_input_state)(retro_input_state_t);

	void (*retro_init)(void);
	void (*retro_deinit)(void);
	unsigned (*retro_api_version)(void);
	void (*retro_get_system_info)(struct retro_system_info*);
	void (*retro_get_system_av_info)(struct retro_system_av_info*);
	void (*retro_set_controller_port_device)(unsigned, unsigned);

	void (*retro_reset)(void);
	void (*retro_run)(void);

	bool (*retro_load_game)(const struct retro_game_info*);
	bool (*retro_load_game_special)(unsigned, const struct retro_game_info*, size_t);
	void (*retro_unload_game)(void);
	unsigned (*retro_get_region)(void);

	size_t (*retro_serialize_size)(void);
	bool (*retro_serialize)(void*, size_t);
	bool (*retro_unserialize)(const void*, size_t);

	void* (*retro_get_memory_data)(unsigned);
	size_t (*retro_get_memory_size)(unsigned);

	void (*retro_cheat_reset)(void);
	void (*retro_cheat_set)(unsigned, bool, const char*);
} BmsxLibretroApi;

typedef struct BmsxCoreSession {
	void* library_handle;
	BmsxLibretroApi api;
	struct retro_system_info system_info;
	BmsxCoreOptions options;
	const char* system_directory;
	const char* save_directory;
	struct retro_frame_time_callback frame_time;
	uint64_t frame_period_usec;
	uint64_t frame_period_ns;
	bool shutdown_requested;
} BmsxCoreSession;

void core_session_open(
		BmsxCoreSession* session,
		const char* core_path,
		const char* system_directory,
		const char* save_directory);
void core_session_load_content(
		BmsxCoreSession* session,
		bool no_game,
		const char* game_path);
void core_session_update_timing(
		BmsxCoreSession* session,
		const struct retro_system_timing* timing);
void core_session_close(BmsxCoreSession* session);

bool core_session_environment(unsigned command, void* data);

#endif
