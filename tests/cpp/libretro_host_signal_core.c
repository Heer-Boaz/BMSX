#include "libretro.h"

#include <string.h>
#include <unistd.h>

void retro_set_environment(retro_environment_t callback) { (void)callback; }
void retro_set_video_refresh(retro_video_refresh_t callback) { (void)callback; }
void retro_set_audio_sample(retro_audio_sample_t callback) { (void)callback; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t callback) { (void)callback; }
void retro_set_input_poll(retro_input_poll_t callback) { (void)callback; }
void retro_set_input_state(retro_input_state_t callback) { (void)callback; }
void retro_init(void) {}
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
