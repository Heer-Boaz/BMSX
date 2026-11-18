#include "audio_output.h"

#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <sched.h>
#include <sound/asound.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>

#define CHECK(condition) do { \
	if (!(condition)) { \
		fprintf(stderr, "CHECK failed at %s:%d: %s\n", __FILE__, __LINE__, #condition); \
		abort(); \
	} \
} while (0)

enum { kDeviceFd = 37, kChannels = 2, kPeriodFrames = 1024, kBufferFrames = 4096 };

static pthread_mutex_t device_mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t device_changed = PTHREAD_COND_INITIALIZER;
static struct {
	unsigned rate;
	unsigned software_parameters;
	unsigned prepares;
	unsigned drops;
	unsigned drains;
	unsigned closes;
	unsigned underruns;
	unsigned auto_starts;
	int next_write_error;
	bool prepared;
	bool running;
	size_t queued_frames;
	const void* retry_buffer;
	size_t retry_frames;
	struct snd_pcm_sw_params software;
	size_t written_frames;
	int16_t samples[kPeriodFrames * kChannels * 6];
} device;

int __wrap_open(const char* path, int flags, ...) {
	CHECK(strcmp(path, "/dev/snd/pcmC0D0p") == 0);
	CHECK(flags == O_WRONLY);
	return kDeviceFd;
}

int __wrap_close(int fd) {
	CHECK(fd == kDeviceFd);
	device.closes += 1u;
	return 0;
}

int __wrap_pthread_setschedparam(pthread_t thread, int policy, const struct sched_param* parameters) {
	CHECK(pthread_equal(thread, pthread_self()));
	CHECK(policy == SCHED_FIFO);
	CHECK(parameters->sched_priority == 20);
	return EPERM;
}

int __wrap_ioctl(int fd, unsigned long request, ...) {
	CHECK(fd == kDeviceFd);
	va_list arguments;
	va_start(arguments, request);
	pthread_mutex_lock(&device_mutex);
	int result = 0;
	switch (request) {
		case SNDRV_PCM_IOCTL_HW_REFINE:
		case SNDRV_PCM_IOCTL_HW_PARAMS: {
			struct snd_pcm_hw_params* hardware = va_arg(arguments, struct snd_pcm_hw_params*);
			CHECK(hardware->intervals[SNDRV_PCM_HW_PARAM_RATE - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL].min == device.rate);
			CHECK(hardware->intervals[SNDRV_PCM_HW_PARAM_RATE - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL].max == device.rate);
			CHECK(hardware->intervals[SNDRV_PCM_HW_PARAM_CHANNELS - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL].min == kChannels);
			CHECK(hardware->intervals[SNDRV_PCM_HW_PARAM_PERIOD_SIZE - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL].min == kPeriodFrames);
			CHECK(hardware->intervals[SNDRV_PCM_HW_PARAM_PERIOD_SIZE - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL].max == kPeriodFrames);
			CHECK(hardware->intervals[SNDRV_PCM_HW_PARAM_PERIODS - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL].min == 4u);
			CHECK(hardware->intervals[SNDRV_PCM_HW_PARAM_PERIODS - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL].max == 4u);
			struct snd_interval* buffer = &hardware->intervals[SNDRV_PCM_HW_PARAM_BUFFER_SIZE - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL];
			buffer->min = buffer->max = kBufferFrames;
			buffer->integer = 1u;
			break;
		}
		case SNDRV_PCM_IOCTL_SW_PARAMS:
			device.software = *va_arg(arguments, struct snd_pcm_sw_params*);
			device.software_parameters += 1u;
			// Configure the real PCM publication boundary, not a second test policy.
			CHECK(device.software.start_threshold == 2048u);
			CHECK(device.software.stop_threshold == kBufferFrames);
			CHECK(device.software.avail_min == 1u);
			CHECK(device.software.silence_threshold == 0u);
			CHECK(device.software.silence_size == 0u);
			break;
		case SNDRV_PCM_IOCTL_PREPARE:
			CHECK(device.software_parameters == 1u);
			CHECK(device.software.start_threshold == 2048u);
			CHECK(!device.prepared);
			device.prepared = true;
			device.running = false;
			device.queued_frames = 0u;
			device.prepares += 1u;
			break;
		case SNDRV_PCM_IOCTL_DROP:
			device.drops += 1u;
			device.prepared = device.running = false;
			device.queued_frames = 0u;
			break;
		case SNDRV_PCM_IOCTL_DRAIN:
			CHECK(device.running);
			device.drains += 1u;
			device.running = false;
			device.queued_frames = 0u;
			break;
		case SNDRV_PCM_IOCTL_WRITEI_FRAMES: {
			struct snd_xferi* transfer = va_arg(arguments, struct snd_xferi*);
			CHECK(device.prepared);
			CHECK(transfer->frames == kPeriodFrames);
			if (device.next_write_error != 0) {
				device.retry_buffer = transfer->buf;
				device.retry_frames = transfer->frames;
				device.prepared = device.running = false;
				device.underruns += 1u;
				errno = device.next_write_error;
				device.next_write_error = 0;
				result = -1;
				break;
			}
			if (device.retry_buffer != NULL) {
				CHECK(transfer->buf == device.retry_buffer && transfer->frames == device.retry_frames);
				device.retry_buffer = NULL;
			}
			CHECK((device.written_frames + transfer->frames) * kChannels <= sizeof(device.samples) / sizeof(device.samples[0]));
			memcpy(device.samples + device.written_frames * kChannels, transfer->buf,
				transfer->frames * kChannels * sizeof(int16_t));
			device.written_frames += transfer->frames;
			device.queued_frames += transfer->frames;
			// The PCM kernel owns automatic start at the installed threshold.
			if (!device.running && device.queued_frames >= device.software.start_threshold) {
				device.running = true;
				device.auto_starts += 1u;
			}
			transfer->result = transfer->frames;
			pthread_cond_signal(&device_changed);
			break;
		}
		default:
			// In particular, playback must not be explicitly started after one write.
			CHECK(false);
	}
	pthread_mutex_unlock(&device_mutex);
	va_end(arguments);
	return result;
}

