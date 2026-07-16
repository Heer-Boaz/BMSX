#include "audio_output.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <pthread.h>
#include <sched.h>
#include <sound/asound.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

#ifdef BMSX_LIBRETRO_HOST_SDL
#include <SDL.h>
#endif

#include "audio_queue.h"
#include "host_fatal.h"

enum {
	kAlsaPeriodFrames = 1024,
	kAlsaPeriodCount = 4,
	kAlsaPrimePeriods = 4,
	kSdlBufferFrames = 1024,
	kSampleBufferFrames = 512,
	kAudioThreadPriority = 20,
	kAudioChannels = 2,
};

static const char kAlsaDevice[] = "/dev/snd/pcmC0D0p";

typedef struct AudioOutput {
	int fd;
	int sample_rate;
	unsigned period_frames;
	unsigned period_count;
	unsigned buffer_frames;
	bool prepared;
	unsigned underruns;
	size_t sdl_underrun_frames;
	BmsxAudioQueue queue;
	pthread_t thread;
	int16_t* thread_buffer;
	size_t thread_buffer_frames;
	int16_t sample_buffer[kSampleBufferFrames * kAudioChannels];
	size_t sample_buffer_frames;
	bool active;
	bool use_sdl;
	bool track_high_water;
#ifdef BMSX_LIBRETRO_HOST_SDL
	SDL_AudioDeviceID sdl_device;
#endif
} AudioOutput;

static AudioOutput g_audio = {
	.fd = -1,
};

static void write_alsa_frames(const int16_t* data, size_t frames) {
	size_t remaining = frames;
	const int16_t* source = data;
	while (remaining > 0) {
		struct snd_xferi transfer;
		transfer.buf = (void*)source;
		transfer.frames = remaining;
		transfer.result = 0;
		if (!g_audio.prepared) {
			if (ioctl(g_audio.fd, SNDRV_PCM_IOCTL_PREPARE) != 0) {
				if (errno == EINTR) {
					continue;
				}
				host_fatal("SNDRV_PCM_IOCTL_PREPARE failed: %s", strerror(errno));
			}
			g_audio.prepared = true;
		}
		if (ioctl(g_audio.fd, SNDRV_PCM_IOCTL_WRITEI_FRAMES, &transfer) != 0) {
			if (errno == EINTR) {
				continue;
			}
			if (errno == EPIPE || errno == ESTRPIPE) {
				g_audio.prepared = false;
				g_audio.underruns += 1u;
				continue;
			}
			host_fatal("SNDRV_PCM_IOCTL_WRITEI_FRAMES failed: %s", strerror(errno));
		}
		if (transfer.result <= 0) {
			host_fatal("SNDRV_PCM_IOCTL_WRITEI_FRAMES made no progress");
		}
		remaining -= (size_t)transfer.result;
		source += (size_t)transfer.result * kAudioChannels;
	}
}

static void set_audio_thread_realtime(void) {
	struct sched_param parameters;
	memset(&parameters, 0, sizeof(parameters));
	parameters.sched_priority = kAudioThreadPriority;
	const int error = pthread_setschedparam(pthread_self(), SCHED_FIFO, &parameters);
	if (error != 0) {
		fprintf(stderr, "[libretro-host] warning: SCHED_FIFO priority %d unavailable (%s), audio thread runs at normal priority\n",
				kAudioThreadPriority, strerror(error));
	}
}

static void* audio_thread_main(void* argument) {
	(void)argument;
	set_audio_thread_realtime();
	const size_t prime_frames = g_audio.period_frames * kAlsaPrimePeriods;
	bool primed = false;
	for (;;) {
		const size_t minimum_frames = primed ? g_audio.period_frames : prime_frames;
		const size_t frames = bmsx_audio_queue_pop_wait(&g_audio.queue, g_audio.thread_buffer,
				g_audio.thread_buffer_frames, minimum_frames);
		if (frames == 0) {
			break;
		}
		primed = true;
		write_alsa_frames(g_audio.thread_buffer, frames);
	}
	if (ioctl(g_audio.fd, SNDRV_PCM_IOCTL_DRAIN) != 0) {
		host_fatal("SNDRV_PCM_IOCTL_DRAIN failed: %s", strerror(errno));
	}
	return NULL;
}

static void flush_sample_buffer(void) {
	if (g_audio.sample_buffer_frames == 0) {
		return;
	}
	bmsx_audio_queue_push(&g_audio.queue, g_audio.sample_buffer, g_audio.sample_buffer_frames);
	g_audio.sample_buffer_frames = 0;
}

