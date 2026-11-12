#include "clover.h"

#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

#include "host_fatal.h"
#include "video_presenter.h"

void clover_read_arguments(BmsxClover* clover, int argc, char** argv) {
	for (int index = 0; index < argc; ++index) {
		const char* option = argv[index];
		const char** destination = NULL;
		if (strcmp(option, "--rollback-input-dir") == 0) destination = &clover->input_directory;
		else if (strcmp(option, "--rollback-output-dir") == 0) destination = &clover->output_directory;
		else if (strcmp(option, "--save-screenshot-on-quit") == 0) destination = &clover->screenshot_path;
		else if (strcmp(option, "--load-time-path") == 0) destination = &clover->input_time_path;
		else if (strcmp(option, "--save-time-path") == 0) destination = &clover->output_time_path;
		else if (strcmp(option, "--replay-inputs") == 0) clover->demo = true;
		else if (strcmp(option, "--rollback-mode") == 0) {
			if (++index == argc) host_fatal("Clover option %s requires a value", option);
			clover->replay = strcmp(argv[index], "replay") == 0;
		}
		if (destination) {
			if (++index == argc) host_fatal("Clover option %s requires a value", option);
			*destination = argv[index];
		}
	}
}

bool clover_load_state(BmsxClover* clover, const BmsxLibretroApi* core) {
	if (clover->demo) return true;
	if (!clover->input_directory) return !clover->input_time_path;
	if (!clover->input_time_path) return false;
	char path[PATH_MAX];
	if (snprintf(path, sizeof(path), "%s/savestate", clover->input_directory) >= (int)sizeof(path)) return false;
	gzFile file = gzopen(path, "rb");
	if (!file) return false;
	const size_t size = core->retro_serialize_size();
	void* state = malloc(size);
	if (!state) { gzclose(file); return false; }
	const int read_bytes = gzread(file, state, (unsigned)size);
	unsigned char extra;
	const int trailing_bytes = gzread(file, &extra, 1);
	const bool compressed = gzdirect(file) == 0;
	const int close_result = gzclose(file);
	const bool loaded = read_bytes == (int)size && trailing_bytes == 0 && compressed && close_result == Z_OK
			&& core->retro_unserialize(state, size);
	free(state);
	if (!loaded) return false;
	FILE* time_file = fopen(clover->input_time_path, "r");
	if (!time_file) return false;
	unsigned long long seconds;
	const bool read_time = fscanf(time_file, "%llu", &seconds) == 1;
	fclose(time_file);
	if (!read_time) return false;
	clover->previous_seconds = (uint64_t)seconds;
	return true;
}

bool clover_save_state(const BmsxClover* clover, const BmsxLibretroApi* core, uint64_t elapsed_seconds) {
	if (clover->demo) return true;
	if (!clover->output_directory) return !clover->output_time_path && !clover->screenshot_path;
	if (!clover->output_time_path || !clover->screenshot_path) return false;
	char path[PATH_MAX], temporary[PATH_MAX];
	if (snprintf(path, sizeof(path), "%s/savestate", clover->output_directory) >= (int)sizeof(path) ||
			snprintf(temporary, sizeof(temporary), "%s/savestate.tmp", clover->output_directory) >= (int)sizeof(temporary)) return false;
	const size_t size = core->retro_serialize_size();
	void* state = malloc(size);
	if (!state) return false;
	if (!core->retro_serialize(state, size)) { free(state); return false; }
	gzFile file = gzopen(temporary, "wb1");
	if (!file) { free(state); return false; }
	const int written = gzwrite(file, state, (unsigned)size);
	const int close_result = gzclose(file);
	free(state);
	if (written != (int)size || close_result != Z_OK || rename(temporary, path) != 0) return false;
	FILE* time_file = fopen(clover->output_time_path, "w");
	if (!time_file) return false;
	const bool wrote_time = fprintf(time_file, "%llu", (unsigned long long)(clover->previous_seconds + elapsed_seconds)) > 0;
	const bool closed = fclose(time_file) == 0;
	if (!wrote_time || !closed) return false;
	return video_presenter_save_screenshot(clover->screenshot_path);
}