static void publish_period(unsigned index, unsigned expected_starts, size_t expected_queued) {
	int16_t samples[kPeriodFrames * kChannels];
	for (size_t sample = 0u; sample < sizeof(samples) / sizeof(samples[0]); ++sample) {
		samples[sample] = (int16_t)(index * kPeriodFrames * kChannels + sample);
	}
	CHECK(audio_output_sample_batch(samples, kPeriodFrames) == kPeriodFrames);
	struct timespec deadline;
	CHECK(clock_gettime(CLOCK_REALTIME, &deadline) == 0);
	deadline.tv_sec += 5;
	pthread_mutex_lock(&device_mutex);
	while (device.written_frames < (index + 1u) * kPeriodFrames) {
		CHECK(pthread_cond_timedwait(&device_changed, &device_mutex, &deadline) == 0);
	}
	CHECK(memcmp(device.samples + index * kPeriodFrames * kChannels, samples, sizeof(samples)) == 0);
	CHECK(device.auto_starts == expected_starts);
	CHECK(device.queued_frames == expected_queued);
	CHECK(device.running == (expected_queued == 2u * kPeriodFrames));
	pthread_mutex_unlock(&device_mutex);
}

static void run_stream(unsigned rate, int recovery_error) {
	memset(&device, 0, sizeof(device));
	device.rate = rate;
	audio_output_open((int)rate, false, false);
	CHECK(device.software_parameters == 1u);
	CHECK(device.prepares == 1u);
	// One period is published promptly but cannot start the PCM. The second
	// reaches half the unchanged hardware buffer without waiting for all four.
	publish_period(0u, 0u, kPeriodFrames);
	publish_period(1u, 1u, 2u * kPeriodFrames);

	audio_output_set_suspended(true);
	CHECK(device.drops == 1u);
	int16_t discarded[kPeriodFrames * kChannels] = {0};
	CHECK(audio_output_sample_batch(discarded, kPeriodFrames) == kPeriodFrames);
	CHECK(device.written_frames == 2u * kPeriodFrames);
	audio_output_set_suspended(false);
	CHECK(device.prepares == 2u);
	publish_period(2u, 1u, kPeriodFrames);
	publish_period(3u, 2u, 2u * kPeriodFrames);

	pthread_mutex_lock(&device_mutex);
	device.next_write_error = recovery_error;
	pthread_mutex_unlock(&device_mutex);
	publish_period(4u, 2u, kPeriodFrames);
	publish_period(5u, 3u, 2u * kPeriodFrames);
	CHECK(audio_output_alsa_underruns() == 1u);
	CHECK(device.underruns == 1u);
	CHECK(device.prepares == 3u);
	CHECK(device.software_parameters == 1u);
	audio_output_close();
	CHECK(device.drains == 1u);
	CHECK(device.closes == 1u);
	CHECK(device.written_frames == 6u * kPeriodFrames);
	CHECK(device.auto_starts == 3u);
}

int main(void) {
	run_stream(48000u, EPIPE);
	run_stream(44100u, EPIPE);
	run_stream(48000u, ESTRPIPE);
	run_stream(44100u, ESTRPIPE);
	return 0;
}
