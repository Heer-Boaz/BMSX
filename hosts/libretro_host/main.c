#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <ucontext.h>

#include "libretro.h"
#include "audio_output.h"
#include "core_options.h"
#include "frame_pacer.h"
#include "frame_timing.h"
#include "host_fatal.h"
#include "input_devices.h"
#include "input_timeline.h"
#include "keyboard_input.h"
#include "video_context.h"
#include "video_presenter.h"

#define BMSX_HOST_USEC_PER_SECOND 1000000ull
#define BMSX_HOST_NSEC_PER_SECOND 1000000000ull

typedef struct LibretroCore {
	void* handle;

	void (*retro_set_environment)(retro_environment_t);
	void (*retro_set_video_refresh)(retro_video_refresh_t);
	void (*retro_set_audio_sample)(retro_audio_sample_t);
	void (*retro_set_audio_sample_batch)(retro_audio_sample_batch_t);
	void (*retro_set_input_poll)(retro_input_poll_t);
	void (*retro_set_input_state)(retro_input_state_t);

	void (*retro_init)(void);
	void (*retro_deinit)(void);
	unsigned (*retro_api_version)(void);
	void (*retro_get_system_info)(struct retro_system_info*);
	void (*retro_get_system_av_info)(struct retro_system_av_info*);
	void (*retro_set_controller_port_device)(unsigned, unsigned);

	void (*retro_reset)(void);
	void (*retro_run)(void);

	bool (*retro_load_game)(const struct retro_game_info*);
	void (*retro_unload_game)(void);
	unsigned (*retro_get_region)(void);

	size_t (*retro_serialize_size)(void);
	bool (*retro_serialize)(void*, size_t);
	bool (*retro_unserialize)(const void*, size_t);

	void* (*retro_get_memory_data)(unsigned);
	size_t (*retro_get_memory_size)(unsigned);

	void (*retro_cheat_reset)(void);
	void (*retro_cheat_set)(unsigned, bool, const char*);
} LibretroCore;

static volatile sig_atomic_t g_should_quit = 0;
enum { kInputTimelineAutoQuitGraceFrames = 0 };
static char g_system_dir[1024] = "";
static char g_save_dir[1024] = "";
static LibretroCore* g_core = NULL;
static BmsxCoreOptions g_core_options;

static uint64_t g_frame_usec = 0;
static uint64_t g_frame_ns = 0;
static uint64_t g_max_run_frames = 0;
static uint64_t g_run_frame_count = 0;
static struct retro_frame_time_callback g_frame_time_cb = {0};
static bool g_has_frame_time_cb = false;

static BmsxFrameTimingState g_frame_timing = {
	.warmup_frames = 500u,
};

static void crash_handler(int sig, siginfo_t* si, void* ctx_) {
#if defined(__arm__)
	ucontext_t* uc = (ucontext_t*)ctx_;
	unsigned long pc = uc->uc_mcontext.arm_pc;
	unsigned long sp = uc->uc_mcontext.arm_sp;
	fprintf(stderr, "\nCRASH sig=%d addr=%p pc=%08lx lr=%08lx sp=%08lx\n",
			sig, si->si_addr, pc, (unsigned long)uc->uc_mcontext.arm_lr, sp);
#elif defined(__aarch64__)
	ucontext_t* uc = (ucontext_t*)ctx_;
	unsigned long pc = uc->uc_mcontext.pc;
	unsigned long sp = uc->uc_mcontext.sp;
	fprintf(stderr, "\nCRASH sig=%d addr=%p pc=%016lx sp=%016lx\n",
			sig, si->si_addr, pc, sp);
#else
	(void)ctx_;
	fprintf(stderr, "\nCRASH sig=%d addr=%p\n", sig, si->si_addr);
#endif

	fflush(stderr);
	_Exit(128 + sig);
}

static void install_crash_handlers(void) {
	struct sigaction sa;
	sa.sa_sigaction = crash_handler;
	sigemptyset(&sa.sa_mask);
	sa.sa_flags = SA_SIGINFO | SA_RESETHAND;

	sigaction(SIGSEGV, &sa, NULL);
	sigaction(SIGBUS,  &sa, NULL);
	sigaction(SIGILL,  &sa, NULL);
	sigaction(SIGABRT, &sa, NULL);
}

static void on_signal(int signum) {
	(void)signum;
	g_should_quit = 1;
}

