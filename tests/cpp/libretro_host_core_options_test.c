#include "core_options.h"

#include <stdio.h>
#include <string.h>

#define CHECK(condition) do { \
	if (!(condition)) { \
		fprintf(stderr, "CHECK failed at %s:%d: %s\n", __FILE__, __LINE__, #condition); \
		return 1; \
	} \
} while (0)

static const char* option_value(BmsxCoreOptions* options, const char* key) {
	struct retro_variable variable = {key, NULL};
	bmsx_core_options_get(options, &variable);
	return variable.value;
}

int main(void) {
	BmsxCoreOptions options = {0};
	CHECK(bmsx_core_options_get(&options, NULL));
	CHECK(option_value(&options, "missing") == NULL);
	CHECK(bmsx_core_options_set_variable(&options, NULL));

	bmsx_core_options_override(&options, "video_backend", "gles2");
	CHECK(option_value(&options, "video_backend") == NULL);

	char backend_key[] = "video_backend";
	char software_value[] = "software";
	char gles2_value[] = "gles2";
	struct retro_core_option_v2_definition definitions[] = {
		{
			.key = backend_key,
			.values = {
				{software_value, "Software"},
				{gles2_value, "GLES2"},
			},
			.default_value = software_value,
		},
		{
			.key = "dither",
			.values = {
				{"off", "Off"},
				{"rgb565", "RGB565"},
			},
			.default_value = "rgb565",
		},
		{0},
	};
	struct retro_core_options_v2 core_options = {
		.definitions = definitions,
	};
	bmsx_core_options_register_v2(&options, &core_options);
	memset(backend_key, 'x', strlen(backend_key));
	memset(software_value, 'x', strlen(software_value));
	memset(gles2_value, 'x', strlen(gles2_value));
	CHECK(strcmp(option_value(&options, "video_backend"), "gles2") == 0);
	CHECK(strcmp(option_value(&options, "dither"), "rgb565") == 0);
	CHECK(!bmsx_core_options_take_updated(&options));

	const struct retro_variable unknown = {"missing", "off"};
	const struct retro_variable invalid = {"dither", "rgb777"};
	const struct retro_variable empty_key = {"", "off"};
	const struct retro_variable empty_value = {"dither", ""};
	CHECK(!bmsx_core_options_set_variable(&options, &unknown));
	CHECK(!bmsx_core_options_set_variable(&options, &invalid));
	CHECK(!bmsx_core_options_set_variable(&options, &empty_key));
	CHECK(!bmsx_core_options_set_variable(&options, &empty_value));
	CHECK(!bmsx_core_options_take_updated(&options));

	const struct retro_variable valid = {"dither", "off"};
	CHECK(bmsx_core_options_set_variable(&options, &valid));
	CHECK(strcmp(option_value(&options, "dither"), "off") == 0);
	CHECK(bmsx_core_options_take_updated(&options));
	CHECK(bmsx_core_options_set_variable(&options, &valid));
	CHECK(!bmsx_core_options_take_updated(&options));
	bmsx_core_options_register_v2(&options, &core_options);
	CHECK(strcmp(option_value(&options, "dither"), "off") == 0);

	bmsx_core_options_register_v2(&options, NULL);
	CHECK(option_value(&options, "video_backend") == NULL);
	CHECK(option_value(&options, "dither") == NULL);

	const struct retro_variable legacy[] = {
		{"video_backend", "Video Backend; software|gles2"},
		{"crt", "CRT; on|off"},
		{NULL, NULL},
	};
	bmsx_core_options_register_legacy(&options, legacy);
	CHECK(strcmp(option_value(&options, "video_backend"), "gles2") == 0);
	CHECK(strcmp(option_value(&options, "crt"), "on") == 0);
	const struct retro_variable legacy_valid = {"crt", "off"};
	CHECK(bmsx_core_options_set_variable(&options, &legacy_valid));
	CHECK(bmsx_core_options_take_updated(&options));

	bmsx_core_options_destroy(&options);
	return 0;
}
