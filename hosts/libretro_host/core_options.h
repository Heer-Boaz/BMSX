#ifndef BMSX_LIBRETRO_HOST_CORE_OPTIONS_H
#define BMSX_LIBRETRO_HOST_CORE_OPTIONS_H

#include <stdbool.h>
#include <stddef.h>

#include "libretro.h"

typedef struct BmsxCoreOptionEntry {
	char* key;
	char* value;
	char** allowed_values;
	size_t allowed_value_count;
	bool registered;
	bool overridden;
} BmsxCoreOptionEntry;

typedef struct BmsxCoreOptions {
	BmsxCoreOptionEntry* entries;
	size_t count;
	size_t capacity;
	bool updated;
} BmsxCoreOptions;

void bmsx_core_options_destroy(BmsxCoreOptions* options);
void bmsx_core_options_override(BmsxCoreOptions* options, const char* key, const char* value);
void bmsx_core_options_register_v2(BmsxCoreOptions* options, const struct retro_core_options_v2* definitions);
void bmsx_core_options_register_v1(BmsxCoreOptions* options, const struct retro_core_option_definition* definitions);
void bmsx_core_options_register_legacy(BmsxCoreOptions* options, const struct retro_variable* variables);
bool bmsx_core_options_set_variable(BmsxCoreOptions* options, const struct retro_variable* variable);
bool bmsx_core_options_get(const BmsxCoreOptions* options, struct retro_variable* variable);
bool bmsx_core_options_take_updated(BmsxCoreOptions* options);

#endif
