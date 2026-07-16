#define _GNU_SOURCE

#include <dirent.h>
#include <limits.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <GLES2/gl2.h>
#ifdef BMSX_LIBRETRO_HOST_SDL
#include <SDL.h>
#endif
#include <linux/input.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
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
#include "input_timeline.h"
#include "keyboard_input.h"
#include "screenshot.h"
#include "video_context.h"

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

typedef struct InputDev {
	const char* path;
	int fd;
	int32_t hat_x;
	int32_t hat_y;
	int32_t hat_x_min;
	int32_t hat_x_max;
	int32_t hat_y_min;
	int32_t hat_y_max;
	int32_t abs_x;
	int32_t abs_y;
	int32_t abs_x_min;
	int32_t abs_x_max;
	int32_t abs_y_min;
	int32_t abs_y_max;
	bool hat_x_valid;
	bool hat_y_valid;
	bool has_hat;
	bool has_abs_xy;
	uint16_t pad_state;
} InputDev;

static volatile sig_atomic_t g_should_quit = 0;
enum { kInputTimelineAutoQuitGraceFrames = 0 };
static bool g_input_debug = false;
static const uint64_t kExitComboHoldMs = 2000;
static char g_system_dir[1024] = "";
static char g_save_dir[1024] = "";
static LibretroCore* g_core = NULL;
static BmsxCoreOptions g_core_options;

#ifdef BMSX_LIBRETRO_HOST_SDL
static bool g_use_sdl = false;
static SDL_GameController* g_sdl_gamepad = NULL;
static SDL_JoystickID g_sdl_gamepad_id = -1;
static uint16_t g_sdl_pad_state = 0;
static bool g_sdl_focused = true;
#endif

static enum retro_pixel_format g_core_pixel_format = RETRO_PIXEL_FORMAT_XRGB8888;
static struct retro_hw_render_callback g_hw_render;
static bool g_use_hw_render = false;
static bool g_hw_context_pending_reset = false;
static unsigned g_geom_base_w = 0;
static unsigned g_geom_base_h = 0;
static unsigned g_render_target_w = 0;
static unsigned g_render_target_h = 0;
static float g_geom_aspect = 0.0f;
static bool g_geom_dirty = false;
static uint64_t g_frame_usec = 0;
static uint64_t g_frame_ns = 0;
static uint64_t g_max_run_frames = 0;
static uint64_t g_run_frame_count = 0;
static struct retro_frame_time_callback g_frame_time_cb = {0};
static bool g_has_frame_time_cb = false;
static unsigned g_last_video_w = 0;
static unsigned g_last_video_h = 0;
static bool g_drop_video = false;
static uint64_t g_accepted_presentation_count = 0;
static bool g_core_presented_frame = false;

static BmsxFrameTimingState g_frame_timing = {
	.warmup_frames = 500u,
};

static GLuint g_hw_fbo = 0;
static GLuint g_hw_tex = 0;
static unsigned g_hw_tex_w = 0;
static unsigned g_hw_tex_h = 0;
static GLuint g_blit_program = 0;
static GLuint g_blit_vbo = 0;
static GLint g_blit_attr_pos = -1;
static GLint g_blit_attr_uv = -1;
static GLint g_blit_uniform_tex = -1;
static GLint g_blit_uniform_flip = -1;
static bool g_gl_loaded = false;

static double g_target_fps = 0.0;

#define MSG_MAX_TEXT 256
#define MSG_MAX_LINES 4
#define MSG_MAX_LINE 96

static char g_msg_text[MSG_MAX_TEXT] = "";
static char g_msg_lines[MSG_MAX_LINES][MSG_MAX_LINE];
static int g_msg_line_count = 0;
static unsigned g_msg_frames_left = 0;
static bool g_msg_dirty = false;
static bool g_msg_gl_dirty = false;
static uint8_t* g_msg_surface = NULL;
static int g_msg_surface_w = 0;
static int g_msg_surface_h = 0;
static int g_msg_surface_stride = 0;
static int g_msg_x = 8;
static int g_msg_y = 8;
static GLuint g_msg_tex = 0;
static GLuint g_msg_vbo = 0;
static int g_msg_tex_w = 0;
static int g_msg_tex_h = 0;

typedef void (GL_APIENTRYP PFNGLACTIVETEXTUREPROC)(GLenum texture);
typedef void (GL_APIENTRYP PFNGLATTACHSHADERPROC)(GLuint program, GLuint shader);
typedef void (GL_APIENTRYP PFNGLBINDBUFFERPROC)(GLenum target, GLuint buffer);
typedef void (GL_APIENTRYP PFNGLBINDFRAMEBUFFERPROC)(GLenum target, GLuint framebuffer);
typedef void (GL_APIENTRYP PFNGLBINDTEXTUREPROC)(GLenum target, GLuint texture);
typedef void (GL_APIENTRYP PFNGLBUFFERDATAPROC)(GLenum target, GLsizeiptr size, const void* data, GLenum usage);
typedef void (GL_APIENTRYP PFNGLCLEARPROC)(GLbitfield mask);
typedef void (GL_APIENTRYP PFNGLCLEARCOLORPROC)(GLfloat red, GLfloat green, GLfloat blue, GLfloat alpha);
typedef void (GL_APIENTRYP PFNGLCOMPILESHADERPROC)(GLuint shader);
typedef GLuint (GL_APIENTRYP PFNGLCREATEPROGRAMPROC)(void);
typedef GLuint (GL_APIENTRYP PFNGLCREATESHADERPROC)(GLenum type);
typedef void (GL_APIENTRYP PFNGLDELETEBUFFERSPROC)(GLsizei n, const GLuint* buffers);
typedef void (GL_APIENTRYP PFNGLDELETEFRAMEBUFFERSPROC)(GLsizei n, const GLuint* framebuffers);
typedef void (GL_APIENTRYP PFNGLDELETEPROGRAMPROC)(GLuint program);
typedef void (GL_APIENTRYP PFNGLDELETESHADERPROC)(GLuint shader);
typedef void (GL_APIENTRYP PFNGLDELETETEXTURESPROC)(GLsizei n, const GLuint* textures);
typedef void (GL_APIENTRYP PFNGLDISABLEPROC)(GLenum cap);
typedef void (GL_APIENTRYP PFNGLENABLEPROC)(GLenum cap);
typedef void (GL_APIENTRYP PFNGLBLENDFUNCPROC)(GLenum sfactor, GLenum dfactor);
typedef void (GL_APIENTRYP PFNGLDRAWARRAYSPROC)(GLenum mode, GLint first, GLsizei count);
typedef void (GL_APIENTRYP PFNGLENABLEVERTEXATTRIBARRAYPROC)(GLuint index);
typedef void (GL_APIENTRYP PFNGLFRAMEBUFFERTEXTURE2DPROC)(GLenum target, GLenum attachment, GLenum textarget, GLuint texture, GLint level);
typedef void (GL_APIENTRYP PFNGLGENBUFFERSPROC)(GLsizei n, GLuint* buffers);
typedef void (GL_APIENTRYP PFNGLGENFRAMEBUFFERSPROC)(GLsizei n, GLuint* framebuffers);
typedef void (GL_APIENTRYP PFNGLGENTEXTURESPROC)(GLsizei n, GLuint* textures);
typedef GLint (GL_APIENTRYP PFNGLGETATTRIBLOCATIONPROC)(GLuint program, const GLchar* name);
typedef void (GL_APIENTRYP PFNGLGETPROGRAMINFOLOGPROC)(GLuint program, GLsizei bufSize, GLsizei* length, GLchar* infoLog);
typedef void (GL_APIENTRYP PFNGLGETPROGRAMIVPROC)(GLuint program, GLenum pname, GLint* params);
typedef void (GL_APIENTRYP PFNGLGETSHADERINFOLOGPROC)(GLuint shader, GLsizei bufSize, GLsizei* length, GLchar* infoLog);
typedef void (GL_APIENTRYP PFNGLGETSHADERIVPROC)(GLuint shader, GLenum pname, GLint* params);
typedef GLint (GL_APIENTRYP PFNGLGETUNIFORMLOCATIONPROC)(GLuint program, const GLchar* name);
typedef void (GL_APIENTRYP PFNGLLINKPROGRAMPROC)(GLuint program);
typedef void (GL_APIENTRYP PFNGLSHADERSOURCEPROC)(GLuint shader, GLsizei count, const GLchar* const* string, const GLint* length);
typedef void (GL_APIENTRYP PFNGLTEXIMAGE2DPROC)(GLenum target, GLint level, GLint internalformat, GLsizei width, GLsizei height, GLint border, GLenum format, GLenum type, const void* pixels);
typedef void (GL_APIENTRYP PFNGLTEXPARAMETERIPROC)(GLenum target, GLenum pname, GLint param);
typedef void (GL_APIENTRYP PFNGLUNIFORM1FPROC)(GLint location, GLfloat v0);
typedef void (GL_APIENTRYP PFNGLUNIFORM1IPROC)(GLint location, GLint v0);
typedef void (GL_APIENTRYP PFNGLUSEPROGRAMPROC)(GLuint program);
typedef void (GL_APIENTRYP PFNGLVERTEXATTRIBPOINTERPROC)(GLuint index, GLint size, GLenum type, GLboolean normalized, GLsizei stride, const void* pointer);
typedef void (GL_APIENTRYP PFNGLVIEWPORTPROC)(GLint x, GLint y, GLsizei width, GLsizei height);
typedef GLenum (GL_APIENTRYP PFNGLCHECKFRAMEBUFFERSTATUSPROC)(GLenum target);

static PFNGLACTIVETEXTUREPROC glActiveTexture_ptr = NULL;
static PFNGLATTACHSHADERPROC glAttachShader_ptr = NULL;
static PFNGLBINDBUFFERPROC glBindBuffer_ptr = NULL;
static PFNGLBINDFRAMEBUFFERPROC glBindFramebuffer_ptr = NULL;
static PFNGLBINDTEXTUREPROC glBindTexture_ptr = NULL;
static PFNGLBUFFERDATAPROC glBufferData_ptr = NULL;
static PFNGLCLEARPROC glClear_ptr = NULL;
static PFNGLCLEARCOLORPROC glClearColor_ptr = NULL;
static PFNGLCOMPILESHADERPROC glCompileShader_ptr = NULL;
static PFNGLCREATEPROGRAMPROC glCreateProgram_ptr = NULL;
static PFNGLCREATESHADERPROC glCreateShader_ptr = NULL;
static PFNGLDELETEBUFFERSPROC glDeleteBuffers_ptr = NULL;
static PFNGLDELETEFRAMEBUFFERSPROC glDeleteFramebuffers_ptr = NULL;
static PFNGLDELETEPROGRAMPROC glDeleteProgram_ptr = NULL;
static PFNGLDELETESHADERPROC glDeleteShader_ptr = NULL;
static PFNGLDELETETEXTURESPROC glDeleteTextures_ptr = NULL;
static PFNGLDISABLEPROC glDisable_ptr = NULL;
static PFNGLENABLEPROC glEnable_ptr = NULL;
static PFNGLBLENDFUNCPROC glBlendFunc_ptr = NULL;
static PFNGLDRAWARRAYSPROC glDrawArrays_ptr = NULL;
static PFNGLENABLEVERTEXATTRIBARRAYPROC glEnableVertexAttribArray_ptr = NULL;
static PFNGLFRAMEBUFFERTEXTURE2DPROC glFramebufferTexture2D_ptr = NULL;
static PFNGLGENBUFFERSPROC glGenBuffers_ptr = NULL;
static PFNGLGENFRAMEBUFFERSPROC glGenFramebuffers_ptr = NULL;
static PFNGLGENTEXTURESPROC glGenTextures_ptr = NULL;
static PFNGLGETATTRIBLOCATIONPROC glGetAttribLocation_ptr = NULL;
static PFNGLGETPROGRAMINFOLOGPROC glGetProgramInfoLog_ptr = NULL;
static PFNGLGETPROGRAMIVPROC glGetProgramiv_ptr = NULL;
static PFNGLGETSHADERINFOLOGPROC glGetShaderInfoLog_ptr = NULL;
static PFNGLGETSHADERIVPROC glGetShaderiv_ptr = NULL;
static PFNGLGETUNIFORMLOCATIONPROC glGetUniformLocation_ptr = NULL;
static PFNGLLINKPROGRAMPROC glLinkProgram_ptr = NULL;
static PFNGLSHADERSOURCEPROC glShaderSource_ptr = NULL;
static PFNGLTEXIMAGE2DPROC glTexImage2D_ptr = NULL;
static PFNGLTEXPARAMETERIPROC glTexParameteri_ptr = NULL;
static PFNGLUNIFORM1FPROC glUniform1f_ptr = NULL;
static PFNGLUNIFORM1IPROC glUniform1i_ptr = NULL;
static PFNGLUSEPROGRAMPROC glUseProgram_ptr = NULL;
static PFNGLVERTEXATTRIBPOINTERPROC glVertexAttribPointer_ptr = NULL;
static PFNGLVIEWPORTPROC glViewport_ptr = NULL;
static PFNGLCHECKFRAMEBUFFERSTATUSPROC glCheckFramebufferStatus_ptr = NULL;
static PFNGLREADPIXELSPROC glReadPixels_ptr = NULL;

