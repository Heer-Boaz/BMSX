#define _GNU_SOURCE

#include "video_context.h"

#include <dlfcn.h>
#include <EGL/egl.h>
#include <errno.h>
#include <fcntl.h>
#ifdef BMSX_LIBRETRO_HOST_SDL
#include <SDL.h>
#endif
#include <linux/fb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <unistd.h>

#include "host_fatal.h"

struct fbdev_window {
	uint16_t width;
	uint16_t height;
};

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

typedef struct BmsxVideoContext {
	BmsxVideoContextKind kind;
	BmsxVideoSurface surface;
	int framebuffer_fd;
	struct fb_fix_screeninfo framebuffer_fix;
	struct fb_var_screeninfo framebuffer_var;
	size_t framebuffer_map_size;
	struct fbdev_window framebuffer_window;
	EGLDisplay egl_display;
	EGLContext egl_context;
	EGLSurface egl_surface;
	void* egl_library;
	void* gles_library;
#ifdef BMSX_LIBRETRO_HOST_SDL
	SDL_Window* window;
	SDL_Renderer* renderer;
	SDL_Texture* texture;
	SDL_GLContext gl_context;
#endif
} BmsxVideoContext;

static BmsxVideoContext g_video_context = {
	.framebuffer_fd = -1,
	.egl_display = EGL_NO_DISPLAY,
	.egl_context = EGL_NO_CONTEXT,
	.egl_surface = EGL_NO_SURFACE,
};

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

#define ASSIGN_PROC(dst, src) do { \
	void* source_proc = (src); \
	memcpy(&(dst), &source_proc, sizeof(dst)); \
} while (0)

#define ASSIGN_EGL_PROC(dst, src) do { \
	__eglMustCastToProperFunctionPointerType source_proc = (src); \
	memcpy(&(dst), &source_proc, sizeof(dst)); \
} while (0)

#ifdef BMSX_LIBRETRO_HOST_SDL
static int map_window_axis_to_surface(int position, int window_extent, int surface_extent) {
	const int64_t numerator = (int64_t)position * surface_extent;
	return numerator < 0
		? (int)((numerator - window_extent + 1) / window_extent)
		: (int)(numerator / window_extent);
}
#endif

static void framebuffer_open(void) {
	BmsxVideoContext* context = &g_video_context;
	context->framebuffer_fd = open("/dev/fb0", O_RDWR);
	if (context->framebuffer_fd < 0) {
		host_fatal("Failed to open /dev/fb0: %s", strerror(errno));
	}
	if (ioctl(context->framebuffer_fd, FBIOGET_FSCREENINFO, &context->framebuffer_fix) != 0) {
		host_fatal("FBIOGET_FSCREENINFO failed: %s", strerror(errno));
	}
	if (ioctl(context->framebuffer_fd, FBIOGET_VSCREENINFO, &context->framebuffer_var) != 0) {
		host_fatal("FBIOGET_VSCREENINFO failed: %s", strerror(errno));
	}
	context->surface.width = (int)context->framebuffer_var.xres;
	context->surface.height = (int)context->framebuffer_var.yres;
	context->surface.bits_per_pixel = (int)context->framebuffer_var.bits_per_pixel;
	context->surface.stride = (int)context->framebuffer_fix.line_length;
	context->framebuffer_map_size = (size_t)context->framebuffer_fix.smem_len;
	context->surface.pixels = (uint8_t*)mmap(
			NULL,
			context->framebuffer_map_size,
			PROT_READ | PROT_WRITE,
			MAP_SHARED,
			context->framebuffer_fd,
			0);
	if (context->surface.pixels == MAP_FAILED) {
		host_fatal("mmap framebuffer failed: %s", strerror(errno));
	}
	fprintf(stderr,
			"[libretro-host] fbdev %dx%d bpp=%d stride=%d\n",
			context->surface.width,
			context->surface.height,
			context->surface.bits_per_pixel,
			context->surface.stride);
}

static void framebuffer_close(void) {
	BmsxVideoContext* context = &g_video_context;
	munmap(context->surface.pixels, context->framebuffer_map_size);
	close(context->framebuffer_fd);
}

