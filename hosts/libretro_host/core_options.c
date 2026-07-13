#include "core_options.h"

#include <stdlib.h>
#include <string.h>

static char* copy_string(const char* value, size_t length) {
	char* copy = malloc(length + 1u);
	if (!copy) {
		abort();
	}
	memcpy(copy, value, length);
	copy[length] = '\0';
	return copy;
}

static BmsxCoreOptionEntry* find_option(BmsxCoreOptions* options, const char* key) {
	for (size_t index = 0; index < options->count; index += 1u) {
		if (strcmp(options->entries[index].key, key) == 0) {
			return &options->entries[index];
		}
	}
	return NULL;
}

static BmsxCoreOptionEntry* append_option(BmsxCoreOptions* options, const char* key) {
	if (options->count == options->capacity) {
		const size_t capacity = options->capacity ? options->capacity * 2u : 16u;
		BmsxCoreOptionEntry* entries = realloc(options->entries, capacity * sizeof(*entries));
		if (!entries) {
			abort();
		}
		options->entries = entries;
		options->capacity = capacity;
	}
	BmsxCoreOptionEntry* entry = &options->entries[options->count++];
	memset(entry, 0, sizeof(*entry));
	entry->key = copy_string(key, strlen(key));
	return entry;
}

static BmsxCoreOptionEntry* find_or_append_option(BmsxCoreOptions* options, const char* key) {
	BmsxCoreOptionEntry* entry = find_option(options, key);
	return entry ? entry : append_option(options, key);
}

static void clear_allowed_values(BmsxCoreOptionEntry* entry) {
	for (size_t index = 0; index < entry->allowed_value_count; index += 1u) {
		free(entry->allowed_values[index]);
	}
	free(entry->allowed_values);
	entry->allowed_values = NULL;
	entry->allowed_value_count = 0u;
}

static void destroy_option(BmsxCoreOptionEntry* entry) {
	free(entry->key);
	free(entry->value);
	clear_allowed_values(entry);
}

static void begin_registration(BmsxCoreOptions* options) {
	for (size_t index = 0; index < options->count; index += 1u) {
		BmsxCoreOptionEntry* entry = &options->entries[index];
		clear_allowed_values(entry);
		entry->registered = false;
	}
}

static void finish_registration(BmsxCoreOptions* options) {
	size_t retained_count = 0u;
	for (size_t index = 0; index < options->count; index += 1u) {
		BmsxCoreOptionEntry* entry = &options->entries[index];
		if (!entry->registered && !entry->overridden) {
			destroy_option(entry);
			continue;
		}
		if (retained_count != index) {
			options->entries[retained_count] = *entry;
		}
		retained_count += 1u;
	}
	options->count = retained_count;
}

static void append_allowed_value(BmsxCoreOptionEntry* entry, const char* value, size_t length) {
	char** allowed_values = realloc(entry->allowed_values,
			(entry->allowed_value_count + 1u) * sizeof(*allowed_values));
	if (!allowed_values) {
		abort();
	}
	entry->allowed_values = allowed_values;
	entry->allowed_values[entry->allowed_value_count++] = copy_string(value, length);
}

static void register_option(BmsxCoreOptions* options, const char* key, const char* default_value,
		const struct retro_core_option_value* values) {
	BmsxCoreOptionEntry* entry = find_or_append_option(options, key);
	clear_allowed_values(entry);
	for (const struct retro_core_option_value* value = values; value->value; value += 1) {
		append_allowed_value(entry, value->value, strlen(value->value));
	}
	bool current_value_allowed = false;
	for (size_t index = 0; entry->value && index < entry->allowed_value_count; index += 1u) {
		if (strcmp(entry->value, entry->allowed_values[index]) == 0) {
			current_value_allowed = true;
			break;
		}
	}
	if (!current_value_allowed) {
		free(entry->value);
		entry->value = copy_string(default_value, strlen(default_value));
	}
	entry->registered = true;
}

