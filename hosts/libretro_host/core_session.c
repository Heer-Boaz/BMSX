#include "core_session.h"

#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "host_fatal.h"
#include "keyboard_input.h"
#include "video_presenter.h"

#define BMSX_HOST_USEC_PER_SECOND 1000000ull
#define BMSX_HOST_NSEC_PER_SECOND 1000000000ull

/* retro_environment_t has no userdata. The direct host runs one core session. */
static BmsxCoreSession* g_active_session;

static void host_log(enum retro_log_level level, const char* format, ...) {
	const char* prefix = "INFO";
	switch (level) {
		case RETRO_LOG_DEBUG: prefix = "DEBUG"; break;
		case RETRO_LOG_INFO: prefix = "INFO"; break;
		case RETRO_LOG_WARN: prefix = "WARN"; break;
		case RETRO_LOG_ERROR: prefix = "ERROR"; break;
		default: break;
	}
	fprintf(stderr, "[libretro-host][%s] ", prefix);
	va_list arguments;
	va_start(arguments, format);
	vfprintf(stderr, format, arguments);
	va_end(arguments);
}

static void* read_file(const char* path, size_t* out_size) {
	int file = open(path, O_RDONLY);
	if (file < 0) {
		host_fatal("Failed to open %s: %s", path, strerror(errno));
	}
	struct stat status;
	if (fstat(file, &status) != 0) {
		host_fatal("fstat(%s) failed: %s", path, strerror(errno));
	}
	if (status.st_size <= 0) {
		host_fatal("File is empty: %s", path);
	}
	const size_t size = (size_t)status.st_size;
	void* data = malloc(size);
	if (!data) {
		host_fatal("malloc(%zu) failed", size);
	}
	size_t offset = 0;
	while (offset < size) {
		const ssize_t bytes_read = read(file, (uint8_t*)data + offset, size - offset);
		if (bytes_read < 0) {
			host_fatal("read(%s) failed: %s", path, strerror(errno));
		}
		if (bytes_read == 0) {
			host_fatal("Unexpected EOF while reading %s", path);
		}
		offset += (size_t)bytes_read;
	}
	close(file);
	*out_size = size;
	return data;
}

static void load_symbol(void* library_handle, const char* name, void* destination) {
	void* symbol = dlsym(library_handle, name);
	if (!symbol) {
		host_fatal("Missing symbol %s: %s", name, dlerror());
	}
	memcpy(destination, &symbol, sizeof(symbol));
}

void core_session_open(
		BmsxCoreSession* session,
		const char* core_path,
		const char* system_directory,
		const char* save_directory) {
	*session = (BmsxCoreSession){
		.system_directory = system_directory,
		.save_directory = save_directory,
	};
	g_active_session = session;
	session->library_handle = dlopen(core_path, RTLD_NOW | RTLD_LOCAL);
	if (!session->library_handle) {
		host_fatal("dlopen(%s) failed: %s", core_path, dlerror());
	}

	BmsxLibretroApi* api = &session->api;
	load_symbol(session->library_handle, "retro_set_environment", &api->retro_set_environment);
	load_symbol(session->library_handle, "retro_set_video_refresh", &api->retro_set_video_refresh);
	load_symbol(session->library_handle, "retro_set_audio_sample", &api->retro_set_audio_sample);
	load_symbol(session->library_handle, "retro_set_audio_sample_batch", &api->retro_set_audio_sample_batch);
	load_symbol(session->library_handle, "retro_set_input_poll", &api->retro_set_input_poll);
	load_symbol(session->library_handle, "retro_set_input_state", &api->retro_set_input_state);
	load_symbol(session->library_handle, "retro_init", &api->retro_init);
	load_symbol(session->library_handle, "retro_deinit", &api->retro_deinit);
	load_symbol(session->library_handle, "retro_api_version", &api->retro_api_version);
	load_symbol(session->library_handle, "retro_get_system_info", &api->retro_get_system_info);
	load_symbol(session->library_handle, "retro_get_system_av_info", &api->retro_get_system_av_info);
	load_symbol(session->library_handle, "retro_set_controller_port_device", &api->retro_set_controller_port_device);
	load_symbol(session->library_handle, "retro_reset", &api->retro_reset);
	load_symbol(session->library_handle, "retro_run", &api->retro_run);
	load_symbol(session->library_handle, "retro_load_game", &api->retro_load_game);
	load_symbol(session->library_handle, "retro_load_game_special", &api->retro_load_game_special);
	load_symbol(session->library_handle, "retro_unload_game", &api->retro_unload_game);
	load_symbol(session->library_handle, "retro_get_region", &api->retro_get_region);
	load_symbol(session->library_handle, "retro_serialize_size", &api->retro_serialize_size);
	load_symbol(session->library_handle, "retro_serialize", &api->retro_serialize);
	load_symbol(session->library_handle, "retro_unserialize", &api->retro_unserialize);
	load_symbol(session->library_handle, "retro_get_memory_data", &api->retro_get_memory_data);
	load_symbol(session->library_handle, "retro_get_memory_size", &api->retro_get_memory_size);
	load_symbol(session->library_handle, "retro_cheat_reset", &api->retro_cheat_reset);
	load_symbol(session->library_handle, "retro_cheat_set", &api->retro_cheat_set);

	const unsigned api_version = api->retro_api_version();
	if (api_version != RETRO_API_VERSION) {
		host_fatal(
				"Unsupported libretro API version %u (expected %u)",
				api_version,
				RETRO_API_VERSION);
	}
	api->retro_get_system_info(&session->system_info);
}

