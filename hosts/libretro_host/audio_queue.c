#include "audio_queue.h"

#include <stdlib.h>
#include <string.h>

static void copy_from_queue(BmsxAudioQueue* queue, int16_t* out, size_t frames) {
	const size_t tail = queue->capacity_frames - queue->read_frame;
	const size_t first = frames < tail ? frames : tail;
	memcpy(out, queue->data + queue->read_frame * queue->channels,
			first * queue->channels * sizeof(int16_t));
	if (frames > first) {
		memcpy(out + first * queue->channels, queue->data,
				(frames - first) * queue->channels * sizeof(int16_t));
	}
	queue->read_frame = (queue->read_frame + frames) % queue->capacity_frames;
	queue->used_frames -= frames;
}

void bmsx_audio_queue_init(BmsxAudioQueue* queue, size_t capacity_frames, unsigned channels,
		bool track_high_water) {
	memset(queue, 0, sizeof(*queue));
	queue->data = malloc(capacity_frames * channels * sizeof(int16_t));
	if (!queue->data) {
		abort();
	}
	queue->capacity_frames = capacity_frames;
	queue->channels = channels;
	queue->track_high_water = track_high_water;
	pthread_mutexattr_t mutex_attributes;
	if (pthread_mutexattr_init(&mutex_attributes) != 0
			|| pthread_mutexattr_setprotocol(&mutex_attributes, PTHREAD_PRIO_INHERIT) != 0
			|| pthread_mutex_init(&queue->mutex, &mutex_attributes) != 0
			|| pthread_mutexattr_destroy(&mutex_attributes) != 0
			|| pthread_cond_init(&queue->can_read, NULL) != 0
			|| pthread_cond_init(&queue->can_write, NULL) != 0) {
		abort();
	}
	queue->running = true;
}

void bmsx_audio_queue_destroy(BmsxAudioQueue* queue) {
	free(queue->data);
	pthread_cond_destroy(&queue->can_read);
	pthread_cond_destroy(&queue->can_write);
	pthread_mutex_destroy(&queue->mutex);
	memset(queue, 0, sizeof(*queue));
}

void bmsx_audio_queue_stop(BmsxAudioQueue* queue) {
	pthread_mutex_lock(&queue->mutex);
	queue->running = false;
	pthread_cond_broadcast(&queue->can_read);
	pthread_cond_broadcast(&queue->can_write);
	pthread_mutex_unlock(&queue->mutex);
}

void bmsx_audio_queue_prime_silence(BmsxAudioQueue* queue) {
	memset(queue->data, 0, queue->capacity_frames * queue->channels * sizeof(int16_t));
	queue->used_frames = queue->capacity_frames;
	queue->high_water_frames = queue->capacity_frames;
}

void bmsx_audio_queue_push(BmsxAudioQueue* queue, const int16_t* data, size_t frames) {
	while (frames > 0u) {
		pthread_mutex_lock(&queue->mutex);
		while (queue->used_frames == queue->capacity_frames && queue->running) {
			pthread_cond_wait(&queue->can_write, &queue->mutex);
		}
		if (!queue->running) {
			pthread_mutex_unlock(&queue->mutex);
			return;
		}
		const size_t space = queue->capacity_frames - queue->used_frames;
		const size_t write_frames = frames < space ? frames : space;
		const size_t tail = queue->capacity_frames - queue->write_frame;
		const size_t first = write_frames < tail ? write_frames : tail;
		memcpy(queue->data + queue->write_frame * queue->channels, data,
				first * queue->channels * sizeof(int16_t));
		if (write_frames > first) {
			memcpy(queue->data, data + first * queue->channels,
					(write_frames - first) * queue->channels * sizeof(int16_t));
		}
		queue->write_frame = (queue->write_frame + write_frames) % queue->capacity_frames;
		queue->used_frames += write_frames;
		if (queue->track_high_water && queue->high_water_frames < queue->used_frames) {
			queue->high_water_frames = queue->used_frames;
		}
		pthread_cond_signal(&queue->can_read);
		pthread_mutex_unlock(&queue->mutex);
		data += write_frames * queue->channels;
		frames -= write_frames;
	}
}

size_t bmsx_audio_queue_pop_wait(BmsxAudioQueue* queue, int16_t* out, size_t max_frames,
		size_t min_frames) {
	pthread_mutex_lock(&queue->mutex);
	while (queue->used_frames < min_frames && queue->running) {
		pthread_cond_wait(&queue->can_read, &queue->mutex);
	}
	if (queue->used_frames == 0u && !queue->running) {
		pthread_mutex_unlock(&queue->mutex);
		return 0u;
	}
	const size_t frames = queue->used_frames < max_frames ? queue->used_frames : max_frames;
	copy_from_queue(queue, out, frames);
	pthread_cond_signal(&queue->can_write);
	pthread_mutex_unlock(&queue->mutex);
	return frames;
}

size_t bmsx_audio_queue_read(BmsxAudioQueue* queue, int16_t* out, size_t max_frames) {
	pthread_mutex_lock(&queue->mutex);
	const size_t frames = queue->used_frames < max_frames ? queue->used_frames : max_frames;
	copy_from_queue(queue, out, frames);
	pthread_cond_signal(&queue->can_write);
	pthread_mutex_unlock(&queue->mutex);
	return frames;
}