static BmsxVideoSurface* g_video_surface = NULL;
enum { kMaxInputDevs = KEYBOARD_INPUT_EVDEV_SOURCE_COUNT };
static InputDev g_input_devs[kMaxInputDevs];
static char g_input_paths[kMaxInputDevs][64];
static size_t g_input_dev_count = 0;
static uint16_t g_pad_state_raw = 0;
static uint16_t g_pad_state_port0 = 0;
enum {
	kRetroMouseIdX = 0,
	kRetroMouseIdY = 1,
	kRetroMouseIdLeft = 2,
	kRetroMouseIdRight = 3,
	kRetroMouseIdWheelUp = 4,
	kRetroMouseIdWheelDown = 5,
	kRetroMouseIdMiddle = 6,
	kRetroMouseIdButton4 = 9,
	kRetroMouseIdButton5 = 10,
	kRetroPointerIdX = 0,
	kRetroPointerIdY = 1,
	kRetroPointerIdPressed = 2,
	kMouseButtonPrimary = 1 << 0,
	kMouseButtonSecondary = 1 << 1,
	kMouseButtonAux = 1 << 2,
	kMouseButtonBack = 1 << 3,
	kMouseButtonForward = 1 << 4,
};
static int32_t g_mouse_abs_x = 0;
static int32_t g_mouse_abs_y = 0;
static int32_t g_mouse_delta_x = 0;
static int32_t g_mouse_delta_y = 0;
static int32_t g_mouse_wheel_y = 0;
static uint8_t g_mouse_buttons = 0;
static bool g_mouse_position_valid = false;
#ifdef BMSX_LIBRETRO_HOST_SDL
static uint8_t map_sdl_mouse_buttons(uint32_t buttons);
static void set_mouse_absolute_position(int x, int y, bool update_delta);
#endif
static void clamp_mouse_position_to_framebuffer(void);
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

static bool hw_ensure_fbo(unsigned width, unsigned height);
static bool hw_present_frame(unsigned src_w, unsigned src_h);
static void msg_render_software(void);
static void msg_render_hw(void);
static void msg_tick(void);
static uint64_t monotonic_ns(void);
static uint64_t monotonic_ms(void);
static void set_host_timing(const struct retro_system_timing* timing);
static inline uint16_t rgb888_to_rgb565(uint8_t r, uint8_t g, uint8_t b);
static inline uint32_t rgb565_to_xrgb8888(uint16_t p);

#define ASSIGN_PROC(dst, src) do { \
	void* _src = (src); \
	memcpy(&(dst), &_src, sizeof(dst)); \
} while (0)
#define PTR_TO_RETRO_PROC(dst, src) do { \
	void* _src = (src); \
	memcpy(&(dst), &_src, sizeof(dst)); \
} while (0)
#ifdef BMSX_LIBRETRO_HOST_SDL
static void poll_input_devices_sdl(void);
#endif

static uintptr_t RETRO_CALLCONV hw_get_current_framebuffer(void) {
	const unsigned target_w = g_render_target_w;
	const unsigned target_h = g_render_target_h;
	if (g_geom_dirty || g_hw_tex == 0 || g_hw_tex_w != target_w || g_hw_tex_h != target_h) {
		if (!hw_ensure_fbo(target_w, target_h)) {
			return 0;
		}
		g_geom_dirty = false;
	}
	glBindFramebuffer_ptr(GL_FRAMEBUFFER, g_hw_fbo);
	return (uintptr_t)g_hw_fbo;
}

static retro_proc_address_t RETRO_CALLCONV hw_get_proc_address(const char* sym) {
	void* proc = bmsx_video_context_get_gl_proc(sym);
	if (!proc) {
		return NULL;
	}
	retro_proc_address_t fn = NULL;
	PTR_TO_RETRO_PROC(fn, proc);
	return fn;
}

static void update_geometry(const struct retro_game_geometry* geom) {
	if (!geom) {
		return;
	}
	if (geom->base_width > 0 && geom->base_height > 0) {
		g_geom_base_w = geom->base_width;
		g_geom_base_h = geom->base_height;
		g_render_target_w = geom->base_width;
		g_render_target_h = geom->base_height;
	}
	if (geom->aspect_ratio > 0.0f) {
		g_geom_aspect = geom->aspect_ratio;
	} else if (g_geom_base_w > 0 && g_geom_base_h > 0) {
		g_geom_aspect = (float)g_geom_base_w / (float)g_geom_base_h;
	}
	g_geom_dirty = true;
}

