#include <errno.h>
#include <limits.h>
#include <dlfcn.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "libretro.h"

typedef struct LibretroCore {
	void* handle;
	void (*set_environment)(retro_environment_t);
	void (*set_video_refresh)(retro_video_refresh_t);
	void (*set_audio_sample)(retro_audio_sample_t);
	void (*set_audio_sample_batch)(retro_audio_sample_batch_t);
	void (*set_input_poll)(retro_input_poll_t);
	void (*set_input_state)(retro_input_state_t);
	void (*init)(void);
	void (*deinit)(void);
	unsigned (*api_version)(void);
	void (*get_system_info)(struct retro_system_info*);
	void (*get_system_av_info)(struct retro_system_av_info*);
	void (*set_controller_port_device)(unsigned, unsigned);
	bool (*load_game)(const struct retro_game_info*);
	void (*unload_game)(void);
	void (*run)(void);
} LibretroCore;

static const char* g_system_directory;
static unsigned g_video_frames;
static bool g_shutdown_requested;

static void RETRO_CALLCONV log_message(enum retro_log_level level, const char* format, ...) {
	(void)level;
	va_list arguments;
	va_start(arguments, format);
	vfprintf(stderr, format, arguments);
	va_end(arguments);
}

static bool environment(unsigned command, void* data) {
	switch (command) {
		case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
			((struct retro_log_callback*)data)->log = log_message;
			return true;
		case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
		case RETRO_ENVIRONMENT_SET_SERIALIZATION_QUIRKS:
		case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL:
		case RETRO_ENVIRONMENT_SET_VARIABLES:
		case RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK:
		case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO:
			return true;
		case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
		case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
			*(const char**)data = g_system_directory;
			return true;
		case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION:
			*(unsigned*)data = 2;
			return true;
		case RETRO_ENVIRONMENT_GET_VARIABLE: {
			struct retro_variable* variable = data;
			if (strcmp(variable->key, "bmsx_render_backend") == 0) {
				variable->value = "software";
				return true;
			}
			if (strcmp(variable->key, "bmsx_crt_postprocessing") == 0) {
				variable->value = "off";
				return true;
			}
			return false;
		}
		case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
			*(bool*)data = false;
			return true;
		case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
			return *(const enum retro_pixel_format*)data == RETRO_PIXEL_FORMAT_XRGB8888;
		case RETRO_ENVIRONMENT_SET_GEOMETRY:
			return true;
		case RETRO_ENVIRONMENT_SET_MESSAGE:
			fprintf(stderr, "[core message] %s\n", ((const struct retro_message*)data)->msg);
			return true;
		case RETRO_ENVIRONMENT_SHUTDOWN:
			g_shutdown_requested = true;
			return true;
		default:
			return false;
	}
}

static void video_refresh(const void* data, unsigned width, unsigned height, size_t pitch) {
	if (data != NULL && width != 0 && height != 0 && pitch != 0) {
		g_video_frames += 1;
	}
}

static void audio_sample(int16_t left, int16_t right) {
	(void)left;
	(void)right;
}

static size_t audio_sample_batch(const int16_t* data, size_t frames) {
	(void)data;
	return frames;
}

static void input_poll(void) {
}

static int16_t input_state(unsigned port, unsigned device, unsigned index, unsigned id) {
	(void)port;
	(void)device;
	(void)index;
	(void)id;
	return 0;
}

static void load_symbol(void* handle, const char* name, void* output) {
	void* symbol = dlsym(handle, name);
	if (symbol == NULL) {
		fprintf(stderr, "missing libretro symbol %s: %s\n", name, dlerror());
		exit(1);
	}
	memcpy(output, &symbol, sizeof(symbol));
}

static void load_core(LibretroCore* core, const char* path) {
	memset(core, 0, sizeof(*core));
	core->handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
	if (core->handle == NULL) {
		fprintf(stderr, "dlopen(%s) failed: %s\n", path, dlerror());
		exit(1);
	}
	load_symbol(core->handle, "retro_set_environment", &core->set_environment);
	load_symbol(core->handle, "retro_set_video_refresh", &core->set_video_refresh);
	load_symbol(core->handle, "retro_set_audio_sample", &core->set_audio_sample);
	load_symbol(core->handle, "retro_set_audio_sample_batch", &core->set_audio_sample_batch);
	load_symbol(core->handle, "retro_set_input_poll", &core->set_input_poll);
	load_symbol(core->handle, "retro_set_input_state", &core->set_input_state);
	load_symbol(core->handle, "retro_init", &core->init);
	load_symbol(core->handle, "retro_deinit", &core->deinit);
	load_symbol(core->handle, "retro_api_version", &core->api_version);
	load_symbol(core->handle, "retro_get_system_info", &core->get_system_info);
	load_symbol(core->handle, "retro_get_system_av_info", &core->get_system_av_info);
	load_symbol(core->handle, "retro_set_controller_port_device", &core->set_controller_port_device);
	load_symbol(core->handle, "retro_load_game", &core->load_game);
	load_symbol(core->handle, "retro_unload_game", &core->unload_game);
	load_symbol(core->handle, "retro_run", &core->run);
}

int main(int argc, char** argv) {
	if (argc != 5) {
		fprintf(stderr, "usage: %s <core> <system-dir> <rom> <frames>\n", argv[0]);
		return 1;
	}

	const char* core_path = argv[1];
	g_system_directory = argv[2];
	const char* rom_path = argv[3];
	if (argv[4][0] < '0' || argv[4][0] > '9') {
		fprintf(stderr, "frames must be a positive integer\n");
		return 1;
	}
	errno = 0;
	char* frame_count_end = NULL;
	const unsigned long frame_count = strtoul(argv[4], &frame_count_end, 10);
	if (errno != 0 || frame_count_end == argv[4] || *frame_count_end != '\0' ||
			frame_count == 0 || frame_count > UINT_MAX) {
		fprintf(stderr, "frames must be a positive integer\n");
		return 1;
	}
	const unsigned frames = (unsigned)frame_count;

	LibretroCore core;
	load_core(&core, core_path);
	core.set_environment(environment);
	core.set_video_refresh(video_refresh);
	core.set_audio_sample(audio_sample);
	core.set_audio_sample_batch(audio_sample_batch);
	core.set_input_poll(input_poll);
	core.set_input_state(input_state);

	if (core.api_version() != RETRO_API_VERSION) {
		fprintf(stderr, "unexpected libretro API version\n");
		return 1;
	}
	struct retro_system_info system_info;
	core.get_system_info(&system_info);
	fprintf(stderr, "[snesmini smoke] core=%s %s\n", system_info.library_name, system_info.library_version);

	core.init();
	core.set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
	const struct retro_game_info game = {
		.path = rom_path,
	};
	if (!core.load_game(&game)) {
		fprintf(stderr, "retro_load_game failed\n");
		return 1;
	}

	struct retro_system_av_info av_info;
	core.get_system_av_info(&av_info);
	fprintf(
		stderr,
		"[snesmini smoke] video=%ux%u fps=%.2f\n",
		av_info.geometry.base_width,
		av_info.geometry.base_height,
		av_info.timing.fps);
	for (unsigned frame = 0; frame < frames && !g_shutdown_requested; frame += 1) {
		core.run();
	}
	if (g_shutdown_requested || g_video_frames != frames) {
		fprintf(stderr, "core completed %u of %u requested software frames\n", g_video_frames, frames);
		return 1;
	}

	core.unload_game();
	core.deinit();
	dlclose(core.handle);
	fprintf(stderr, "[snesmini smoke] completed %u frames, received %u video frames\n", frames, g_video_frames);
	return 0;
}