static void initialize_hardware_parameters(struct snd_pcm_hw_params* parameters) {
	memset(parameters, 0, sizeof(*parameters));
	for (size_t mask_index = 0; mask_index < sizeof(parameters->masks) / sizeof(parameters->masks[0]); mask_index += 1u) {
		for (size_t word_index = 0; word_index < sizeof(parameters->masks[mask_index].bits) / sizeof(parameters->masks[mask_index].bits[0]); word_index += 1u) {
			parameters->masks[mask_index].bits[word_index] = 0xFFFFFFFFu;
		}
	}
	for (size_t interval_index = 0; interval_index < sizeof(parameters->intervals) / sizeof(parameters->intervals[0]); interval_index += 1u) {
		parameters->intervals[interval_index].min = 0;
		parameters->intervals[interval_index].max = UINT_MAX;
		parameters->intervals[interval_index].openmin = 0;
		parameters->intervals[interval_index].openmax = 0;
		parameters->intervals[interval_index].integer = 0;
		parameters->intervals[interval_index].empty = 0;
	}
	parameters->rmask = 0;
	parameters->cmask = 0;
}

static void set_hardware_mask(struct snd_pcm_hw_params* parameters, snd_pcm_hw_param_t parameter, unsigned value) {
	struct snd_mask* mask = &parameters->masks[parameter - SNDRV_PCM_HW_PARAM_FIRST_MASK];
	for (size_t index = 0; index < sizeof(mask->bits) / sizeof(mask->bits[0]); index += 1u) {
		mask->bits[index] = 0;
	}
	mask->bits[value / 32u] |= 1u << (value % 32u);
	parameters->rmask |= 1u << parameter;
}

static void set_hardware_interval(struct snd_pcm_hw_params* parameters, snd_pcm_hw_param_t parameter, unsigned minimum, unsigned maximum) {
	struct snd_interval* interval = &parameters->intervals[parameter - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL];
	interval->min = minimum;
	interval->max = maximum;
	interval->openmin = 0;
	interval->openmax = 0;
	interval->integer = 1;
	interval->empty = 0;
	parameters->rmask |= 1u << parameter;
}

static unsigned hardware_interval_minimum(const struct snd_pcm_hw_params* parameters, snd_pcm_hw_param_t parameter) {
	return parameters->intervals[parameter - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL].min;
}

static unsigned hardware_interval_maximum(const struct snd_pcm_hw_params* parameters, snd_pcm_hw_param_t parameter) {
	return parameters->intervals[parameter - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL].max;
}

static void configure_alsa_software_parameters(void) {
	struct snd_pcm_sw_params parameters;
	memset(&parameters, 0, sizeof(parameters));
	parameters.tstamp_mode = SNDRV_PCM_TSTAMP_ENABLE;
	parameters.period_step = 1;
	parameters.sleep_min = 0;
	parameters.avail_min = 1;
	parameters.xfer_align = g_audio.period_frames / 2u;
	parameters.start_threshold = g_audio.period_frames;
	parameters.stop_threshold = g_audio.buffer_frames;
	parameters.silence_threshold = 0;
	parameters.silence_size = 0;
	parameters.boundary = g_audio.buffer_frames;
	while (parameters.boundary * 2u <= (unsigned)(INT_MAX - (int)g_audio.buffer_frames)) {
		parameters.boundary *= 2u;
	}
	if (ioctl(g_audio.fd, SNDRV_PCM_IOCTL_SW_PARAMS, &parameters) != 0) {
		host_fatal("SNDRV_PCM_IOCTL_SW_PARAMS failed: %s", strerror(errno));
	}
}

#ifdef BMSX_LIBRETRO_HOST_SDL
static void sdl_audio_callback(void* userdata, Uint8* stream, int byte_count) {
	(void)userdata;
	const size_t requested_frames = (size_t)byte_count / (kAudioChannels * sizeof(int16_t));
	const size_t frames = bmsx_audio_queue_read(&g_audio.queue, (int16_t*)stream, requested_frames);
	const size_t missing_frames = requested_frames - frames;
	g_audio.sdl_underrun_frames += missing_frames;
	memset(stream + frames * kAudioChannels * sizeof(int16_t), 0,
			missing_frames * kAudioChannels * sizeof(int16_t));
}