static void egl_unload(void) {
	BmsxVideoContext* context = &g_video_context;
	if (context->egl_library) {
		dlclose(context->egl_library);
		context->egl_library = NULL;
	}
	if (context->gles_library) {
		dlclose(context->gles_library);
		context->gles_library = NULL;
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
	BmsxVideoContext* context = &g_video_context;
	context->gles_library = dlopen("libGLESv2.so.2", RTLD_LAZY | RTLD_GLOBAL);
	if (!context->gles_library) {
		context->gles_library = dlopen("libGLESv2.so", RTLD_LAZY | RTLD_GLOBAL);
	}
	context->egl_library = dlopen("libEGL.so.1", RTLD_LAZY | RTLD_LOCAL);
	if (!context->egl_library) {
		context->egl_library = dlopen("libEGL.so", RTLD_LAZY | RTLD_LOCAL);
	}
	if (!context->egl_library) {
		fprintf(stderr, "[libretro-host] dlopen(libEGL) failed: %s\n", dlerror());
		return false;
	}

	bool symbols_complete = true;
#define BMSX_RUNTIME_SYMBOL(name) do { \
	ASSIGN_PROC(name##_ptr, dlsym(context->egl_library, #name)); \
	symbols_complete = symbols_complete && name##_ptr != NULL; \
} while (0)
#include "egl_symbols.inc"
#undef BMSX_RUNTIME_SYMBOL
	if (!symbols_complete) {
		fprintf(stderr, "[libretro-host] egl symbols missing\n");
		egl_unload();
		return false;
	}
	return true;
}

static bool egl_open(void) {
	BmsxVideoContext* context = &g_video_context;
	if (!egl_load()) {
		return false;
	}
	if (!eglBindAPI_ptr(EGL_OPENGL_ES_API)) {
		fprintf(stderr, "[libretro-host] eglBindAPI failed\n");
		return false;
	}
	context->egl_display = eglGetDisplay_ptr(EGL_DEFAULT_DISPLAY);
	if (context->egl_display == EGL_NO_DISPLAY) {
		fprintf(stderr, "[libretro-host] eglGetDisplay failed\n");
		return false;
	}
	if (!eglInitialize_ptr(context->egl_display, NULL, NULL)) {
		fprintf(stderr, "[libretro-host] eglInitialize failed\n");
		return false;
	}

	const EGLint config_attributes[] = {
		EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
		EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
		EGL_RED_SIZE, 8,
		EGL_GREEN_SIZE, 8,
		EGL_BLUE_SIZE, 8,
		EGL_ALPHA_SIZE, 0,
		EGL_NONE,
	};
	EGLConfig config;
	EGLint config_count = 0;
	if (!eglChooseConfig_ptr(context->egl_display, config_attributes, &config, 1, &config_count) ||
			config_count == 0) {
		fprintf(stderr, "[libretro-host] eglChooseConfig failed\n");
		return false;
	}

	context->framebuffer_window.width = (uint16_t)context->surface.width;
	context->framebuffer_window.height = (uint16_t)context->surface.height;
	context->egl_surface = eglCreateWindowSurface_ptr(
			context->egl_display,
			config,
			(EGLNativeWindowType)&context->framebuffer_window,
			NULL);
	if (context->egl_surface == EGL_NO_SURFACE) {
		fprintf(stderr,
				"[libretro-host] eglCreateWindowSurface failed (0x%04x)\n",
				eglGetError_ptr());
		return false;
	}

	const EGLint context_attributes[] = {
		EGL_CONTEXT_CLIENT_VERSION, 2,
		EGL_NONE,
	};
	context->egl_context = eglCreateContext_ptr(
			context->egl_display,
			config,
			EGL_NO_CONTEXT,
			context_attributes);
	if (context->egl_context == EGL_NO_CONTEXT) {
		fprintf(stderr, "[libretro-host] eglCreateContext failed\n");
		return false;
	}
	if (!eglMakeCurrent_ptr(
			context->egl_display,
			context->egl_surface,
			context->egl_surface,
			context->egl_context)) {
		fprintf(stderr, "[libretro-host] eglMakeCurrent failed\n");
		return false;
	}
	eglSwapInterval_ptr(context->egl_display, 0);
	return true;
}

static void egl_close(void) {
	BmsxVideoContext* context = &g_video_context;
	if (context->egl_display != EGL_NO_DISPLAY) {
		eglMakeCurrent_ptr(context->egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
		if (context->egl_context != EGL_NO_CONTEXT) {
			eglDestroyContext_ptr(context->egl_display, context->egl_context);
		}
		if (context->egl_surface != EGL_NO_SURFACE) {
			eglDestroySurface_ptr(context->egl_display, context->egl_surface);
		}
		eglTerminate_ptr(context->egl_display);
	}
	egl_unload();
}

#ifdef BMSX_LIBRETRO_HOST_SDL
static void sdl_resize_software_surface(unsigned width, unsigned height) {
	BmsxVideoContext* context = &g_video_context;
	BmsxVideoSurface* surface = &context->surface;
	surface->width = (int)width;
	surface->height = (int)height;
	surface->bits_per_pixel = 32;
	surface->stride = (int)(width * 4u);
	const size_t pixel_bytes = (size_t)surface->stride * (size_t)surface->height;
	uint8_t* pixels = (uint8_t*)realloc(surface->pixels, pixel_bytes);
	if (!pixels) {
		host_fatal("realloc(%zu) failed", pixel_bytes);
	}
	surface->pixels = pixels;
	memset(surface->pixels, 0, pixel_bytes);
	if (context->texture) {
		SDL_DestroyTexture(context->texture);
	}
	context->texture = SDL_CreateTexture(
			context->renderer,
			SDL_PIXELFORMAT_XRGB8888,
			SDL_TEXTUREACCESS_STREAMING,
			surface->width,
			surface->height);
	if (!context->texture) {
		host_fatal("SDL_CreateTexture failed: %s", SDL_GetError());
	}
	SDL_RenderSetLogicalSize(context->renderer, surface->width, surface->height);
}

static void sdl_open(bool hidden_window) {
	BmsxVideoContext* context = &g_video_context;
	if (SDL_InitSubSystem(SDL_INIT_VIDEO) != 0) {
		host_fatal("SDL video initialization failed: %s", SDL_GetError());
	}
	SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "nearest");
	const unsigned frame_width = 320u;
	const unsigned frame_height = 240u;
	unsigned window_width = frame_width * 3u;
	unsigned window_height = frame_height * 3u;
	if (window_width < 640u) window_width = 640u;
	if (window_height < 480u) window_height = 480u;
	uint32_t window_flags = SDL_WINDOW_RESIZABLE;
	if (hidden_window) {
		window_flags |= SDL_WINDOW_HIDDEN;
	}
	if (context->kind == BMSX_VIDEO_CONTEXT_SDL_GLES2) {
		SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
		SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 2);
		SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
		SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
		window_flags |= SDL_WINDOW_OPENGL;
	}
	context->window = SDL_CreateWindow(
			"bmsx_libretro_host",
			SDL_WINDOWPOS_CENTERED,
			SDL_WINDOWPOS_CENTERED,
			(int)window_width,
			(int)window_height,
			(int)window_flags);
	if (!context->window) {
		host_fatal("SDL_CreateWindow failed: %s", SDL_GetError());
	}
	if (context->kind == BMSX_VIDEO_CONTEXT_SDL_GLES2) {
		context->gl_context = SDL_GL_CreateContext(context->window);
		if (!context->gl_context) {
			host_fatal("SDL_GL_CreateContext failed: %s", SDL_GetError());
		}
		if (SDL_GL_MakeCurrent(context->window, context->gl_context) != 0) {
			host_fatal("SDL_GL_MakeCurrent failed: %s", SDL_GetError());
		}
		SDL_GL_SetSwapInterval(0);
		context->surface.width = (int)frame_width;
		context->surface.height = (int)frame_height;
		context->surface.bits_per_pixel = 32;
		context->surface.stride = (int)(frame_width * 4u);
		bmsx_video_context_refresh_drawable_size();
	} else {
		context->renderer = SDL_CreateRenderer(context->window, -1, 0);
		if (!context->renderer) {
			host_fatal("SDL_CreateRenderer failed: %s", SDL_GetError());
		}
		sdl_resize_software_surface(frame_width, frame_height);
	}
}

