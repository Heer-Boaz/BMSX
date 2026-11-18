#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "core_session.h"

typedef struct BmsxClover {
	const char* input_directory;
	const char* output_directory;
	const char* screenshot_path;
	const char* input_time_path;
	const char* output_time_path;
	uint64_t previous_seconds;
	bool replay;
	bool demo;
} BmsxClover;

void clover_read_arguments(BmsxClover* clover, int argc, char** argv);
bool clover_load_state(BmsxClover* clover, const BmsxLibretroApi* core);
bool clover_save_state(const BmsxClover* clover, const BmsxLibretroApi* core, uint64_t elapsed_seconds);
