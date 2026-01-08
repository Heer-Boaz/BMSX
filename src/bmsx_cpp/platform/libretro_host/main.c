#define _GNU_SOURCE

#include <dlfcn.h>
#include <EGL/egl.h>
#include <errno.h>
#include <fcntl.h>
#include <GLES2/gl2.h>
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
#include <ucontext.h>

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
static struct retro_hw_render_callback g_hw_render;
static bool g_use_hw_render = false;
static bool g_hw_context_pending_reset = false;
static EGLDisplay g_egl_display = EGL_NO_DISPLAY;
static EGLContext g_egl_context = EGL_NO_CONTEXT;
static EGLSurface g_egl_surface = EGL_NO_SURFACE;
static void* g_egl_lib = NULL;
static void* g_gles_lib = NULL;

struct fbdev_window {
	uint16_t width;
	uint16_t height;
};

static struct fbdev_window g_fbwin;

typedef EGLDisplay (EGLAPIENTRYP PFNEGLGETDISPLAY)(EGLNativeDisplayType display_id);
typedef EGLBoolean (EGLAPIENTRYP PFNEGLBINDAPI)(EGLenum api);
typedef EGLBoolean (EGLAPIENTRYP PFNEGLINITIALIZE)(EGLDisplay dpy, EGLint* major, EGLint* minor);
typedef EGLBoolean (EGLAPIENTRYP PFNEGLCHOOSECONFIG)(EGLDisplay dpy, const EGLint* attrib_list, EGLConfig* configs, EGLint config_size, EGLint* num_config);
typedef EGLSurface (EGLAPIENTRYP PFNEGLCREATEWINDOWSURFACE)(EGLDisplay dpy, EGLConfig config, EGLNativeWindowType win, const EGLint* attrib_list);
typedef EGLContext (EGLAPIENTRYP PFNEGLCREATECONTEXT)(EGLDisplay dpy, EGLConfig config, EGLContext share_context, const EGLint* attrib_list);
typedef EGLBoolean (EGLAPIENTRYP PFNEGLMAKECURRENT)(EGLDisplay dpy, EGLSurface draw, EGLSurface read, EGLContext ctx);
typedef EGLBoolean (EGLAPIENTRYP PFNEGLSWAPINTERVAL)(EGLDisplay dpy, EGLint interval);
typedef EGLBoolean (EGLAPIENTRYP PFNEGLSWAPBUFFERS)(EGLDisplay dpy, EGLSurface surface);
typedef EGLBoolean (EGLAPIENTRYP PFNEGLDESTROYCONTEXT)(EGLDisplay dpy, EGLContext ctx);
typedef EGLBoolean (EGLAPIENTRYP PFNEGLDESTROYSURFACE)(EGLDisplay dpy, EGLSurface surface);
typedef EGLBoolean (EGLAPIENTRYP PFNEGLTERMINATE)(EGLDisplay dpy);
typedef EGLint (EGLAPIENTRYP PFNEGLGETERROR)(void);
typedef __eglMustCastToProperFunctionPointerType (EGLAPIENTRYP PFNEGLGETPROCADDRESS)(const char* procname);

static PFNEGLGETDISPLAY eglGetDisplay_ptr = NULL;
static PFNEGLBINDAPI eglBindAPI_ptr = NULL;
static PFNEGLINITIALIZE eglInitialize_ptr = NULL;
static PFNEGLCHOOSECONFIG eglChooseConfig_ptr = NULL;
static PFNEGLCREATEWINDOWSURFACE eglCreateWindowSurface_ptr = NULL;
static PFNEGLCREATECONTEXT eglCreateContext_ptr = NULL;
static PFNEGLMAKECURRENT eglMakeCurrent_ptr = NULL;
static PFNEGLSWAPINTERVAL eglSwapInterval_ptr = NULL;
static PFNEGLSWAPBUFFERS eglSwapBuffers_ptr = NULL;
static PFNEGLDESTROYCONTEXT eglDestroyContext_ptr = NULL;
static PFNEGLDESTROYSURFACE eglDestroySurface_ptr = NULL;
static PFNEGLTERMINATE eglTerminate_ptr = NULL;
static PFNEGLGETERROR eglGetError_ptr = NULL;
static PFNEGLGETPROCADDRESS eglGetProcAddress_ptr = NULL;

static FbDev g_fb;
static InputDev g_input_devs[4];
static size_t g_input_dev_count = 0;
static uint16_t g_pad_state_port0 = 0;

