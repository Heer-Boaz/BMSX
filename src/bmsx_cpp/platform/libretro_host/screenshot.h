#pragma once

#include <stdbool.h>
#include <stdint.h>

void screenshot_set_output_dir(const char* output_dir);
const char* screenshot_get_output_dir(void);

bool screenshot_save_png(const char* filename, uint32_t width, uint32_t height, const uint8_t* rgba_data);