void core_session_load_content(
		BmsxCoreSession* session,
		bool no_game,
		const char* game_path) {
	bool loaded;
	if (no_game) {
		loaded = session->api.retro_load_game(NULL);
	} else if (session->system_info.need_fullpath) {
		const struct retro_game_info game_info = {
			.path = game_path,
		};
		loaded = session->api.retro_load_game(&game_info);
	} else {
		size_t game_size;
		void* game_data = read_file(game_path, &game_size);
		const struct retro_game_info game_info = {
			.path = game_path,
			.data = game_data,
			.size = game_size,
		};
		loaded = session->api.retro_load_game(&game_info);
		free(game_data);
	}
	if (!loaded) {
		host_fatal("retro_load_game failed");
	}
}

void core_session_update_timing(
		BmsxCoreSession* session,
		const struct retro_system_timing* timing) {
	session->frame_period_usec =
			(uint64_t)((double)BMSX_HOST_USEC_PER_SECOND / timing->fps + 0.5);
	session->frame_period_ns =
			(uint64_t)((double)BMSX_HOST_NSEC_PER_SECOND / timing->fps + 0.5);
}

void core_session_close(BmsxCoreSession* session) {
	bmsx_core_options_destroy(&session->options);
	dlclose(session->library_handle);
	g_active_session = NULL;
}

bool core_session_environment(unsigned command, void* data) {
	BmsxCoreSession* session = g_active_session;
	switch (command) {
		case RETRO_ENVIRONMENT_GET_LOG_INTERFACE: {
			struct retro_log_callback* callback = (struct retro_log_callback*)data;
			callback->log = host_log;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
			return true;
		case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY: {
			const char** directory = (const char**)data;
			*directory = session->system_directory;
			return true;
		}
		case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: {
			const char** directory = (const char**)data;
			*directory = session->save_directory;
			return true;
		}
		case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: {
			unsigned* version = (unsigned*)data;
			*version = 2;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
			bmsx_core_options_register_v2(
					&session->options,
					(const struct retro_core_options_v2*)data);
			return false;
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL: {
			const struct retro_core_options_v2_intl* definitions =
					(const struct retro_core_options_v2_intl*)data;
			bmsx_core_options_register_v2(&session->options, definitions->us);
			return false;
		}
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL: {
			const struct retro_core_options_intl* definitions =
					(const struct retro_core_options_intl*)data;
			bmsx_core_options_register_v1(&session->options, definitions->us);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
			bmsx_core_options_register_v1(
					&session->options,
					(const struct retro_core_option_definition*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_VARIABLES:
			bmsx_core_options_register_legacy(
					&session->options,
					(const struct retro_variable*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_VARIABLE:
			return bmsx_core_options_set_variable(
					&session->options,
					(const struct retro_variable*)data);
		case RETRO_ENVIRONMENT_GET_VARIABLE:
			return bmsx_core_options_get(
					&session->options,
					(struct retro_variable*)data);
		case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: {
			bool* updated = (bool*)data;
			*updated = bmsx_core_options_take_updated(&session->options);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_MESSAGE:
			video_presenter_post_message((const struct retro_message*)data);
			return true;
		case RETRO_ENVIRONMENT_GET_CAN_DUPE: {
			bool* can_duplicate = (bool*)data;
			*can_duplicate = true;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
			return true;
		case RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK:
			keyboard_input_set_callback(*(const struct retro_keyboard_callback*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_GEOMETRY:
			video_presenter_update_geometry((const struct retro_game_geometry*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO: {
			const struct retro_system_av_info* info =
					(const struct retro_system_av_info*)data;
			video_presenter_update_av_info(info);
			core_session_update_timing(session, &info->timing);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
			return video_presenter_accept_pixel_format(
					*(const enum retro_pixel_format*)data);
		case RETRO_ENVIRONMENT_SET_HW_RENDER:
			return video_presenter_negotiate_hw_render(
					(struct retro_hw_render_callback*)data);
		case RETRO_ENVIRONMENT_SET_FRAME_TIME_CALLBACK:
			session->frame_time = *(const struct retro_frame_time_callback*)data;
			return true;
		case RETRO_ENVIRONMENT_SHUTDOWN:
			session->shutdown_requested = true;
			return true;
		default:
			return false;
	}
}