static void crash_handler(int sig, siginfo_t* si, void* ctx_) {
  ucontext_t* uc = (ucontext_t*)ctx_;

#if defined(__arm__)
  unsigned long pc = uc->uc_mcontext.arm_pc;
  unsigned long lr = uc->uc_mcontext.arm_lr;
  unsigned long sp = uc->uc_mcontext.arm_sp;
  fprintf(stderr, "\nCRASH sig=%d addr=%p pc=%08lx lr=%08lx sp=%08lx\n",
          sig, si->si_addr, pc, lr, sp);
#elif defined(__aarch64__)
  unsigned long pc = uc->uc_mcontext.pc;
  unsigned long sp = uc->uc_mcontext.sp;
  fprintf(stderr, "\nCRASH sig=%d addr=%p pc=%016lx sp=%016lx\n",
          sig, si->si_addr, pc, sp);
#else
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

static void die(const char* fmt, ...) {
	va_list ap;
	va_start(ap, fmt);
	vfprintf(stderr, fmt, ap);
	va_end(ap);
	fputc('\n', stderr);
	exit(1);
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

static uintptr_t RETRO_CALLCONV hw_get_current_framebuffer(void) {
	return 0;
}

static retro_proc_address_t RETRO_CALLCONV hw_get_proc_address(const char* sym) {
	if (sym && g_gles_lib) {
		void* proc = dlsym(g_gles_lib, sym);
		if (proc) {
			return (retro_proc_address_t)proc;
		}
	}
	if (!eglGetProcAddress_ptr) {
		return NULL;
	}
	return (retro_proc_address_t)eglGetProcAddress_ptr(sym);
}

static void egl_unload(void) {
	if (g_egl_lib) {
		dlclose(g_egl_lib);
		g_egl_lib = NULL;
	}
	if (g_gles_lib) {
		dlclose(g_gles_lib);
		g_gles_lib = NULL;
	}
	eglGetDisplay_ptr = NULL;
	eglBindAPI_ptr = NULL;
	eglInitialize_ptr = NULL;
	eglChooseConfig_ptr = NULL;
	eglCreateWindowSurface_ptr = NULL;
	eglCreateContext_ptr = NULL;
	eglMakeCurrent_ptr = NULL;
	eglSwapInterval_ptr = NULL;
	eglSwapBuffers_ptr = NULL;
	eglDestroyContext_ptr = NULL;
	eglDestroySurface_ptr = NULL;
	eglTerminate_ptr = NULL;
	eglGetError_ptr = NULL;
	eglGetProcAddress_ptr = NULL;
}

static bool egl_load(void) {
	if (g_egl_lib) {
		return true;
	}
	g_gles_lib = dlopen("libGLESv2.so.2", RTLD_LAZY | RTLD_GLOBAL);
	if (!g_gles_lib) {
		g_gles_lib = dlopen("libGLESv2.so", RTLD_LAZY | RTLD_GLOBAL);
	}
	g_egl_lib = dlopen("libEGL.so.1", RTLD_LAZY | RTLD_LOCAL);
	if (!g_egl_lib) {
		g_egl_lib = dlopen("libEGL.so", RTLD_LAZY | RTLD_LOCAL);
	}
	if (!g_egl_lib) {
		fprintf(stderr, "[libretro-host] dlopen(libEGL) failed: %s\n", dlerror());
		return false;
	}

	eglGetDisplay_ptr = (PFNEGLGETDISPLAY)dlsym(g_egl_lib, "eglGetDisplay");
	eglBindAPI_ptr = (PFNEGLBINDAPI)dlsym(g_egl_lib, "eglBindAPI");
	eglInitialize_ptr = (PFNEGLINITIALIZE)dlsym(g_egl_lib, "eglInitialize");
	eglChooseConfig_ptr = (PFNEGLCHOOSECONFIG)dlsym(g_egl_lib, "eglChooseConfig");
	eglCreateWindowSurface_ptr = (PFNEGLCREATEWINDOWSURFACE)dlsym(g_egl_lib, "eglCreateWindowSurface");
	eglCreateContext_ptr = (PFNEGLCREATECONTEXT)dlsym(g_egl_lib, "eglCreateContext");
	eglMakeCurrent_ptr = (PFNEGLMAKECURRENT)dlsym(g_egl_lib, "eglMakeCurrent");
	eglSwapInterval_ptr = (PFNEGLSWAPINTERVAL)dlsym(g_egl_lib, "eglSwapInterval");
	eglSwapBuffers_ptr = (PFNEGLSWAPBUFFERS)dlsym(g_egl_lib, "eglSwapBuffers");
	eglDestroyContext_ptr = (PFNEGLDESTROYCONTEXT)dlsym(g_egl_lib, "eglDestroyContext");
	eglDestroySurface_ptr = (PFNEGLDESTROYSURFACE)dlsym(g_egl_lib, "eglDestroySurface");
	eglTerminate_ptr = (PFNEGLTERMINATE)dlsym(g_egl_lib, "eglTerminate");
	eglGetError_ptr = (PFNEGLGETERROR)dlsym(g_egl_lib, "eglGetError");
	eglGetProcAddress_ptr = (PFNEGLGETPROCADDRESS)dlsym(g_egl_lib, "eglGetProcAddress");

	if (!eglGetDisplay_ptr || !eglBindAPI_ptr || !eglInitialize_ptr || !eglChooseConfig_ptr ||
		!eglCreateWindowSurface_ptr || !eglCreateContext_ptr ||
		!eglMakeCurrent_ptr || !eglSwapInterval_ptr || !eglSwapBuffers_ptr ||
		!eglDestroyContext_ptr || !eglDestroySurface_ptr || !eglTerminate_ptr || !eglGetError_ptr ||
		!eglGetProcAddress_ptr) {
		fprintf(stderr, "[libretro-host] egl symbols missing\n");
		egl_unload();
		return false;
	}
	return true;
}

static bool egl_init(void) {
	EGLint err = EGL_SUCCESS;
	if (!egl_load()) {
		return false;
	}
	if (!eglBindAPI_ptr(EGL_OPENGL_ES_API)) {
		fprintf(stderr, "[libretro-host] eglBindAPI failed\n");
		return false;
	}
	g_egl_display = eglGetDisplay_ptr(EGL_DEFAULT_DISPLAY);
	if (g_egl_display == EGL_NO_DISPLAY) {
		fprintf(stderr, "[libretro-host] eglGetDisplay failed\n");
		return false;
	}
	if (!eglInitialize_ptr(g_egl_display, NULL, NULL)) {
		err = eglGetError_ptr();
		fprintf(stderr, "[libretro-host] eglInitialize failed\n");
		return false;
	}

	const EGLint config_attrs[] = {
		EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
		EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
		EGL_RED_SIZE, 8,
		EGL_GREEN_SIZE, 8,
		EGL_BLUE_SIZE, 8,
		EGL_ALPHA_SIZE, 0,
		EGL_NONE
	};
	EGLConfig config;
	EGLint num_configs = 0;
	if (!eglChooseConfig_ptr(g_egl_display, config_attrs, &config, 1, &num_configs) || num_configs == 0) {
		err = eglGetError_ptr();
		fprintf(stderr, "[libretro-host] eglChooseConfig failed\n");
		return false;
	}

	g_fbwin.width = (uint16_t)(g_fb.width > 0 ? g_fb.width : 1280);
	g_fbwin.height = (uint16_t)(g_fb.height > 0 ? g_fb.height : 720);
	g_egl_surface = eglCreateWindowSurface_ptr(
		g_egl_display,
		config,
		(EGLNativeWindowType)&g_fbwin,
		NULL
	);
	if (g_egl_surface == EGL_NO_SURFACE) {
		err = eglGetError_ptr();
		fprintf(stderr, "[libretro-host] eglCreateWindowSurface failed (0x%04x)\n", err);
		return false;
	}

	const EGLint ctx_attrs[] = {
		EGL_CONTEXT_CLIENT_VERSION, 2,
		EGL_NONE
	};
	g_egl_context = eglCreateContext_ptr(g_egl_display, config, EGL_NO_CONTEXT, ctx_attrs);
	if (g_egl_context == EGL_NO_CONTEXT) {
		err = eglGetError_ptr();
		fprintf(stderr, "[libretro-host] eglCreateContext failed\n");
		return false;
	}

	if (!eglMakeCurrent_ptr(g_egl_display, g_egl_surface, g_egl_surface, g_egl_context)) {
		err = eglGetError_ptr();
		fprintf(stderr, "[libretro-host] eglMakeCurrent failed\n");
		return false;
	}
	eglSwapInterval_ptr(g_egl_display, 1);
	return true;
}

static void egl_shutdown(void) {
	if (g_egl_display == EGL_NO_DISPLAY) {
		return;
	}
	eglMakeCurrent_ptr(g_egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
	if (g_egl_context != EGL_NO_CONTEXT) {
		eglDestroyContext_ptr(g_egl_display, g_egl_context);
		g_egl_context = EGL_NO_CONTEXT;
	}
	if (g_egl_surface != EGL_NO_SURFACE) {
		eglDestroySurface_ptr(g_egl_display, g_egl_surface);
		g_egl_surface = EGL_NO_SURFACE;
	}
	eglTerminate_ptr(g_egl_display);
	g_egl_display = EGL_NO_DISPLAY;
	egl_unload();
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
		case RETRO_ENVIRONMENT_SET_HW_RENDER: {
			struct retro_hw_render_callback* cb = (struct retro_hw_render_callback*)data;
			if (cb->context_type != RETRO_HW_CONTEXT_OPENGLES2) {
				return false;
			}
			cb->get_current_framebuffer = hw_get_current_framebuffer;
			cb->get_proc_address = hw_get_proc_address;
			g_hw_render = *cb;
			if (!egl_init()) {
				return false;
			}
			g_use_hw_render = true;
			g_hw_context_pending_reset = (g_hw_render.context_reset != NULL);
			return true;
		}
		case RETRO_ENVIRONMENT_SHUTDOWN:
			g_should_quit = 1;
			return true;
	default:
			return false;
	}
}

static void fb_init(FbDev* fb, const char* path) {
	memset(fb, 0, sizeof(*fb));
	fb->fd = open(path, O_RDWR);
	if (fb->fd < 0) {
		die("Failed to open %s: %s", path, strerror(errno));
	}
	if (ioctl(fb->fd, FBIOGET_FSCREENINFO, &fb->fix) != 0) {
		die("FBIOGET_FSCREENINFO failed: %s", strerror(errno));
	}
	if (ioctl(fb->fd, FBIOGET_VSCREENINFO, &fb->var) != 0) {
		die("FBIOGET_VSCREENINFO failed: %s", strerror(errno));
	}
	fb->width = (int)fb->var.xres;
	fb->height = (int)fb->var.yres;
	fb->bpp = (int)fb->var.bits_per_pixel;
	fb->stride = (int)fb->fix.line_length;
	fb->map_size = (size_t)fb->fix.smem_len;
	fb->map = (uint8_t*)mmap(NULL, fb->map_size, PROT_READ | PROT_WRITE, MAP_SHARED, fb->fd, 0);
	if (fb->map == MAP_FAILED) {
		die("mmap framebuffer failed: %s", strerror(errno));
	}
	fprintf(stderr, "[libretro-host] fbdev %dx%d bpp=%d stride=%d\n", fb->width, fb->height, fb->bpp, fb->stride);
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

static void video_cb(const void* data, unsigned width, unsigned height, size_t pitch) {
	if (g_use_hw_render && data == RETRO_HW_FRAME_BUFFER_VALID) {
		eglSwapBuffers_ptr(g_egl_display, g_egl_surface);
		return;
	}
	if (!data) {
		return;
	}

	const int fb_w = g_fb.width;
	const int fb_h = g_fb.height;

	int dst_x = (fb_w - (int)width) / 2;
	int dst_y = (fb_h - (int)height) / 2;
	if (dst_x < 0) dst_x = 0;
	if (dst_y < 0) dst_y = 0;

	unsigned copy_w = width;
	unsigned copy_h = height;
	if ((int)copy_w > fb_w - dst_x) copy_w = (unsigned)(fb_w - dst_x);
	if ((int)copy_h > fb_h - dst_y) copy_h = (unsigned)(fb_h - dst_y);

	if (g_fb.bpp == 16) {
		for (unsigned y = 0; y < copy_h; ++y) {
			uint8_t* dst_line = g_fb.map + (size_t)(dst_y + (int)y) * (size_t)g_fb.stride + (size_t)dst_x * 2u;
			uint16_t* dst = (uint16_t*)dst_line;
			const uint8_t* src_line = (const uint8_t*)data + y * pitch;
			if (g_core_pixel_format == RETRO_PIXEL_FORMAT_RGB565) {
				memcpy(dst, src_line, copy_w * 2u);
			} else {
				const uint32_t* src = (const uint32_t*)src_line;
				for (unsigned x = 0; x < copy_w; ++x) {
					uint32_t p = src[x];
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
		for (unsigned y = 0; y < copy_h; ++y) {
			uint8_t* dst_line = g_fb.map + (size_t)(dst_y + (int)y) * (size_t)g_fb.stride + (size_t)dst_x * 4u;
			uint32_t* dst = (uint32_t*)dst_line;
			const uint8_t* src_line = (const uint8_t*)data + y * pitch;
			if (g_core_pixel_format == RETRO_PIXEL_FORMAT_XRGB8888) {
				memcpy(dst, src_line, copy_w * 4u);
			} else {
				const uint16_t* src = (const uint16_t*)src_line;
				for (unsigned x = 0; x < copy_w; ++x) {
					dst[x] = rgb565_to_xrgb8888(src[x]);
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
	install_crash_handlers();
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

	fb_init(&g_fb, "/dev/fb0");
	input_open_default_devices();

	core.retro_init();
	if (g_use_hw_render && g_hw_context_pending_reset && g_hw_render.context_reset) {
		g_hw_render.context_reset();
		g_hw_context_pending_reset = false;
	}

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
		fps = 50.0;
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
	if (g_use_hw_render && g_hw_render.context_destroy) {
		g_hw_render.context_destroy();
	}
	egl_shutdown();
	return 0;
}
