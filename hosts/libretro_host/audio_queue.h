#ifndef BMSX_LIBRETRO_HOST_AUDIO_QUEUE_H
#define BMSX_LIBRETRO_HOST_AUDIO_QUEUE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <pthread.h>

typedef struct BmsxAudioQueue {
	int16_t* data;
	size_t capacity_frames;
	size_t read_frame;
	size_t write_frame;
	size_t used_frames;
	size_t high_water_frames;
	unsigned channels;
	pthread_mutex_t mutex;
	pthread_cond_t can_read;
	pthread_cond_t can_write;
	bool running;
	bool track_high_water;
} BmsxAudioQueue;

void bmsx_audio_queue_init(BmsxAudioQueue* queue, size_t capacity_frames, unsigned channels,
		bool track_high_water);
void bmsx_audio_queue_destroy(BmsxAudioQueue* queue);
void bmsx_audio_queue_stop(BmsxAudioQueue* queue);
void bmsx_audio_queue_prime_silence(BmsxAudioQueue* queue);
void bmsx_audio_queue_push(BmsxAudioQueue* queue, const int16_t* data, size_t frames);
size_t bmsx_audio_queue_pop_wait(BmsxAudioQueue* queue, int16_t* out, size_t max_frames,
		size_t min_frames);
size_t bmsx_audio_queue_read(BmsxAudioQueue* queue, int16_t* out, size_t max_frames);

#endif
