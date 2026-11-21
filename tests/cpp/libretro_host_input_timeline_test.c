#define _POSIX_C_SOURCE 200809L

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "host_control.h"
#include "input_timeline.h"
#include "keyboard_input.h"
#include "screenshot.h"
#include "video_presenter.h"

static void require(bool condition, const char* message) {
	if (!condition) {
		fprintf(stderr, "%s\n", message);
		exit(1);
	}
}

static int32_t active_domain = -1;
static unsigned current_run;
static struct { unsigned run, key; bool down; } inputs[32];
static unsigned input_count;
static unsigned captures;
static char capture_filename[128];

static int32_t RETRO_CALLCONV read_active_domain(void) { return active_domain; }
static void RETRO_CALLCONV key_event(bool down, unsigned key, uint32_t character, uint16_t modifiers) {
	(void)character; (void)modifiers;
	inputs[input_count].run = current_run;
	inputs[input_count].key = key;
	inputs[input_count++].down = down;
}

// Replace only output/context boundaries, not timeline or presenter behavior.
void screenshot_set_output_dir(const char* directory) { (void)directory; }
bool screenshot_save_png(const char* filename, uint32_t width, uint32_t height, const uint8_t* rgba) {
	require(width == 2 && height == 1 && rgba != NULL, "capture uses the actual presented software surface");
	++captures;
	snprintf(capture_filename, sizeof(capture_filename), "%s", filename);
	return true;
}
bool host_control_capture_pending(void) { return false; }
const char* host_control_capture_filename(void) { return NULL; }
void host_control_capture_complete(uint32_t width, uint32_t height, bool saved) { (void)width; (void)height; (void)saved; }
bool bmsx_video_context_enable_gles2(void) { return false; }
void* bmsx_video_context_get_gl_proc(const char* name) { (void)name; return NULL; }
void bmsx_video_context_swap_buffers(void) { require(false, "software test never swaps a hardware context"); }

static void configure(const char* json, uint64_t guest_ticks) {
	char path[] = "/tmp/bmsx-input-timeline-test-XXXXXX";
	const int fd = mkstemp(path);
	require(fd >= 0, "create temporary timeline");
	const size_t length = strlen(json);
	require(write(fd, json, length) == (ssize_t)length && close(fd) == 0, "write complete timeline fixture");
	keyboard_input_set_callback((struct retro_keyboard_callback){key_event});
	active_domain = -1;
	current_run = 0;
	input_count = 0;
	captures = 0;
	input_timeline_configure(path, NULL, NULL, 10000, read_active_domain, guest_ticks);
	require(unlink(path) == 0, "timeline owns parsed input rather than the fixture file");
}

static const uint32_t pixels[2] = {0xff123456u, 0xffabcdefu};
static uint32_t surface_pixels[2];
static BmsxVideoSurface surface = {(uint8_t*)surface_pixels, 2, 1, 32, 8};
static BmsxFrameTimingState timing;

static void open_presenter(void) {
	memset(&timing, 0, sizeof(timing));
	video_presenter_open(&surface, &timing);
	const struct retro_system_av_info av = {{2, 1, 2, 1, 2.0f}, {100.0, 48000.0}};
	video_presenter_update_av_info(&av);
}

static void complete_run(bool drop, bool null_video, bool callback) {
	input_timeline_dispatch_before_run();
	video_presenter_begin_frame(drop);
	if (callback) video_presenter_refresh(null_video ? NULL : pixels, 2, 1, sizeof(pixels));
	require(video_presenter_end_frame() == (callback && !drop && !null_video), "shipping presenter drops and null callbacks do not present");
	require(input_timeline_finish_run(0), "legacy completion does not consult guest ticks");
}

static void input_clock(unsigned video_mode) {
	const bool drop_every_frame = video_mode == 1;
	const bool callback = video_mode != 2;
	configure("["
		"{\"frame\":0,\"event\":{\"type\":\"button\",\"code\":\"KeyB\",\"down\":true}},"
		"{\"frame\":1,\"event\":{\"type\":\"button\",\"code\":\"KeyB\",\"down\":false}},"
		"{\"frame\":2,\"repeat\":2,\"repeatEveryFrames\":2,\"event\":{\"type\":\"button\",\"code\":\"KeyA\",\"down\":true}},"
		"{\"frame\":3,\"repeat\":2,\"repeatEveryFrames\":2,\"event\":{\"type\":\"button\",\"code\":\"KeyA\",\"down\":false}}]", 0);
	open_presenter();
	for (unsigned bios = 0; bios < 12; ++bios) {
		complete_run(bios % 2 != 0, bios % 3 != 0, callback);
		require(input_count == 0 && !input_timeline_should_auto_quit(0), "BIOS runs and presentations neither start nor advance cartridge input");
	}
	// Activation occurs during the run, after its before-run input boundary.
	input_timeline_dispatch_before_run();
	active_domain = 0;
	video_presenter_begin_frame(drop_every_frame);
	if (callback) video_presenter_refresh(pixels, 2, 1, sizeof(pixels));
	require(input_count == 0, "first cartridge frame retains its original no-input startup ordering");
	require(input_timeline_finish_run(0), "legacy activation charges the first cartridge host call");
	for (current_run = 1; current_run <= 9; ++current_run) {
		// Once started, system execution within the cartridge session does not
		// reset its timeline or pause time (e.g. BIOS calls).
		active_domain = current_run == 3 ? -1 : 0;
		complete_run(drop_every_frame, drop_every_frame && current_run % 2 == 0, callback);
		require(input_timeline_should_auto_quit(2) == (current_run == 9), "trailing-frame autoquit follows completed runs, not successful presentations");
	}
	require(input_count == 8, "every expanded repeat is dispatched once");
	for (unsigned index = 0; index < input_count; ++index) {
		require(inputs[index].run == (index < 2 ? 1 : index)
			&& inputs[index].key == (index < 2 ? RETROK_b : RETROK_a)
			&& inputs[index].down == (index % 2 == 0), "input order and run index agree with or without every presentation dropped");
	}
	require(captures == 0, "an input-only performance timeline performs no capture");
	input_timeline_shutdown();
	video_presenter_close();
}

