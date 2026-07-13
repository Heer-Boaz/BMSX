#include "audio_queue.h"

#include <stdio.h>
#include <string.h>

#define CHECK(condition) do { \
	if (!(condition)) { \
		fprintf(stderr, "CHECK failed at %s:%d: %s\n", __FILE__, __LINE__, #condition); \
		return 1; \
	} \
} while (0)

int main(void) {
	BmsxAudioQueue queue;
	bmsx_audio_queue_init(&queue, 4u, 2u, true);
	const int16_t first_frames[] = {1, 2, 3, 4, 5, 6};
	bmsx_audio_queue_push(&queue, first_frames, 3u);
	CHECK(queue.used_frames == 3u);

	int16_t output[8] = {0};
	CHECK(bmsx_audio_queue_read(&queue, output, 2u) == 2u);
	CHECK(memcmp(output, first_frames, 4u * sizeof(int16_t)) == 0);

	const int16_t wrapped_frames[] = {7, 8, 9, 10, 11, 12};
	bmsx_audio_queue_push(&queue, wrapped_frames, 3u);
	CHECK(queue.used_frames == 4u);
	CHECK(queue.high_water_frames == 4u);
	CHECK(bmsx_audio_queue_pop_wait(&queue, output, 4u, 4u) == 4u);
	const int16_t expected[] = {5, 6, 7, 8, 9, 10, 11, 12};
	CHECK(memcmp(output, expected, sizeof(expected)) == 0);

	bmsx_audio_queue_prime_silence(&queue);
	memset(output, 0xff, sizeof(output));
	CHECK(bmsx_audio_queue_read(&queue, output, 4u) == 4u);
	const int16_t silence[8] = {0};
	CHECK(memcmp(output, silence, sizeof(silence)) == 0);

	bmsx_audio_queue_stop(&queue);
	bmsx_audio_queue_push(&queue, first_frames, 1u);
	CHECK(bmsx_audio_queue_pop_wait(&queue, output, 4u, 1u) == 0u);
	bmsx_audio_queue_destroy(&queue);
	return 0;
}