static void sdl_close(void) {
	BmsxVideoContext* context = &g_video_context;
	if (context->texture) {
		SDL_DestroyTexture(context->texture);
	}
	if (context->gl_context) {
		SDL_GL_DeleteContext(context->gl_context);
	}
	if (context->renderer) {
		SDL_DestroyRenderer(context->renderer);
	}
	if (context->window) {
		SDL_DestroyWindow(context->window);
	}
	free(context->surface.pixels);
	SDL_QuitSubSystem(SDL_INIT_VIDEO);
}
#endif

BmsxVideoSurface* bmsx_video_context_open(
		BmsxVideoContextKind kind,
		bool hidden_window) {
	g_video_context.kind = kind;
	if (kind == BMSX_VIDEO_CONTEXT_FBDEV) {
		framebuffer_open();
	} else {
#ifdef BMSX_LIBRETRO_HOST_SDL
		sdl_open(hidden_window);
#else
		(void)hidden_window;
		host_fatal("SDL video backend not available in this build");
#endif
	}
	return &g_video_context.surface;
}

void bmsx_video_context_close(void) {
	if (g_video_context.kind == BMSX_VIDEO_CONTEXT_FBDEV) {
		egl_close();
		framebuffer_close();
	} else {
#ifdef BMSX_LIBRETRO_HOST_SDL
		sdl_close();
#endif
	}
	memset(&g_video_context, 0, sizeof(g_video_context));
	g_video_context.framebuffer_fd = -1;
	g_video_context.egl_display = EGL_NO_DISPLAY;
	g_video_context.egl_context = EGL_NO_CONTEXT;
	g_video_context.egl_surface = EGL_NO_SURFACE;
}

