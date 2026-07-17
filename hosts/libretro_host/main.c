#define _GNU_SOURCE

#include <errno.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <ucontext.h>

#include "libretro.h"
#include "audio_output.h"
#include "core_session.h"
#include "core_options.h"
#include "frame_pacer.h"
#include "frame_timing.h"
#include "host_fatal.h"
#include "input_devices.h"
#include "input_timeline.h"
#include "video_context.h"
#include "video_presenter.h"

#define BMSX_HOST_NSEC_PER_SECOND 1000000000ull

static volatile sig_atomic_t g_signal_quit_requested = 0;
enum { kInputTimelineAutoQuitGraceFrames = 0 };

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
	g_signal_quit_requested = 1;
}

static uint64_t monotonic_ns(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (uint64_t)ts.tv_sec * BMSX_HOST_NSEC_PER_SECOND + (uint64_t)ts.tv_nsec;
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
	const char* system_dir = NULL;
	const char* save_dir = NULL;
	const char* rom_folder = NULL;
	const char* input_timeline = NULL;
	const char* crt_postprocessing = NULL;
	const char* crt_noise = NULL;
	bool use_input_timeline = false;
	bool paced_timeline = false;
	bool auto_timeline = false;
	bool audio_disabled = false;
	bool hidden_window = false;
	uint64_t maximum_run_frames = 0;
	uint64_t run_frame_count = 0;
	BmsxFrameTimingState frame_timing = {
		.warmup_frames = 500u,
	};
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
			maximum_run_frames = parse_positive_u64_arg(
					required_arg(argc, argv, &i),
					"--max-frames");
			continue;
		}
		if (strcmp(argv[i], "--gles2-timing-report") == 0) {
			frame_timing.enabled = true;
			continue;
		}
		if (strcmp(argv[i], "--timing-warmup") == 0) {
			frame_timing.warmup_frames = parse_positive_u64_arg(
					required_arg(argc, argv, &i),
					"--timing-warmup");
			continue;
		}
		if (strcmp(argv[i], "--crt-postprocessing") == 0) {
			const char* value = required_arg(argc, argv, &i);
			if (strcmp(value, "on") != 0 && strcmp(value, "off") != 0) {
				host_fatal("Invalid --crt-postprocessing %s (expected on|off)", value);
			}
			crt_postprocessing = value;
			continue;
		}
		if (strcmp(argv[i], "--crt-noise") == 0) {
			const char* value = required_arg(argc, argv, &i);
			if (strcmp(value, "on") != 0 && strcmp(value, "off") != 0) {
				host_fatal("Invalid --crt-noise %s (expected on|off)", value);
			}
			crt_noise = value;
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
	if (frame_timing.enabled && strcmp(backend, "gles2") != 0) {
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

	signal(SIGINT, on_signal);
	signal(SIGTERM, on_signal);

	BmsxCoreSession session;
	core_session_open(&session, core_path, system_dir, save_dir);
	bmsx_core_options_override(
			&session.options,
			"bmsx_render_backend",
			backend);
	if (crt_postprocessing) {
		bmsx_core_options_override(
				&session.options,
				"bmsx_crt_postprocessing",
				crt_postprocessing);
	}
	if (crt_noise) {
		bmsx_core_options_override(
				&session.options,
				"bmsx_crt_noise",
				crt_noise);
	}

	BmsxLibretroApi* core = &session.api;
	core->retro_set_environment(core_session_environment);
	core->retro_set_video_refresh(video_presenter_refresh);
	core->retro_set_audio_sample(audio_output_sample);
	core->retro_set_audio_sample_batch(audio_output_sample_batch);
	core->retro_set_input_poll(input_devices_poll);
	core->retro_set_input_state(input_devices_state);

	BmsxVideoSurface* video_surface =
			bmsx_video_context_open(video_context_kind, hidden_window);
	video_presenter_open(video_surface, &frame_timing);
	input_devices_open(input_driver, !hidden_window, video_surface);

	core->retro_init();
	fprintf(stderr, "[libretro-host] core=%s v%s api=%u\n",
			session.system_info.library_name,
			session.system_info.library_version,
			RETRO_API_VERSION);
	fprintf(stderr, "[libretro-host] need_fullpath=%s\n",
			session.system_info.need_fullpath ? "true" : "false");

	core->retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
	core_session_load_content(&session, no_game, game_path);
	video_presenter_reset_presentation_timeline();

	struct retro_system_av_info av = {0};
	core->retro_get_system_av_info(&av);
	video_presenter_update_av_info(&av);
	core_session_update_timing(&session, &av.timing);
	video_presenter_activate_core_context();
	fprintf(stderr, "[libretro-host] av: base=%ux%u max=%ux%u fps=%.2f sr=%.2f\n",
			av.geometry.base_width, av.geometry.base_height,
			av.geometry.max_width, av.geometry.max_height,
			av.timing.fps, av.timing.sample_rate);

	const int audio_rate = (int)(av.timing.sample_rate + 0.5);
	if (audio_disabled) {
		fprintf(stderr, "[libretro-host] audio: disabled\n");
	} else {
		audio_output_open(audio_rate, use_sdl_backend, frame_timing.enabled);
	}
	if (use_input_timeline || auto_timeline) {
		input_timeline_configure(use_input_timeline ? input_timeline : NULL,
				rom_folder,
				game_path,
				session.frame_period_usec);
	}
	const bool unpaced_timeline = input_timeline_is_active() && !paced_timeline;
	const bool audio_master = !audio_disabled && !unpaced_timeline;
	BmsxFramePacer frame_pacer;
	bmsx_frame_pacer_init(
			&frame_pacer,
			monotonic_ns(),
			session.frame_period_ns);
	bool runloop_quit_requested = false;

	while (!g_signal_quit_requested &&
			!session.shutdown_requested &&
			!runloop_quit_requested &&
			!input_devices_quit_requested()) {
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
		frame_timing.record_frame =
				frame_timing.enabled &&
				run_frame_count >= frame_timing.warmup_frames;
		if (session.frame_time.callback) {
			const retro_usec_t frame_time_usec = !unpaced_timeline && pacing.has_elapsed
				? (retro_usec_t)(pacing.elapsed_ns / 1000u)
				: session.frame_time.reference;
			session.frame_time.callback(frame_time_usec);
		}
		input_timeline_dispatch_before_run(video_presenter_presentation_count());
		video_presenter_begin_frame(drop_video);
		const uint64_t run_start_ns = frame_timing.record_frame ? monotonic_ns() : 0u;
		core->retro_run();
		const bool presented_frame = video_presenter_end_frame();
		if (frame_timing.record_frame) {
			const uint64_t run_ns = monotonic_ns() - run_start_ns;
			bmsx_frame_timing_record(&frame_timing.report,
					run_ns,
					frame_timing.current_blit_ns,
					frame_timing.current_blit_ran,
					frame_timing.current_swap_ns,
					frame_timing.current_swap_ran,
					drop_video && frame_timing.current_video_frame_received,
					!drop_video && presented_frame);
		}
		++run_frame_count;
		const uint64_t presentation_count =
				video_presenter_presentation_count();
		if (maximum_run_frames == 0 && presentation_count > 1u &&
				input_timeline_should_auto_quit(
					presentation_count - 2u,
					kInputTimelineAutoQuitGraceFrames)) {
			fprintf(stderr, "[libretro-host] input timeline completed, exiting\n");
			runloop_quit_requested = true;
		}
		if (maximum_run_frames > 0 && run_frame_count >= maximum_run_frames) {
			fprintf(stderr, "[libretro-host] max frames reached (%llu), exiting\n",
					(unsigned long long)run_frame_count);
			runloop_quit_requested = true;
		}
		now_ns = monotonic_ns();
		bmsx_frame_pacer_complete(
				&frame_pacer,
				now_ns,
				!unpaced_timeline && !audio_master,
				session.frame_period_ns);
	}
	if (frame_timing.enabled) {
		bmsx_frame_timing_print(&frame_timing.report, frame_timing.warmup_frames);
	}

	input_timeline_shutdown();
	input_devices_close();
	video_presenter_destroy_core_context();
	core->retro_unload_game();
	core->retro_deinit();
	video_presenter_close();
	if (!audio_disabled) {
		audio_output_close();
	}
	bmsx_video_context_close();
	core_session_close(&session);
	return 0;
}