static bool gl_load(void) {
	if (g_gl_loaded) {
		return true;
	}
#define GL_LOAD(name, type) do { \
	void* _proc = bmsx_video_context_get_gl_proc(#name); \
	if (!_proc) { \
		fprintf(stderr, "[libretro-host] missing GL proc %s\n", #name); \
		return false; \
	} \
	ASSIGN_PROC(name##_ptr, _proc); \
} while (0)
	GL_LOAD(glActiveTexture, PFNGLACTIVETEXTUREPROC);
	GL_LOAD(glAttachShader, PFNGLATTACHSHADERPROC);
	GL_LOAD(glBindBuffer, PFNGLBINDBUFFERPROC);
	GL_LOAD(glBindFramebuffer, PFNGLBINDFRAMEBUFFERPROC);
	GL_LOAD(glBindTexture, PFNGLBINDTEXTUREPROC);
	GL_LOAD(glBufferData, PFNGLBUFFERDATAPROC);
	GL_LOAD(glClear, PFNGLCLEARPROC);
	GL_LOAD(glClearColor, PFNGLCLEARCOLORPROC);
	GL_LOAD(glCompileShader, PFNGLCOMPILESHADERPROC);
	GL_LOAD(glCreateProgram, PFNGLCREATEPROGRAMPROC);
	GL_LOAD(glCreateShader, PFNGLCREATESHADERPROC);
	GL_LOAD(glDeleteBuffers, PFNGLDELETEBUFFERSPROC);
	GL_LOAD(glDeleteFramebuffers, PFNGLDELETEFRAMEBUFFERSPROC);
	GL_LOAD(glDeleteProgram, PFNGLDELETEPROGRAMPROC);
	GL_LOAD(glDeleteShader, PFNGLDELETESHADERPROC);
	GL_LOAD(glDeleteTextures, PFNGLDELETETEXTURESPROC);
	GL_LOAD(glDisable, PFNGLDISABLEPROC);
	GL_LOAD(glEnable, PFNGLENABLEPROC);
	GL_LOAD(glBlendFunc, PFNGLBLENDFUNCPROC);
	GL_LOAD(glDrawArrays, PFNGLDRAWARRAYSPROC);
	GL_LOAD(glEnableVertexAttribArray, PFNGLENABLEVERTEXATTRIBARRAYPROC);
	GL_LOAD(glFramebufferTexture2D, PFNGLFRAMEBUFFERTEXTURE2DPROC);
	GL_LOAD(glGenBuffers, PFNGLGENBUFFERSPROC);
	GL_LOAD(glGenFramebuffers, PFNGLGENFRAMEBUFFERSPROC);
	GL_LOAD(glGenTextures, PFNGLGENTEXTURESPROC);
	GL_LOAD(glGetAttribLocation, PFNGLGETATTRIBLOCATIONPROC);
	GL_LOAD(glGetProgramInfoLog, PFNGLGETPROGRAMINFOLOGPROC);
	GL_LOAD(glGetProgramiv, PFNGLGETPROGRAMIVPROC);
	GL_LOAD(glGetShaderInfoLog, PFNGLGETSHADERINFOLOGPROC);
	GL_LOAD(glGetShaderiv, PFNGLGETSHADERIVPROC);
	GL_LOAD(glGetUniformLocation, PFNGLGETUNIFORMLOCATIONPROC);
	GL_LOAD(glLinkProgram, PFNGLLINKPROGRAMPROC);
	GL_LOAD(glShaderSource, PFNGLSHADERSOURCEPROC);
	GL_LOAD(glTexImage2D, PFNGLTEXIMAGE2DPROC);
	GL_LOAD(glTexParameteri, PFNGLTEXPARAMETERIPROC);
	GL_LOAD(glUniform1f, PFNGLUNIFORM1FPROC);
	GL_LOAD(glUniform1i, PFNGLUNIFORM1IPROC);
	GL_LOAD(glUseProgram, PFNGLUSEPROGRAMPROC);
	GL_LOAD(glVertexAttribPointer, PFNGLVERTEXATTRIBPOINTERPROC);
	GL_LOAD(glViewport, PFNGLVIEWPORTPROC);
	GL_LOAD(glCheckFramebufferStatus, PFNGLCHECKFRAMEBUFFERSTATUSPROC);
	GL_LOAD(glReadPixels, PFNGLREADPIXELSPROC);
#undef GL_LOAD
	g_gl_loaded = true;
	return true;
}

static void gl_set_nearest_clamp_texture_2d(void) {
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
}

static GLuint compile_shader(GLenum type, const char* src) {
	GLuint shader = glCreateShader_ptr(type);
	if (!shader) {
		return 0;
	}
	glShaderSource_ptr(shader, 1, &src, NULL);
	glCompileShader_ptr(shader);
	GLint status = 0;
	glGetShaderiv_ptr(shader, GL_COMPILE_STATUS, &status);
	if (!status) {
		char log[512];
		GLsizei log_len = 0;
		glGetShaderInfoLog_ptr(shader, sizeof(log), &log_len, log);
		fprintf(stderr, "[libretro-host] shader compile failed: %s\n", log_len ? log : "(no log)");
		glDeleteShader_ptr(shader);
		return 0;
	}
	return shader;
}

static bool hw_init_blitter(void) {
	if (g_blit_program) {
		return true;
	}
	if (!gl_load()) {
		return false;
	}
	static const char* k_vs =
		"attribute vec2 a_pos;\n"
		"attribute vec2 a_uv;\n"
		"varying vec2 v_uv;\n"
		"void main() {\n"
		"  gl_Position = vec4(a_pos, 0.0, 1.0);\n"
		"  v_uv = a_uv;\n"
		"}\n";
	static const char* k_fs =
		"#ifdef GL_FRAGMENT_PRECISION_HIGH\n"
		"precision highp float;\n"
		"#else\n"
		"precision mediump float;\n"
		"#endif\n"
		"varying vec2 v_uv;\n"
		"uniform sampler2D u_tex;\n"
		"uniform float u_flip_y;\n"
		"void main() {\n"
		"  vec2 uv = v_uv;\n"
		"  if (u_flip_y > 0.5) uv.y = 1.0 - uv.y;\n"
		"  gl_FragColor = texture2D(u_tex, uv);\n"
		"}\n";
	GLuint vs = compile_shader(GL_VERTEX_SHADER, k_vs);
	if (!vs) {
		return false;
	}
	GLuint fs = compile_shader(GL_FRAGMENT_SHADER, k_fs);
	if (!fs) {
		glDeleteShader_ptr(vs);
		return false;
	}
	GLuint program = glCreateProgram_ptr();
	glAttachShader_ptr(program, vs);
	glAttachShader_ptr(program, fs);
	glLinkProgram_ptr(program);
	glDeleteShader_ptr(vs);
	glDeleteShader_ptr(fs);
	GLint linked = 0;
	glGetProgramiv_ptr(program, GL_LINK_STATUS, &linked);
	if (!linked) {
		char log[512];
		GLsizei log_len = 0;
		glGetProgramInfoLog_ptr(program, sizeof(log), &log_len, log);
		fprintf(stderr, "[libretro-host] program link failed: %s\n", log_len ? log : "(no log)");
		glDeleteProgram_ptr(program);
		return false;
	}
	g_blit_program = program;
	g_blit_attr_pos = glGetAttribLocation_ptr(program, "a_pos");
	g_blit_attr_uv = glGetAttribLocation_ptr(program, "a_uv");
	g_blit_uniform_tex = glGetUniformLocation_ptr(program, "u_tex");
	g_blit_uniform_flip = glGetUniformLocation_ptr(program, "u_flip_y");

	const float quad[] = {
		-1.0f, -1.0f, 0.0f, 0.0f,
			1.0f, -1.0f, 1.0f, 0.0f,
		-1.0f,  1.0f, 0.0f, 1.0f,
			1.0f,  1.0f, 1.0f, 1.0f,
	};
	glGenBuffers_ptr(1, &g_blit_vbo);
	glBindBuffer_ptr(GL_ARRAY_BUFFER, g_blit_vbo);
	glBufferData_ptr(GL_ARRAY_BUFFER, (GLsizeiptr)sizeof(quad), quad, GL_STATIC_DRAW);
	return true;
}

static bool hw_ensure_fbo(unsigned width, unsigned height) {
	if (!gl_load()) {
		return false;
	}
	if (width == 0 || height == 0) {
		return false;
	}
	if (g_hw_tex && g_hw_tex_w == width && g_hw_tex_h == height) {
		return true;
	}
	if (g_hw_tex) {
		glDeleteTextures_ptr(1, &g_hw_tex);
		g_hw_tex = 0;
	}
	if (g_hw_fbo) {
		glDeleteFramebuffers_ptr(1, &g_hw_fbo);
		g_hw_fbo = 0;
	}
	glGenTextures_ptr(1, &g_hw_tex);
	glBindTexture_ptr(GL_TEXTURE_2D, g_hw_tex);
	gl_set_nearest_clamp_texture_2d();
	glTexImage2D_ptr(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)width, (GLsizei)height, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);

	glGenFramebuffers_ptr(1, &g_hw_fbo);
	glBindFramebuffer_ptr(GL_FRAMEBUFFER, g_hw_fbo);
	glFramebufferTexture2D_ptr(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_hw_tex, 0);
	if (glCheckFramebufferStatus_ptr(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
		fprintf(stderr, "[libretro-host] FBO incomplete\n");
		glBindFramebuffer_ptr(GL_FRAMEBUFFER, 0);
		return false;
	}
	glBindFramebuffer_ptr(GL_FRAMEBUFFER, 0);
	g_hw_tex_w = width;
	g_hw_tex_h = height;
	fprintf(stderr, "[libretro-host] hw render target %ux%u\n", width, height);
	return true;
}

static void hw_release_resources(void) {
	if (!g_gl_loaded) {
		return;
	}
	const GLuint buffers[] = {g_blit_vbo, g_msg_vbo};
	const GLuint textures[] = {g_hw_tex, g_msg_tex};
	glDeleteBuffers_ptr(2, buffers);
	glDeleteTextures_ptr(2, textures);
	glDeleteFramebuffers_ptr(1, &g_hw_fbo);
	if (g_blit_program) {
		glDeleteProgram_ptr(g_blit_program);
	}
	g_hw_fbo = 0;
	g_hw_tex = 0;
	g_hw_tex_w = 0;
	g_hw_tex_h = 0;
	g_blit_program = 0;
	g_blit_vbo = 0;
	g_blit_attr_pos = -1;
	g_blit_attr_uv = -1;
	g_blit_uniform_tex = -1;
	g_blit_uniform_flip = -1;
	g_msg_tex = 0;
	g_msg_vbo = 0;
	g_msg_tex_w = 0;
	g_msg_tex_h = 0;
}

static void compute_dst_rect(int fb_w, int fb_h, unsigned src_w, unsigned src_h,
		int* out_x, int* out_y, int* out_w, int* out_h) {
	if (fb_w <= 0 || fb_h <= 0 || src_w == 0 || src_h == 0) {
		*out_x = 0;
		*out_y = 0;
		*out_w = 0;
		*out_h = 0;
		return;
	}
	double aspect = (g_geom_aspect > 0.0f) ? g_geom_aspect : ((double)src_w / (double)src_h);
	if (aspect <= 0.0) {
		aspect = (double)src_w / (double)src_h;
	}
	int dst_w = fb_w;
	int dst_h = (int)(fb_w / aspect + 0.5);
	if (dst_h > fb_h) {
		dst_h = fb_h;
		dst_w = (int)(fb_h * aspect + 0.5);
	}
	const double src_aspect = (double)src_w / (double)src_h;
	if (fabs(aspect - src_aspect) <= 0.01) {
		const double scale_x = (double)dst_w / (double)src_w;
		const double scale_y = (double)dst_h / (double)src_h;
		const double min_scale = scale_x < scale_y ? scale_x : scale_y;
		const int integer_scale = (int)min_scale;
		if (integer_scale >= 1) {
			const int snapped_w = (int)src_w * integer_scale;
			const int snapped_h = (int)src_h * integer_scale;
			if (snapped_w <= fb_w && snapped_h <= fb_h) {
				dst_w = snapped_w;
				dst_h = snapped_h;
			}
		}
	}
	if (dst_w < 1) dst_w = 1;
	if (dst_h < 1) dst_h = 1;
	int dst_x = (fb_w - dst_w) / 2;
	int dst_y = (fb_h - dst_h) / 2;
	*out_x = dst_x;
	*out_y = dst_y;
	*out_w = dst_w;
	*out_h = dst_h;
}

typedef struct OverlayGlyph {
	char c;
	uint8_t rows[7];
} OverlayGlyph;

static const OverlayGlyph kOverlayGlyphs[] = {
	{' ', {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}},
	{'+', {0x00, 0x04, 0x04, 0x1F, 0x04, 0x04, 0x00}},
	{'-', {0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00}},
	{'.', {0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x06}},
	{'/', {0x01, 0x02, 0x04, 0x08, 0x10, 0x00, 0x00}},
	{':', {0x00, 0x04, 0x04, 0x00, 0x04, 0x04, 0x00}},
	{'?', {0x0E, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04}},
	{'0', {0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E}},
	{'1', {0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E}},
	{'2', {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F}},
	{'3', {0x1E, 0x01, 0x01, 0x0E, 0x01, 0x01, 0x1E}},
	{'4', {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02}},
	{'5', {0x1F, 0x10, 0x10, 0x1E, 0x01, 0x01, 0x1E}},
	{'6', {0x0E, 0x10, 0x10, 0x1E, 0x11, 0x11, 0x0E}},
	{'7', {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08}},
	{'8', {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E}},
	{'9', {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x01, 0x0E}},
	{'A', {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11}},
	{'B', {0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E}},
	{'C', {0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E}},
	{'D', {0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E}},
	{'E', {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F}},
	{'F', {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10}},
	{'G', {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F}},
	{'H', {0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11}},
	{'I', {0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E}},
	{'J', {0x07, 0x02, 0x02, 0x02, 0x12, 0x12, 0x0C}},
	{'K', {0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11}},
	{'L', {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F}},
	{'M', {0x11, 0x1B, 0x15, 0x11, 0x11, 0x11, 0x11}},
	{'N', {0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11}},
	{'O', {0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E}},
	{'P', {0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10}},
	{'Q', {0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D}},
	{'R', {0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11}},
	{'S', {0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E}},
	{'T', {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04}},
	{'U', {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E}},
	{'V', {0x11, 0x11, 0x11, 0x11, 0x0A, 0x0A, 0x04}},
	{'W', {0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11}},
	{'X', {0x11, 0x0A, 0x04, 0x04, 0x04, 0x0A, 0x11}},
	{'Y', {0x11, 0x0A, 0x04, 0x04, 0x04, 0x04, 0x04}},
	{'Z', {0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F}},
	{'(', {0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02}},
	{')', {0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08}},
	{'_', {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F}},
};

static const uint8_t* overlay_glyph_rows(char c) {
	static const uint8_t k_unknown[7] = {0x0E, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04};
	for (size_t i = 0; i < sizeof(kOverlayGlyphs) / sizeof(kOverlayGlyphs[0]); ++i) {
		if (kOverlayGlyphs[i].c == c) {
			return kOverlayGlyphs[i].rows;
		}
	}
	return k_unknown;
}

static void surface_draw_pixel(uint8_t* surface, int surface_w, int surface_h, int surface_stride, int x, int y, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
	if (!surface || x < 0 || y < 0 || x >= surface_w || y >= surface_h) {
		return;
	}
	uint8_t* p = surface + (size_t)y * (size_t)surface_stride + (size_t)x * 4u;
	p[0] = r;
	p[1] = g;
	p[2] = b;
	p[3] = a;
}

static void surface_draw_rect(uint8_t* surface, int surface_w, int surface_h, int surface_stride, int x, int y, int w, int h, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
	for (int yy = 0; yy < h; ++yy) {
		for (int xx = 0; xx < w; ++xx) {
			surface_draw_pixel(surface, surface_w, surface_h, surface_stride, x + xx, y + yy, r, g, b, a);
		}
	}
}

static void surface_draw_char(uint8_t* surface, int surface_w, int surface_h, int surface_stride, int x, int y, char c, uint8_t r, uint8_t g, uint8_t b, uint8_t a, int scale) {
	if (c >= 'a' && c <= 'z') {
		c = (char)(c - ('a' - 'A'));
	}
	const uint8_t* rows = overlay_glyph_rows(c);
	for (int row = 0; row < 7; ++row) {
		uint8_t bits = rows[row];
		for (int col = 0; col < 5; ++col) {
			if (bits & (1u << (4 - col))) {
				for (int sy = 0; sy < scale; ++sy) {
					for (int sx = 0; sx < scale; ++sx) {
						surface_draw_pixel(surface, surface_w, surface_h, surface_stride, x + col * scale + sx, y + row * scale + sy, r, g, b, a);
					}
				}
			}
		}
	}
}

static void surface_draw_text(uint8_t* surface, int surface_w, int surface_h, int surface_stride, int x, int y, const char* text, uint8_t r, uint8_t g, uint8_t b, uint8_t a, int scale) {
	if (!text) return;
	const int advance = (5 + 1) * scale;
	for (const char* p = text; *p; ++p) {
		surface_draw_char(surface, surface_w, surface_h, surface_stride, x, y, *p, r, g, b, a, scale);
		x += advance;
	}
}

static inline uint8_t blend_channel_u8(uint8_t src, uint8_t dst, uint8_t alpha) {
	return (uint8_t)((src * alpha + dst * (255 - alpha) + 127) / 255);
}

static inline uint32_t pack_xrgb8888(uint8_t r, uint8_t g, uint8_t b) {
	return (uint32_t)((r << 16) | (g << 8) | b);
}

static inline uint32_t blend_rgba_over_xrgb8888(uint32_t dst, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
	if (a == 255) {
		return pack_xrgb8888(r, g, b);
	}
	const uint8_t dst_r = (uint8_t)((dst >> 16) & 0xFF);
	const uint8_t dst_g = (uint8_t)((dst >> 8) & 0xFF);
	const uint8_t dst_b = (uint8_t)(dst & 0xFF);
	return pack_xrgb8888(
			blend_channel_u8(r, dst_r, a),
			blend_channel_u8(g, dst_g, a),
			blend_channel_u8(b, dst_b, a));
}

static inline uint16_t blend_rgba_over_rgb565(uint16_t dst, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
	if (a == 255) {
		return rgb888_to_rgb565(r, g, b);
	}
	const uint32_t expanded = rgb565_to_xrgb8888(dst);
	const uint8_t dst_r = (uint8_t)((expanded >> 16) & 0xFF);
	const uint8_t dst_g = (uint8_t)((expanded >> 8) & 0xFF);
	const uint8_t dst_b = (uint8_t)(expanded & 0xFF);
	return rgb888_to_rgb565(
			blend_channel_u8(r, dst_r, a),
			blend_channel_u8(g, dst_g, a),
			blend_channel_u8(b, dst_b, a));
}

static void blit_rgba_line_xrgb8888(uint32_t* dst, const uint8_t* src, int width) {
	for (int x = 0; x < width; ++x) {
		const uint8_t* rgba = src + (size_t)x * 4u;
		const uint8_t a = rgba[3];
		if (a) {
			dst[x] = blend_rgba_over_xrgb8888(dst[x], rgba[0], rgba[1], rgba[2], a);
		}
	}
}

static void blit_rgba_line_rgb565(uint16_t* dst, const uint8_t* src, int width) {
	for (int x = 0; x < width; ++x) {
		const uint8_t* rgba = src + (size_t)x * 4u;
		const uint8_t a = rgba[3];
		if (a) {
			dst[x] = blend_rgba_over_rgb565(dst[x], rgba[0], rgba[1], rgba[2], a);
		}
	}
}

static void blit_rgba_surface_software(
		const uint8_t* surface,
		int surface_w,
		int surface_h,
		int surface_stride,
		int dst_x,
		int dst_y) {
	int x0 = 0;
	int y0 = 0;
	int x1 = surface_w;
	int y1 = surface_h;
	if (dst_x < 0) x0 = -dst_x;
	if (dst_y < 0) y0 = -dst_y;
	if (dst_x + x1 > g_video_surface->width) x1 = g_video_surface->width - dst_x;
	if (dst_y + y1 > g_video_surface->height) y1 = g_video_surface->height - dst_y;
	if (x0 >= x1 || y0 >= y1) return;

	const int clipped_w = x1 - x0;
	switch (g_video_surface->bits_per_pixel) {
		case 32:
			for (int y = y0; y < y1; ++y) {
				uint8_t* dst_line = g_video_surface->pixels +
						(size_t)(dst_y + y) * (size_t)g_video_surface->stride +
						(size_t)(dst_x + x0) * 4u;
				const uint8_t* src_line = surface + (size_t)y * (size_t)surface_stride + (size_t)x0 * 4u;
				blit_rgba_line_xrgb8888((uint32_t*)dst_line, src_line, clipped_w);
			}
			break;
		case 16:
			for (int y = y0; y < y1; ++y) {
				uint8_t* dst_line = g_video_surface->pixels +
						(size_t)(dst_y + y) * (size_t)g_video_surface->stride +
						(size_t)(dst_x + x0) * 2u;
				const uint8_t* src_line = surface + (size_t)y * (size_t)surface_stride + (size_t)x0 * 4u;
				blit_rgba_line_rgb565((uint16_t*)dst_line, src_line, clipped_w);
			}
			break;
		default:
			break;
	}
}

static void hw_begin_blit(GLuint tex, float flip_y) {
	glUseProgram_ptr(g_blit_program);
	glActiveTexture_ptr(GL_TEXTURE0);
	glBindTexture_ptr(GL_TEXTURE_2D, tex);
	if (g_blit_uniform_tex >= 0) {
		glUniform1i_ptr(g_blit_uniform_tex, 0);
	}
	if (g_blit_uniform_flip >= 0) {
		glUniform1f_ptr(g_blit_uniform_flip, flip_y);
	}
}

static void hw_enable_blit_attributes(void) {
	if (g_blit_attr_pos >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)g_blit_attr_pos);
		glVertexAttribPointer_ptr((GLuint)g_blit_attr_pos, 2, GL_FLOAT, GL_FALSE, 4 * (GLsizei)sizeof(float), (void*)0);
	}
	if (g_blit_attr_uv >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)g_blit_attr_uv);
		glVertexAttribPointer_ptr((GLuint)g_blit_attr_uv, 2, GL_FLOAT, GL_FALSE, 4 * (GLsizei)sizeof(float), (void*)(2 * sizeof(float)));
	}
}

