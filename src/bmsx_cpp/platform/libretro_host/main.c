#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/fb.h>
#include <linux/input.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "libretro.h"

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

typedef struct FbDev {
	int fd;
	struct fb_fix_screeninfo fix;
	struct fb_var_screeninfo var;
	size_t map_size;
	uint8_t* map;
	int width;
	int height;
	int bpp;
	int stride;
} FbDev;

typedef struct InputDev {
	const char* path;
	int fd;
	int32_t hat_x;
	int32_t hat_y;
	uint16_t pad_state;
} InputDev;

static volatile sig_atomic_t g_should_quit = 0;
static bool g_input_debug = false;

static char g_system_dir[1024] = "";
static char g_save_dir[1024] = "";
static char g_opt_render_backend[16] = "software";
static char g_opt_crt_postprocessing[8] = "off";
static char g_opt_postprocess_detail[8] = "off";
static bool g_vars_updated = false;

static enum retro_pixel_format g_core_pixel_format = RETRO_PIXEL_FORMAT_XRGB8888;

static FbDev g_fb;
static InputDev g_input_devs[4];
static size_t g_input_dev_count = 0;
static uint16_t g_pad_state_port0 = 0;
static uint8_t* g_last_frame = NULL;
static size_t g_last_frame_size = 0;
static unsigned g_last_frame_w = 0;
static unsigned g_last_frame_h = 0;
static size_t g_last_frame_pitch = 0;

static void on_signal(int signum) {
	(void)signum;
	g_should_quit = 1;
}

static void die(const char* fmt, ...) {
	FILE* f = fopen("/var/log/bmsx_host.log", "a");
	va_list ap;
	va_list ap_copy;
	va_start(ap, fmt);
	va_copy(ap_copy, ap);
	vfprintf(stderr, fmt, ap);
	if (f) {
		vfprintf(f, fmt, ap_copy);
		fputc('\n', f);
		fclose(f);
	}
	va_end(ap_copy);
	va_end(ap);
	fputc('\n', stderr);
	exit(1);
}