static void host_log(enum retro_log_level level, const char* fmt, ...) {
	const char* prefix = "INFO";
	switch (level) {
		case RETRO_LOG_DEBUG: prefix = "DEBUG"; break;
		case RETRO_LOG_INFO: prefix = "INFO"; break;
		case RETRO_LOG_WARN: prefix = "WARN"; break;
		case RETRO_LOG_ERROR: prefix = "ERROR"; break;
		default: break;
	}
	fprintf(stderr, "[libretro-host][%s] ", prefix);
	va_list ap;
	va_start(ap, fmt);
	vfprintf(stderr, fmt, ap);
	va_end(ap);
}

static uint64_t monotonic_ns(void);
static void set_host_timing(const struct retro_system_timing* timing);

static bool environ_cb(unsigned cmd, void* data) {
	switch (cmd) {
		case RETRO_ENVIRONMENT_GET_LOG_INTERFACE: {
			struct retro_log_callback* cb = (struct retro_log_callback*)data;
			cb->log = host_log;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
			return true;
		case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY: {
			const char** out = (const char**)data;
			*out = g_system_dir;
			return true;
		}
		case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: {
			const char** out = (const char**)data;
			*out = g_save_dir[0] ? g_save_dir : g_system_dir;
			return true;
		}
		case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: {
			unsigned* version = (unsigned*)data;
			*version = 2;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
			bmsx_core_options_register_v2(&g_core_options, (const struct retro_core_options_v2*)data);
			return false;
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL: {
			const struct retro_core_options_v2_intl* definitions = (const struct retro_core_options_v2_intl*)data;
			bmsx_core_options_register_v2(&g_core_options, definitions ? definitions->us : NULL);
			return false;
		}
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL: {
			const struct retro_core_options_intl* definitions = (const struct retro_core_options_intl*)data;
			bmsx_core_options_register_v1(&g_core_options, definitions ? definitions->us : NULL);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
			bmsx_core_options_register_v1(&g_core_options, (const struct retro_core_option_definition*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_VARIABLES:
			bmsx_core_options_register_legacy(&g_core_options, (const struct retro_variable*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_VARIABLE: {
			return bmsx_core_options_set_variable(&g_core_options, (const struct retro_variable*)data);
		}
		case RETRO_ENVIRONMENT_GET_VARIABLE: {
			return bmsx_core_options_get(&g_core_options, (struct retro_variable*)data);
		}
		case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: {
			bool* updated = (bool*)data;
			*updated = bmsx_core_options_take_updated(&g_core_options);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_MESSAGE: {
			video_presenter_post_message((const struct retro_message*)data);
			return true;
		}
		case RETRO_ENVIRONMENT_GET_CAN_DUPE: {
			bool* can_dupe = (bool*)data;
			*can_dupe = true;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
			return true;
		case RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK:
			keyboard_input_set_callback(*(const struct retro_keyboard_callback*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_GEOMETRY:
			video_presenter_update_geometry((const struct retro_game_geometry*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO: {
			const struct retro_system_av_info* info = (const struct retro_system_av_info*)data;
			video_presenter_update_av_info(info);
			set_host_timing(&info->timing);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
			return video_presenter_accept_pixel_format(
					*(const enum retro_pixel_format*)data);
		case RETRO_ENVIRONMENT_SET_HW_RENDER:
			return video_presenter_negotiate_hw_render(
					(struct retro_hw_render_callback*)data);
		case RETRO_ENVIRONMENT_SET_FRAME_TIME_CALLBACK: {
			const struct retro_frame_time_callback* cb = (const struct retro_frame_time_callback*)data;
			g_frame_time_cb = *cb;
			g_has_frame_time_cb = cb->callback != NULL;
			return true;
		}
		case RETRO_ENVIRONMENT_SHUTDOWN:
			g_should_quit = 1;
			return true;
		default:
			return false;
	}
}

static uint64_t monotonic_ns(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (uint64_t)ts.tv_sec * BMSX_HOST_NSEC_PER_SECOND + (uint64_t)ts.tv_nsec;
}

static void set_host_timing(const struct retro_system_timing* timing) {
	g_frame_usec = (uint64_t)((double)BMSX_HOST_USEC_PER_SECOND / timing->fps + 0.5);
	g_frame_ns = (uint64_t)((double)BMSX_HOST_NSEC_PER_SECOND / timing->fps + 0.5);
}

static void* read_file(const char* path, size_t* out_size) {
	int fd = open(path, O_RDONLY);
	if (fd < 0) {
		host_fatal("Failed to open %s: %s", path, strerror(errno));
	}
	struct stat st;
	if (fstat(fd, &st) != 0) {
		host_fatal("fstat(%s) failed: %s", path, strerror(errno));
	}
	if (st.st_size <= 0) {
		host_fatal("File is empty: %s", path);
	}
	size_t size = (size_t)st.st_size;
	void* buf = malloc(size);
	if (!buf) {
		host_fatal("malloc(%zu) failed", size);
	}
	size_t off = 0;
	while (off < size) {
		ssize_t n = read(fd, (uint8_t*)buf + off, size - off);
		if (n < 0) {
			host_fatal("read(%s) failed: %s", path, strerror(errno));
		}
		if (n == 0) {
			host_fatal("Unexpected EOF while reading %s", path);
		}
		off += (size_t)n;
	}
	close(fd);
	*out_size = size;
	return buf;
}

static void load_symbol(void* handle, const char* name, void* out_fn_ptr) {
	void* sym = dlsym(handle, name);
	if (!sym) {
		host_fatal("Missing symbol %s: %s", name, dlerror());
	}
	memcpy(out_fn_ptr, &sym, sizeof(sym));
}

static void load_core(LibretroCore* core, const char* path) {
	memset(core, 0, sizeof(*core));
	core->handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
	if (!core->handle) {
		host_fatal("dlopen(%s) failed: %s", path, dlerror());
	}

	load_symbol(core->handle, "retro_set_environment", &core->retro_set_environment);
	load_symbol(core->handle, "retro_set_video_refresh", &core->retro_set_video_refresh);
	load_symbol(core->handle, "retro_set_audio_sample", &core->retro_set_audio_sample);
	load_symbol(core->handle, "retro_set_audio_sample_batch", &core->retro_set_audio_sample_batch);
	load_symbol(core->handle, "retro_set_input_poll", &core->retro_set_input_poll);
	load_symbol(core->handle, "retro_set_input_state", &core->retro_set_input_state);
	load_symbol(core->handle, "retro_init", &core->retro_init);
	load_symbol(core->handle, "retro_deinit", &core->retro_deinit);
	load_symbol(core->handle, "retro_api_version", &core->retro_api_version);
	load_symbol(core->handle, "retro_get_system_info", &core->retro_get_system_info);
	load_symbol(core->handle, "retro_get_system_av_info", &core->retro_get_system_av_info);
	load_symbol(core->handle, "retro_set_controller_port_device", &core->retro_set_controller_port_device);
	load_symbol(core->handle, "retro_reset", &core->retro_reset);
	load_symbol(core->handle, "retro_run", &core->retro_run);
	load_symbol(core->handle, "retro_load_game", &core->retro_load_game);
	load_symbol(core->handle, "retro_unload_game", &core->retro_unload_game);
	load_symbol(core->handle, "retro_get_region", &core->retro_get_region);
	load_symbol(core->handle, "retro_serialize_size", &core->retro_serialize_size);
	load_symbol(core->handle, "retro_serialize", &core->retro_serialize);
	load_symbol(core->handle, "retro_unserialize", &core->retro_unserialize);
	load_symbol(core->handle, "retro_get_memory_data", &core->retro_get_memory_data);
	load_symbol(core->handle, "retro_get_memory_size", &core->retro_get_memory_size);
	load_symbol(core->handle, "retro_cheat_reset", &core->retro_cheat_reset);
	load_symbol(core->handle, "retro_cheat_set", &core->retro_cheat_set);
}

static void usage(const char* argv0) {
	fprintf(stderr,
			"Usage:\n"
			"  %s --core ./libretro_bmsx.so --no-game [--backend software|gles2] [--video fb|sdl] [--hidden-window] [--system-dir PATH] [--save-dir PATH] [--rom-folder FOLDER] [--input-timeline FILE] [--paced-timeline] [--auto-timeline] [--no-audio] [--max-frames N] [--gles2-timing-report] [--timing-warmup N] [--crt-postprocessing on|off] [--crt-noise on|off]\n"
			"  %s --core ./libretro_bmsx.so GAME.rom [--backend software|gles2] [--video fb|sdl] [--hidden-window] [--system-dir PATH] [--save-dir PATH] [--rom-folder FOLDER] [--input-timeline FILE] [--paced-timeline] [--auto-timeline] [--no-audio] [--max-frames N] [--gles2-timing-report] [--timing-warmup N] [--crt-postprocessing on|off] [--crt-noise on|off]\n",
			argv0, argv0);
	exit(2);
}

static const char* required_arg(int argc, char** argv, int* index) {
	if (*index + 1 >= argc) {
		usage(argv[0]);
	}
	return argv[++(*index)];
}

static uint64_t parse_positive_u64_arg(const char* text, const char* option_name) {
	if (!text || !text[0]) {
		host_fatal("%s expects a positive integer", option_name);
	}
	errno = 0;
	char* end = NULL;
	unsigned long long value = strtoull(text, &end, 10);
	if (errno != 0 || end == text || *end != '\0' || value == 0ull) {
		host_fatal("%s expects a positive integer, got '%s'", option_name, text);
	}
	return (uint64_t)value;
}

int main(int argc, char** argv) {
	install_crash_handlers();
	const char* core_path = "./libretro_bmsx.so";
	const char* game_path = NULL;
	bool no_game = false;
	const char* system_dir = "";
	const char* save_dir = "";
	const char* rom_folder = "";
	const char* input_timeline = "";
	bool use_input_timeline = false;
	bool paced_timeline = false;
	bool auto_timeline = false;
	bool audio_disabled = false;
	bool hidden_window = false;
	BmsxVideoContextKind video_context_kind = BMSX_VIDEO_CONTEXT_FBDEV;
	BmsxInputDriverKind input_driver = BMSX_INPUT_DRIVER_EVDEV;
	const char* backend = "software";
	const char* video_backend = "fb";

	for (int i = 1; i < argc; ++i) {
		if (strcmp(argv[i], "--core") == 0) {
			core_path = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--no-game") == 0) {
			no_game = true;
			continue;
		}
		if (strcmp(argv[i], "--system-dir") == 0) {
			system_dir = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--save-dir") == 0) {
			save_dir = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--backend") == 0) {
			backend = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--video") == 0) {
			video_backend = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--no-audio") == 0) {
			audio_disabled = true;
			continue;
		}
		if (strcmp(argv[i], "--hidden-window") == 0) {
			hidden_window = true;
			continue;
		}
		if (strcmp(argv[i], "--max-frames") == 0) {
			g_max_run_frames = parse_positive_u64_arg(required_arg(argc, argv, &i), "--max-frames");
			continue;
		}
		if (strcmp(argv[i], "--gles2-timing-report") == 0) {
			g_frame_timing.enabled = true;
			continue;
		}
		if (strcmp(argv[i], "--timing-warmup") == 0) {
			g_frame_timing.warmup_frames = parse_positive_u64_arg(required_arg(argc, argv, &i), "--timing-warmup");
			continue;
		}
		if (strcmp(argv[i], "--crt-postprocessing") == 0) {
			const char* value = required_arg(argc, argv, &i);
			if (strcmp(value, "on") != 0 && strcmp(value, "off") != 0) {
				host_fatal("Invalid --crt-postprocessing %s (expected on|off)", value);
			}
			bmsx_core_options_override(&g_core_options, "bmsx_crt_postprocessing", value);
			continue;
		}
		if (strcmp(argv[i], "--crt-noise") == 0) {
			const char* value = required_arg(argc, argv, &i);
			if (strcmp(value, "on") != 0 && strcmp(value, "off") != 0) {
				host_fatal("Invalid --crt-noise %s (expected on|off)", value);
			}
			bmsx_core_options_override(&g_core_options, "bmsx_crt_noise", value);
			continue;
		}
		if (strcmp(argv[i], "--rom-folder") == 0) {
			rom_folder = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--input-timeline") == 0) {
			use_input_timeline = true;
			input_timeline = required_arg(argc, argv, &i);
			continue;
		}
		if (strcmp(argv[i], "--paced-timeline") == 0) {
			paced_timeline = true;
			continue;
		}
		if (strcmp(argv[i], "--auto-timeline") == 0) {
			auto_timeline = true;
			continue;
		}
		if (argv[i][0] == '-') {
			usage(argv[0]);
		}
		game_path = argv[i];
	}

	if (!no_game && !game_path) {
		usage(argv[0]);
	}
	if (strcmp(backend, "software") != 0 && strcmp(backend, "gles2") != 0) {
		host_fatal("Invalid --backend %s (expected software|gles2)", backend);
	}
	if (g_frame_timing.enabled && strcmp(backend, "gles2") != 0) {
		host_fatal("--gles2-timing-report requires --backend gles2");
	}
	if (strcmp(video_backend, "fb") != 0 && strcmp(video_backend, "sdl") != 0) {
		host_fatal("Invalid --video %s (expected fb|sdl)", video_backend);
	}
	const bool use_sdl_backend = strcmp(video_backend, "sdl") == 0;
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (use_sdl_backend) {
		input_driver = BMSX_INPUT_DRIVER_SDL;
		video_context_kind = strcmp(backend, "gles2") == 0
			? BMSX_VIDEO_CONTEXT_SDL_GLES2
			: BMSX_VIDEO_CONTEXT_SDL_SOFTWARE;
	}
#else
	if (use_sdl_backend) {
		host_fatal("SDL video backend not available in this build");
	}
#endif

	snprintf(g_system_dir, sizeof(g_system_dir), "%s", system_dir);
	snprintf(g_save_dir, sizeof(g_save_dir), "%s", save_dir);
	bmsx_core_options_override(&g_core_options, "bmsx_render_backend", backend);

	signal(SIGINT, on_signal);
	signal(SIGTERM, on_signal);

	LibretroCore core;
	load_core(&core, core_path);
	g_core = &core;

	core.retro_set_environment(environ_cb);
	core.retro_set_video_refresh(video_presenter_refresh);
	core.retro_set_audio_sample(audio_output_sample);
	core.retro_set_audio_sample_batch(audio_output_sample_batch);
	core.retro_set_input_poll(input_devices_poll);
	core.retro_set_input_state(input_devices_state);

	BmsxVideoSurface* video_surface =
			bmsx_video_context_open(video_context_kind, hidden_window);
	video_presenter_open(video_surface, &g_frame_timing);
	input_devices_open(input_driver, !hidden_window, video_surface);

	core.retro_init();
	struct retro_system_av_info av;
	memset(&av, 0, sizeof(av));
	core.retro_get_system_av_info(&av);
	video_presenter_update_av_info(&av);
	set_host_timing(&av.timing);
	video_presenter_activate_core_context();

	struct retro_system_info sysinfo;
	memset(&sysinfo, 0, sizeof(sysinfo));
	core.retro_get_system_info(&sysinfo);
	fprintf(stderr, "[libretro-host] core=%s v%s api=%u\n",
			sysinfo.library_name ? sysinfo.library_name : "(unknown)",
			sysinfo.library_version ? sysinfo.library_version : "(unknown)",
			core.retro_api_version());
	fprintf(stderr, "[libretro-host] need_fullpath=%s\n",
			sysinfo.need_fullpath ? "true" : "false");

	core.retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);

	void* game_buf = NULL;
	size_t game_size = 0;
	struct retro_game_info game_info;
	memset(&game_info, 0, sizeof(game_info));
	bool loaded_ok = false;
	if (no_game) {
		loaded_ok = core.retro_load_game(NULL);
	} else {
		game_info.path = game_path;
		if (!sysinfo.need_fullpath) {
			game_buf = read_file(game_path, &game_size);
			game_info.data = game_buf;
			game_info.size = game_size;
		}
		game_info.meta = NULL;
		loaded_ok = core.retro_load_game(&game_info);
	}
	if (!loaded_ok) {
		host_fatal("retro_load_game failed");
	}
	video_presenter_reset_presentation_timeline();

	memset(&av, 0, sizeof(av));
	core.retro_get_system_av_info(&av);
	video_presenter_update_av_info(&av);
	set_host_timing(&av.timing);
	video_presenter_activate_core_context();
	fprintf(stderr, "[libretro-host] av: base=%ux%u max=%ux%u fps=%.2f sr=%.2f\n",
			av.geometry.base_width, av.geometry.base_height,
			av.geometry.max_width, av.geometry.max_height,
			av.timing.fps, av.timing.sample_rate);

	const int audio_rate = (int)(av.timing.sample_rate + 0.5);
	if (audio_rate <= 0) {
		host_fatal("Invalid audio sample rate: %.2f", av.timing.sample_rate);
	}
	if (audio_disabled) {
		fprintf(stderr, "[libretro-host] audio: disabled\n");
	} else {
		audio_output_open(audio_rate, use_sdl_backend, g_frame_timing.enabled);
	}
	/*
	 * Configure input timelines only when explicitly requested:
	 *  - --input-timeline FILE  (use_input_timeline)
	 *  - --auto-timeline        (auto_timeline)
	 * Previously the code auto-configured timelines whenever a rom_folder or game was present;
	 * make that behavior opt-in via --auto-timeline.
	 */
	if (use_input_timeline || auto_timeline) {
		input_timeline_configure(use_input_timeline ? input_timeline : NULL,
				(rom_folder && rom_folder[0]) ? rom_folder : NULL,
				(game_path && game_path[0]) ? game_path : NULL,
				g_frame_usec);
	}
	const bool unpaced_timeline = input_timeline_is_active() && !paced_timeline;
	const bool audio_master = !audio_disabled && !unpaced_timeline;
	BmsxFramePacer frame_pacer;
	bmsx_frame_pacer_init(&frame_pacer, monotonic_ns(), g_frame_ns);

	while (!g_should_quit && !input_devices_quit_requested()) {
		uint64_t now_ns = monotonic_ns();
		if (!unpaced_timeline && !audio_master && now_ns < frame_pacer.next_deadline_ns) {
			struct timespec ts;
			ts.tv_sec = (time_t)(frame_pacer.next_deadline_ns / BMSX_HOST_NSEC_PER_SECOND);
			ts.tv_nsec = (long)(frame_pacer.next_deadline_ns % BMSX_HOST_NSEC_PER_SECOND);
			while (clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &ts, NULL) == EINTR) {
			}
		}
		now_ns = monotonic_ns();
		const BmsxFramePacerDecision pacing = bmsx_frame_pacer_begin(&frame_pacer, now_ns);
		/* Missed deadlines are caught up by subsequent host-loop iterations.
		 * Drop their presentation and advance exactly one machine frame per call. */
		const bool drop_video =
				!unpaced_timeline && !audio_master && pacing.drop_presentation;
		g_frame_timing.record_frame = g_frame_timing.enabled && g_run_frame_count >= g_frame_timing.warmup_frames;
		if (g_has_frame_time_cb) {
			const retro_usec_t frame_time_usec = !unpaced_timeline && pacing.has_elapsed
				? (retro_usec_t)(pacing.elapsed_ns / 1000u)
				: g_frame_time_cb.reference;
			g_frame_time_cb.callback(frame_time_usec);
		}
		input_timeline_dispatch_before_run(video_presenter_presentation_count());
		video_presenter_begin_frame(drop_video);
		const uint64_t run_start_ns = g_frame_timing.record_frame ? monotonic_ns() : 0u;
		core.retro_run();
		const bool presented_frame = video_presenter_end_frame();
		if (g_frame_timing.record_frame) {
			const uint64_t run_ns = monotonic_ns() - run_start_ns;
			bmsx_frame_timing_record(&g_frame_timing.report,
					run_ns,
					g_frame_timing.current_blit_ns,
					g_frame_timing.current_blit_ran,
					g_frame_timing.current_swap_ns,
					g_frame_timing.current_swap_ran,
					drop_video && g_frame_timing.current_video_frame_received,
					!drop_video && presented_frame);
		}
		++g_run_frame_count;
		const uint64_t presentation_count =
				video_presenter_presentation_count();
		if (g_max_run_frames == 0 && presentation_count > 1u &&
				input_timeline_should_auto_quit(
					presentation_count - 2u,
					kInputTimelineAutoQuitGraceFrames)) {
			fprintf(stderr, "[libretro-host] input timeline completed, exiting\n");
			g_should_quit = 1;
		}
		if (g_max_run_frames > 0 && g_run_frame_count >= g_max_run_frames) {
			fprintf(stderr, "[libretro-host] max frames reached (%llu), exiting\n",
					(unsigned long long)g_run_frame_count);
			g_should_quit = 1;
		}
		now_ns = monotonic_ns();
		bmsx_frame_pacer_complete(&frame_pacer, now_ns, !unpaced_timeline && !audio_master, g_frame_ns);
	}
	if (g_frame_timing.enabled) {
		bmsx_frame_timing_print(&g_frame_timing.report, g_frame_timing.warmup_frames);
	}

	input_timeline_shutdown();
	input_devices_close();
	video_presenter_destroy_core_context();
	core.retro_unload_game();
	core.retro_deinit();
	video_presenter_close();
	if (!audio_disabled) {
		audio_output_close();
	}
	bmsx_video_context_close();
	if (game_buf) {
		free(game_buf);
	}
	if (core.handle) {
		dlclose(core.handle);
	}
	bmsx_core_options_destroy(&g_core_options);
	return 0;
}