static void hw_bind_static_blit_vbo(GLuint vbo) {
	glBindBuffer_ptr(GL_ARRAY_BUFFER, vbo);
	hw_enable_blit_attributes();
}

static void hw_upload_dynamic_blit_vbo(GLuint vbo, const float* quad) {
	glBindBuffer_ptr(GL_ARRAY_BUFFER, vbo);
	glBufferData_ptr(GL_ARRAY_BUFFER, (GLsizeiptr)(16 * sizeof(float)), quad, GL_DYNAMIC_DRAW);
	hw_enable_blit_attributes();
}

static void hw_update_rgba_overlay_texture(
		GLuint* tex,
		int* tex_w,
		int* tex_h,
		bool* dirty,
		int width,
		int height,
		const uint8_t* pixels) {
	if (!*tex || *tex_w != width || *tex_h != height) {
		if (*tex) {
			glDeleteTextures_ptr(1, tex);
			*tex = 0;
		}
		glGenTextures_ptr(1, tex);
		glBindTexture_ptr(GL_TEXTURE_2D, *tex);
		gl_set_nearest_clamp_texture_2d();
		glTexImage2D_ptr(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)width, (GLsizei)height, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
		*tex_w = width;
		*tex_h = height;
		*dirty = false;
	} else if (*dirty) {
		glBindTexture_ptr(GL_TEXTURE_2D, *tex);
		glTexImage2D_ptr(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)width, (GLsizei)height, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
		*dirty = false;
	}
}

