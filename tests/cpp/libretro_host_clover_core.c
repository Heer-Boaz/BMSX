#include "bmsx_libretro.h"

#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static retro_environment_t environment;
static retro_video_refresh_t video;
static uint32_t frames;

void retro_set_environment(retro_environment_t callback) { environment = callback; }
void retro_set_video_refresh(retro_video_refresh_t callback) { video = callback; }
void retro_set_audio_sample(retro_audio_sample_t callback) { (void)callback; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t callback) { (void)callback; }
void retro_set_input_poll(retro_input_poll_t callback) { (void)callback; }
void retro_set_input_state(retro_input_state_t callback) { (void)callback; }
void retro_init(void) {
	enum retro_pixel_format format = RETRO_PIXEL_FORMAT_XRGB8888;
	environment(RETRO_ENVIRONMENT_SET_PIXEL_FORMAT, &format);
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return RETRO_API_VERSION; }
void retro_get_system_info(struct retro_system_info* info) {
	memset(info, 0, sizeof(*info));
	info->library_name = "Clover test";
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
void retro_reset(void) { frames = 0; }
void retro_run(void) {
	static bool ready;
	uint32_t pixels[16 * 16];
	for (size_t index = 0; index < 16 * 16; ++index) pixels[index] = 0x00123456u;
	video(pixels, 16, 16, 16 * sizeof(*pixels));
	++frames;
	if (!ready) {
		if (write(STDOUT_FILENO, "R", 1) != 1) _exit(1);
		ready = true;
	}
	const char* shutdown = getenv("BMSX_TEST_CLOVER_SHUTDOWN");
	if (frames == 2 && shutdown) {
		if (strcmp(shutdown, "standard") != 0) {
			BmsxShutdownReasonV1 reason = strcmp(shutdown, "suspend") == 0
				? BMSX_SHUTDOWN_REASON_SUSPEND : BMSX_SHUTDOWN_REASON_EXIT_GAME;
			environment(BMSX_ENVIRONMENT_SET_SHUTDOWN_REASON_V1, &reason);
		}
		environment(RETRO_ENVIRONMENT_SHUTDOWN, NULL);
		if (strcmp(shutdown, "exit_signal") == 0) raise(SIGTERM);
	}
}
bool retro_load_game(const struct retro_game_info* info) { (void)info; return true; }
bool retro_load_game_special(unsigned type, const struct retro_game_info* info, size_t count) {
	(void)type; (void)info; (void)count; return true;
}
void retro_unload_game(void) {}
unsigned retro_get_region(void) { return RETRO_REGION_NTSC; }
size_t retro_serialize_size(void) { return sizeof(frames); }
bool retro_serialize(void* data, size_t size) {
	if (size != sizeof(frames)) return false;
	memcpy(data, &frames, size);
	return true;
}
bool retro_unserialize(const void* data, size_t size) {
	if (size != sizeof(frames)) return false;
	memcpy(&frames, data, size);
	if (write(STDOUT_FILENO, "L", 1) != 1 || write(STDOUT_FILENO, data, size) != (ssize_t)size) _exit(1);
	return true;
}
void* retro_get_memory_data(unsigned id) { (void)id; return NULL; }
size_t retro_get_memory_size(unsigned id) { (void)id; return 0; }
void retro_cheat_reset(void) {}
void retro_cheat_set(unsigned index, bool enabled, const char* code) {
	(void)index; (void)enabled; (void)code;
}