static void open_sdl_audio(int sample_rate) {
	if (SDL_InitSubSystem(SDL_INIT_AUDIO) != 0) {
		host_fatal("SDL audio initialization failed: %s", SDL_GetError());
	}
	SDL_AudioSpec requested;
	SDL_AudioSpec obtained;
	memset(&requested, 0, sizeof(requested));
	memset(&obtained, 0, sizeof(obtained));
	requested.freq = sample_rate;
	requested.format = AUDIO_S16SYS;
	requested.channels = (Uint8)kAudioChannels;
	requested.samples = (Uint16)kSdlBufferFrames;
	requested.callback = sdl_audio_callback;
	g_audio.sdl_device = SDL_OpenAudioDevice(NULL, 0, &requested, &obtained, 0);
	if (!g_audio.sdl_device) {
		host_fatal("SDL_OpenAudioDevice failed: %s", SDL_GetError());
	}
	if (obtained.freq != sample_rate) {
		host_fatal("SDL audio rate mismatch: requested %d got %d", sample_rate, obtained.freq);
	}
	if (obtained.channels != kAudioChannels) {
		host_fatal("SDL audio channel mismatch: requested %u got %u", kAudioChannels, obtained.channels);
	}
	g_audio.sample_rate = obtained.freq;
	g_audio.buffer_frames = obtained.samples;
	g_audio.sample_buffer_frames = 0;
	bmsx_audio_queue_init(&g_audio.queue, (size_t)obtained.samples * 2u, kAudioChannels,
			g_audio.track_high_water);
	bmsx_audio_queue_prime_silence(&g_audio.queue);
	g_audio.sdl_underrun_frames = 0;
	SDL_PauseAudioDevice(g_audio.sdl_device, 0);
	fprintf(stderr, "[libretro-host] audio: sdl rate=%d ch=%u samples=%u\n",
			obtained.freq, obtained.channels, obtained.samples);
}

static void close_sdl_audio(void) {
	SDL_PauseAudioDevice(g_audio.sdl_device, 1);
	SDL_CloseAudioDevice(g_audio.sdl_device);
	if (g_audio.track_high_water || g_audio.sdl_underrun_frames > 0u) {
		fprintf(stderr,
				"[libretro-host] audio stats: queue_capacity_frames=%zu queue_high_water_frames=%zu underrun_frames=%zu\n",
				g_audio.queue.capacity_frames,
				g_audio.queue.high_water_frames,
				g_audio.sdl_underrun_frames);
	}
	bmsx_audio_queue_stop(&g_audio.queue);
	bmsx_audio_queue_destroy(&g_audio.queue);
	SDL_QuitSubSystem(SDL_INIT_AUDIO);
}
#endif

static void open_alsa_audio(int sample_rate) {
	g_audio.fd = open(kAlsaDevice, O_WRONLY);
	if (g_audio.fd < 0) {
		host_fatal("Failed to open %s: %s", kAlsaDevice, strerror(errno));
	}
	struct snd_pcm_hw_params hardware;
	initialize_hardware_parameters(&hardware);
	set_hardware_mask(&hardware, SNDRV_PCM_HW_PARAM_ACCESS, SNDRV_PCM_ACCESS_RW_INTERLEAVED);
	set_hardware_mask(&hardware, SNDRV_PCM_HW_PARAM_FORMAT, SNDRV_PCM_FORMAT_S16_LE);
	set_hardware_mask(&hardware, SNDRV_PCM_HW_PARAM_SUBFORMAT, SNDRV_PCM_SUBFORMAT_STD);
	set_hardware_interval(&hardware, SNDRV_PCM_HW_PARAM_CHANNELS, kAudioChannels, kAudioChannels);
	set_hardware_interval(&hardware, SNDRV_PCM_HW_PARAM_RATE, (unsigned)sample_rate, (unsigned)sample_rate);
	set_hardware_interval(&hardware, SNDRV_PCM_HW_PARAM_PERIOD_SIZE, kAlsaPeriodFrames, kAlsaPeriodFrames);
	set_hardware_interval(&hardware, SNDRV_PCM_HW_PARAM_PERIODS, kAlsaPeriodCount, kAlsaPeriodCount);
	if (ioctl(g_audio.fd, SNDRV_PCM_IOCTL_HW_REFINE, &hardware) != 0) {
		host_fatal("SNDRV_PCM_IOCTL_HW_REFINE failed: %s", strerror(errno));
	}
	if (ioctl(g_audio.fd, SNDRV_PCM_IOCTL_HW_PARAMS, &hardware) != 0) {
		host_fatal("SNDRV_PCM_IOCTL_HW_PARAMS failed: %s", strerror(errno));
	}
	const unsigned minimum_rate = hardware_interval_minimum(&hardware, SNDRV_PCM_HW_PARAM_RATE);
	const unsigned maximum_rate = hardware_interval_maximum(&hardware, SNDRV_PCM_HW_PARAM_RATE);
	if (minimum_rate != (unsigned)sample_rate || maximum_rate != (unsigned)sample_rate) {
		host_fatal("Audio rate mismatch: requested %d got %u-%u", sample_rate, minimum_rate, maximum_rate);
	}
	const unsigned minimum_channels = hardware_interval_minimum(&hardware, SNDRV_PCM_HW_PARAM_CHANNELS);
	const unsigned maximum_channels = hardware_interval_maximum(&hardware, SNDRV_PCM_HW_PARAM_CHANNELS);
	if (minimum_channels != kAudioChannels || maximum_channels != kAudioChannels) {
		host_fatal("Audio channel mismatch: requested %u got %u-%u", kAudioChannels, minimum_channels, maximum_channels);
	}
	g_audio.sample_rate = (int)minimum_rate;
	g_audio.period_frames = hardware_interval_minimum(&hardware, SNDRV_PCM_HW_PARAM_PERIOD_SIZE);
	g_audio.period_count = hardware_interval_minimum(&hardware, SNDRV_PCM_HW_PARAM_PERIODS);
	if (g_audio.period_frames == 0) {
		host_fatal("Invalid ALSA period size");
	}
	if (g_audio.period_count == 0) {
		host_fatal("Invalid ALSA period count");
	}
	g_audio.buffer_frames = g_audio.period_frames * g_audio.period_count;
	configure_alsa_software_parameters();
	if (ioctl(g_audio.fd, SNDRV_PCM_IOCTL_PREPARE) != 0) {
		host_fatal("SNDRV_PCM_IOCTL_PREPARE failed: %s", strerror(errno));
	}
	g_audio.prepared = true;
	g_audio.underruns = 0;
	g_audio.thread_buffer_frames = g_audio.period_frames;
	g_audio.thread_buffer = malloc(g_audio.thread_buffer_frames * kAudioChannels * sizeof(int16_t));
	if (!g_audio.thread_buffer) {
		host_fatal("malloc(%zu) failed for audio thread buffer",
				g_audio.thread_buffer_frames * kAudioChannels * sizeof(int16_t));
	}
	bmsx_audio_queue_init(&g_audio.queue, g_audio.buffer_frames, kAudioChannels,
			g_audio.track_high_water);
	const int error = pthread_create(&g_audio.thread, NULL, audio_thread_main, NULL);
	if (error != 0) {
		host_fatal("pthread_create failed: %s", strerror(error));
	}
	g_audio.sample_buffer_frames = 0;
	fprintf(stderr, "[libretro-host] audio: dev=%s rate=%d ch=%u period=%u periods=%u buffer=%u\n",
			kAlsaDevice, g_audio.sample_rate, kAudioChannels,
			g_audio.period_frames, g_audio.period_count, g_audio.buffer_frames);
}