static void hw_draw_rgba_overlay(GLuint tex, GLuint* vbo, int x, int y, int width, int height) {
	if (!*vbo) {
		glGenBuffers_ptr(1, vbo);
	}
	const float left = ((float)x / (float)g_video_surface->width) * 2.0f - 1.0f;
	const float right = ((float)(x + width) / (float)g_video_surface->width) * 2.0f - 1.0f;
	const float top = 1.0f - ((float)y / (float)g_video_surface->height) * 2.0f;
	const float bottom = 1.0f - ((float)(y + height) / (float)g_video_surface->height) * 2.0f;
	const float quad[] = {
		left,  bottom, 0.0f, 0.0f,
		right, bottom, 1.0f, 0.0f,
		left,  top,    0.0f, 1.0f,
		right, top,    1.0f, 1.0f,
	};
	glViewport_ptr(0, 0, g_video_surface->width, g_video_surface->height);
	glDisable_ptr(GL_DEPTH_TEST);
	glDisable_ptr(GL_CULL_FACE);
	glEnable_ptr(GL_BLEND);
	glBlendFunc_ptr(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	hw_begin_blit(tex, 1.0f);
	hw_upload_dynamic_blit_vbo(*vbo, quad);
	glDrawArrays_ptr(GL_TRIANGLE_STRIP, 0, 4);
	glDisable_ptr(GL_BLEND);
}

static void msg_mark_dirty(void) {
	g_msg_dirty = true;
	g_msg_gl_dirty = true;
}

static unsigned msg_default_frames(void) {
	unsigned frames = (unsigned)(g_target_fps * 2.0 + 0.5);
	if (frames < 60) {
		frames = 60;
	}
	return frames;
}

static void msg_clear(void) {
	g_msg_text[0] = '\0';
	g_msg_line_count = 0;
	g_msg_frames_left = 0;
	msg_mark_dirty();
}

static void msg_set(const char* text, unsigned frames) {
	if (!text || !text[0]) {
		return;
	}
	snprintf(g_msg_text, sizeof(g_msg_text), "%s", text);
	g_msg_frames_left = frames ? frames : msg_default_frames();
	msg_mark_dirty();
}

static void msg_tick(void) {
	if (g_msg_frames_left == 0) {
		return;
	}
	if (g_msg_frames_left > 0) {
		--g_msg_frames_left;
		if (g_msg_frames_left == 0) {
			msg_clear();
		}
	}
}

static void msg_build_lines(int max_chars) {
	g_msg_line_count = 0;
	if (!g_msg_text[0] || max_chars <= 0) {
		return;
	}
	const char* p = g_msg_text;
	while (*p && g_msg_line_count < MSG_MAX_LINES) {
		while (*p == ' ' || *p == '\t' || *p == '\r') {
			++p;
		}
		if (*p == '\n') {
			++p;
			continue;
		}
		int len = 0;
		int last_space = -1;
		while (p[len] && p[len] != '\n' && len < max_chars) {
			if (p[len] == ' ' || p[len] == '\t') {
				last_space = len;
			}
			++len;
		}
		int take = len;
		if (p[len] == '\n') {
			take = len;
		} else if (len >= max_chars && last_space > 0) {
			take = last_space;
		}
		if (take <= 0) {
			break;
		}
		if (take >= MSG_MAX_LINE) {
			take = MSG_MAX_LINE - 1;
		}
		memcpy(g_msg_lines[g_msg_line_count], p, (size_t)take);
		g_msg_lines[g_msg_line_count][take] = '\0';
		size_t line_len = strlen(g_msg_lines[g_msg_line_count]);
		while (line_len > 0) {
			char c = g_msg_lines[g_msg_line_count][line_len - 1];
			if (c != ' ' && c != '\t') {
				break;
			}
			g_msg_lines[g_msg_line_count][line_len - 1] = '\0';
			--line_len;
		}
		++g_msg_line_count;
		p += take;
		while (*p == ' ' || *p == '\t') {
			++p;
		}
		if (*p == '\n') {
			++p;
		}
	}
	if (*p && g_msg_line_count > 0) {
		char* line = g_msg_lines[g_msg_line_count - 1];
		size_t line_len = strlen(line);
		if (line_len + 3 < MSG_MAX_LINE) {
			strcat(line, "...");
		} else if (line_len >= 3) {
			line[line_len - 3] = '.';
			line[line_len - 2] = '.';
			line[line_len - 1] = '.';
		}
	}
}

static void msg_rebuild_surface(void) {
	if (g_msg_frames_left == 0 || !g_msg_text[0] ||
			g_video_surface->width <= 0 || g_video_surface->height <= 0) {
		return;
	}
	int scale = 2;
	int padding = 6;
	int max_w = g_video_surface->width - 24;
	if (max_w < 40) {
		return;
	}
	int max_chars = max_w / ((5 + 1) * scale);
	if (max_chars < 12) {
		scale = 1;
		max_chars = max_w / ((5 + 1) * scale);
	}
	if (max_chars < 8) {
		max_chars = 8;
	}
	msg_build_lines(max_chars);
	if (g_msg_line_count == 0) {
		return;
	}
	int max_len = 0;
	for (int i = 0; i < g_msg_line_count; ++i) {
		int len = (int)strlen(g_msg_lines[i]);
		if (len > max_len) {
			max_len = len;
		}
	}
	int line_h = (7 * scale) + 2;
	int surf_w = max_len * (5 + 1) * scale + padding * 2;
	int surf_h = g_msg_line_count * line_h + padding * 2;
	if (surf_w > g_video_surface->width - 8) surf_w = g_video_surface->width - 8;
	if (surf_h > g_video_surface->height - 8) surf_h = g_video_surface->height - 8;
	if (surf_w < 1 || surf_h < 1) return;

	if (surf_w != g_msg_surface_w || surf_h != g_msg_surface_h) {
		free(g_msg_surface);
		g_msg_surface = (uint8_t*)malloc((size_t)surf_w * (size_t)surf_h * 4u);
		if (!g_msg_surface) {
			g_msg_surface_w = 0;
			g_msg_surface_h = 0;
			g_msg_surface_stride = 0;
			return;
		}
		g_msg_surface_w = surf_w;
		g_msg_surface_h = surf_h;
		g_msg_surface_stride = surf_w * 4;
	}

	memset(g_msg_surface, 0, (size_t)g_msg_surface_stride * (size_t)g_msg_surface_h);
	g_msg_x = 8;
	g_msg_y = g_video_surface->height - g_msg_surface_h - 12;
	if (g_msg_x < 0) g_msg_x = 0;
	if (g_msg_y < 0) g_msg_y = 0;

	const uint8_t bg_r = 8, bg_g = 8, bg_b = 8, bg_a = 180;
	const uint8_t text_r = 240, text_g = 240, text_b = 240, text_a = 255;
	surface_draw_rect(g_msg_surface, g_msg_surface_w, g_msg_surface_h, g_msg_surface_stride, 0, 0, g_msg_surface_w, g_msg_surface_h, bg_r, bg_g, bg_b, bg_a);
	for (int i = 0; i < g_msg_line_count; ++i) {
		int y = padding + i * line_h;
		surface_draw_text(g_msg_surface, g_msg_surface_w, g_msg_surface_h, g_msg_surface_stride, padding, y, g_msg_lines[i], text_r, text_g, text_b, text_a, scale);
	}
	g_msg_dirty = false;
	g_msg_gl_dirty = true;
}

static void msg_render_software(void) {
	if (g_msg_frames_left == 0) return;
	if (g_msg_dirty) msg_rebuild_surface();
	if (!g_msg_surface) return;

	blit_rgba_surface_software(g_msg_surface, g_msg_surface_w, g_msg_surface_h, g_msg_surface_stride, g_msg_x, g_msg_y);
}

static void msg_render_hw(void) {
	if (g_msg_frames_left == 0) return;
	if (g_msg_dirty) msg_rebuild_surface();
	if (!g_msg_surface) return;
	if (!hw_init_blitter()) return;

	hw_update_rgba_overlay_texture(&g_msg_tex, &g_msg_tex_w, &g_msg_tex_h, &g_msg_gl_dirty, g_msg_surface_w, g_msg_surface_h, g_msg_surface);
	hw_draw_rgba_overlay(g_msg_tex, &g_msg_vbo, g_msg_x, g_msg_y, g_msg_surface_w, g_msg_surface_h);
}

static bool hw_present_frame(unsigned src_w, unsigned src_h) {
	const uint64_t timing_start_ns = g_frame_timing.record_frame ? monotonic_ns() : 0u;
	if (!hw_init_blitter()) {
		return false;
	}
	if (!g_hw_tex) {
		return false;
	}
	const unsigned present_w = g_hw_tex_w ? g_hw_tex_w : src_w;
	const unsigned present_h = g_hw_tex_h ? g_hw_tex_h : src_h;
	if (present_w == 0 || present_h == 0) {
		return false;
	}
	int dst_x = 0, dst_y = 0, dst_w = 0, dst_h = 0;
	compute_dst_rect(
			g_video_surface->width,
			g_video_surface->height,
			present_w,
			present_h,
			&dst_x,
			&dst_y,
			&dst_w,
			&dst_h);
	if (dst_w <= 0 || dst_h <= 0) {
		return false;
	}
	glBindFramebuffer_ptr(GL_FRAMEBUFFER, 0);
	glViewport_ptr(0, 0, g_video_surface->width, g_video_surface->height);
	glClearColor_ptr(0.0f, 0.0f, 0.0f, 1.0f);
	glClear_ptr(GL_COLOR_BUFFER_BIT);
	glViewport_ptr(dst_x, dst_y, dst_w, dst_h);
	glDisable_ptr(GL_BLEND);
	glDisable_ptr(GL_DEPTH_TEST);
	glDisable_ptr(GL_CULL_FACE);
	hw_begin_blit(g_hw_tex, g_hw_render.bottom_left_origin ? 0.0f : 1.0f);
	hw_bind_static_blit_vbo(g_blit_vbo);
	glDrawArrays_ptr(GL_TRIANGLE_STRIP, 0, 4);
	msg_render_hw();
	uint64_t capture_frame;
	if (input_timeline_consume_presented_capture(g_accepted_presentation_count, &capture_frame)) {
		fprintf(stderr, "[SCREENSHOT] Capturing frame %llu (%ux%u)\n", (unsigned long long)capture_frame, present_w, present_h);
		uint8_t* pixels = malloc((size_t)present_w * (size_t)present_h * 4u);
		if (!pixels) {
			host_fatal("Screenshot allocation failed for %ux%u frame", present_w, present_h);
		}
		glBindFramebuffer_ptr(GL_FRAMEBUFFER, g_hw_fbo);
		glReadPixels_ptr(0, 0, (GLsizei)present_w, (GLsizei)present_h, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
		char filename[128];
		snprintf(filename, sizeof(filename), "frame_%05llu.png", (unsigned long long)capture_frame);
		if (!screenshot_save_png(filename, present_w, present_h, pixels)) {
			host_fatal("Screenshot save failed: %s", filename);
		}
		free(pixels);
		glBindFramebuffer_ptr(GL_FRAMEBUFFER, 0);
	}

	if (g_frame_timing.record_frame) {
		g_frame_timing.current_blit_ns += monotonic_ns() - timing_start_ns;
		g_frame_timing.current_blit_ran = true;
	}
	return true;
}

static inline void write_xrgb8888_as_rgba(uint8_t* dst, uint32_t p) {
	dst[0] = (uint8_t)((p >> 16) & 0xFF);
	dst[1] = (uint8_t)((p >> 8) & 0xFF);
	dst[2] = (uint8_t)(p & 0xFF);
	dst[3] = 255;
}

static void copy_framebuffer_row_to_rgba(uint8_t* dst_line, const uint8_t* src_line, int width) {
	switch (g_video_surface->bits_per_pixel) {
		case 32: {
			const uint32_t* src = (const uint32_t*)src_line;
			for (int x = 0; x < width; ++x) {
				write_xrgb8888_as_rgba(dst_line + (size_t)x * 4u, src[x]);
			}
			break;
		}
		case 16: {
			const uint16_t* src = (const uint16_t*)src_line;
			for (int x = 0; x < width; ++x) {
				write_xrgb8888_as_rgba(dst_line + (size_t)x * 4u, rgb565_to_xrgb8888(src[x]));
			}
			break;
		}
		default:
			break;
	}
}

static void step_software_frame_capture(void) {
	uint64_t capture_frame;
	if (!input_timeline_consume_presented_capture(g_accepted_presentation_count, &capture_frame)) {
		return;
	}
	fprintf(stderr,
			"[SCREENSHOT] Capturing frame %llu (%dx%d)\n",
			(unsigned long long)capture_frame,
			g_video_surface->width,
			g_video_surface->height);
	const size_t pixel_count =
			(size_t)g_video_surface->width * (size_t)g_video_surface->height;
	uint8_t* pixels = (uint8_t*)malloc(pixel_count * 4u);
	if (!pixels) {
		host_fatal(
				"Screenshot allocation failed for %dx%d frame",
				g_video_surface->width,
				g_video_surface->height);
	}
	for (int y = 0; y < g_video_surface->height; ++y) {
		const int src_y = g_video_surface->height - 1 - y;
		const uint8_t* src_line = g_video_surface->pixels +
				(size_t)src_y * (size_t)g_video_surface->stride;
		uint8_t* dst_line = pixels +
				(size_t)y * (size_t)g_video_surface->width * 4u;
		copy_framebuffer_row_to_rgba(dst_line, src_line, g_video_surface->width);
	}
	char filename[128];
	snprintf(filename, sizeof(filename), "frame_%05llu.png", (unsigned long long)capture_frame);
	if (!screenshot_save_png(
			filename,
			(uint32_t)g_video_surface->width,
			(uint32_t)g_video_surface->height,
			pixels)) {
		host_fatal("Screenshot save failed: %s", filename);
	}
	free(pixels);
}

#ifdef BMSX_LIBRETRO_HOST_SDL
static void sdl_open_first_controller(void) {
	const int num = SDL_NumJoysticks();
	for (int i = 0; i < num; ++i) {
		if (!SDL_IsGameController(i)) {
			continue;
		}
		g_sdl_gamepad = SDL_GameControllerOpen(i);
		if (!g_sdl_gamepad) {
			continue;
		}
		SDL_Joystick* joy = SDL_GameControllerGetJoystick(g_sdl_gamepad);
		g_sdl_gamepad_id = SDL_JoystickInstanceID(joy);
		fprintf(stderr, "[libretro-host] SDL gamepad: %s\n", SDL_GameControllerName(g_sdl_gamepad));
		return;
	}
}

static void sdl_update_mouse_position(void) {
	int window_x = 0;
	int window_y = 0;
	const uint32_t mouse_state = SDL_GetMouseState(&window_x, &window_y);
	g_mouse_buttons = map_sdl_mouse_buttons(mouse_state);
	int mapped_x = 0;
	int mapped_y = 0;
	if (bmsx_video_context_map_window_point(window_x, window_y, &mapped_x, &mapped_y)) {
		set_mouse_absolute_position(mapped_x, mapped_y, true);
	}
}
#endif

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
			const struct retro_message* msg = (const struct retro_message*)data;
			if (msg && msg->msg) {
				fprintf(stderr, "[libretro-host][MSG] (%u) %s\n", msg->frames, msg->msg);
				msg_set(msg->msg, msg->frames);
			}
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
			update_geometry((const struct retro_game_geometry*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO: {
			const struct retro_system_av_info* info = (const struct retro_system_av_info*)data;
			if (!info) {
				return false;
			}
			update_geometry(&info->geometry);
			set_host_timing(&info->timing);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: {
			const enum retro_pixel_format* fmt = (const enum retro_pixel_format*)data;
			switch (*fmt) {
				case RETRO_PIXEL_FORMAT_XRGB8888:
				case RETRO_PIXEL_FORMAT_RGB565:
					g_core_pixel_format = *fmt;
					return true;
				default:
					return false;
			}
		}
		case RETRO_ENVIRONMENT_SET_HW_RENDER: {
			struct retro_hw_render_callback* cb = (struct retro_hw_render_callback*)data;
			if (cb->context_type != RETRO_HW_CONTEXT_OPENGLES2) {
				return false;
			}
			if (!bmsx_video_context_enable_gles2()) {
				return false;
			}
			cb->get_current_framebuffer = hw_get_current_framebuffer;
			cb->get_proc_address = hw_get_proc_address;
			g_hw_render = *cb;
			if (!gl_load()) {
				return false;
			}
			g_use_hw_render = true;
			g_hw_context_pending_reset = (g_hw_render.context_reset != NULL);
			return true;
		}
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
	g_frame_timing.current_video_frame_received = data != NULL;
	if (g_msg_frames_left > 0) {
		msg_tick();
	}
	if (g_drop_video) {
		if (width > 0 && height > 0) {
			g_last_video_w = width;
			g_last_video_h = height;
		}
		return;
	}
	if (g_use_hw_render && data == RETRO_HW_FRAME_BUFFER_VALID) {
		if (width > 0 && height > 0) {
			g_last_video_w = width;
			g_last_video_h = height;
			if ((g_geom_base_w == 0 || g_geom_base_h == 0) &&
					(g_render_target_w != width || g_render_target_h != height)) {
				g_render_target_w = width;
				g_render_target_h = height;
				if (g_geom_aspect <= 0.0f) {
					g_geom_aspect = (float)width / (float)height;
				}
				g_geom_dirty = true;
			}
		}
		if (hw_present_frame(width, height)) {
			g_core_presented_frame = true;
			g_accepted_presentation_count += 1u;
		}
		const uint64_t swap_start_ns = g_frame_timing.record_frame ? monotonic_ns() : 0u;
		bmsx_video_context_swap_buffers();
		if (g_frame_timing.record_frame) {
			g_frame_timing.current_swap_ns += monotonic_ns() - swap_start_ns;
			g_frame_timing.current_swap_ran = true;
		}
		return;
	}
	if (!data || width == 0 || height == 0) {
		return;
	}
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		const unsigned target_w = g_geom_base_w ? g_geom_base_w : width;
		const unsigned target_h = g_geom_base_h ? g_geom_base_h : height;
		if (bmsx_video_context_prepare_software_frame(target_w, target_h)) {
			msg_mark_dirty();
			clamp_mouse_position_to_framebuffer();
		} else if (g_geom_dirty) {
			g_geom_dirty = false;
		}
	}
#endif
	g_last_video_w = width;
	g_last_video_h = height;

	const int fb_w = g_video_surface->width;
	const int fb_h = g_video_surface->height;

	int dst_x = 0;
	int dst_y = 0;
	int dst_w = 0;
	int dst_h = 0;
	compute_dst_rect(fb_w, fb_h, width, height, &dst_x, &dst_y, &dst_w, &dst_h);
	if (dst_w <= 0 || dst_h <= 0) {
		return;
	}

	unsigned copy_w = width;
	unsigned copy_h = height;
	if ((int)copy_w > fb_w - dst_x) copy_w = (unsigned)(fb_w - dst_x);
	if ((int)copy_h > fb_h - dst_y) copy_h = (unsigned)(fb_h - dst_y);

	if (g_video_surface->bits_per_pixel == 16) {
		if (dst_w == (int)width && dst_h == (int)height) {
			for (unsigned y = 0; y < copy_h; ++y) {
				uint8_t* dst_line = g_video_surface->pixels +
						(size_t)(dst_y + (int)y) * (size_t)g_video_surface->stride +
						(size_t)dst_x * 2u;
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
		} else {
			const uint32_t step_x = (uint32_t)(((uint64_t)width << 16) / (uint32_t)dst_w);
			const uint32_t step_y = (uint32_t)(((uint64_t)height << 16) / (uint32_t)dst_h);
			for (int y = 0; y < dst_h; ++y) {
				const uint32_t src_y = (uint32_t)(((uint64_t)y * step_y) >> 16);
				uint8_t* dst_line = g_video_surface->pixels +
						(size_t)(dst_y + y) * (size_t)g_video_surface->stride +
						(size_t)dst_x * 2u;
				uint16_t* dst = (uint16_t*)dst_line;
				const uint8_t* src_line = (const uint8_t*)data + (size_t)src_y * pitch;
				uint32_t src_x = 0;
				if (g_core_pixel_format == RETRO_PIXEL_FORMAT_RGB565) {
					const uint16_t* src = (const uint16_t*)src_line;
					for (int x = 0; x < dst_w; ++x) {
						dst[x] = src[src_x >> 16];
						src_x += step_x;
					}
				} else {
					const uint32_t* src = (const uint32_t*)src_line;
					for (int x = 0; x < dst_w; ++x) {
						uint32_t p = src[src_x >> 16];
						uint8_t r = (uint8_t)((p >> 16) & 0xFF);
						uint8_t g = (uint8_t)((p >> 8) & 0xFF);
						uint8_t b = (uint8_t)(p & 0xFF);
						dst[x] = rgb888_to_rgb565(r, g, b);
						src_x += step_x;
					}
				}
			}
		}
		step_software_frame_capture();
		msg_render_software();
		g_core_presented_frame = true;
		g_accepted_presentation_count += 1u;
#ifdef BMSX_LIBRETRO_HOST_SDL
		if (g_use_sdl) {
			bmsx_video_context_present_software();
		}
#endif
		return;
	}

	if (g_video_surface->bits_per_pixel == 32) {
		if (dst_w == (int)width && dst_h == (int)height) {
			for (unsigned y = 0; y < copy_h; ++y) {
				uint8_t* dst_line = g_video_surface->pixels +
						(size_t)(dst_y + (int)y) * (size_t)g_video_surface->stride +
						(size_t)dst_x * 4u;
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
		} else {
			const uint32_t step_x = (uint32_t)(((uint64_t)width << 16) / (uint32_t)dst_w);
			const uint32_t step_y = (uint32_t)(((uint64_t)height << 16) / (uint32_t)dst_h);
			for (int y = 0; y < dst_h; ++y) {
				const uint32_t src_y = (uint32_t)(((uint64_t)y * step_y) >> 16);
				uint8_t* dst_line = g_video_surface->pixels +
						(size_t)(dst_y + y) * (size_t)g_video_surface->stride +
						(size_t)dst_x * 4u;
				uint32_t* dst = (uint32_t*)dst_line;
				const uint8_t* src_line = (const uint8_t*)data + (size_t)src_y * pitch;
				uint32_t src_x = 0;
				if (g_core_pixel_format == RETRO_PIXEL_FORMAT_XRGB8888) {
					const uint32_t* src = (const uint32_t*)src_line;
					for (int x = 0; x < dst_w; ++x) {
						dst[x] = src[src_x >> 16];
						src_x += step_x;
					}
				} else {
					const uint16_t* src = (const uint16_t*)src_line;
					for (int x = 0; x < dst_w; ++x) {
						dst[x] = rgb565_to_xrgb8888(src[src_x >> 16]);
						src_x += step_x;
					}
				}
			}
		}
		step_software_frame_capture();
		msg_render_software();
		g_core_presented_frame = true;
		g_accepted_presentation_count += 1u;
#ifdef BMSX_LIBRETRO_HOST_SDL
		if (g_use_sdl) {
			bmsx_video_context_present_software();
		}
#endif
		return;
	}

	host_fatal("Unsupported video surface bpp: %d", g_video_surface->bits_per_pixel);
}

static int clamp_int(int value, int min_value, int max_value) {
	if (value < min_value) return min_value;
	if (value > max_value) return max_value;
	return value;
}

static void reset_mouse_frame_state(void) {
	g_mouse_delta_x = 0;
	g_mouse_delta_y = 0;
	g_mouse_wheel_y = 0;
}

static void clamp_mouse_position_to_framebuffer(void) {
	if (g_video_surface->width <= 0 || g_video_surface->height <= 0) {
		g_mouse_abs_x = 0;
		g_mouse_abs_y = 0;
		g_mouse_position_valid = false;
		return;
	}
	g_mouse_abs_x = clamp_int(g_mouse_abs_x, 0, g_video_surface->width - 1);
	g_mouse_abs_y = clamp_int(g_mouse_abs_y, 0, g_video_surface->height - 1);
}

#ifdef BMSX_LIBRETRO_HOST_SDL
static void set_mouse_absolute_position(int x, int y, bool update_delta) {
	const bool had_prev = g_mouse_position_valid;
	const int prev_x = g_mouse_abs_x;
	const int prev_y = g_mouse_abs_y;
	g_mouse_abs_x = x;
	g_mouse_abs_y = y;
	g_mouse_position_valid = true;
	clamp_mouse_position_to_framebuffer();
	if (update_delta && had_prev) {
		g_mouse_delta_x = g_mouse_abs_x - prev_x;
		g_mouse_delta_y = g_mouse_abs_y - prev_y;
	}
}
#endif

static void add_mouse_relative_delta(int dx, int dy) {
	g_mouse_delta_x += dx;
	g_mouse_delta_y += dy;
	if (!g_mouse_position_valid) {
		g_mouse_abs_x = 0;
		g_mouse_abs_y = 0;
		g_mouse_position_valid = true;
	}
	g_mouse_abs_x += dx;
	g_mouse_abs_y += dy;
	clamp_mouse_position_to_framebuffer();
}

static int16_t encode_pointer_axis(int position, int extent) {
	if (!g_mouse_position_valid || extent <= 1) {
		return 0;
	}
	const int clamped = clamp_int(position, 0, extent - 1);
	const double normalized = (double)clamped / (double)(extent - 1);
	return (int16_t)lrint(normalized * 65534.0 - 32767.0);
}

static uint8_t map_ev_key_to_mouse(uint16_t code) {
	switch (code) {
		case BTN_LEFT:
			return kMouseButtonPrimary;
		case BTN_RIGHT:
			return kMouseButtonSecondary;
		case BTN_MIDDLE:
			return kMouseButtonAux;
		case BTN_SIDE:
			return kMouseButtonBack;
		case BTN_EXTRA:
			return kMouseButtonForward;
		default:
			return 0;
	}
}

static uint16_t map_ev_key_to_pad(uint16_t code) {
	switch (code) {
		case KEY_UP:
		case KEY_KP8:
#ifdef BTN_TRIGGER_HAPPY3
		case BTN_TRIGGER_HAPPY3:
#endif
		case BTN_DPAD_UP:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		case KEY_DOWN:
		case KEY_KP2:
#ifdef BTN_TRIGGER_HAPPY4
		case BTN_TRIGGER_HAPPY4:
#endif
		case BTN_DPAD_DOWN:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		case KEY_LEFT:
		case KEY_KP4:
#ifdef BTN_TRIGGER_HAPPY1
		case BTN_TRIGGER_HAPPY1:
#endif
		case BTN_DPAD_LEFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
		case KEY_RIGHT:
		case KEY_KP6:
#ifdef BTN_TRIGGER_HAPPY2
		case BTN_TRIGGER_HAPPY2:
#endif
		case BTN_DPAD_RIGHT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);

		case BTN_TL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L);
		case BTN_TR:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R);
		case KEY_LEFTSHIFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L);
		case KEY_RIGHTSHIFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R);
		case BTN_TL2:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L2);
		case BTN_TR2:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R2);

		case BTN_START:
		case KEY_ENTER:
		case KEY_KPENTER:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START);
		case BTN_SELECT:
		case KEY_BACKSPACE:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);
		case KEY_LEFTCTRL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L2);
		case KEY_RIGHTCTRL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R2);

		case KEY_Q:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L3);
		case KEY_E:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R3);

		case KEY_X:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A);
		case KEY_C:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B);
		case KEY_Z:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X);
		case KEY_S:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y);

		case BTN_SOUTH:
			// SNES mini button wiring reports A/B swapped; map to physical layout.
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A);
		case BTN_EAST:
			// SNES mini button wiring reports A/B swapped; map to physical layout.
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B);
		case BTN_NORTH:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X);
		case BTN_WEST:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y);
		default:
			return 0;
	}
}