static void host_log(enum retro_log_level level, const char* fmt, ...) {
	FILE* f = fopen("/var/log/bmsx_host.log", "a");
	const char* prefix = "INFO";
	switch (level) {
		case RETRO_LOG_DEBUG: prefix = "DEBUG"; break;
		case RETRO_LOG_INFO: prefix = "INFO"; break;
		case RETRO_LOG_WARN: prefix = "WARN"; break;
		case RETRO_LOG_ERROR: prefix = "ERROR"; break;
		default: break;
	}
	fprintf(stderr, "[libretro-host][%s] ", prefix);
	if (f) {
		fprintf(f, "[libretro-host][%s] ", prefix);
	}
	va_list ap;
	va_list ap_copy;
	va_start(ap, fmt);
	va_copy(ap_copy, ap);
	vfprintf(stderr, fmt, ap);
	if (f) {
		vfprintf(f, fmt, ap_copy);
		fputc('\n', f);
		fclose(f);
	}
	va_end(ap_copy);
	va_end(ap);
}

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
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL:
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
		case RETRO_ENVIRONMENT_SET_VARIABLES:
			return true;
		case RETRO_ENVIRONMENT_SET_VARIABLE: {
			const struct retro_variable* var = (const struct retro_variable*)data;
			if (strcmp(var->key, "bmsx_render_backend") == 0) {
				snprintf(g_opt_render_backend, sizeof(g_opt_render_backend), "%s", var->value);
				g_vars_updated = true;
				return true;
			}
			if (strcmp(var->key, "bmsx_crt_postprocessing") == 0) {
				snprintf(g_opt_crt_postprocessing, sizeof(g_opt_crt_postprocessing), "%s", var->value);
				g_vars_updated = true;
				return true;
			}
			if (strcmp(var->key, "bmsx_postprocess_detail") == 0) {
				snprintf(g_opt_postprocess_detail, sizeof(g_opt_postprocess_detail), "%s", var->value);
				g_vars_updated = true;
				return true;
			}
			return false;
		}
		case RETRO_ENVIRONMENT_GET_VARIABLE: {
			struct retro_variable* var = (struct retro_variable*)data;
			if (strcmp(var->key, "bmsx_render_backend") == 0) {
				var->value = g_opt_render_backend;
				return true;
			}
			if (strcmp(var->key, "bmsx_crt_postprocessing") == 0) {
				var->value = g_opt_crt_postprocessing;
				return true;
			}
			if (strcmp(var->key, "bmsx_postprocess_detail") == 0) {
				var->value = g_opt_postprocess_detail;
				return true;
			}
			return false;
		}
		case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: {
			bool* updated = (bool*)data;
			*updated = g_vars_updated;
			g_vars_updated = false;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_MESSAGE: {
			const struct retro_message* msg = (const struct retro_message*)data;
			fprintf(stderr, "[libretro-host][MSG] (%u) %s\n", msg->frames, msg->msg);
			return true;
		}
		case RETRO_ENVIRONMENT_GET_CAN_DUPE: {
			bool* can_dupe = (bool*)data;
			*can_dupe = true;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
			return true;
		case RETRO_ENVIRONMENT_SET_GEOMETRY:
			return true;
		case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: {
			const enum retro_pixel_format* fmt = (const enum retro_pixel_format*)data;
			g_core_pixel_format = *fmt;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_HW_RENDER:
			return false;
		case RETRO_ENVIRONMENT_SHUTDOWN:
			g_should_quit = 1;
			return true;
	default:
			return false;
	}
}

static void fb_draw_test_pattern(FbDev* fb);

static bool fb_init_try(FbDev* fb, const char* path) {
	memset(fb, 0, sizeof(*fb));
	fb->fd = open(path, O_RDWR);
	if (fb->fd < 0) {
		return false;
	}
	if (ioctl(fb->fd, FBIOGET_FSCREENINFO, &fb->fix) != 0) {
		close(fb->fd);
		fb->fd = -1;
		return false;
	}
	if (ioctl(fb->fd, FBIOGET_VSCREENINFO, &fb->var) != 0) {
		close(fb->fd);
		fb->fd = -1;
		return false;
	}
	fb->width = (int)fb->var.xres;
	fb->height = (int)fb->var.yres;
	fb->bpp = (int)fb->var.bits_per_pixel;
	fb->stride = (int)fb->fix.line_length;
	fb->map_size = (size_t)fb->fix.smem_len;
	fb->map = (uint8_t*)mmap(NULL, fb->map_size, PROT_READ | PROT_WRITE, MAP_SHARED, fb->fd, 0);
	if (fb->map == MAP_FAILED) {
		close(fb->fd);
		fb->fd = -1;
		return false;
	}
	fprintf(stderr, "[libretro-host] fbdev %dx%d bpp=%d stride=%d\n", fb->width, fb->height, fb->bpp, fb->stride);
	{
		FILE* f = fopen("/var/log/bmsx_host.log", "a");
		if (f) {
			fprintf(f, "[libretro-host] fbdev %dx%d bpp=%d stride=%d\n", fb->width, fb->height, fb->bpp, fb->stride);
			fclose(f);
		}
	}

	fb_draw_test_pattern(fb);
	{
		FILE* f = fopen("/var/log/bmsx_host.log", "a");
		if (f) {
			fprintf(f, "[libretro-host] fbdev test pattern drawn\n");
			fclose(f);
		}
	}
	return true;
}

static void fb_init(FbDev* fb, const char* path) {
	if (!fb_init_try(fb, path)) {
		die("Failed to open %s: %s", path, strerror(errno));
	}
}

static void fb_shutdown(FbDev* fb) {
	if (fb->map && fb->map != MAP_FAILED) {
		munmap(fb->map, fb->map_size);
	}
	if (fb->fd >= 0) {
		close(fb->fd);
	}
	memset(fb, 0, sizeof(*fb));
}

static void fb_init_auto(FbDev* fb) {
	const char* env_fb = getenv("BMSX_FBDEV");
	if (env_fb && env_fb[0] != '\0') {
		if (fb_init_try(fb, env_fb)) {
			FILE* f = fopen("/var/log/bmsx_host.log", "a");
			if (f) {
				fprintf(f, "[libretro-host] fbdev selected via BMSX_FBDEV=%s\n", env_fb);
				fclose(f);
			}
			return;
		}
	}

	const char* candidates[] = {
		"/dev/fb0",
		"/dev/fb1",
		"/dev/graphics/fb0",
		"/dev/graphics/fb1",
	};

	for (size_t i = 0; i < sizeof(candidates) / sizeof(candidates[0]); ++i) {
		if (fb_init_try(fb, candidates[i])) {
			FILE* f = fopen("/var/log/bmsx_host.log", "a");
			if (f) {
				fprintf(f, "[libretro-host] fbdev selected %s\n", candidates[i]);
				fclose(f);
			}
			return;
		}
	}

	die("Failed to open any framebuffer device");
}

static inline uint16_t rgb888_to_rgb565(uint8_t r, uint8_t g, uint8_t b) {
	return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

static inline uint32_t rgb565_to_xrgb8888(uint16_t p) {
	uint8_t r5 = (uint8_t)((p >> 11) & 0x1F);
	uint8_t g6 = (uint8_t)((p >> 5) & 0x3F);
	uint8_t b5 = (uint8_t)(p & 0x1F);
	uint8_t r = (uint8_t)((r5 << 3) | (r5 >> 2));
	uint8_t g = (uint8_t)((g6 << 2) | (g6 >> 4));
	uint8_t b = (uint8_t)((b5 << 3) | (b5 >> 2));
	return (uint32_t)((r << 16) | (g << 8) | b);
}

static void fb_draw_test_pattern(FbDev* fb) {
	if (!fb || !fb->map || fb->map == MAP_FAILED || fb->width <= 0 || fb->height <= 0) {
		return;
	}

	const uint32_t colors[] = {
		0x00ff0000, 0x0000ff00, 0x000000ff, 0x00ffff00,
		0x00ff00ff, 0x0000ffff, 0x00ffffff, 0x00000000,
	};
	const int bars = (int)(sizeof(colors) / sizeof(colors[0]));
	int bar_w = fb->width / bars;
	if (bar_w < 1) bar_w = 1;

	for (int y = 0; y < fb->height; ++y) {
		uint8_t* row = fb->map + (size_t)y * (size_t)fb->stride;
		for (int x = 0; x < fb->width; ++x) {
			int idx = x / bar_w;
			if (idx >= bars) idx = bars - 1;
			uint32_t c = colors[idx];
			if (fb->bpp == 32) {
				((uint32_t*)row)[x] = c;
			} else if (fb->bpp == 16) {
				uint8_t r = (uint8_t)((c >> 16) & 0xFF);
				uint8_t g = (uint8_t)((c >> 8) & 0xFF);
				uint8_t b = (uint8_t)(c & 0xFF);
				((uint16_t*)row)[x] = rgb888_to_rgb565(r, g, b);
			} else {
				return;
			}
		}
	}
}

static void video_cb(const void* data, unsigned width, unsigned height, size_t pitch) {
	static bool logged_first = false;
	static bool logged_null = false;
	static bool logged_zero = false;

	if (width == 0 || height == 0) {
		if (!logged_zero) {
			FILE* f = fopen("/var/log/bmsx_host.log", "a");
			if (f) {
				fprintf(f, "[libretro-host] video_cb: zero frame (w=%u h=%u pitch=%zu data=%p)\n",
					width, height, pitch, data);
				fclose(f);
			}
			logged_zero = true;
		}
		return;
	}

	const uint8_t* frame_data = (const uint8_t*)data;
	unsigned frame_w = width;
	unsigned frame_h = height;
	size_t frame_pitch = pitch;
	if (!frame_data) {
		if (!g_last_frame || g_last_frame_w == 0 || g_last_frame_h == 0) {
			if (!logged_null) {
				FILE* f = fopen("/var/log/bmsx_host.log", "a");
				if (f) {
					fprintf(f, "[libretro-host] video_cb: null frame with no cache (w=%u h=%u pitch=%zu)\n", width, height, pitch);
					fclose(f);
				}
				logged_null = true;
			}
			return;
		}
		frame_data = g_last_frame;
		frame_w = g_last_frame_w;
		frame_h = g_last_frame_h;
		frame_pitch = g_last_frame_pitch;
	} else {
		size_t needed = pitch * height;
		if (needed > g_last_frame_size) {
			uint8_t* next = (uint8_t*)realloc(g_last_frame, needed);
			if (!next) {
				return;
			}
			g_last_frame = next;
			g_last_frame_size = needed;
		}
		for (unsigned y = 0; y < height; ++y) {
			memcpy(g_last_frame + y * pitch, frame_data + y * pitch, pitch);
		}
		g_last_frame_w = width;
		g_last_frame_h = height;
		g_last_frame_pitch = pitch;
	}

	if (!logged_first) {
		FILE* f = fopen("/var/log/bmsx_host.log", "a");
		if (f) {
			fprintf(f, "[libretro-host] video_cb: frame=%ux%u pitch=%zu fmt=%d fb=%dx%d bpp=%d\n",
				frame_w, frame_h, frame_pitch, (int)g_core_pixel_format, g_fb.width, g_fb.height, g_fb.bpp);
			fclose(f);
		}
		logged_first = true;
	}

	const int fb_w = g_fb.width;
	const int fb_h = g_fb.height;

	int scale = 1;
	if (frame_w > 0 && frame_h > 0) {
		int scale_x = fb_w / (int)frame_w;
		int scale_y = fb_h / (int)frame_h;
		scale = scale_x < scale_y ? scale_x : scale_y;
		if (scale < 1) scale = 1;
	}

	const unsigned dst_w = frame_w * (unsigned)scale;
	const unsigned dst_h = frame_h * (unsigned)scale;

	int dst_x = (fb_w - (int)dst_w) / 2;
	int dst_y = (fb_h - (int)dst_h) / 2;
	if (dst_x < 0) dst_x = 0;
	if (dst_y < 0) dst_y = 0;

	unsigned copy_w = dst_w;
	unsigned copy_h = dst_h;
	if ((int)copy_w > fb_w - dst_x) copy_w = (unsigned)(fb_w - dst_x);
	if ((int)copy_h > fb_h - dst_y) copy_h = (unsigned)(fb_h - dst_y);

	if (g_fb.bpp == 16) {
		const bool src565 = (g_core_pixel_format == RETRO_PIXEL_FORMAT_RGB565);
		for (unsigned y = 0; y < copy_h; ++y) {
			const unsigned src_y = y / (unsigned)scale;
			uint8_t* dst_line = g_fb.map + (size_t)(dst_y + (int)y) * (size_t)g_fb.stride + (size_t)dst_x * 2u;
			uint16_t* dst = (uint16_t*)dst_line;
			const uint8_t* src_line = frame_data + src_y * frame_pitch;
			if (scale == 1 && src565) {
				memcpy(dst, src_line, copy_w * 2u);
				continue;
			}
			for (unsigned x = 0; x < copy_w; ++x) {
				const unsigned src_x = x / (unsigned)scale;
				if (src565) {
					const uint16_t* src = (const uint16_t*)src_line;
					dst[x] = src[src_x];
				} else {
					const uint32_t* src = (const uint32_t*)src_line;
					uint32_t p = src[src_x];
					uint8_t r = (uint8_t)((p >> 16) & 0xFF);
					uint8_t g = (uint8_t)((p >> 8) & 0xFF);
					uint8_t b = (uint8_t)(p & 0xFF);
					dst[x] = rgb888_to_rgb565(r, g, b);
				}
			}
		}
		return;
	}

	if (g_fb.bpp == 32) {
		const bool src8888 = (g_core_pixel_format == RETRO_PIXEL_FORMAT_XRGB8888);
		for (unsigned y = 0; y < copy_h; ++y) {
			const unsigned src_y = y / (unsigned)scale;
			uint8_t* dst_line = g_fb.map + (size_t)(dst_y + (int)y) * (size_t)g_fb.stride + (size_t)dst_x * 4u;
			uint32_t* dst = (uint32_t*)dst_line;
			const uint8_t* src_line = frame_data + src_y * frame_pitch;
			if (scale == 1 && src8888) {
				memcpy(dst, src_line, copy_w * 4u);
				continue;
			}
			for (unsigned x = 0; x < copy_w; ++x) {
				const unsigned src_x = x / (unsigned)scale;
				if (src8888) {
					const uint32_t* src = (const uint32_t*)src_line;
					dst[x] = src[src_x];
				} else {
					const uint16_t* src = (const uint16_t*)src_line;
					dst[x] = rgb565_to_xrgb8888(src[src_x]);
				}
			}
		}
		return;
	}

	die("Unsupported fbdev bpp: %d", g_fb.bpp);
}

static void audio_sample_cb(int16_t left, int16_t right) {
	(void)left;
	(void)right;
}

static size_t audio_batch_cb(const int16_t* data, size_t frames) {
	(void)data;
	return frames;
}

static uint16_t map_ev_key_to_pad(uint16_t code) {
	switch (code) {
		case KEY_UP:
		case BTN_DPAD_UP:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		case KEY_DOWN:
		case BTN_DPAD_DOWN:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		case KEY_LEFT:
		case BTN_DPAD_LEFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
		case KEY_RIGHT:
		case BTN_DPAD_RIGHT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);

		case BTN_TL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L);
		case BTN_TR:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R);

		case BTN_START:
		case KEY_ENTER:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START);
		case BTN_SELECT:
		case KEY_BACKSPACE:
		case KEY_ESC:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);

		case BTN_SOUTH:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B);
		case BTN_EAST:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A);
		case BTN_NORTH:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X);
		case BTN_WEST:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y);
		default:
			return 0;
	}
}

