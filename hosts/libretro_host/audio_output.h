#ifndef BMSX_LIBRETRO_HOST_AUDIO_OUTPUT_H
#define BMSX_LIBRETRO_HOST_AUDIO_OUTPUT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

void audio_output_open(int sample_rate, bool use_sdl, bool track_high_water);
void audio_output_close(void);
void audio_output_sample(int16_t left, int16_t right);
size_t audio_output_sample_batch(const int16_t* data, size_t frames);

#endif