#ifdef BMSX_LIBRETRO_HOST_SDL
static uint16_t map_sdl_key_to_pad(SDL_Keycode code) {
	switch (code) {
		case SDLK_UP:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		case SDLK_DOWN:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		case SDLK_LEFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
		case SDLK_RIGHT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);

		case SDLK_LSHIFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L);
		case SDLK_RSHIFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R);

		case SDLK_LCTRL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L2);
		case SDLK_RCTRL:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R2);

		case SDLK_q:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L3);
		case SDLK_e:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R3);

		case SDLK_RETURN:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START);
		case SDLK_BACKSPACE:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);

		case SDLK_x:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A);
		case SDLK_c:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B);
		case SDLK_z:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X);
		case SDLK_s:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y);
		default:
			return 0;
	}
}

static uint16_t map_sdl_button_to_pad(uint8_t button) {
	switch (button) {
		case SDL_CONTROLLER_BUTTON_DPAD_UP:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		case SDL_CONTROLLER_BUTTON_DPAD_DOWN:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		case SDL_CONTROLLER_BUTTON_DPAD_LEFT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
		case SDL_CONTROLLER_BUTTON_DPAD_RIGHT:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);

		case SDL_CONTROLLER_BUTTON_LEFTSHOULDER:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L);
		case SDL_CONTROLLER_BUTTON_RIGHTSHOULDER:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R);

		case SDL_CONTROLLER_BUTTON_START:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START);
		case SDL_CONTROLLER_BUTTON_BACK:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);

		case SDL_CONTROLLER_BUTTON_A:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_A);
		case SDL_CONTROLLER_BUTTON_B:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_B);
		case SDL_CONTROLLER_BUTTON_X:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_X);
		case SDL_CONTROLLER_BUTTON_Y:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_Y);
		case SDL_CONTROLLER_BUTTON_LEFTSTICK:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L3);
		case SDL_CONTROLLER_BUTTON_RIGHTSTICK:
			return (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R3);
		default:
			return 0;
	}
}