static void close_alsa_audio(void) {
	bmsx_audio_queue_stop(&g_audio.queue);
	const int error = pthread_join(g_audio.thread, NULL);
	if (error != 0) {
		host_fatal("pthread_join failed: %s", strerror(error));
	}
	bmsx_audio_queue_destroy(&g_audio.queue);
	if (g_audio.track_high_water || g_audio.underruns > 0u) {
		fprintf(stderr, "[libretro-host] audio stats: underruns=%u\n", g_audio.underruns);
	}
	free(g_audio.thread_buffer);
	close(g_audio.fd);
}

void audio_output_open(int sample_rate, bool use_sdl, bool track_high_water) {
	g_audio.use_sdl = use_sdl;
	g_audio.track_high_water = track_high_water;
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (use_sdl) {
		open_sdl_audio(sample_rate);
	} else {
		open_alsa_audio(sample_rate);
	}
#else
	(void)use_sdl;
	open_alsa_audio(sample_rate);
#endif
	g_audio.active = true;
}

void audio_output_close(void) {
	flush_sample_buffer();
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_audio.use_sdl) {
		close_sdl_audio();
	} else {
		close_alsa_audio();
	}
#else
	close_alsa_audio();
#endif
	g_audio = (AudioOutput){
		.fd = -1,
	};
}

void audio_output_sample(int16_t left, int16_t right) {
	if (!g_audio.active) {
		return;
	}
	const size_t index = g_audio.sample_buffer_frames * kAudioChannels;
	g_audio.sample_buffer[index] = left;
	g_audio.sample_buffer[index + 1u] = right;
	g_audio.sample_buffer_frames += 1u;
	if (g_audio.sample_buffer_frames == kSampleBufferFrames) {
		bmsx_audio_queue_push(&g_audio.queue, g_audio.sample_buffer, g_audio.sample_buffer_frames);
		g_audio.sample_buffer_frames = 0;
	}
}

size_t audio_output_sample_batch(const int16_t* data, size_t frames) {
	if (!g_audio.active) {
		return frames;
	}
	flush_sample_buffer();
	bmsx_audio_queue_push(&g_audio.queue, data, frames);
	return frames;
}