static void capture_observation(void) {
	configure("[{\"frame\":0,\"capture\":true},{\"frame\":2,\"capture\":true},"
		"{\"frame\":3,\"capture\":true},{\"frame\":7,\"capture\":true}]", 0);
	open_presenter();
	uint64_t frame = 99;
	for (unsigned poll = 0; poll < 20; ++poll)
		require(!input_timeline_consume_presented_capture(&frame), "pre-cartridge capture polling has no timeline side effects");
	complete_run(false, false, true);
	require(captures == 0, "a visible BIOS frame cannot consume a cartridge capture");
	input_timeline_dispatch_before_run();
	active_domain = 0;
	video_presenter_begin_frame(false);
	video_presenter_refresh(pixels, 2, 1, sizeof(pixels));
	require(captures == 1 && strcmp(capture_filename, "frame_00000.png") == 0, "first cartridge presentation captures frame zero before run completion");
	for (unsigned poll = 0; poll < 20; ++poll) {
		video_presenter_refresh(pixels, 2, 1, sizeof(pixels));
		require(!input_timeline_consume_presented_capture(&frame), "repeated capture polls do not advance to a future capture");
	}
	require(captures == 1, "repeated video callbacks consume a frame's capture only once");
	require(input_timeline_finish_run(0), "legacy presentation does not own the clock");
	complete_run(true, false, true);  // run 1
	complete_run(false, true, true);  // run 2: due capture remains pending
	complete_run(true, false, true);  // run 3: second pending capture
	require(captures == 1, "dropped and null presentation do not fabricate screenshots");
	complete_run(false, false, true); // run 4: existing latest-due capture coalescing
	require(captures == 2 && strcmp(capture_filename, "frame_00003.png") == 0,
		"next visible frame consumes the latest overdue capture label, not an exact historical image");
	complete_run(true, false, true);  // run 5
	complete_run(false, true, true);  // run 6
	complete_run(true, false, true);  // run 7
	require(!input_timeline_should_auto_quit(0), "autoquit still waits for pending requested capture consumption");
	complete_run(false, false, true); // run 8
	require(captures == 3 && strcmp(capture_filename, "frame_00007.png") == 0 && input_timeline_should_auto_quit(0),
		"last deferred capture is consumed without changing completed-run autoquit time");
	input_timeline_shutdown();
	video_presenter_close();
}

static void guest_tick_clock(void) {
	configure("["
		"{\"frame\":0,\"event\":{\"type\":\"button\",\"code\":\"KeyA\",\"down\":true}},"
		"{\"frame\":1,\"event\":{\"type\":\"button\",\"code\":\"KeyA\",\"down\":false}}]", 3);
	for (current_run = 0; current_run != 3; ++current_run) {
		input_timeline_dispatch_before_run();
		require(input_timeline_finish_run(1) && input_count == 0
			&& input_timeline_elapsed_frames() == 0, "completed BIOS ticks do not start cartridge playback");
	}
	active_domain = 0;
	require(input_timeline_finish_run(0), "a partial call can enter the cartridge without completing a tick");
	input_timeline_dispatch_before_run();
	require(input_count == 0 && input_timeline_finish_run(1) && input_timeline_elapsed_frames() == 0,
		"the first completed cartridge tick anchors the script but executes no scripted input");
	for (current_run = 4; current_run != 8; ++current_run) {
		input_timeline_dispatch_before_run();
		require(input_count == 1 && inputs[0].run == 4 && inputs[0].key == RETROK_a && inputs[0].down,
			"frame zero is sent once and remains held on retries");
		require(input_timeline_finish_run(0) && input_timeline_elapsed_frames() == 0,
			"maintenance and partial calls do not consume the script or its warmup clock");
	}
	require(!input_timeline_finish_run(2) && !input_timeline_finish_run(-1)
		&& input_timeline_elapsed_frames() == 0, "strict input cannot attribute skipped or rewound ticks");
	active_domain = -1;
	require(input_timeline_finish_run(1) && input_timeline_elapsed_frames() == 1,
		"the cartridge clock includes its BIOS work and does not require presentation");
	input_timeline_dispatch_before_run();
	require(input_count == 2 && inputs[1].run == 8 && inputs[1].key == RETROK_a && !inputs[1].down,
		"frame one follows the actual completion of frame zero");
	require(input_timeline_finish_run(1) && input_timeline_elapsed_frames() == 2, "the guest clock progresses exactly one tick");
	input_timeline_shutdown();
}

int main(void) {
	input_clock(0);
	input_clock(1);
	input_clock(2);
	capture_observation();
	guest_tick_clock();
	puts("Libretro input timeline clock tests passed");
	return 0;
}