static uint8_t map_sdl_mouse_buttons(uint32_t buttons) {
	uint8_t mapped = 0;
	if (buttons & SDL_BUTTON(SDL_BUTTON_LEFT)) mapped |= kMouseButtonPrimary;
	if (buttons & SDL_BUTTON(SDL_BUTTON_RIGHT)) mapped |= kMouseButtonSecondary;
	if (buttons & SDL_BUTTON(SDL_BUTTON_MIDDLE)) mapped |= kMouseButtonAux;
	if (buttons & SDL_BUTTON(SDL_BUTTON_X1)) mapped |= kMouseButtonBack;
	if (buttons & SDL_BUTTON(SDL_BUTTON_X2)) mapped |= kMouseButtonForward;
	return mapped;
}
#endif

static bool input_init_abs_axis(InputDev* dev, unsigned code, int32_t* min_out, int32_t* max_out, bool* has_axis) {
	struct input_absinfo absinfo;
	if (ioctl(dev->fd, EVIOCGABS(code), &absinfo) == 0) {
		if (min_out) *min_out = absinfo.minimum;
		if (max_out) *max_out = absinfo.maximum;
		if (has_axis) *has_axis = true;
		return true;
	}
	return false;
}

static void input_register_device(const char* path) {
	if (g_input_dev_count >= kMaxInputDevs) {
		return;
	}
	int fd = open(path, O_RDONLY | O_NONBLOCK);
	if (fd < 0) {
		fprintf(stderr, "[libretro-host] Failed to open %s: %s\n", path, strerror(errno));
		return;
	}
	InputDev dev;
	memset(&dev, 0, sizeof(dev));
	snprintf(g_input_paths[g_input_dev_count], sizeof(g_input_paths[g_input_dev_count]), "%s", path);
	dev.path = g_input_paths[g_input_dev_count];
	dev.fd = fd;
	dev.hat_x = 0;
	dev.hat_y = 0;
	dev.hat_x_min = INT32_MAX;
	dev.hat_x_max = INT32_MIN;
	dev.hat_y_min = INT32_MAX;
	dev.hat_y_max = INT32_MIN;
	dev.abs_x = 0;
	dev.abs_y = 0;
	dev.abs_x_min = INT32_MIN;
	dev.abs_x_max = INT32_MAX;
	dev.abs_y_min = INT32_MIN;
	dev.abs_y_max = INT32_MAX;
	dev.hat_x_valid = false;
	dev.hat_y_valid = false;
	dev.has_hat = false;
	dev.has_abs_xy = false;
	dev.pad_state = 0;

	dev.hat_x_valid = input_init_abs_axis(&dev, ABS_HAT0X, &dev.hat_x_min, &dev.hat_x_max, &dev.has_hat);
	dev.hat_y_valid = input_init_abs_axis(&dev, ABS_HAT0Y, &dev.hat_y_min, &dev.hat_y_max, &dev.has_hat);
	input_init_abs_axis(&dev, ABS_X, &dev.abs_x_min, &dev.abs_x_max, &dev.has_abs_xy);
	input_init_abs_axis(&dev, ABS_Y, &dev.abs_y_min, &dev.abs_y_max, &dev.has_abs_xy);

	g_input_devs[g_input_dev_count++] = dev;
	fprintf(stderr, "[libretro-host] input %s opened\n", path);
}

static void input_open_default_devices(void) {
	g_input_dev_count = 0;
	DIR* dir = opendir("/dev/input");
	if (dir) {
		struct dirent* ent = NULL;
		while ((ent = readdir(dir)) != NULL) {
			if (strncmp(ent->d_name, "event", 5) != 0) {
				continue;
			}
			char path[64];
			const size_t prefix_len = sizeof("/dev/input/") - 1;
			const size_t max_name = sizeof(path) - prefix_len - 1;
			snprintf(path, sizeof(path), "/dev/input/%.*s", (int)max_name, ent->d_name);
			input_register_device(path);
			if (g_input_dev_count >= kMaxInputDevs) {
				break;
			}
		}
		closedir(dir);
	}

	if (g_input_dev_count == 0) {
		static const char* paths[] = {
			"/dev/input/event0",
			"/dev/input/event1",
			"/dev/input/event2",
			"/dev/input/event3",
		};
		for (size_t i = 0; i < sizeof(paths) / sizeof(paths[0]); ++i) {
			input_register_device(paths[i]);
			if (g_input_dev_count >= kMaxInputDevs) {
				break;
			}
		}
	}
	if (g_input_dev_count == 0) {
		host_fatal("No input devices opened. Are you running as root / do you have permissions for /dev/input/event*?");
	}
}

static void input_finalize(uint16_t merged) {
	g_pad_state_raw = merged;
	static uint64_t combo_start_ms = 0;
	const bool combo_down =
		(g_pad_state_raw & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START)) &&
		(g_pad_state_raw & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT)) &&
		(g_pad_state_raw & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L)) &&
		(g_pad_state_raw & (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R));
	if (combo_down) {
		uint64_t now = monotonic_ms();
		if (combo_start_ms == 0) {
			combo_start_ms = now;
		} else if (now - combo_start_ms >= kExitComboHoldMs) {
			fprintf(stderr, "[libretro-host] exit combo held %llums, exiting\n",
				(unsigned long long)(now - combo_start_ms));
			g_should_quit = 1;
			combo_start_ms = 0;
		}
	} else {
		combo_start_ms = 0;
	}
	g_pad_state_port0 = g_pad_state_raw;
}

static void poll_input_devices(void) {
	uint16_t merged = 0;
	reset_mouse_frame_state();
	for (size_t i = 0; i < g_input_dev_count; ++i) {
		InputDev* dev = &g_input_devs[i];
		if (dev->fd < 0) {
			continue;
		}
		struct input_event ev;
		for (;;) {
			ssize_t n = read(dev->fd, &ev, sizeof(ev));
			if (n < 0) {
				if (errno == EAGAIN || errno == EWOULDBLOCK) {
					break;
				}
				host_fatal("read(%s) failed: %s", dev->path, strerror(errno));
			}
			if (n == 0) {
				keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_EVDEV_FIRST + (unsigned)i);
				close(dev->fd);
				dev->fd = -1;
				dev->pad_state = 0;
				break;
			}
			if ((size_t)n != sizeof(ev)) {
				host_fatal("Short read from %s: %zd", dev->path, n);
			}

			if (ev.type == EV_KEY) {
				const enum retro_key keyboard_key = keyboard_input_key_from_evdev(ev.code);
				if (keyboard_key != RETROK_UNKNOWN && (ev.value == 0 || ev.value == 1)) {
					keyboard_input_post(KEYBOARD_INPUT_SOURCE_EVDEV_FIRST + (unsigned)i, keyboard_key, ev.value != 0);
				}
				const uint8_t mouse_button = map_ev_key_to_mouse(ev.code);
				if (mouse_button) {
					if (ev.value) {
						g_mouse_buttons |= mouse_button;
					} else {
						g_mouse_buttons &= (uint8_t)~mouse_button;
					}
				}
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
					dev->has_hat = true;
				} else if (ev.code == ABS_HAT0Y) {
					dev->hat_y = ev.value;
					dev->has_hat = true;
				} else if (ev.code == ABS_X) {
					dev->abs_x = ev.value;
					dev->has_abs_xy = true;
				} else if (ev.code == ABS_Y) {
					dev->abs_y = ev.value;
					dev->has_abs_xy = true;
				}
			} else if (ev.type == EV_REL) {
				if (ev.code == REL_X) {
					add_mouse_relative_delta(ev.value, 0);
				} else if (ev.code == REL_Y) {
					add_mouse_relative_delta(0, ev.value);
				} else if (ev.code == REL_WHEEL) {
					g_mouse_wheel_y -= ev.value;
				}
			}
		}

		merged |= dev->pad_state;
		if (dev->has_hat) {
			if (dev->hat_x_valid && dev->hat_x_min <= dev->hat_x_max && dev->hat_x_min != dev->hat_x_max) {
				const int64_t mid2 = (int64_t)dev->hat_x_min + (int64_t)dev->hat_x_max;
				const int64_t val2 = (int64_t)dev->hat_x * 2;
				if (val2 < mid2) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
				if (val2 > mid2) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
			} else {
				if (dev->hat_x < 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
				if (dev->hat_x > 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
			}
			if (dev->hat_y_valid && dev->hat_y_min <= dev->hat_y_max && dev->hat_y_min != dev->hat_y_max) {
				const int64_t mid2 = (int64_t)dev->hat_y_min + (int64_t)dev->hat_y_max;
				const int64_t val2 = (int64_t)dev->hat_y * 2;
				if (val2 < mid2) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
				if (val2 > mid2) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
			} else {
				if (dev->hat_y < 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
				if (dev->hat_y > 0) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
			}
		} else if (dev->has_abs_xy) {
			int32_t x_min = dev->abs_x_min;
			int32_t y_min = dev->abs_y_min;
			int32_t x_range = dev->abs_x_max - x_min;
			int32_t y_range = dev->abs_y_max - y_min;
			if (x_range <= 0 || y_range <= 0) {
				continue;
			}
			int32_t x_mid = x_min + (x_range / 2);
			int32_t y_mid = y_min + (y_range / 2);
			int32_t x_dead = x_range > 0 ? x_range / 8 : 0;
			int32_t y_dead = y_range > 0 ? y_range / 8 : 0;
			if (dev->abs_x < x_mid - x_dead) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
			if (dev->abs_x > x_mid + x_dead) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
			if (dev->abs_y < y_mid - y_dead) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_UP);
			if (dev->abs_y > y_mid + y_dead) merged |= (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		}
	}
	input_finalize(merged);
}

#ifdef BMSX_LIBRETRO_HOST_SDL
static void poll_input_devices_sdl(void) {
	SDL_Event ev;
	SDL_PumpEvents();
	uint16_t pad_state = 0;
	reset_mouse_frame_state();
	if (g_sdl_focused) {
		const Uint8* keystate = SDL_GetKeyboardState(NULL);
		static const SDL_Keycode keys[] = {
			SDLK_UP,
			SDLK_DOWN,
			SDLK_LEFT,
			SDLK_RIGHT,

			SDLK_LSHIFT,
			SDLK_RSHIFT,
			SDLK_LCTRL,
			SDLK_RCTRL,
			SDLK_BACKSPACE,
			SDLK_RETURN,

			SDLK_x,
			SDLK_c,
			SDLK_z,
			SDLK_s,
			SDLK_q,
			SDLK_e,
		};
		for (size_t i = 0; i < sizeof(keys) / sizeof(keys[0]); ++i) {
			SDL_Scancode sc = SDL_GetScancodeFromKey(keys[i]);
			if (sc != SDL_SCANCODE_UNKNOWN && keystate[sc]) {
				pad_state |= map_sdl_key_to_pad(keys[i]);
			}
		}
		if (g_sdl_gamepad) {
			static const SDL_GameControllerButton buttons[] = {
				SDL_CONTROLLER_BUTTON_DPAD_UP,
				SDL_CONTROLLER_BUTTON_DPAD_DOWN,
				SDL_CONTROLLER_BUTTON_DPAD_LEFT,
				SDL_CONTROLLER_BUTTON_DPAD_RIGHT,
				SDL_CONTROLLER_BUTTON_LEFTSHOULDER,
				SDL_CONTROLLER_BUTTON_RIGHTSHOULDER,
				SDL_CONTROLLER_BUTTON_START,
				SDL_CONTROLLER_BUTTON_BACK,
				SDL_CONTROLLER_BUTTON_A,
				SDL_CONTROLLER_BUTTON_B,
				SDL_CONTROLLER_BUTTON_X,
				SDL_CONTROLLER_BUTTON_Y,
				SDL_CONTROLLER_BUTTON_LEFTSTICK,
				SDL_CONTROLLER_BUTTON_RIGHTSTICK,
			};
			for (size_t i = 0; i < sizeof(buttons) / sizeof(buttons[0]); ++i) {
				if (SDL_GameControllerGetButton(g_sdl_gamepad, buttons[i])) {
					pad_state |= map_sdl_button_to_pad((uint8_t)buttons[i]);
				}
			}
		}
	}
	while (SDL_PollEvent(&ev)) {
		switch (ev.type) {
			case SDL_QUIT:
				g_should_quit = 1;
				break;
			case SDL_KEYDOWN:
			case SDL_KEYUP: {
				if (ev.key.repeat) {
					break;
				}
				const enum retro_key keyboard_key = keyboard_input_key_from_sdl(ev.key.keysym.scancode);
				if (keyboard_key != RETROK_UNKNOWN) {
					keyboard_input_post(KEYBOARD_INPUT_SOURCE_SDL, keyboard_key, ev.type == SDL_KEYDOWN);
				}
				break;
			}
			case SDL_WINDOWEVENT:
				if (ev.window.event == SDL_WINDOWEVENT_FOCUS_LOST) {
					g_sdl_focused = false;
					pad_state = 0;
					g_sdl_pad_state = 0;
					g_mouse_buttons = 0;
					g_mouse_wheel_y = 0;
					keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_SDL);
				} else if (ev.window.event == SDL_WINDOWEVENT_FOCUS_GAINED) {
					g_sdl_focused = true;
				} else if (ev.window.event == SDL_WINDOWEVENT_SIZE_CHANGED ||
						ev.window.event == SDL_WINDOWEVENT_DISPLAY_CHANGED) {
					if (bmsx_video_context_refresh_drawable_size()) {
						msg_mark_dirty();
						clamp_mouse_position_to_framebuffer();
					}
				}
				break;
			case SDL_CONTROLLERDEVICEADDED:
				if (!g_sdl_gamepad && SDL_IsGameController(ev.cdevice.which)) {
					g_sdl_gamepad = SDL_GameControllerOpen(ev.cdevice.which);
					if (g_sdl_gamepad) {
						SDL_Joystick* joy = SDL_GameControllerGetJoystick(g_sdl_gamepad);
						g_sdl_gamepad_id = SDL_JoystickInstanceID(joy);
						fprintf(stderr, "[libretro-host] SDL gamepad: %s\n", SDL_GameControllerName(g_sdl_gamepad));
					}
				}
				break;
			case SDL_CONTROLLERDEVICEREMOVED:
				if (g_sdl_gamepad && ev.cdevice.which == g_sdl_gamepad_id) {
					SDL_GameControllerClose(g_sdl_gamepad);
					g_sdl_gamepad = NULL;
					g_sdl_gamepad_id = -1;
					g_sdl_pad_state = 0;
				}
				break;
			case SDL_MOUSEWHEEL: {
				int wheel_y = ev.wheel.y;
				if (ev.wheel.direction == SDL_MOUSEWHEEL_FLIPPED) {
					wheel_y = -wheel_y;
				}
				g_mouse_wheel_y -= wheel_y;
				break;
			}
			default:
				break;
		}
	}
	if (g_sdl_focused) {
		sdl_update_mouse_position();
	}
	g_sdl_pad_state = pad_state;
	input_finalize(g_sdl_pad_state);
}
#endif