static void input_open_default_devices(void) {
	static const char* paths[] = {
		"/dev/input/event0",
		"/dev/input/event1",
		"/dev/input/event2",
		"/dev/input/event3",
	};
	for (size_t i = 0; i < sizeof(paths) / sizeof(paths[0]); ++i) {
		int fd = open(paths[i], O_RDONLY | O_NONBLOCK);
		if (fd < 0) {
			fprintf(stderr, "[libretro-host] Failed to open %s: %s\n", paths[i], strerror(errno));
			continue;
		}
		InputDev dev = {
			.path = paths[i],
			.fd = fd,
			.hat_x = 0,
			.hat_y = 0,
			.pad_state = 0,
		};
		g_input_devs[g_input_dev_count++] = dev;
		fprintf(stderr, "[libretro-host] input %s opened\n", paths[i]);
		if (g_input_dev_count == sizeof(g_input_devs) / sizeof(g_input_devs[0])) {
			break;
		}
	}
	if (g_input_dev_count == 0) {
		die("No input devices opened. Are you running as root / do you have permissions for /dev/input/event*?");
	}
}

static void poll_input_devices(void) {
	uint16_t merged = 0;
	for (size_t i = 0; i < g_input_dev_count; ++i) {
		InputDev* dev = &g_input_devs[i];
		struct input_event ev;
		for (;;) {
			ssize_t n = read(dev->fd, &ev, sizeof(ev));
			if (n < 0) {
				if (errno == EAGAIN || errno == EWOULDBLOCK) {
					break;
				}
				die("read(%s) failed: %s", dev->path, strerror(errno));
			}
			if (n == 0) {
				break;
			}
			if ((size_t)n != sizeof(ev)) {
				die("Short read from %s: %zd", dev->path, n);
			}

			if (g_input_debug) {
				fprintf(stderr, "[libretro-host][input] %s type=%u code=%u value=%d\n",
						dev->path, ev.type, ev.code, ev.value);
			}

			if (ev.type == EV_KEY) {
				const uint16_t bit = map_ev_key_to_pad(ev.code);
				if (bit) {
					if (ev.value) {
						dev->pad_state |= bit;
					} else {
						dev->pad_state &= (uint16_t)~bit;
					}
				}
			} else if (ev.type == EV_ABS) {
				if (ev.code == ABS_HAT0X) {
					dev->hat_x = ev.value;
				} else if (ev.code == ABS_HAT0Y) {
					dev->hat_y = ev.value;
				}
			}
		}

		merged |= dev->pad_state;
		if (dev->hat_x < 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
		if (dev->hat_x > 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
		if (dev->hat_y < 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		if (dev->hat_y > 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
	}
	g_pad_state_port0 = merged;
	if (g_input_debug) {
		fprintf(stderr, "[libretro-host][input] port0=0x%04x\n", g_pad_state_port0);
	}
}

static void input_poll_cb(void) {
	poll_input_devices();
}

static int16_t input_state_cb(unsigned port, unsigned device, unsigned index, unsigned id) {
	(void)index;
	if (port != 0) {
		return 0;
	}
	if (device != RETRO_DEVICE_JOYPAD) {
		return 0;
	}
	return (g_pad_state_port0 & (uint16_t)(1u << id)) ? 1 : 0;
}

static void* read_file(const char* path, size_t* out_size) {
	int fd = open(path, O_RDONLY);
	if (fd < 0) {
		die("Failed to open %s: %s", path, strerror(errno));
	}
	struct stat st;
	if (fstat(fd, &st) != 0) {
		die("fstat(%s) failed: %s", path, strerror(errno));
	}
	if (st.st_size <= 0) {
		die("File is empty: %s", path);
	}
	size_t size = (size_t)st.st_size;
	void* buf = malloc(size);
	if (!buf) {
		die("malloc(%zu) failed", size);
	}
	size_t off = 0;
	while (off < size) {
		ssize_t n = read(fd, (uint8_t*)buf + off, size - off);
		if (n < 0) {
			die("read(%s) failed: %s", path, strerror(errno));
		}
		if (n == 0) {
			die("Unexpected EOF while reading %s", path);
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
		die("Missing symbol %s: %s", name, dlerror());
	}
	memcpy(out_fn_ptr, &sym, sizeof(sym));
}

static void load_core(LibretroCore* core, const char* path) {
	memset(core, 0, sizeof(*core));
	core->handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
	if (!core->handle) {
		die("dlopen(%s) failed: %s", path, dlerror());
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
			"  %s --core ./bmsx_libretro.so --no-game [--backend software|gles2] [--system-dir PATH] [--save-dir PATH] [--input-debug]\n"
			"  %s --core ./bmsx_libretro.so GAME.rom [--backend software|gles2] [--system-dir PATH] [--save-dir PATH] [--input-debug]\n",
			argv0, argv0);
	exit(2);
}

int main(int argc, char** argv) {
	const char* core_path = "./bmsx_libretro.so";
	const char* game_path = NULL;
	bool no_game = false;
	const char* system_dir = "";
	const char* save_dir = "";
	const char* backend = "software";

	for (int i = 1; i < argc; ++i) {
		if (strcmp(argv[i], "--core") == 0) {
			if (i + 1 >= argc) usage(argv[0]);
			core_path = argv[++i];
			continue;
		}
		if (strcmp(argv[i], "--no-game") == 0) {
			no_game = true;
			continue;
		}
		if (strcmp(argv[i], "--system-dir") == 0) {
			if (i + 1 >= argc) usage(argv[0]);
			system_dir = argv[++i];
			continue;
		}
		if (strcmp(argv[i], "--save-dir") == 0) {
			if (i + 1 >= argc) usage(argv[0]);
			save_dir = argv[++i];
			continue;
		}
		if (strcmp(argv[i], "--backend") == 0) {
			if (i + 1 >= argc) usage(argv[0]);
			backend = argv[++i];
			continue;
		}
		if (strcmp(argv[i], "--input-debug") == 0) {
			g_input_debug = true;
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
		die("Invalid --backend %s (expected software|gles2)", backend);
	}

	snprintf(g_system_dir, sizeof(g_system_dir), "%s", system_dir);
	snprintf(g_save_dir, sizeof(g_save_dir), "%s", save_dir);
	snprintf(g_opt_render_backend, sizeof(g_opt_render_backend), "%s", backend);

	signal(SIGINT, on_signal);
	signal(SIGTERM, on_signal);

	LibretroCore core;
	load_core(&core, core_path);

	core.retro_set_environment(environ_cb);
	core.retro_set_video_refresh(video_cb);
	core.retro_set_audio_sample(audio_sample_cb);
	core.retro_set_audio_sample_batch(audio_batch_cb);
	core.retro_set_input_poll(input_poll_cb);
	core.retro_set_input_state(input_state_cb);

	core.retro_init();

	struct retro_system_info sysinfo;
	memset(&sysinfo, 0, sizeof(sysinfo));
	core.retro_get_system_info(&sysinfo);
	fprintf(stderr, "[libretro-host] core=%s v%s api=%u\n",
			sysinfo.library_name ? sysinfo.library_name : "(unknown)",
			sysinfo.library_version ? sysinfo.library_version : "(unknown)",
			core.retro_api_version());

	struct retro_system_av_info av;
	memset(&av, 0, sizeof(av));
	core.retro_get_system_av_info(&av);
	fprintf(stderr, "[libretro-host] av: base=%ux%u max=%ux%u fps=%.2f sr=%.2f\n",
			av.geometry.base_width, av.geometry.base_height,
			av.geometry.max_width, av.geometry.max_height,
			av.timing.fps, av.timing.sample_rate);

	fb_init(&g_fb, "/dev/fb0");
	input_open_default_devices();
	core.retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);

	void* game_buf = NULL;
	size_t game_size = 0;
	struct retro_game_info game_info;
	memset(&game_info, 0, sizeof(game_info));
	bool loaded_ok = false;
	if (no_game) {
		loaded_ok = core.retro_load_game(NULL);
	} else {
		game_buf = read_file(game_path, &game_size);
		game_info.path = game_path;
		game_info.data = game_buf;
		game_info.size = game_size;
		game_info.meta = NULL;
		loaded_ok = core.retro_load_game(&game_info);
	}
	if (!loaded_ok) {
		die("retro_load_game failed");
	}

	double fps = av.timing.fps;
	if (fps <= 0.0) {
		fps = 60.0;
	}
	const long frame_ns = (long)(1000000000.0 / fps);

	while (!g_should_quit) {
		struct timespec start;
		clock_gettime(CLOCK_MONOTONIC, &start);
		core.retro_run();
		struct timespec end;
		clock_gettime(CLOCK_MONOTONIC, &end);

		long elapsed_ns = (end.tv_sec - start.tv_sec) * 1000000000L + (end.tv_nsec - start.tv_nsec);
		long sleep_ns = frame_ns - elapsed_ns;
		if (sleep_ns > 0) {
			struct timespec ts;
			ts.tv_sec = sleep_ns / 1000000000L;
			ts.tv_nsec = sleep_ns % 1000000000L;
			nanosleep(&ts, NULL);
		}
	}

	core.retro_unload_game();
	core.retro_deinit();

	for (size_t i = 0; i < g_input_dev_count; ++i) {
		if (g_input_devs[i].fd >= 0) {
			close(g_input_devs[i].fd);
		}
	}
	fb_shutdown(&g_fb);
	if (game_buf) {
		free(game_buf);
	}
	if (core.handle) {
		dlclose(core.handle);
	}
	return 0;
}