bool bmsx_video_context_enable_gles2(void) {
	if (g_video_context.kind == BMSX_VIDEO_CONTEXT_SDL_GLES2) {
		return true;
	}
	if (g_video_context.kind == BMSX_VIDEO_CONTEXT_SDL_SOFTWARE) {
		return false;
	}
	return egl_open();
}

void* bmsx_video_context_get_gl_proc(const char* name) {
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_video_context.kind == BMSX_VIDEO_CONTEXT_SDL_GLES2) {
		return SDL_GL_GetProcAddress(name);
	}
#endif
	void* proc = dlsym(g_video_context.gles_library, name);
	if (!proc) {
		ASSIGN_EGL_PROC(proc, eglGetProcAddress_ptr(name));
	}
	return proc;
}

void bmsx_video_context_swap_buffers(void) {
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_video_context.kind == BMSX_VIDEO_CONTEXT_SDL_GLES2) {
		SDL_GL_SwapWindow(g_video_context.window);
		return;
	}
#endif
	eglSwapBuffers_ptr(g_video_context.egl_display, g_video_context.egl_surface);
}

#ifdef BMSX_LIBRETRO_HOST_SDL
bool bmsx_video_context_prepare_software_frame(unsigned width, unsigned height) {
	if (g_video_context.kind == BMSX_VIDEO_CONTEXT_SDL_SOFTWARE &&
			(g_video_context.surface.width != (int)width ||
				g_video_context.surface.height != (int)height)) {
		sdl_resize_software_surface(width, height);
		return true;
	}
	return false;
}

bool bmsx_video_context_refresh_drawable_size(void) {
	if (g_video_context.kind == BMSX_VIDEO_CONTEXT_SDL_GLES2) {
		int drawable_width = 0;
		int drawable_height = 0;
		SDL_GL_GetDrawableSize(g_video_context.window, &drawable_width, &drawable_height);
		if (drawable_width > 0 && drawable_height > 0 &&
				(g_video_context.surface.width != drawable_width ||
					g_video_context.surface.height != drawable_height)) {
			g_video_context.surface.width = drawable_width;
			g_video_context.surface.height = drawable_height;
			g_video_context.surface.bits_per_pixel = 32;
			g_video_context.surface.stride = drawable_width * 4;
			return true;
		}
	}
	return false;
}

void bmsx_video_context_present_software(void) {
	BmsxVideoContext* context = &g_video_context;
	if (context->kind != BMSX_VIDEO_CONTEXT_SDL_SOFTWARE) {
		return;
	}
	SDL_UpdateTexture(context->texture, NULL, context->surface.pixels, context->surface.stride);
	SDL_RenderClear(context->renderer);
	SDL_RenderCopy(context->renderer, context->texture, NULL, NULL);
	SDL_RenderPresent(context->renderer);
}

bool bmsx_video_context_window_point_to_surface(
		int window_x,
		int window_y,
		int* surface_x,
		int* surface_y) {
	BmsxVideoContext* context = &g_video_context;
	if (context->kind == BMSX_VIDEO_CONTEXT_SDL_SOFTWARE) {
		SDL_Rect viewport;
		SDL_RenderGetViewport(context->renderer, &viewport);
		if (viewport.w <= 0 || viewport.h <= 0) {
			return false;
		}
		*surface_x = map_window_axis_to_surface(
				window_x - viewport.x,
				viewport.w,
				context->surface.width);
		*surface_y = map_window_axis_to_surface(
				window_y - viewport.y,
				viewport.h,
				context->surface.height);
		return true;
	}
	int window_width = 0;
	int window_height = 0;
	SDL_GetWindowSize(context->window, &window_width, &window_height);
	if (window_width <= 0 || window_height <= 0) {
		return false;
	}
	*surface_x = map_window_axis_to_surface(
			window_x,
			window_width,
			context->surface.width);
	*surface_y = map_window_axis_to_surface(
			window_y,
			window_height,
			context->surface.height);
	return true;
}
#endif