static void input_poll_cb(void) {
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		poll_input_devices_sdl();
		return;
	}
#endif
	poll_input_devices();
}

static uint64_t monotonic_ns(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (uint64_t)ts.tv_sec * BMSX_HOST_NSEC_PER_SECOND + (uint64_t)ts.tv_nsec;
}

static uint64_t monotonic_ms(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (uint64_t)ts.tv_sec * 1000ull + (uint64_t)ts.tv_nsec / BMSX_HOST_USEC_PER_SECOND;
}

static void set_host_timing(const struct retro_system_timing* timing) {
	g_target_fps = timing->fps;
	g_frame_usec = (uint64_t)((double)BMSX_HOST_USEC_PER_SECOND / timing->fps + 0.5);
	g_frame_ns = (uint64_t)((double)BMSX_HOST_NSEC_PER_SECOND / timing->fps + 0.5);
}

static int16_t input_state_cb(unsigned port, unsigned device, unsigned index, unsigned id) {
	(void)index;
	if (port != 0) {
		return 0;
	}
	if (device == RETRO_DEVICE_JOYPAD) {
		return (g_pad_state_port0 & (uint16_t)(1u << id)) ? 1 : 0;
	}
	if (device == RETRO_DEVICE_MOUSE) {
		switch (id) {
			case kRetroMouseIdX:
				return (int16_t)g_mouse_delta_x;
			case kRetroMouseIdY:
				return (int16_t)g_mouse_delta_y;
			case kRetroMouseIdLeft:
				return (g_mouse_buttons & kMouseButtonPrimary) ? 1 : 0;
			case kRetroMouseIdRight:
				return (g_mouse_buttons & kMouseButtonSecondary) ? 1 : 0;
			case kRetroMouseIdWheelUp:
				return g_mouse_wheel_y < 0 ? (int16_t)(-g_mouse_wheel_y) : 0;
			case kRetroMouseIdWheelDown:
				return g_mouse_wheel_y > 0 ? (int16_t)g_mouse_wheel_y : 0;
			case kRetroMouseIdMiddle:
				return (g_mouse_buttons & kMouseButtonAux) ? 1 : 0;
			case kRetroMouseIdButton4:
				return (g_mouse_buttons & kMouseButtonBack) ? 1 : 0;
			case kRetroMouseIdButton5:
				return (g_mouse_buttons & kMouseButtonForward) ? 1 : 0;
			default:
				return 0;
		}
	}
	if (device == RETRO_DEVICE_POINTER) {
		switch (id) {
			case kRetroPointerIdX:
				return encode_pointer_axis(g_mouse_abs_x, g_video_surface->width);
			case kRetroPointerIdY:
				return encode_pointer_axis(g_mouse_abs_y, g_video_surface->height);
			case kRetroPointerIdPressed:
				return (g_mouse_buttons & kMouseButtonPrimary) ? 1 : 0;
			default:
				return 0;
		}
	}
	return 0;
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
			"  %s --core ./libretro_bmsx.so --no-game [--backend software|gles2] [--video fb|sdl] [--hidden-window] [--system-dir PATH] [--save-dir PATH] [--rom-folder FOLDER] [--input-timeline FILE] [--paced-timeline] [--auto-timeline] [--input-debug] [--no-audio] [--max-frames N] [--gles2-timing-report] [--timing-warmup N] [--crt-postprocessing on|off] [--crt-noise on|off]\n"
			"  %s --core ./libretro_bmsx.so GAME.rom [--backend software|gles2] [--video fb|sdl] [--hidden-window] [--system-dir PATH] [--save-dir PATH] [--rom-folder FOLDER] [--input-timeline FILE] [--paced-timeline] [--auto-timeline] [--input-debug] [--no-audio] [--max-frames N] [--gles2-timing-report] [--timing-warmup N] [--crt-postprocessing on|off] [--crt-noise on|off]\n",
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
		if (strcmp(argv[i], "--input-debug") == 0) {
			g_input_debug = true;
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
		g_use_sdl = true;
		video_context_kind = strcmp(backend, "gles2") == 0
			? BMSX_VIDEO_CONTEXT_SDL_GLES2
			: BMSX_VIDEO_CONTEXT_SDL_SOFTWARE;
		g_sdl_focused = !hidden_window;
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
	core.retro_set_video_refresh(video_cb);
	core.retro_set_audio_sample(audio_output_sample);
	core.retro_set_audio_sample_batch(audio_output_sample_batch);
	core.retro_set_input_poll(input_poll_cb);
	core.retro_set_input_state(input_state_cb);

	g_video_surface = bmsx_video_context_open(
			video_context_kind,
			hidden_window,
			g_geom_base_w,
			g_geom_base_h);
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		if (SDL_InitSubSystem(SDL_INIT_GAMECONTROLLER) != 0) {
			host_fatal("SDL game-controller initialization failed: %s", SDL_GetError());
		}
		SDL_ShowCursor(SDL_DISABLE);
		sdl_open_first_controller();
	} else
#endif
	{
		input_open_default_devices();
	}

	core.retro_init();
	struct retro_system_av_info av;
	memset(&av, 0, sizeof(av));
	core.retro_get_system_av_info(&av);
	update_geometry(&av.geometry);
	set_host_timing(&av.timing);
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
	g_accepted_presentation_count = 0;

	memset(&av, 0, sizeof(av));
	core.retro_get_system_av_info(&av);
	update_geometry(&av.geometry);
	set_host_timing(&av.timing);
	if (g_use_hw_render && g_hw_context_pending_reset && g_hw_render.context_reset) {
		g_hw_render.context_reset();
		g_hw_context_pending_reset = false;
	}
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

	while (!g_should_quit) {
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
		g_drop_video = !unpaced_timeline && !audio_master && pacing.drop_presentation;
		g_frame_timing.record_frame = g_frame_timing.enabled && g_run_frame_count >= g_frame_timing.warmup_frames;
		if (g_has_frame_time_cb) {
			const retro_usec_t frame_time_usec = !unpaced_timeline && pacing.has_elapsed
				? (retro_usec_t)(pacing.elapsed_ns / 1000u)
				: g_frame_time_cb.reference;
			g_frame_time_cb.callback(frame_time_usec);
		}
		input_timeline_dispatch_before_run(g_accepted_presentation_count);
		g_frame_timing.current_video_frame_received = false;
		g_core_presented_frame = false;
		g_frame_timing.current_blit_ns = 0u;
		g_frame_timing.current_swap_ns = 0u;
		g_frame_timing.current_blit_ran = false;
		g_frame_timing.current_swap_ran = false;
		const uint64_t run_start_ns = g_frame_timing.record_frame ? monotonic_ns() : 0u;
		core.retro_run();
		if (g_frame_timing.record_frame) {
			const uint64_t run_ns = monotonic_ns() - run_start_ns;
			bmsx_frame_timing_record(&g_frame_timing.report,
					run_ns,
					g_frame_timing.current_blit_ns,
					g_frame_timing.current_blit_ran,
					g_frame_timing.current_swap_ns,
					g_frame_timing.current_swap_ran,
					g_drop_video && g_frame_timing.current_video_frame_received,
					!g_drop_video && g_core_presented_frame);
		}
		++g_run_frame_count;
		if (g_max_run_frames == 0 && g_accepted_presentation_count > 1u &&
				input_timeline_should_auto_quit(g_accepted_presentation_count - 2u, kInputTimelineAutoQuitGraceFrames)) {
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

	if (g_use_hw_render && g_hw_render.context_destroy) {
		g_hw_render.context_destroy();
	}
	hw_release_resources();
	input_timeline_shutdown();
	keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_SDL);
	for (unsigned source = 0; source < KEYBOARD_INPUT_EVDEV_SOURCE_COUNT; source += 1u) {
		keyboard_input_release_source(KEYBOARD_INPUT_SOURCE_EVDEV_FIRST + source);
	}
	core.retro_unload_game();
	core.retro_deinit();
	if (!audio_disabled) {
		audio_output_close();
	}
	for (size_t i = 0; i < g_input_dev_count; ++i) {
		if (g_input_devs[i].fd >= 0) {
			close(g_input_devs[i].fd);
		}
	}
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		if (g_sdl_gamepad) {
			SDL_GameControllerClose(g_sdl_gamepad);
			g_sdl_gamepad = NULL;
			g_sdl_gamepad_id = -1;
		}
		SDL_QuitSubSystem(SDL_INIT_GAMECONTROLLER);
	}
#endif
	bmsx_video_context_close();
	g_video_surface = NULL;
	free(g_msg_surface);
	g_msg_surface = NULL;
	if (game_buf) {
		free(game_buf);
	}
	if (core.handle) {
		dlclose(core.handle);
	}
	bmsx_core_options_destroy(&g_core_options);
	return 0;
}