void bmsx_core_options_destroy(BmsxCoreOptions* options) {
	for (size_t index = 0; index < options->count; index += 1u) {
		destroy_option(&options->entries[index]);
	}
	free(options->entries);
	memset(options, 0, sizeof(*options));
}

void bmsx_core_options_override(BmsxCoreOptions* options, const char* key, const char* value) {
	BmsxCoreOptionEntry* entry = find_or_append_option(options, key);
	char* replacement = copy_string(value, strlen(value));
	free(entry->value);
	entry->value = replacement;
	entry->overridden = true;
}

void bmsx_core_options_register_v2(BmsxCoreOptions* options, const struct retro_core_options_v2* core_options) {
	begin_registration(options);
	if (!core_options) {
		finish_registration(options);
		return;
	}
	for (const struct retro_core_option_v2_definition* definition = core_options->definitions;
			definition->key; definition += 1) {
		register_option(options, definition->key, definition->default_value, definition->values);
	}
	finish_registration(options);
}

void bmsx_core_options_register_v1(BmsxCoreOptions* options, const struct retro_core_option_definition* definitions) {
	begin_registration(options);
	if (!definitions) {
		finish_registration(options);
		return;
	}
	for (const struct retro_core_option_definition* definition = definitions; definition->key; definition += 1) {
		register_option(options, definition->key, definition->default_value, definition->values);
	}
	finish_registration(options);
}

void bmsx_core_options_register_legacy(BmsxCoreOptions* options, const struct retro_variable* variables) {
	begin_registration(options);
	if (!variables) {
		finish_registration(options);
		return;
	}
	for (const struct retro_variable* variable = variables; variable->key; variable += 1) {
		BmsxCoreOptionEntry* entry = find_or_append_option(options, variable->key);
		clear_allowed_values(entry);
		const char* value = strchr(variable->value, ';') + 1;
		while (*value == ' ') {
			value += 1;
		}
		const char* default_value = value;
		const char* value_end = strchr(value, '|');
		const size_t default_length = value_end ? (size_t)(value_end - value) : strlen(value);
		if (!entry->value) {
			entry->value = copy_string(value, default_length);
		}
		for (;;) {
			value_end = strchr(value, '|');
			append_allowed_value(entry, value, value_end ? (size_t)(value_end - value) : strlen(value));
			if (!value_end) {
				break;
			}
			value = value_end + 1;
		}
		bool current_value_allowed = false;
		for (size_t index = 0; index < entry->allowed_value_count; index += 1u) {
			if (strcmp(entry->value, entry->allowed_values[index]) == 0) {
				current_value_allowed = true;
				break;
			}
		}
		if (!current_value_allowed) {
			free(entry->value);
			entry->value = copy_string(default_value, default_length);
		}
		entry->registered = true;
	}
	finish_registration(options);
}

bool bmsx_core_options_set_variable(BmsxCoreOptions* options, const struct retro_variable* variable) {
	if (!variable) {
		return true;
	}
	if (!variable->key || !variable->key[0] || !variable->value || !variable->value[0]) {
		return false;
	}
	BmsxCoreOptionEntry* entry = find_option(options, variable->key);
	if (!entry || !entry->registered) {
		return false;
	}
	for (size_t index = 0; index < entry->allowed_value_count; index += 1u) {
		if (strcmp(entry->allowed_values[index], variable->value) == 0) {
			if (strcmp(entry->value, variable->value) != 0) {
				char* replacement = copy_string(variable->value, strlen(variable->value));
				free(entry->value);
				entry->value = replacement;
				options->updated = true;
			}
			return true;
		}
	}
	return false;
}

bool bmsx_core_options_get(const BmsxCoreOptions* options, struct retro_variable* variable) {
	if (!variable) {
		return true;
	}
	variable->value = NULL;
	for (size_t index = 0; index < options->count; index += 1u) {
		if (options->entries[index].registered && strcmp(options->entries[index].key, variable->key) == 0) {
			variable->value = options->entries[index].value;
			return true;
		}
	}
	return true;
}

bool bmsx_core_options_take_updated(BmsxCoreOptions* options) {
	const bool updated = options->updated;
	options->updated = false;
	return updated;
}
