#define _GNU_SOURCE

#include <dirent.h>
#include <limits.h>
#include <dlfcn.h>
#include <EGL/egl.h>
#include <errno.h>
#include <fcntl.h>
#include <GLES2/gl2.h>
#ifdef BMSX_LIBRETRO_HOST_SDL
#include <SDL.h>
#endif
#include <linux/fb.h>
#include <linux/input.h>
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sound/asound.h>
#include <time.h>
#include <unistd.h>
#include <ucontext.h>

#include "libretro.h"
#include "input_timeline.h"
#include "screenshot.h"

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

	void (*bmsx_set_frame_time_usec)(retro_usec_t);
	int64_t (*bmsx_get_ufps)(void);
	void (*bmsx_keyboard_event)(const char* code, bool down);
	void (*bmsx_keyboard_reset)(void);
	void (*bmsx_focus_changed)(bool focused);
	bool (*bmsx_is_cart_program_active)(void);
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

typedef struct AudioQueue {
	int16_t* data;
	size_t capacity_frames;
	size_t read_frame;
	size_t write_frame;
	size_t used_frames;
	pthread_mutex_t mutex;
	pthread_cond_t can_read;
	pthread_cond_t can_write;
	bool running;
} AudioQueue;

static volatile sig_atomic_t g_should_quit = 0;
enum { kInputTimelineAutoQuitGraceFrames = 0 };
static bool g_input_debug = false;
static const uint64_t kExitComboHoldMs = 2000;
static const unsigned kAudioPeriodFrames = 1024;
static const unsigned kAudioPeriodCount = 4;
static const unsigned kAudioPrimePeriods = 4;
static const unsigned kSdlAudioBufferFrames = 1024;
static const double kAudioMixOverheadSec = 0.004;
static const unsigned kAudioRefillMarginFrames = 128;
static const unsigned kAudioRequestAheadFrames = 256;
static const unsigned kAudioTargetMinFrames = 384;
static const unsigned kAudioTargetMaxFrames = 4096;
static const int kAudioThreadPriority = 20;
static const unsigned kAudioRecoverMaxAttempts = 8;
static const uint64_t kAudioRecoverSleepNs = 1000000ull;
static const uint64_t kFrameScheduleResyncNs = 100000000ull;
static const int64_t kHzScale = 1000000ll;

static char g_system_dir[1024] = "";
static char g_save_dir[1024] = "";
static char g_opt_render_backend[16] = "software";
static char g_opt_crt_postprocessing[8] = "off";
static char g_opt_postprocess_detail[8] = "off";
static bool g_vars_updated = false;
static LibretroCore* g_core = NULL;

static uint32_t g_frame_number = 0;

static const char* kMenuKeyRenderBackend = "bmsx_render_backend";
static const char* kMenuKeyCrtPostprocessing = "bmsx_crt_postprocessing";
static const char* kMenuKeyPostprocessDetail = "bmsx_postprocess_detail";
static const char* kMenuKeyCrtNoise = "bmsx_crt_noise";
static const char* kMenuKeyCrtColorBleed = "bmsx_crt_color_bleed";
static const char* kMenuKeyCrtScanlines = "bmsx_crt_scanlines";
static const char* kMenuKeyCrtBlur = "bmsx_crt_blur";
static const char* kMenuKeyCrtGlow = "bmsx_crt_glow";
static const char* kMenuKeyCrtFringing = "bmsx_crt_fringing";
static const char* kMenuKeyCrtAperture = "bmsx_crt_aperture";
static const char* kMenuKeyDither = "bmsx_dither";
static const char* kMenuKeyFrameSkip = "bmsx_frameskip";
static const char* kMenuKeyHostShowFps = "bmsx_host_show_fps";

#ifdef BMSX_LIBRETRO_HOST_SDL
static bool g_use_sdl = false;
static bool g_sdl_use_gl = false;
static SDL_Window* g_sdl_window = NULL;
static SDL_Renderer* g_sdl_renderer = NULL;
static SDL_Texture* g_sdl_texture = NULL;
static SDL_GLContext g_sdl_gl_context = NULL;
static SDL_GameController* g_sdl_gamepad = NULL;
static SDL_JoystickID g_sdl_gamepad_id = -1;
static uint16_t g_sdl_pad_state = 0;
static SDL_AudioDeviceID g_sdl_audio_device = 0;
#endif

static enum retro_pixel_format g_core_pixel_format = RETRO_PIXEL_FORMAT_XRGB8888;
static struct retro_hw_render_callback g_hw_render;
static bool g_use_hw_render = false;
static bool g_hw_context_pending_reset = false;
static EGLDisplay g_egl_display = EGL_NO_DISPLAY;
static EGLContext g_egl_context = EGL_NO_CONTEXT;
static EGLSurface g_egl_surface = EGL_NO_SURFACE;
static void* g_egl_lib = NULL;
static void* g_gles_lib = NULL;
static unsigned g_geom_base_w = 0;
static unsigned g_geom_base_h = 0;
static unsigned g_render_target_w = 0;
static unsigned g_render_target_h = 0;
static float g_geom_aspect = 0.0f;
static bool g_geom_dirty = false;
static uint64_t g_frame_usec = 20000;
static uint64_t g_frame_ns = 20000000;
static struct retro_frame_time_callback g_frame_time_cb = {0};
static bool g_has_frame_time_cb = false;
static unsigned g_last_video_w = 0;
static unsigned g_last_video_h = 0;
static bool g_drop_video = false;

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

struct fbdev_window {
	uint16_t width;
	uint16_t height;
};

static struct fbdev_window g_fbwin;

#define MENU_MAX_OPTIONS 32
#define MENU_MAX_VALUES 16
#define MENU_MAX_KEY 64
#define MENU_MAX_LABEL 96
#define MENU_MAX_INFO 192

typedef struct MenuOptionValue {
	char value[MENU_MAX_KEY];
	char label[MENU_MAX_LABEL];
} MenuOptionValue;

typedef struct MenuOption {
	char key[MENU_MAX_KEY];
	char label[MENU_MAX_LABEL];
	char info[MENU_MAX_INFO];
	size_t value_count;
	size_t current_index;
	MenuOptionValue values[MENU_MAX_VALUES];
} MenuOption;

static MenuOption g_menu_options[MENU_MAX_OPTIONS];
static size_t g_menu_option_count = 0;
static bool g_menu_active = false;
static bool g_menu_dirty = false;
static bool g_menu_gl_dirty = false;
static size_t g_menu_selected = 0;
static uint16_t g_menu_prev_pad = 0;

static uint8_t* g_menu_surface = NULL;
static int g_menu_surface_w = 0;
static int g_menu_surface_h = 0;
static int g_menu_surface_stride = 0;
static int g_menu_x = 0;
static int g_menu_y = 0;

static GLuint g_menu_tex = 0;
static GLuint g_menu_vbo = 0;
static int g_menu_tex_w = 0;
static int g_menu_tex_h = 0;

static bool g_show_fps = false;
static uint64_t g_fps_last_ms = 0;
static uint32_t g_fps_frames = 0;
static float g_fps_value = 0.0f;
static char g_fps_text[32] = "FPS: --";
static bool g_fps_dirty = true;
static bool g_fps_gl_dirty = true;
static uint8_t* g_fps_surface = NULL;
static int g_fps_surface_w = 0;
static int g_fps_surface_h = 0;
static int g_fps_surface_stride = 0;
static int g_fps_x = 8;
static int g_fps_y = 8;
static GLuint g_fps_tex = 0;
static GLuint g_fps_vbo = 0;
static int g_fps_tex_w = 0;
static int g_fps_tex_h = 0;

static double g_target_fps = 50.0;

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

static FbDev g_fb;
enum { kMaxInputDevs = 16 };
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
static const char* map_ev_key_to_dom_code(uint16_t code);
static void core_keyboard_event(const char* code, bool down);
static void core_focus_changed(bool focused);
static bool core_cart_program_active(void);
#ifdef BMSX_LIBRETRO_HOST_SDL
static const char* map_sdl_scancode_to_dom_code(SDL_Scancode scancode);
static uint8_t map_sdl_mouse_buttons(uint32_t buttons);
#endif
static void clamp_mouse_position_to_framebuffer(void);
static void set_mouse_absolute_position(int x, int y, bool update_delta);
static char g_audio_device[64] = "/dev/snd/pcmC0D0p";
enum { kAudioSampleBufferFrames = 512 };
static int g_audio_fd = -1;
static int g_audio_sample_rate = 0;
static unsigned g_audio_channels = 2;
static unsigned g_audio_period_frames = 0;
static unsigned g_audio_period_count = 0;
static unsigned g_audio_buffer_frames = 0;
static bool g_audio_prepared = false;
static bool g_audio_running = false;
static unsigned g_audio_underruns = 0;
static unsigned g_audio_overruns = 0;
static AudioQueue g_audio_queue;
static pthread_t g_audio_thread;
static bool g_audio_thread_started = false;
static int16_t* g_audio_thread_buf = NULL;
static size_t g_audio_thread_buf_frames = 0;
static int16_t g_audio_sample_buf[kAudioSampleBufferFrames * 2];
static size_t g_audio_sample_buf_frames = 0;

static void crash_handler(int sig, siginfo_t* si, void* ctx_) {
#if defined(__arm__)
	ucontext_t* uc = (ucontext_t*)ctx_;
	unsigned long pc = uc->uc_mcontext.arm_pc;
	unsigned long lr = uc->uc_mcontext.arm_lr;
	unsigned long sp = uc->uc_mcontext.arm_sp;
	fprintf(stderr, "\nCRASH sig=%d addr=%p pc=%08lx lr=%08lx sp=%08lx\n",
			sig, si->si_addr, pc, lr, sp);
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

static bool hw_ensure_fbo(unsigned width, unsigned height);
static bool hw_present_frame(unsigned src_w, unsigned src_h);
static void menu_render_software(void);
static void menu_render_hw(void);
static void fps_render_software(void);
static void fps_render_hw(void);
static void fps_update(void);
static void msg_render_software(void);
static void msg_render_hw(void);
static void msg_tick(void);
static uint64_t monotonic_ns(void);
static uint64_t monotonic_ms(void);
static inline uint16_t rgb888_to_rgb565(uint8_t r, uint8_t g, uint8_t b);
static inline uint32_t rgb565_to_xrgb8888(uint16_t p);
#define ASSIGN_PROC(dst, src) do { \
	void* _src = (src); \
	memcpy(&(dst), &_src, sizeof(dst)); \
} while (0)
#define ASSIGN_EGL_PROC(dst, src) do { \
	__eglMustCastToProperFunctionPointerType _src = (src); \
	memcpy(&(dst), &_src, sizeof(dst)); \
} while (0)
#define PTR_TO_RETRO_PROC(dst, src) do { \
	void* _src = (src); \
	memcpy(&(dst), &_src, sizeof(dst)); \
} while (0)
#define EGL_TO_RETRO_PROC(dst, src) do { \
	__eglMustCastToProperFunctionPointerType _src = (src); \
	memcpy(&(dst), &_src, sizeof(dst)); \
} while (0)
#ifdef BMSX_LIBRETRO_HOST_SDL
static void sdl_init(void);
static void sdl_shutdown(void);
static void sdl_prepare_frame(unsigned frame_w, unsigned frame_h);
static void sdl_present(void);
static void sdl_sync_gl_drawable_size(void);
static void poll_input_devices_sdl(void);
#endif

static uintptr_t RETRO_CALLCONV hw_get_current_framebuffer(void) {
	unsigned target_w = g_render_target_w ? g_render_target_w : g_geom_base_w;
	unsigned target_h = g_render_target_h ? g_render_target_h : g_geom_base_h;
	if (target_w == 0) target_w = g_last_video_w;
	if (target_h == 0) target_h = g_last_video_h;
	if (target_w == 0) target_w = 256;
	if (target_h == 0) target_h = 240;
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
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl && g_sdl_use_gl) {
		void* proc = SDL_GL_GetProcAddress(sym);
		if (!proc) {
			return NULL;
		}
		retro_proc_address_t fn = NULL;
		PTR_TO_RETRO_PROC(fn, proc);
		return fn;
	}
#endif
	if (sym && g_gles_lib) {
		void* proc = dlsym(g_gles_lib, sym);
		if (proc) {
			retro_proc_address_t fn = NULL;
			PTR_TO_RETRO_PROC(fn, proc);
			return fn;
		}
	}
	if (!eglGetProcAddress_ptr) {
		return NULL;
	}
	retro_proc_address_t fn = NULL;
	EGL_TO_RETRO_PROC(fn, eglGetProcAddress_ptr(sym));
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

static void* get_gl_proc(const char* name) {
	void* proc = NULL;
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl && g_sdl_use_gl) {
		proc = SDL_GL_GetProcAddress(name);
	}
#endif
	if (g_gles_lib) {
		proc = dlsym(g_gles_lib, name);
	}
	if (!proc && eglGetProcAddress_ptr) {
		ASSIGN_EGL_PROC(proc, eglGetProcAddress_ptr(name));
	}
	return proc;
}

static bool gl_load(void) {
	if (g_gl_loaded) {
		return true;
	}
#define GL_LOAD(name, type) do { \
	void* _proc = get_gl_proc(#name); \
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
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
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

typedef struct MenuGlyph {
	char c;
	uint8_t rows[7];
} MenuGlyph;

static const MenuGlyph kMenuGlyphs[] = {
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

static const uint8_t* menu_glyph_rows(char c) {
	static const uint8_t k_unknown[7] = {0x0E, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04};
	for (size_t i = 0; i < sizeof(kMenuGlyphs) / sizeof(kMenuGlyphs[0]); ++i) {
		if (kMenuGlyphs[i].c == c) {
			return kMenuGlyphs[i].rows;
		}
	}
	return k_unknown;
}

static void menu_mark_dirty(void) {
	g_menu_dirty = true;
	g_menu_gl_dirty = true;
}

static void menu_copy_str(char* dst, size_t dst_size, const char* src) {
	if (!dst || dst_size == 0) {
		return;
	}
	if (!src) {
		dst[0] = '\0';
		return;
	}
	snprintf(dst, dst_size, "%s", src);
}

static void menu_trim(char* s) {
	if (!s) return;
	char* start = s;
	while (*start == ' ' || *start == '\t') {
		++start;
	}
	char* end = start + strlen(start);
	while (end > start && (end[-1] == ' ' || end[-1] == '\t')) {
		--end;
	}
	size_t len = (size_t)(end - start);
	if (start != s) {
		memmove(s, start, len);
	}
	s[len] = '\0';
}

static bool menu_is_crt_detail_key(const char* key) {
	if (!key) {
		return false;
	}
	return strcmp(key, kMenuKeyPostprocessDetail) == 0 ||
			strcmp(key, kMenuKeyCrtNoise) == 0 ||
			strcmp(key, kMenuKeyCrtColorBleed) == 0 ||
			strcmp(key, kMenuKeyCrtScanlines) == 0 ||
			strcmp(key, kMenuKeyCrtBlur) == 0 ||
			strcmp(key, kMenuKeyCrtGlow) == 0 ||
			strcmp(key, kMenuKeyCrtFringing) == 0 ||
			strcmp(key, kMenuKeyCrtAperture) == 0;
}

static const char* menu_known_label(const char* key) {
	if (!key) return NULL;
	if (strcmp(key, kMenuKeyRenderBackend) == 0) return "Render Backend";
	if (strcmp(key, kMenuKeyCrtPostprocessing) == 0) return "CRT Post-processing";
	if (strcmp(key, kMenuKeyPostprocessDetail) == 0) return "Post-processing Detail";
	if (strcmp(key, kMenuKeyCrtNoise) == 0) return "CRT Noise";
	if (strcmp(key, kMenuKeyCrtColorBleed) == 0) return "CRT Color Bleed";
	if (strcmp(key, kMenuKeyCrtScanlines) == 0) return "CRT Scanlines";
	if (strcmp(key, kMenuKeyCrtBlur) == 0) return "CRT Blur";
	if (strcmp(key, kMenuKeyCrtGlow) == 0) return "CRT Glow";
	if (strcmp(key, kMenuKeyCrtFringing) == 0) return "CRT Fringing";
	if (strcmp(key, kMenuKeyCrtAperture) == 0) return "CRT Aperture";
	if (strcmp(key, kMenuKeyDither) == 0) return "Dither";
	if (strcmp(key, kMenuKeyFrameSkip) == 0) return "Frame Skip";
	if (strcmp(key, kMenuKeyHostShowFps) == 0) return "Show FPS";
	return NULL;
}

static const char* menu_known_info(const char* key) {
	if (!key) return NULL;
	if (strcmp(key, kMenuKeyRenderBackend) == 0) return "Switch renderer backend (restart required).";
	if (strcmp(key, kMenuKeyCrtPostprocessing) == 0) return "Enable CRT post-processing.";
	if (strcmp(key, kMenuKeyPostprocessDetail) == 0) return "Increase post-processing detail (higher offscreen scale).";
	if (strcmp(key, kMenuKeyCrtNoise) == 0) return "Toggle CRT noise/grain.";
	if (strcmp(key, kMenuKeyCrtColorBleed) == 0) return "Toggle CRT color bleed.";
	if (strcmp(key, kMenuKeyCrtScanlines) == 0) return "Toggle CRT scanlines.";
	if (strcmp(key, kMenuKeyCrtBlur) == 0) return "Toggle CRT blur.";
	if (strcmp(key, kMenuKeyCrtGlow) == 0) return "Toggle CRT glow.";
	if (strcmp(key, kMenuKeyCrtFringing) == 0) return "Toggle CRT fringing.";
	if (strcmp(key, kMenuKeyCrtAperture) == 0) return "Toggle CRT aperture grille.";
	if (strcmp(key, kMenuKeyDither) == 0) return "Select dithering mode.";
	if (strcmp(key, kMenuKeyFrameSkip) == 0) return "Skip frames when rendering exceeds frame budget.";
	if (strcmp(key, kMenuKeyHostShowFps) == 0) return "Toggle FPS overlay.";
	return NULL;
}

static const char* menu_resolve_label(const char* key, const char* preferred) {
	if (preferred && preferred[0]) {
		return preferred;
	}
	const char* known = menu_known_label(key);
	if (known && known[0]) {
		return known;
	}
	return key ? key : "";
}

static const char* menu_resolve_info(const char* key, const char* preferred) {
	if (preferred && preferred[0]) {
		return preferred;
	}
	return menu_known_info(key);
}

static const struct retro_core_option_v2_category* menu_find_v2_category(
		const struct retro_core_options_v2* opts,
		const char* category_key) {
	if (!opts || !opts->categories || !category_key || !category_key[0]) {
		return NULL;
	}
	for (const struct retro_core_option_v2_category* cat = opts->categories; cat->key; ++cat) {
		if (strcmp(cat->key, category_key) == 0) {
			return cat;
		}
	}
	return NULL;
}

static const char* menu_builtin_value(const char* key) {
	if (!key) return NULL;
	if (strcmp(key, kMenuKeyRenderBackend) == 0) return g_opt_render_backend;
	if (strcmp(key, kMenuKeyCrtPostprocessing) == 0) return g_opt_crt_postprocessing;
	if (strcmp(key, kMenuKeyPostprocessDetail) == 0) return g_opt_postprocess_detail;
	if (strcmp(key, kMenuKeyHostShowFps) == 0) return g_show_fps ? "on" : "off";
	return NULL;
}

static void menu_sync_builtin(const char* key, const char* value) {
	if (!key || !value) return;
	if (strcmp(key, kMenuKeyRenderBackend) == 0) {
		snprintf(g_opt_render_backend, sizeof(g_opt_render_backend), "%s", value);
	} else if (strcmp(key, kMenuKeyCrtPostprocessing) == 0) {
		snprintf(g_opt_crt_postprocessing, sizeof(g_opt_crt_postprocessing), "%s", value);
	} else if (strcmp(key, kMenuKeyPostprocessDetail) == 0) {
		snprintf(g_opt_postprocess_detail, sizeof(g_opt_postprocess_detail), "%s", value);
	} else if (strcmp(key, kMenuKeyHostShowFps) == 0) {
		bool enable = strcmp(value, "on") == 0;
		if (g_show_fps != enable) {
			g_show_fps = enable;
			g_fps_last_ms = 0;
			g_fps_frames = 0;
			snprintf(g_fps_text, sizeof(g_fps_text), "FPS: --");
			g_fps_dirty = true;
			g_fps_gl_dirty = true;
		}
	}
}

static MenuOption* menu_find_option(const char* key) {
	if (!key) return NULL;
	for (size_t i = 0; i < g_menu_option_count; ++i) {
		if (strcmp(g_menu_options[i].key, key) == 0) {
			return &g_menu_options[i];
		}
	}
	return NULL;
}

static MenuOption* menu_get_option(const char* key) {
	MenuOption* opt = menu_find_option(key);
	if (opt) return opt;
	if (!key || g_menu_option_count >= MENU_MAX_OPTIONS) return NULL;
	opt = &g_menu_options[g_menu_option_count++];
	memset(opt, 0, sizeof(*opt));
	menu_copy_str(opt->key, sizeof(opt->key), key);
	menu_copy_str(opt->label, sizeof(opt->label), menu_resolve_label(key, NULL));
	const char* known_info = menu_known_info(key);
	if (known_info && known_info[0]) {
		menu_copy_str(opt->info, sizeof(opt->info), known_info);
	}
	return opt;
}

static bool menu_option_is_action(const MenuOption* opt) {
	return opt && strncmp(opt->key, "__action_", 9) == 0;
}

static bool menu_option_is_disabled(const MenuOption* opt) {
	if (!opt || menu_option_is_action(opt)) {
		return false;
	}
	if (strcmp(g_opt_crt_postprocessing, "on") == 0) {
		return false;
	}
	return menu_is_crt_detail_key(opt->key);
}

static size_t menu_next_selectable(size_t index, int dir) {
	if (g_menu_option_count == 0) {
		return 0;
	}
	size_t cur = index;
	for (;;) {
		if (!menu_option_is_disabled(&g_menu_options[cur])) {
			return cur;
		}
		if (dir > 0) {
			cur = (cur + 1) % g_menu_option_count;
		} else {
			cur = (cur == 0) ? (g_menu_option_count - 1) : (cur - 1);
		}
		if (cur == index) {
			return index;
		}
	}
}

static void menu_execute_action(const char* key) {
	if (!key) return;
	if (strcmp(key, "__action_reboot") == 0) {
		if (g_core && g_core->retro_reset) {
			fprintf(stderr, "[libretro-host] menu: reboot cart\n");
			g_core->retro_reset();
		}
		g_menu_active = false;
		menu_mark_dirty();
		return;
	}
	if (strcmp(key, "__action_exit") == 0) {
		fprintf(stderr, "[libretro-host] menu: exit game\n");
		g_should_quit = 1;
		g_menu_active = false;
		menu_mark_dirty();
		return;
	}
}

static void menu_append_action(const char* key, const char* label) {
	if (!key || menu_find_option(key) || g_menu_option_count >= MENU_MAX_OPTIONS) return;
	MenuOption* opt = &g_menu_options[g_menu_option_count++];
	memset(opt, 0, sizeof(*opt));
	menu_copy_str(opt->key, sizeof(opt->key), key);
	menu_copy_str(opt->label, sizeof(opt->label), label);
	opt->value_count = 0;
	opt->current_index = 0;
}

static void menu_set_option_values(MenuOption* opt, const char* label, const char* info,
		const MenuOptionValue* values, size_t count, const char* default_value);

static void menu_append_host_options(void) {
	MenuOption* opt = menu_get_option(kMenuKeyHostShowFps);
	if (!opt) return;
	MenuOptionValue values[2];
	menu_copy_str(values[0].value, sizeof(values[0].value), "off");
	menu_copy_str(values[0].label, sizeof(values[0].label), "OFF");
	menu_copy_str(values[1].value, sizeof(values[1].value), "on");
	menu_copy_str(values[1].label, sizeof(values[1].label), "ON");
	menu_set_option_values(opt, "HOST: SHOW FPS", "Toggle FPS overlay", values, 2,
		g_show_fps ? "on" : "off");
}

static void menu_append_actions(void) {
	menu_append_action("__action_reboot", "REBOOT CART");
	menu_append_action("__action_exit", "EXIT GAME");
}

static bool menu_set_current_value(MenuOption* opt, const char* value) {
	if (!opt || !value || !value[0]) return false;
	for (size_t i = 0; i < opt->value_count; ++i) {
		if (strcmp(opt->values[i].value, value) == 0) {
			opt->current_index = i;
			return true;
		}
	}
	return false;
}

static void menu_set_option_values(MenuOption* opt, const char* label, const char* info,
		const MenuOptionValue* values, size_t count, const char* default_value) {
	if (!opt) return;
	char prev_value[MENU_MAX_KEY] = "";
	if (opt->value_count > 0 && opt->current_index < opt->value_count) {
		menu_copy_str(prev_value, sizeof(prev_value), opt->values[opt->current_index].value);
	}
	if (label && label[0]) menu_copy_str(opt->label, sizeof(opt->label), label);
	if (info && info[0]) menu_copy_str(opt->info, sizeof(opt->info), info);
	opt->value_count = 0;
	for (size_t i = 0; i < count && i < MENU_MAX_VALUES; ++i) {
		menu_copy_str(opt->values[i].value, sizeof(opt->values[i].value), values[i].value);
		if (values[i].label[0]) {
			menu_copy_str(opt->values[i].label, sizeof(opt->values[i].label), values[i].label);
		} else {
			menu_copy_str(opt->values[i].label, sizeof(opt->values[i].label), values[i].value);
		}
		++opt->value_count;
	}
	const char* initial = menu_builtin_value(opt->key);
	if (!menu_set_current_value(opt, initial) &&
		!menu_set_current_value(opt, prev_value) &&
		!menu_set_current_value(opt, default_value)) {
		opt->current_index = 0;
	}
	if (opt->value_count > 0) {
		menu_sync_builtin(opt->key, opt->values[opt->current_index].value);
	}
	menu_mark_dirty();
}

static const char* menu_option_value_label(const MenuOption* opt) {
	if (!opt || opt->value_count == 0) return "-";
	const MenuOptionValue* val = &opt->values[opt->current_index];
	return val->label[0] ? val->label : val->value;
}

static void menu_enable_option(MenuOption* opt, size_t index, bool mark_update) {
	if (!opt || opt->value_count == 0 || index >= opt->value_count) return;
	opt->current_index = index;
	menu_sync_builtin(opt->key, opt->values[index].value);
	if (mark_update) {
		g_vars_updated = true;
	}
	menu_mark_dirty();
}

static void menu_set_option_value(MenuOption* opt, const char* value, bool mark_update) {
	if (!opt || !value) return;
	for (size_t i = 0; i < opt->value_count; ++i) {
		if (strcmp(opt->values[i].value, value) == 0) {
			menu_enable_option(opt, i, mark_update);
			return;
		}
	}
}

static void menu_clear_options(void) {
	g_menu_option_count = 0;
	g_menu_selected = 0;
	menu_mark_dirty();
}

static void menu_ingest_options_v2(const struct retro_core_options_v2* opts) {
	if (!opts || !opts->definitions) return;
	for (const struct retro_core_option_v2_definition* def = opts->definitions; def->key; ++def) {
		MenuOption* opt = menu_get_option(def->key);
		if (!opt) continue;
		const struct retro_core_option_v2_category* category = menu_find_v2_category(opts, def->category_key);
		const char* label = def->desc_categorized && def->desc_categorized[0]
				? def->desc_categorized
				: def->desc;
		const char* info = def->info_categorized && def->info_categorized[0]
				? def->info_categorized
				: def->info;
		if ((!label || !label[0]) && category && category->desc && category->desc[0]) {
			label = category->desc;
		}
		if ((!info || !info[0]) && category && category->info && category->info[0]) {
			info = category->info;
		}
		label = menu_resolve_label(def->key, label);
		info = menu_resolve_info(def->key, info);
		MenuOptionValue values[MENU_MAX_VALUES];
		size_t count = 0;
		for (size_t i = 0; def->values[i].value && count < MENU_MAX_VALUES; ++i) {
			menu_copy_str(values[count].value, sizeof(values[count].value), def->values[i].value);
			menu_copy_str(values[count].label, sizeof(values[count].label),
					def->values[i].label ? def->values[i].label : def->values[i].value);
			++count;
		}
		menu_set_option_values(opt, label, info, values, count, def->default_value);
	}
	menu_append_host_options();
	menu_append_actions();
}

static void menu_ingest_options_v1(const struct retro_core_option_definition* defs) {
	if (!defs) return;
	for (const struct retro_core_option_definition* def = defs; def->key; ++def) {
		MenuOption* opt = menu_get_option(def->key);
		if (!opt) continue;
		const char* label = menu_resolve_label(def->key, def->desc);
		const char* info = menu_resolve_info(def->key, def->info);
		MenuOptionValue values[MENU_MAX_VALUES];
		size_t count = 0;
		for (size_t i = 0; def->values[i].value && count < MENU_MAX_VALUES; ++i) {
			menu_copy_str(values[count].value, sizeof(values[count].value), def->values[i].value);
			menu_copy_str(values[count].label, sizeof(values[count].label),
					def->values[i].label ? def->values[i].label : def->values[i].value);
			++count;
		}
		menu_set_option_values(opt, label, info, values, count, def->default_value);
	}
	menu_append_host_options();
	menu_append_actions();
}

static void menu_ingest_variables(const struct retro_variable* vars) {
	if (!vars) return;
	for (const struct retro_variable* var = vars; var->key; ++var) {
		if (!var->value) continue;
		MenuOption* opt = menu_get_option(var->key);
		if (!opt) continue;
		char buf[256];
		char label_buf[MENU_MAX_LABEL];
		menu_copy_str(buf, sizeof(buf), var->value);
		char* semicolon = strchr(buf, ';');
		char* values_str = NULL;
		if (semicolon) {
			*semicolon = '\0';
			menu_copy_str(label_buf, sizeof(label_buf), buf);
			values_str = semicolon + 1;
		} else {
			menu_copy_str(label_buf, sizeof(label_buf),
				menu_resolve_label(var->key, opt->label[0] ? opt->label : NULL));
			values_str = buf;
		}
		menu_trim(label_buf);
		menu_trim(values_str);
		MenuOptionValue values[MENU_MAX_VALUES];
		size_t count = 0;
		char* saveptr = NULL;
		for (char* tok = strtok_r(values_str, "|", &saveptr);
				tok && count < MENU_MAX_VALUES;
				tok = strtok_r(NULL, "|", &saveptr)) {
			menu_trim(tok);
			menu_copy_str(values[count].value, sizeof(values[count].value), tok);
			menu_copy_str(values[count].label, sizeof(values[count].label), tok);
			++count;
		}
		const char* default_value = count > 0 ? values[0].value : NULL;
		const char* info = menu_resolve_info(var->key, opt->info[0] ? opt->info : NULL);
		menu_set_option_values(opt, label_buf, info, values, count, default_value);
	}
	menu_append_host_options();
	menu_append_actions();
}

static const char* menu_get_variable_value(const char* key) {
	MenuOption* opt = menu_find_option(key);
	if (opt && opt->value_count > 0) {
		return opt->values[opt->current_index].value;
	}
	return menu_builtin_value(key);
}

static bool menu_set_variable_value(const char* key, const char* value, bool mark_update) {
	MenuOption* opt = menu_find_option(key);
	if (opt) {
		menu_set_option_value(opt, value, mark_update);
		return true;
	}
	if (menu_builtin_value(key)) {
		menu_sync_builtin(key, value);
		if (mark_update) g_vars_updated = true;
		return true;
	}
	return false;
}

static void menu_toggle(void) {
	g_menu_active = !g_menu_active;
	if (g_menu_active && g_menu_selected >= g_menu_option_count) {
		g_menu_selected = 0;
	}
	if (g_menu_active) {
		menu_append_host_options();
		menu_append_actions();
		g_menu_selected = menu_next_selectable(g_menu_selected, 1);
	}
	menu_mark_dirty();
}

static void menu_draw_pixel(int x, int y, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
	if (!g_menu_surface || x < 0 || y < 0 || x >= g_menu_surface_w || y >= g_menu_surface_h) {
		return;
	}
	uint8_t* p = g_menu_surface + (size_t)y * (size_t)g_menu_surface_stride + (size_t)x * 4u;
	p[0] = r;
	p[1] = g;
	p[2] = b;
	p[3] = a;
}

static void menu_draw_rect(int x, int y, int w, int h, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
	for (int yy = 0; yy < h; ++yy) {
		for (int xx = 0; xx < w; ++xx) {
			menu_draw_pixel(x + xx, y + yy, r, g, b, a);
		}
	}
}

static void menu_draw_char(int x, int y, char c, uint8_t r, uint8_t g, uint8_t b, uint8_t a, int scale) {
	if (c >= 'a' && c <= 'z') {
		c = (char)(c - ('a' - 'A'));
	}
	const uint8_t* rows = menu_glyph_rows(c);
	for (int row = 0; row < 7; ++row) {
		uint8_t bits = rows[row];
		for (int col = 0; col < 5; ++col) {
			if (bits & (1u << (4 - col))) {
				for (int sy = 0; sy < scale; ++sy) {
					for (int sx = 0; sx < scale; ++sx) {
						menu_draw_pixel(x + col * scale + sx, y + row * scale + sy, r, g, b, a);
					}
				}
			}
		}
	}
}

static void menu_draw_text(int x, int y, const char* text, uint8_t r, uint8_t g, uint8_t b, uint8_t a, int scale) {
	if (!text) return;
	const int advance = (5 + 1) * scale;
	for (const char* p = text; *p; ++p) {
		menu_draw_char(x, y, *p, r, g, b, a, scale);
		x += advance;
	}
}

static int menu_text_width(const char* text, int scale) {
	if (!text) return 0;
	return (int)strlen(text) * (5 + 1) * scale;
}

static void menu_write_line(char* line, size_t line_size, const char* label, const char* value) {
	const size_t max_line = line_size - 1;
	size_t label_len = strlen(label);
	if (!value || !value[0] || strcmp(value, "-") == 0) {
		if (label_len > max_line) {
			label_len = max_line;
		}
		snprintf(line, line_size, "%.*s", (int)label_len, label);
		return;
	}
	size_t value_len = strlen(value);
	if (max_line <= 2) {
		line[0] = '\0';
		return;
	}
	size_t label_cap = max_line - 2;
	if (label_len > label_cap) {
		label_len = label_cap;
	}
	size_t remaining = max_line - (label_len + 2);
	if (value_len > remaining) {
		value_len = remaining;
	}
	snprintf(line, line_size, "%.*s: %.*s", (int)label_len, label, (int)value_len, value);
}

static void fps_mark_dirty(void) {
	g_fps_dirty = true;
	g_fps_gl_dirty = true;
}

static void fps_draw_pixel(int x, int y, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
	if (!g_fps_surface || x < 0 || y < 0 || x >= g_fps_surface_w || y >= g_fps_surface_h) {
		return;
	}
	uint8_t* p = g_fps_surface + (size_t)y * (size_t)g_fps_surface_stride + (size_t)x * 4u;
	p[0] = r;
	p[1] = g;
	p[2] = b;
	p[3] = a;
}

static void fps_draw_char(int x, int y, char c, uint8_t r, uint8_t g, uint8_t b, uint8_t a, int scale) {
	if (c >= 'a' && c <= 'z') {
		c = (char)(c - ('a' - 'A'));
	}
	const uint8_t* rows = menu_glyph_rows(c);
	for (int row = 0; row < 7; ++row) {
		uint8_t bits = rows[row];
		for (int col = 0; col < 5; ++col) {
			if (bits & (1u << (4 - col))) {
				for (int sy = 0; sy < scale; ++sy) {
					for (int sx = 0; sx < scale; ++sx) {
						fps_draw_pixel(x + col * scale + sx, y + row * scale + sy, r, g, b, a);
					}
				}
			}
		}
	}
}

static void fps_draw_text(int x, int y, const char* text, uint8_t r, uint8_t g, uint8_t b, uint8_t a, int scale) {
	if (!text) return;
	const int advance = (5 + 1) * scale;
	for (const char* p = text; *p; ++p) {
		fps_draw_char(x, y, *p, r, g, b, a, scale);
		x += advance;
	}
}

static void fps_rebuild_surface(void) {
	if (!g_show_fps || g_fb.width <= 0 || g_fb.height <= 0) {
		return;
	}
	int scale = 1;
	int padding = 4;
	int line_h = (7 * scale) + 2;
	int text_w = menu_text_width(g_fps_text, scale);
	int surf_w = text_w + padding * 2;
	int surf_h = line_h + padding * 2;
	if (surf_w > g_fb.width - 4) surf_w = g_fb.width - 4;
	if (surf_h > g_fb.height - 4) surf_h = g_fb.height - 4;
	if (surf_w < 1 || surf_h < 1) return;

	if (surf_w != g_fps_surface_w || surf_h != g_fps_surface_h) {
		free(g_fps_surface);
		g_fps_surface = (uint8_t*)malloc((size_t)surf_w * (size_t)surf_h * 4u);
		if (!g_fps_surface) {
			g_fps_surface_w = 0;
			g_fps_surface_h = 0;
			g_fps_surface_stride = 0;
			return;
		}
		g_fps_surface_w = surf_w;
		g_fps_surface_h = surf_h;
		g_fps_surface_stride = surf_w * 4;
	}

	memset(g_fps_surface, 0, (size_t)g_fps_surface_stride * (size_t)g_fps_surface_h);

	g_fps_x = g_fb.width - g_fps_surface_w - 8;
	g_fps_y = 8;
	if (g_fps_x < 0) g_fps_x = 0;
	if (g_fps_y < 0) g_fps_y = 0;

	const uint8_t text_r = 80, text_g = 220, text_b = 80, text_a = 255;
	fps_draw_text(padding, padding, g_fps_text, text_r, text_g, text_b, text_a, scale);

	g_fps_dirty = false;
	g_fps_gl_dirty = true;
}

static void fps_render_software(void) {
	if (!g_show_fps || g_menu_active) return;
	if (g_fps_dirty) fps_rebuild_surface();
	if (!g_fps_surface) return;

	for (int y = 0; y < g_fps_surface_h; ++y) {
		int fb_y = g_fps_y + y;
		if (fb_y < 0 || fb_y >= g_fb.height) continue;
		uint8_t* dst_line = g_fb.map + (size_t)fb_y * (size_t)g_fb.stride + (size_t)g_fps_x * (size_t)(g_fb.bpp / 8);
		const uint8_t* src_line = g_fps_surface + (size_t)y * (size_t)g_fps_surface_stride;
		for (int x = 0; x < g_fps_surface_w; ++x) {
			int fb_x = g_fps_x + x;
			if (fb_x < 0 || fb_x >= g_fb.width) continue;
			const uint8_t* src = src_line + (size_t)x * 4u;
			uint8_t a = src[3];
			if (a == 0) continue;
			uint8_t r = src[0];
			uint8_t g = src[1];
			uint8_t b = src[2];
			if (g_fb.bpp == 32) {
				uint32_t* dst = (uint32_t*)dst_line;
				uint32_t d = dst[x];
				uint8_t dr = (uint8_t)((d >> 16) & 0xFF);
				uint8_t dg = (uint8_t)((d >> 8) & 0xFF);
				uint8_t db = (uint8_t)(d & 0xFF);
				if (a != 255) {
					dr = (uint8_t)((r * a + dr * (255 - a) + 127) / 255);
					dg = (uint8_t)((g * a + dg * (255 - a) + 127) / 255);
					db = (uint8_t)((b * a + db * (255 - a) + 127) / 255);
				} else {
					dr = r;
					dg = g;
					db = b;
				}
				dst[x] = (uint32_t)((dr << 16) | (dg << 8) | db);
			} else if (g_fb.bpp == 16) {
				uint16_t* dst = (uint16_t*)dst_line;
				uint32_t d = rgb565_to_xrgb8888(dst[x]);
				uint8_t dr = (uint8_t)((d >> 16) & 0xFF);
				uint8_t dg = (uint8_t)((d >> 8) & 0xFF);
				uint8_t db = (uint8_t)(d & 0xFF);
				if (a != 255) {
					dr = (uint8_t)((r * a + dr * (255 - a) + 127) / 255);
					dg = (uint8_t)((g * a + dg * (255 - a) + 127) / 255);
					db = (uint8_t)((b * a + db * (255 - a) + 127) / 255);
				} else {
					dr = r;
					dg = g;
					db = b;
				}
				dst[x] = rgb888_to_rgb565(dr, dg, db);
			}
		}
	}
}

static void fps_render_hw(void) {
	if (!g_show_fps || g_menu_active) return;
	if (g_fps_dirty) fps_rebuild_surface();
	if (!g_fps_surface) return;
	if (!hw_init_blitter()) return;

	if (!g_fps_tex || g_fps_tex_w != g_fps_surface_w || g_fps_tex_h != g_fps_surface_h) {
		if (g_fps_tex) {
			glDeleteTextures_ptr(1, &g_fps_tex);
			g_fps_tex = 0;
		}
		glGenTextures_ptr(1, &g_fps_tex);
		glBindTexture_ptr(GL_TEXTURE_2D, g_fps_tex);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
		glTexImage2D_ptr(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)g_fps_surface_w, (GLsizei)g_fps_surface_h,
			0, GL_RGBA, GL_UNSIGNED_BYTE, g_fps_surface);
		g_fps_tex_w = g_fps_surface_w;
		g_fps_tex_h = g_fps_surface_h;
		g_fps_gl_dirty = false;
	} else if (g_fps_gl_dirty) {
		glBindTexture_ptr(GL_TEXTURE_2D, g_fps_tex);
		glTexImage2D_ptr(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)g_fps_surface_w, (GLsizei)g_fps_surface_h,
			0, GL_RGBA, GL_UNSIGNED_BYTE, g_fps_surface);
		g_fps_gl_dirty = false;
	}

	if (!g_fps_vbo) {
		glGenBuffers_ptr(1, &g_fps_vbo);
	}

	const float left = ((float)g_fps_x / (float)g_fb.width) * 2.0f - 1.0f;
	const float right = ((float)(g_fps_x + g_fps_surface_w) / (float)g_fb.width) * 2.0f - 1.0f;
	const float top = 1.0f - ((float)g_fps_y / (float)g_fb.height) * 2.0f;
	const float bottom = 1.0f - ((float)(g_fps_y + g_fps_surface_h) / (float)g_fb.height) * 2.0f;
	const float quad[] = {
		left,  bottom, 0.0f, 0.0f,
		right, bottom, 1.0f, 0.0f,
		left,  top,    0.0f, 1.0f,
		right, top,    1.0f, 1.0f,
	};

	glViewport_ptr(0, 0, g_fb.width, g_fb.height);
	glDisable_ptr(GL_DEPTH_TEST);
	glDisable_ptr(GL_CULL_FACE);
	glEnable_ptr(GL_BLEND);
	glBlendFunc_ptr(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	glUseProgram_ptr(g_blit_program);
	glActiveTexture_ptr(GL_TEXTURE0);
	glBindTexture_ptr(GL_TEXTURE_2D, g_fps_tex);
	if (g_blit_uniform_tex >= 0) {
		glUniform1i_ptr(g_blit_uniform_tex, 0);
	}
	if (g_blit_uniform_flip >= 0) {
		glUniform1f_ptr(g_blit_uniform_flip, 1.0f);
	}
	glBindBuffer_ptr(GL_ARRAY_BUFFER, g_fps_vbo);
	glBufferData_ptr(GL_ARRAY_BUFFER, (GLsizeiptr)sizeof(quad), quad, GL_DYNAMIC_DRAW);
	if (g_blit_attr_pos >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)g_blit_attr_pos);
		glVertexAttribPointer_ptr((GLuint)g_blit_attr_pos, 2, GL_FLOAT, GL_FALSE, 4 * (GLsizei)sizeof(float), (void*)0);
	}
	if (g_blit_attr_uv >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)g_blit_attr_uv);
		glVertexAttribPointer_ptr((GLuint)g_blit_attr_uv, 2, GL_FLOAT, GL_FALSE, 4 * (GLsizei)sizeof(float), (void*)(2 * sizeof(float)));
	}
	glDrawArrays_ptr(GL_TRIANGLE_STRIP, 0, 4);
	glDisable_ptr(GL_BLEND);
}

static void fps_update(void) {
	if (!g_show_fps) return;
	uint64_t now = monotonic_ms();
	if (g_fps_last_ms == 0) {
		g_fps_last_ms = now;
		g_fps_frames = 0;
	}
	++g_fps_frames;
	const uint64_t elapsed = now - g_fps_last_ms;
	// Host-side FPS estimate; uses monotonic clock (no vsync or GPU timing).
	if (elapsed >= 500) {
		g_fps_value = (float)g_fps_frames * 1000.0f / (float)elapsed;
		snprintf(g_fps_text, sizeof(g_fps_text), "FPS: %.1f", g_fps_value);
		g_fps_frames = 0;
		g_fps_last_ms = now;
		fps_mark_dirty();
	}
}

static void msg_mark_dirty(void) {
	g_msg_dirty = true;
	g_msg_gl_dirty = true;
}

static unsigned msg_default_frames(void) {
	double fps = g_target_fps;
	if (fps <= 1.0) {
		fps = 50.0;
	}
	unsigned frames = (unsigned)(fps * 2.0 + 0.5);
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

static void msg_draw_pixel(int x, int y, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
	if (!g_msg_surface || x < 0 || y < 0 || x >= g_msg_surface_w || y >= g_msg_surface_h) {
		return;
	}
	uint8_t* p = g_msg_surface + (size_t)y * (size_t)g_msg_surface_stride + (size_t)x * 4u;
	p[0] = r;
	p[1] = g;
	p[2] = b;
	p[3] = a;
}

static void msg_draw_rect(int x, int y, int w, int h, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
	for (int yy = 0; yy < h; ++yy) {
		for (int xx = 0; xx < w; ++xx) {
			msg_draw_pixel(x + xx, y + yy, r, g, b, a);
		}
	}
}

static void msg_draw_char(int x, int y, char c, uint8_t r, uint8_t g, uint8_t b, uint8_t a, int scale) {
	if (c >= 'a' && c <= 'z') {
		c = (char)(c - ('a' - 'A'));
	}
	const uint8_t* rows = menu_glyph_rows(c);
	for (int row = 0; row < 7; ++row) {
		uint8_t bits = rows[row];
		for (int col = 0; col < 5; ++col) {
			if (bits & (1u << (4 - col))) {
				for (int sy = 0; sy < scale; ++sy) {
					for (int sx = 0; sx < scale; ++sx) {
						msg_draw_pixel(x + col * scale + sx, y + row * scale + sy, r, g, b, a);
					}
				}
			}
		}
	}
}

static void msg_draw_text(int x, int y, const char* text, uint8_t r, uint8_t g, uint8_t b, uint8_t a, int scale) {
	if (!text) return;
	const int advance = (5 + 1) * scale;
	for (const char* p = text; *p; ++p) {
		msg_draw_char(x, y, *p, r, g, b, a, scale);
		x += advance;
	}
}

static void msg_rebuild_surface(void) {
	if (g_msg_frames_left == 0 || !g_msg_text[0] || g_fb.width <= 0 || g_fb.height <= 0) {
		return;
	}
	int scale = 2;
	int padding = 6;
	int max_w = g_fb.width - 24;
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
	if (surf_w > g_fb.width - 8) surf_w = g_fb.width - 8;
	if (surf_h > g_fb.height - 8) surf_h = g_fb.height - 8;
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
	g_msg_y = g_fb.height - g_msg_surface_h - 12;
	if (g_msg_x < 0) g_msg_x = 0;
	if (g_msg_y < 0) g_msg_y = 0;

	const uint8_t bg_r = 8, bg_g = 8, bg_b = 8, bg_a = 180;
	const uint8_t text_r = 240, text_g = 240, text_b = 240, text_a = 255;
	msg_draw_rect(0, 0, g_msg_surface_w, g_msg_surface_h, bg_r, bg_g, bg_b, bg_a);
	for (int i = 0; i < g_msg_line_count; ++i) {
		int y = padding + i * line_h;
		msg_draw_text(padding, y, g_msg_lines[i], text_r, text_g, text_b, text_a, scale);
	}
	g_msg_dirty = false;
	g_msg_gl_dirty = true;
}

static void msg_render_software(void) {
	if (g_msg_frames_left == 0 || g_menu_active) return;
	if (g_msg_dirty) msg_rebuild_surface();
	if (!g_msg_surface) return;

	for (int y = 0; y < g_msg_surface_h; ++y) {
		int fb_y = g_msg_y + y;
		if (fb_y < 0 || fb_y >= g_fb.height) continue;
		uint8_t* dst_line = g_fb.map + (size_t)fb_y * (size_t)g_fb.stride + (size_t)g_msg_x * (size_t)(g_fb.bpp / 8);
		const uint8_t* src_line = g_msg_surface + (size_t)y * (size_t)g_msg_surface_stride;
		for (int x = 0; x < g_msg_surface_w; ++x) {
			int fb_x = g_msg_x + x;
			if (fb_x < 0 || fb_x >= g_fb.width) continue;
			const uint8_t* src = src_line + (size_t)x * 4u;
			uint8_t a = src[3];
			if (a == 0) continue;
			uint8_t r = src[0];
			uint8_t g = src[1];
			uint8_t b = src[2];
			if (g_fb.bpp == 32) {
				uint32_t* dst = (uint32_t*)dst_line;
				uint32_t d = dst[x];
				uint8_t dr = (uint8_t)((d >> 16) & 0xFF);
				uint8_t dg = (uint8_t)((d >> 8) & 0xFF);
				uint8_t db = (uint8_t)(d & 0xFF);
				if (a != 255) {
					dr = (uint8_t)((r * a + dr * (255 - a) + 127) / 255);
					dg = (uint8_t)((g * a + dg * (255 - a) + 127) / 255);
					db = (uint8_t)((b * a + db * (255 - a) + 127) / 255);
				} else {
					dr = r;
					dg = g;
					db = b;
				}
				dst[x] = (uint32_t)((dr << 16) | (dg << 8) | db);
			} else if (g_fb.bpp == 16) {
				uint16_t* dst = (uint16_t*)dst_line;
				uint32_t d = rgb565_to_xrgb8888(dst[x]);
				uint8_t dr = (uint8_t)((d >> 16) & 0xFF);
				uint8_t dg = (uint8_t)((d >> 8) & 0xFF);
				uint8_t db = (uint8_t)(d & 0xFF);
				if (a != 255) {
					dr = (uint8_t)((r * a + dr * (255 - a) + 127) / 255);
					dg = (uint8_t)((g * a + dg * (255 - a) + 127) / 255);
					db = (uint8_t)((b * a + db * (255 - a) + 127) / 255);
				} else {
					dr = r;
					dg = g;
					db = b;
				}
				dst[x] = rgb888_to_rgb565(dr, dg, db);
			}
		}
	}
}

static void msg_render_hw(void) {
	if (g_msg_frames_left == 0 || g_menu_active) return;
	if (g_msg_dirty) msg_rebuild_surface();
	if (!g_msg_surface) return;
	if (!hw_init_blitter()) return;

	if (!g_msg_tex || g_msg_tex_w != g_msg_surface_w || g_msg_tex_h != g_msg_surface_h) {
		if (g_msg_tex) {
			glDeleteTextures_ptr(1, &g_msg_tex);
			g_msg_tex = 0;
		}
		glGenTextures_ptr(1, &g_msg_tex);
		glBindTexture_ptr(GL_TEXTURE_2D, g_msg_tex);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
		glTexImage2D_ptr(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)g_msg_surface_w, (GLsizei)g_msg_surface_h,
			0, GL_RGBA, GL_UNSIGNED_BYTE, g_msg_surface);
		g_msg_tex_w = g_msg_surface_w;
		g_msg_tex_h = g_msg_surface_h;
		g_msg_gl_dirty = false;
	} else if (g_msg_gl_dirty) {
		glBindTexture_ptr(GL_TEXTURE_2D, g_msg_tex);
		glTexImage2D_ptr(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)g_msg_surface_w, (GLsizei)g_msg_surface_h,
			0, GL_RGBA, GL_UNSIGNED_BYTE, g_msg_surface);
		g_msg_gl_dirty = false;
	}

	if (!g_msg_vbo) {
		glGenBuffers_ptr(1, &g_msg_vbo);
	}

	const float left = ((float)g_msg_x / (float)g_fb.width) * 2.0f - 1.0f;
	const float right = ((float)(g_msg_x + g_msg_surface_w) / (float)g_fb.width) * 2.0f - 1.0f;
	const float top = 1.0f - ((float)g_msg_y / (float)g_fb.height) * 2.0f;
	const float bottom = 1.0f - ((float)(g_msg_y + g_msg_surface_h) / (float)g_fb.height) * 2.0f;
	const float quad[] = {
		left,  bottom, 0.0f, 0.0f,
		right, bottom, 1.0f, 0.0f,
		left,  top,    0.0f, 1.0f,
		right, top,    1.0f, 1.0f,
	};

	glViewport_ptr(0, 0, g_fb.width, g_fb.height);
	glDisable_ptr(GL_DEPTH_TEST);
	glDisable_ptr(GL_CULL_FACE);
	glEnable_ptr(GL_BLEND);
	glBlendFunc_ptr(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	glUseProgram_ptr(g_blit_program);
	glActiveTexture_ptr(GL_TEXTURE0);
	glBindTexture_ptr(GL_TEXTURE_2D, g_msg_tex);
	if (g_blit_uniform_tex >= 0) {
		glUniform1i_ptr(g_blit_uniform_tex, 0);
	}
	if (g_blit_uniform_flip >= 0) {
		glUniform1f_ptr(g_blit_uniform_flip, 1.0f);
	}
	glBindBuffer_ptr(GL_ARRAY_BUFFER, g_msg_vbo);
	glBufferData_ptr(GL_ARRAY_BUFFER, (GLsizeiptr)sizeof(quad), quad, GL_DYNAMIC_DRAW);
	if (g_blit_attr_pos >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)g_blit_attr_pos);
		glVertexAttribPointer_ptr((GLuint)g_blit_attr_pos, 2, GL_FLOAT, GL_FALSE, 4 * (GLsizei)sizeof(float), (void*)0);
	}
	if (g_blit_attr_uv >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)g_blit_attr_uv);
		glVertexAttribPointer_ptr((GLuint)g_blit_attr_uv, 2, GL_FLOAT, GL_FALSE, 4 * (GLsizei)sizeof(float), (void*)(2 * sizeof(float)));
	}
	glDrawArrays_ptr(GL_TRIANGLE_STRIP, 0, 4);
	glDisable_ptr(GL_BLEND);
}

static void menu_rebuild_surface(void) {
	if (!g_menu_active || g_fb.width <= 0 || g_fb.height <= 0) {
		return;
	}
	if (g_menu_option_count > 0 && g_menu_selected >= g_menu_option_count) {
		g_menu_selected = menu_next_selectable(0, 1);
	}
	const char* title = "CORE OPTIONS";
	char footer_buf[MENU_MAX_INFO];
	if (g_menu_option_count == 0) {
		menu_copy_str(footer_buf, sizeof(footer_buf), "B: CLOSE");
	} else {
		const MenuOption* selected = &g_menu_options[g_menu_selected];
		if (menu_option_is_action(selected)) {
			menu_copy_str(footer_buf, sizeof(footer_buf), "A/START: EXECUTE  B: CLOSE");
		} else if (menu_option_is_disabled(selected)) {
			menu_copy_str(footer_buf, sizeof(footer_buf), "LOCKED: ENABLE CRT POST-PROCESSING  B: CLOSE");
		} else {
			menu_copy_str(footer_buf, sizeof(footer_buf), "D-PAD: NAV  L/R: CHANGE  B: CLOSE");
		}
	}
	const char* footer = footer_buf;
	size_t max_chars = strlen(title);
	if (strlen(footer) > max_chars) {
		max_chars = strlen(footer);
	}
	for (size_t i = 0; i < g_menu_option_count; ++i) {
		const MenuOption* opt = &g_menu_options[i];
		const char* label = opt->label[0] ? opt->label : opt->key;
		size_t len = strlen(label);
		if (!menu_option_is_action(opt)) {
			const char* value = menu_option_value_label(opt);
			if (value && value[0] && strcmp(value, "-") != 0) {
				len = strlen(label) + 2 + strlen(value);
			}
		}
		if (len > max_chars) {
			max_chars = len;
		}
	}
	int scale = 2;
	int padding = 8;
	int line_h = (7 * scale) + 4;
	int title_h = line_h;
	int title_gap = 6;
	int lines = (int)(g_menu_option_count ? g_menu_option_count : 1);
	int box_lines = lines + 1;
	int menu_w = (int)(max_chars * (5 + 1) * scale) + padding * 2;
	int box_h = box_lines * line_h + padding * 2;
	int menu_h = title_h + title_gap + box_h;
	if (menu_w > g_fb.width - 20 || menu_h > g_fb.height - 20) {
		scale = 1;
		line_h = (7 * scale) + 3;
		title_h = line_h;
		title_gap = 4;
		menu_w = (int)(max_chars * (5 + 1) * scale) + padding * 2;
		box_h = box_lines * line_h + padding * 2;
		menu_h = title_h + title_gap + box_h;
	}
	if (menu_w > g_fb.width - 10) menu_w = g_fb.width - 10;
	if (menu_h > g_fb.height - 10) menu_h = g_fb.height - 10;
	if (menu_w < 1 || menu_h < 1) return;
	const int box_y = title_h + title_gap;

	if (menu_w != g_menu_surface_w || menu_h != g_menu_surface_h) {
		free(g_menu_surface);
		g_menu_surface = (uint8_t*)malloc((size_t)menu_w * (size_t)menu_h * 4u);
		if (!g_menu_surface) {
			g_menu_surface_w = 0;
			g_menu_surface_h = 0;
			g_menu_surface_stride = 0;
			return;
		}
		g_menu_surface_w = menu_w;
		g_menu_surface_h = menu_h;
		g_menu_surface_stride = menu_w * 4;
	}

	memset(g_menu_surface, 0, (size_t)g_menu_surface_stride * (size_t)g_menu_surface_h);

	g_menu_x = (g_fb.width - g_menu_surface_w) / 2;
	g_menu_y = (g_fb.height - box_h) / 2 - box_y;
	if (g_menu_x < 0) g_menu_x = 0;
	if (g_menu_y < 0) g_menu_y = 0;

	const uint8_t bg_r = 8, bg_g = 8, bg_b = 8, bg_a = 200;
	const uint8_t hl_r = 32, hl_g = 64, hl_b = 96, hl_a = 220;
	const uint8_t text_r = 240, text_g = 240, text_b = 240, text_a = 255;
	const uint8_t dim_r = 180, dim_g = 180, dim_b = 180, dim_a = 255;
	const uint8_t title_r = 96, title_g = 200, title_b = 255, title_a = 255;

	menu_draw_rect(0, box_y, g_menu_surface_w, box_h, bg_r, bg_g, bg_b, bg_a);
	menu_draw_text(padding, 0, title, title_r, title_g, title_b, title_a, scale);

	int cursor_y = box_y + padding;

	if (g_menu_option_count == 0) {
		menu_draw_text(padding, cursor_y, "NO OPTIONS", dim_r, dim_g, dim_b, dim_a, scale);
		cursor_y += line_h;
	} else {
		for (size_t i = 0; i < g_menu_option_count; ++i) {
			if (i == g_menu_selected) {
				menu_draw_rect(0, cursor_y - 2, g_menu_surface_w, line_h, hl_r, hl_g, hl_b, hl_a);
			}
			const MenuOption* opt = &g_menu_options[i];
			const bool disabled = menu_option_is_disabled(opt);
			const char* label = opt->label[0] ? opt->label : opt->key;
			char line[256];
			if (menu_option_is_action(opt)) {
				menu_write_line(line, sizeof(line), label, NULL);
			} else {
				const char* value = menu_option_value_label(opt);
				menu_write_line(line, sizeof(line), label, value);
			}
			const uint8_t line_r = disabled ? dim_r : text_r;
			const uint8_t line_g = disabled ? dim_g : text_g;
			const uint8_t line_b = disabled ? dim_b : text_b;
			menu_draw_text(padding, cursor_y, line, line_r, line_g, line_b, text_a, scale);
			cursor_y += line_h;
		}
	}
	{
		int footer_w = menu_text_width(footer, scale);
		int footer_x = g_menu_surface_w - padding - footer_w;
		if (footer_x < padding) footer_x = padding;
		int footer_y = box_y + box_h - padding - line_h;
		menu_draw_text(footer_x, footer_y, footer, dim_r, dim_g, dim_b, dim_a, scale);
	}

	g_menu_dirty = false;
	g_menu_gl_dirty = true;
}

static void menu_render_software(void) {
	if (!g_menu_active) return;
	if (g_menu_dirty) menu_rebuild_surface();
	if (!g_menu_surface) return;

	for (int y = 0; y < g_menu_surface_h; ++y) {
		int fb_y = g_menu_y + y;
		if (fb_y < 0 || fb_y >= g_fb.height) continue;
		uint8_t* dst_line = g_fb.map + (size_t)fb_y * (size_t)g_fb.stride + (size_t)g_menu_x * (size_t)(g_fb.bpp / 8);
		const uint8_t* src_line = g_menu_surface + (size_t)y * (size_t)g_menu_surface_stride;
		for (int x = 0; x < g_menu_surface_w; ++x) {
			int fb_x = g_menu_x + x;
			if (fb_x < 0 || fb_x >= g_fb.width) continue;
			const uint8_t* src = src_line + (size_t)x * 4u;
			uint8_t a = src[3];
			if (a == 0) continue;
			uint8_t r = src[0];
			uint8_t g = src[1];
			uint8_t b = src[2];
			if (g_fb.bpp == 32) {
				uint32_t* dst = (uint32_t*)dst_line;
				uint32_t d = dst[x];
				uint8_t dr = (uint8_t)((d >> 16) & 0xFF);
				uint8_t dg = (uint8_t)((d >> 8) & 0xFF);
				uint8_t db = (uint8_t)(d & 0xFF);
				if (a != 255) {
					dr = (uint8_t)((r * a + dr * (255 - a) + 127) / 255);
					dg = (uint8_t)((g * a + dg * (255 - a) + 127) / 255);
					db = (uint8_t)((b * a + db * (255 - a) + 127) / 255);
				} else {
					dr = r;
					dg = g;
					db = b;
				}
				dst[x] = (uint32_t)((dr << 16) | (dg << 8) | db);
			} else if (g_fb.bpp == 16) {
				uint16_t* dst = (uint16_t*)dst_line;
				uint32_t d = rgb565_to_xrgb8888(dst[x]);
				uint8_t dr = (uint8_t)((d >> 16) & 0xFF);
				uint8_t dg = (uint8_t)((d >> 8) & 0xFF);
				uint8_t db = (uint8_t)(d & 0xFF);
				if (a != 255) {
					dr = (uint8_t)((r * a + dr * (255 - a) + 127) / 255);
					dg = (uint8_t)((g * a + dg * (255 - a) + 127) / 255);
					db = (uint8_t)((b * a + db * (255 - a) + 127) / 255);
				} else {
					dr = r;
					dg = g;
					db = b;
				}
				dst[x] = rgb888_to_rgb565(dr, dg, db);
			}
		}
	}
}

static void menu_render_hw(void) {
	if (!g_menu_active) return;
	if (g_menu_dirty) menu_rebuild_surface();
	if (!g_menu_surface) return;
	if (!hw_init_blitter()) return;

	if (!g_menu_tex || g_menu_tex_w != g_menu_surface_w || g_menu_tex_h != g_menu_surface_h) {
		if (g_menu_tex) {
			glDeleteTextures_ptr(1, &g_menu_tex);
			g_menu_tex = 0;
		}
		glGenTextures_ptr(1, &g_menu_tex);
		glBindTexture_ptr(GL_TEXTURE_2D, g_menu_tex);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
		glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
		glTexImage2D_ptr(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)g_menu_surface_w, (GLsizei)g_menu_surface_h,
			0, GL_RGBA, GL_UNSIGNED_BYTE, g_menu_surface);
		g_menu_tex_w = g_menu_surface_w;
		g_menu_tex_h = g_menu_surface_h;
		g_menu_gl_dirty = false;
	} else if (g_menu_gl_dirty) {
		glBindTexture_ptr(GL_TEXTURE_2D, g_menu_tex);
		glTexImage2D_ptr(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)g_menu_surface_w, (GLsizei)g_menu_surface_h,
			0, GL_RGBA, GL_UNSIGNED_BYTE, g_menu_surface);
		g_menu_gl_dirty = false;
	}

	if (!g_menu_vbo) {
		glGenBuffers_ptr(1, &g_menu_vbo);
	}

	const float left = ((float)g_menu_x / (float)g_fb.width) * 2.0f - 1.0f;
	const float right = ((float)(g_menu_x + g_menu_surface_w) / (float)g_fb.width) * 2.0f - 1.0f;
	const float top = 1.0f - ((float)g_menu_y / (float)g_fb.height) * 2.0f;
	const float bottom = 1.0f - ((float)(g_menu_y + g_menu_surface_h) / (float)g_fb.height) * 2.0f;
	const float quad[] = {
		left,  bottom, 0.0f, 0.0f,
		right, bottom, 1.0f, 0.0f,
		left,  top,    0.0f, 1.0f,
		right, top,    1.0f, 1.0f,
	};

	glViewport_ptr(0, 0, g_fb.width, g_fb.height);
	glDisable_ptr(GL_DEPTH_TEST);
	glDisable_ptr(GL_CULL_FACE);
	glEnable_ptr(GL_BLEND);
	glBlendFunc_ptr(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	glUseProgram_ptr(g_blit_program);
	glActiveTexture_ptr(GL_TEXTURE0);
	glBindTexture_ptr(GL_TEXTURE_2D, g_menu_tex);
	if (g_blit_uniform_tex >= 0) {
		glUniform1i_ptr(g_blit_uniform_tex, 0);
	}
	if (g_blit_uniform_flip >= 0) {
		glUniform1f_ptr(g_blit_uniform_flip, 1.0f);
	}
	glBindBuffer_ptr(GL_ARRAY_BUFFER, g_menu_vbo);
	glBufferData_ptr(GL_ARRAY_BUFFER, (GLsizeiptr)sizeof(quad), quad, GL_DYNAMIC_DRAW);
	if (g_blit_attr_pos >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)g_blit_attr_pos);
		glVertexAttribPointer_ptr((GLuint)g_blit_attr_pos, 2, GL_FLOAT, GL_FALSE, 4 * (GLsizei)sizeof(float), (void*)0);
	}
	if (g_blit_attr_uv >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)g_blit_attr_uv);
		glVertexAttribPointer_ptr((GLuint)g_blit_attr_uv, 2, GL_FLOAT, GL_FALSE, 4 * (GLsizei)sizeof(float), (void*)(2 * sizeof(float)));
	}
	glDrawArrays_ptr(GL_TRIANGLE_STRIP, 0, 4);
	glDisable_ptr(GL_BLEND);
}

static bool hw_present_frame(unsigned src_w, unsigned src_h) {
	if (!hw_init_blitter()) {
		return false;
	}
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		sdl_sync_gl_drawable_size();
	}
#endif
	if (!g_hw_tex) {
		return false;
	}
	const unsigned present_w = g_hw_tex_w ? g_hw_tex_w : src_w;
	const unsigned present_h = g_hw_tex_h ? g_hw_tex_h : src_h;
	if (present_w == 0 || present_h == 0) {
		return false;
	}
	int dst_x = 0, dst_y = 0, dst_w = 0, dst_h = 0;
	compute_dst_rect(g_fb.width, g_fb.height, present_w, present_h, &dst_x, &dst_y, &dst_w, &dst_h);
	if (dst_w <= 0 || dst_h <= 0) {
		return false;
	}
	glBindFramebuffer_ptr(GL_FRAMEBUFFER, 0);
	glViewport_ptr(0, 0, g_fb.width, g_fb.height);
	glClearColor_ptr(0.0f, 0.0f, 0.0f, 1.0f);
	glClear_ptr(GL_COLOR_BUFFER_BIT);
	glViewport_ptr(dst_x, dst_y, dst_w, dst_h);
	glDisable_ptr(GL_BLEND);
	glDisable_ptr(GL_DEPTH_TEST);
	glDisable_ptr(GL_CULL_FACE);
	glUseProgram_ptr(g_blit_program);
	glActiveTexture_ptr(GL_TEXTURE0);
	glBindTexture_ptr(GL_TEXTURE_2D, g_hw_tex);
	if (g_blit_uniform_tex >= 0) {
		glUniform1i_ptr(g_blit_uniform_tex, 0);
	}
	if (g_blit_uniform_flip >= 0) {
		glUniform1f_ptr(g_blit_uniform_flip, g_hw_render.bottom_left_origin ? 0.0f : 1.0f);
	}
	glBindBuffer_ptr(GL_ARRAY_BUFFER, g_blit_vbo);
	if (g_blit_attr_pos >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)g_blit_attr_pos);
		glVertexAttribPointer_ptr((GLuint)g_blit_attr_pos, 2, GL_FLOAT, GL_FALSE, 4 * (GLsizei)sizeof(float), (void*)0);
	}
	if (g_blit_attr_uv >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)g_blit_attr_uv);
		glVertexAttribPointer_ptr((GLuint)g_blit_attr_uv, 2, GL_FLOAT, GL_FALSE, 4 * (GLsizei)sizeof(float), (void*)(2 * sizeof(float)));
	}
	glDrawArrays_ptr(GL_TRIANGLE_STRIP, 0, 4);
	msg_render_hw();
	fps_render_hw();
	menu_render_hw();
	
	// Capture screenshot if requested by the active input timeline.
	if (core_cart_program_active() && input_timeline_should_capture_frame(g_frame_number)) {
		fprintf(stderr, "[SCREENSHOT] Capturing frame %u (%ux%u)\n", g_frame_number, g_fb.width, g_fb.height);
		uint8_t* pixels = malloc(g_fb.width * g_fb.height * 4);
		if (pixels) {
			glReadPixels_ptr(0, 0, g_fb.width, g_fb.height, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
			char filename[128];
			snprintf(filename, sizeof(filename), "frame_%05u.png", g_frame_number);
			screenshot_save_png(filename, g_fb.width, g_fb.height, pixels);
			free(pixels);
		}
	}
	
	if (core_cart_program_active()) {
		g_frame_number++;
	}
	return true;
}

static void maybe_capture_software_frame(void) {
	if (!core_cart_program_active()) {
		return;
	}
	if (!input_timeline_should_capture_frame(g_frame_number)) {
		g_frame_number++;
		return;
	}
	fprintf(stderr, "[SCREENSHOT] Capturing frame %u (%ux%u)\n", g_frame_number, g_fb.width, g_fb.height);
	const size_t pixel_count = (size_t)g_fb.width * (size_t)g_fb.height;
	uint8_t* pixels = (uint8_t*)malloc(pixel_count * 4u);
	if (pixels) {
		for (int y = 0; y < g_fb.height; ++y) {
			const int src_y = g_fb.height - 1 - y;
			const uint8_t* src_line = g_fb.map + (size_t)src_y * (size_t)g_fb.stride;
			uint8_t* dst_line = pixels + (size_t)y * (size_t)g_fb.width * 4u;
			if (g_fb.bpp == 32) {
				const uint32_t* src = (const uint32_t*)src_line;
				for (int x = 0; x < g_fb.width; ++x) {
					const uint32_t p = src[x];
					dst_line[(size_t)x * 4u + 0] = (uint8_t)((p >> 16) & 0xFF);
					dst_line[(size_t)x * 4u + 1] = (uint8_t)((p >> 8) & 0xFF);
					dst_line[(size_t)x * 4u + 2] = (uint8_t)(p & 0xFF);
					dst_line[(size_t)x * 4u + 3] = 255;
				}
			} else if (g_fb.bpp == 16) {
				const uint16_t* src = (const uint16_t*)src_line;
				for (int x = 0; x < g_fb.width; ++x) {
					const uint32_t p = rgb565_to_xrgb8888(src[x]);
					dst_line[(size_t)x * 4u + 0] = (uint8_t)((p >> 16) & 0xFF);
					dst_line[(size_t)x * 4u + 1] = (uint8_t)((p >> 8) & 0xFF);
					dst_line[(size_t)x * 4u + 2] = (uint8_t)(p & 0xFF);
					dst_line[(size_t)x * 4u + 3] = 255;
				}
			}
		}
		char filename[128];
		snprintf(filename, sizeof(filename), "frame_%05u.png", g_frame_number);
		screenshot_save_png(filename, (uint32_t)g_fb.width, (uint32_t)g_fb.height, pixels);
		free(pixels);
	}
	g_frame_number++;
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

	ASSIGN_PROC(eglGetDisplay_ptr, dlsym(g_egl_lib, "eglGetDisplay"));
	ASSIGN_PROC(eglBindAPI_ptr, dlsym(g_egl_lib, "eglBindAPI"));
	ASSIGN_PROC(eglInitialize_ptr, dlsym(g_egl_lib, "eglInitialize"));
	ASSIGN_PROC(eglChooseConfig_ptr, dlsym(g_egl_lib, "eglChooseConfig"));
	ASSIGN_PROC(eglCreateWindowSurface_ptr, dlsym(g_egl_lib, "eglCreateWindowSurface"));
	ASSIGN_PROC(eglCreateContext_ptr, dlsym(g_egl_lib, "eglCreateContext"));
	ASSIGN_PROC(eglMakeCurrent_ptr, dlsym(g_egl_lib, "eglMakeCurrent"));
	ASSIGN_PROC(eglSwapInterval_ptr, dlsym(g_egl_lib, "eglSwapInterval"));
	ASSIGN_PROC(eglSwapBuffers_ptr, dlsym(g_egl_lib, "eglSwapBuffers"));
	ASSIGN_PROC(eglDestroyContext_ptr, dlsym(g_egl_lib, "eglDestroyContext"));
	ASSIGN_PROC(eglDestroySurface_ptr, dlsym(g_egl_lib, "eglDestroySurface"));
	ASSIGN_PROC(eglTerminate_ptr, dlsym(g_egl_lib, "eglTerminate"));
	ASSIGN_PROC(eglGetError_ptr, dlsym(g_egl_lib, "eglGetError"));
	ASSIGN_PROC(eglGetProcAddress_ptr, dlsym(g_egl_lib, "eglGetProcAddress"));

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

static void sdl_sync_gl_drawable_size(void) {
	if (!g_sdl_use_gl || !g_sdl_window) {
		return;
	}
	int drawable_w = 0;
	int drawable_h = 0;
	SDL_GL_GetDrawableSize(g_sdl_window, &drawable_w, &drawable_h);
	if (drawable_w <= 0 || drawable_h <= 0) {
		return;
	}
	if (g_fb.width == drawable_w && g_fb.height == drawable_h) {
		return;
	}
	g_fb.width = drawable_w;
	g_fb.height = drawable_h;
	g_fb.bpp = 32;
	g_fb.stride = drawable_w * 4;
	fps_mark_dirty();
	msg_mark_dirty();
	menu_mark_dirty();
}

static void sdl_resize(unsigned width, unsigned height) {
	if (width == 0 || height == 0) {
		return;
	}
	g_fb.width = (int)width;
	g_fb.height = (int)height;
	clamp_mouse_position_to_framebuffer();
	g_fb.bpp = 32;
	g_fb.stride = (int)(width * 4u);
	if (g_sdl_use_gl) {
		fps_mark_dirty();
		msg_mark_dirty();
		menu_mark_dirty();
		return;
	}
	g_fb.map_size = (size_t)g_fb.stride * (size_t)g_fb.height;
	uint8_t* map = (uint8_t*)realloc(g_fb.map, g_fb.map_size);
	if (!map) {
		die("realloc(%zu) failed", g_fb.map_size);
	}
	g_fb.map = map;
	memset(g_fb.map, 0, g_fb.map_size);
	if (g_sdl_texture) {
		SDL_DestroyTexture(g_sdl_texture);
	}
	g_sdl_texture = SDL_CreateTexture(g_sdl_renderer, SDL_PIXELFORMAT_XRGB8888,
		SDL_TEXTUREACCESS_STREAMING, g_fb.width, g_fb.height);
	if (!g_sdl_texture) {
		die("SDL_CreateTexture failed: %s", SDL_GetError());
	}
	SDL_RenderSetLogicalSize(g_sdl_renderer, g_fb.width, g_fb.height);
	fps_mark_dirty();
	msg_mark_dirty();
	menu_mark_dirty();
}

static void sdl_update_mouse_position(void) {
	int window_x = 0;
	int window_y = 0;
	const uint32_t mouse_state = SDL_GetMouseState(&window_x, &window_y);
	g_mouse_buttons = map_sdl_mouse_buttons(mouse_state);
	if (!g_sdl_window || g_fb.width <= 0 || g_fb.height <= 0) {
		return;
	}
	if (g_sdl_renderer) {
		SDL_Rect viewport;
		SDL_RenderGetViewport(g_sdl_renderer, &viewport);
		if (viewport.w <= 0 || viewport.h <= 0) {
			return;
		}
		const int mapped_x = (int)floor(((double)(window_x - viewport.x) * (double)g_fb.width) / (double)viewport.w);
		const int mapped_y = (int)floor(((double)(window_y - viewport.y) * (double)g_fb.height) / (double)viewport.h);
		set_mouse_absolute_position(mapped_x, mapped_y, true);
		return;
	}
	int window_w = 0;
	int window_h = 0;
	SDL_GetWindowSize(g_sdl_window, &window_w, &window_h);
	if (window_w <= 0 || window_h <= 0) {
		return;
	}
	const int mapped_x = (int)floor(((double)window_x * (double)g_fb.width) / (double)window_w);
	const int mapped_y = (int)floor(((double)window_y * (double)g_fb.height) / (double)window_h);
	set_mouse_absolute_position(mapped_x, mapped_y, true);
}

static void sdl_init(void) {
	if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMECONTROLLER | SDL_INIT_AUDIO) != 0) {
		die("SDL_Init failed: %s", SDL_GetError());
	}
	SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "nearest");
	unsigned base_w = g_geom_base_w ? g_geom_base_w : 320;
	unsigned base_h = g_geom_base_h ? g_geom_base_h : 240;
	unsigned window_w = base_w * 3u;
	unsigned window_h = base_h * 3u;
	if (window_w < 640) window_w = 640;
	if (window_h < 480) window_h = 480;
	uint32_t window_flags = SDL_WINDOW_RESIZABLE;
	if (g_sdl_use_gl) {
		SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
		SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 2);
		SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
		SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
		window_flags |= SDL_WINDOW_OPENGL;
	}
	g_sdl_window = SDL_CreateWindow("bmsx_libretro_host",
		SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
		(int)window_w, (int)window_h,
		(int)window_flags);
	if (!g_sdl_window) {
		die("SDL_CreateWindow failed: %s", SDL_GetError());
	}
	if (g_sdl_use_gl) {
		g_sdl_gl_context = SDL_GL_CreateContext(g_sdl_window);
		if (!g_sdl_gl_context) {
			die("SDL_GL_CreateContext failed: %s", SDL_GetError());
		}
		if (SDL_GL_MakeCurrent(g_sdl_window, g_sdl_gl_context) != 0) {
			die("SDL_GL_MakeCurrent failed: %s", SDL_GetError());
		}
		SDL_GL_SetSwapInterval(1);
	} else {
		g_sdl_renderer = SDL_CreateRenderer(g_sdl_window, -1, SDL_RENDERER_PRESENTVSYNC);
		if (!g_sdl_renderer) {
			die("SDL_CreateRenderer failed: %s", SDL_GetError());
		}
	}
	sdl_resize(base_w, base_h);
	SDL_ShowCursor(SDL_DISABLE);
	sdl_open_first_controller();
}

static void sdl_shutdown(void) {
	if (g_sdl_gamepad) {
		SDL_GameControllerClose(g_sdl_gamepad);
		g_sdl_gamepad = NULL;
		g_sdl_gamepad_id = -1;
	}
	if (g_sdl_texture) {
		SDL_DestroyTexture(g_sdl_texture);
		g_sdl_texture = NULL;
	}
	if (g_sdl_gl_context) {
		SDL_GL_DeleteContext(g_sdl_gl_context);
		g_sdl_gl_context = NULL;
	}
	if (g_sdl_renderer) {
		SDL_DestroyRenderer(g_sdl_renderer);
		g_sdl_renderer = NULL;
	}
	if (g_sdl_window) {
		SDL_DestroyWindow(g_sdl_window);
		g_sdl_window = NULL;
	}
	SDL_Quit();
	free(g_fb.map);
	memset(&g_fb, 0, sizeof(g_fb));
}

static void sdl_prepare_frame(unsigned frame_w, unsigned frame_h) {
	unsigned target_w = g_geom_base_w ? g_geom_base_w : frame_w;
	unsigned target_h = g_geom_base_h ? g_geom_base_h : frame_h;
	if (target_w == 0 || target_h == 0) {
		return;
	}
	if (g_fb.width != (int)target_w || g_fb.height != (int)target_h) {
		sdl_resize(target_w, target_h);
	} else if (g_geom_dirty) {
		g_geom_dirty = false;
	}
}

static void sdl_present(void) {
	if (g_sdl_use_gl) {
		return;
	}
	SDL_UpdateTexture(g_sdl_texture, NULL, g_fb.map, g_fb.stride);
	SDL_RenderClear(g_sdl_renderer);
	SDL_RenderCopy(g_sdl_renderer, g_sdl_texture, NULL, NULL);
	SDL_RenderPresent(g_sdl_renderer);
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
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2: {
			menu_clear_options();
			menu_ingest_options_v2((const struct retro_core_options_v2*)data);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL: {
			const struct retro_core_options_intl* intl = (const struct retro_core_options_intl*)data;
			menu_clear_options();
			if (intl && intl->us) {
				menu_ingest_options_v1(intl->us);
			}
			return true;
		}
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS: {
			menu_clear_options();
			menu_ingest_options_v1((const struct retro_core_option_definition*)data);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_VARIABLES:
			menu_ingest_variables((const struct retro_variable*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_VARIABLE: {
			const struct retro_variable* var = (const struct retro_variable*)data;
			if (!var || !var->key || !var->value) {
				return false;
			}
			return menu_set_variable_value(var->key, var->value, true);
		}
		case RETRO_ENVIRONMENT_GET_VARIABLE: {
			struct retro_variable* var = (struct retro_variable*)data;
			if (!var || !var->key) {
				return false;
			}
			const char* value = menu_get_variable_value(var->key);
			if (!value) {
				return false;
			}
			var->value = value;
			return true;
		}
		case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: {
			bool* updated = (bool*)data;
			*updated = g_vars_updated;
			g_vars_updated = false;
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
		case RETRO_ENVIRONMENT_SET_GEOMETRY:
			update_geometry((const struct retro_game_geometry*)data);
			return true;
		case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO: {
			const struct retro_system_av_info* info = (const struct retro_system_av_info*)data;
			if (!info) {
				return false;
			}
			update_geometry(&info->geometry);
			g_target_fps = info->timing.fps > 0.0 ? info->timing.fps : g_target_fps;
			if (g_target_fps > 0.0) {
				g_frame_usec = (uint64_t)(1000000.0 / g_target_fps + 0.5);
				g_frame_ns = (uint64_t)(1000000000.0 / g_target_fps + 0.5);
			}
			return true;
		}
		case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: {
			const enum retro_pixel_format* fmt = (const enum retro_pixel_format*)data;
			g_core_pixel_format = *fmt;
			return true;
		}
		case RETRO_ENVIRONMENT_SET_HW_RENDER: {
			struct retro_hw_render_callback* cb = (struct retro_hw_render_callback*)data;
#ifdef BMSX_LIBRETRO_HOST_SDL
			if (g_use_sdl) {
				if (!g_sdl_use_gl) {
					fprintf(stderr, "[libretro-host] SDL video backend does not support HW render in software mode\n");
					return false;
				}
				if (!g_sdl_gl_context) {
					fprintf(stderr, "[libretro-host] SDL GL context is not initialized\n");
					return false;
				}
			}
#endif
			if (cb->context_type != RETRO_HW_CONTEXT_OPENGLES2) {
				return false;
			}
			cb->get_current_framebuffer = hw_get_current_framebuffer;
			cb->get_proc_address = hw_get_proc_address;
			g_hw_render = *cb;
#ifdef BMSX_LIBRETRO_HOST_SDL
			if (g_use_sdl) {
				if (!gl_load()) {
					return false;
				}
			} else
#endif
			{
				if (!egl_init()) {
					return false;
				}
			}
			g_use_hw_render = true;
			g_hw_context_pending_reset = (g_hw_render.context_reset != NULL);
			return true;
		}
		case RETRO_ENVIRONMENT_SET_FRAME_TIME_CALLBACK: {
			const struct retro_frame_time_callback* cb = (const struct retro_frame_time_callback*)data;
			if (!cb || !cb->callback) {
				return false;
			}
			g_frame_time_cb = *cb;
			g_has_frame_time_cb = true;
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
			if (!g_menu_active) {
				fps_update();
			}
			hw_present_frame(width, height);
#ifdef BMSX_LIBRETRO_HOST_SDL
			if (g_use_sdl) {
				SDL_GL_SwapWindow(g_sdl_window);
			} else
#endif
			{
				eglSwapBuffers_ptr(g_egl_display, g_egl_surface);
			}
			return;
		}
	if (!data || width == 0 || height == 0) {
		return;
	}
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		sdl_prepare_frame(width, height);
	}
#endif
	g_last_video_w = width;
	g_last_video_h = height;
	if (!g_menu_active) {
		fps_update();
	}

	const int fb_w = g_fb.width;
	const int fb_h = g_fb.height;

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

	if (g_fb.bpp == 16) {
		if (dst_w == (int)width && dst_h == (int)height) {
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
		} else {
			const uint32_t step_x = (uint32_t)(((uint64_t)width << 16) / (uint32_t)dst_w);
			const uint32_t step_y = (uint32_t)(((uint64_t)height << 16) / (uint32_t)dst_h);
			for (int y = 0; y < dst_h; ++y) {
				const uint32_t src_y = (uint32_t)(((uint64_t)y * step_y) >> 16);
				uint8_t* dst_line = g_fb.map + (size_t)(dst_y + y) * (size_t)g_fb.stride + (size_t)dst_x * 2u;
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
		msg_render_software();
		fps_render_software();
		menu_render_software();
		maybe_capture_software_frame();
#ifdef BMSX_LIBRETRO_HOST_SDL
		if (g_use_sdl) {
			sdl_present();
		}
#endif
		return;
	}

	if (g_fb.bpp == 32) {
		if (dst_w == (int)width && dst_h == (int)height) {
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
		} else {
			const uint32_t step_x = (uint32_t)(((uint64_t)width << 16) / (uint32_t)dst_w);
			const uint32_t step_y = (uint32_t)(((uint64_t)height << 16) / (uint32_t)dst_h);
			for (int y = 0; y < dst_h; ++y) {
				const uint32_t src_y = (uint32_t)(((uint64_t)y * step_y) >> 16);
				uint8_t* dst_line = g_fb.map + (size_t)(dst_y + y) * (size_t)g_fb.stride + (size_t)dst_x * 4u;
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
		msg_render_software();
		fps_render_software();
		menu_render_software();
		maybe_capture_software_frame();
#ifdef BMSX_LIBRETRO_HOST_SDL
		if (g_use_sdl) {
			sdl_present();
		}
#endif
		return;
	}

	die("Unsupported fbdev bpp: %d", g_fb.bpp);
}

static void audio_write_frames(const int16_t* data, size_t frames) {
	if (frames == 0) {
		return;
	}
	size_t remaining = frames;
	const int16_t* src = data;
	unsigned recover_attempts = 0;
	while (remaining > 0) {
		struct snd_xferi xfer;
		xfer.buf = (void*)src;
		xfer.frames = remaining;
		xfer.result = 0;
		if (!g_audio_prepared) {
			if (ioctl(g_audio_fd, SNDRV_PCM_IOCTL_PREPARE) != 0) {
				if (errno == EINTR || errno == EPIPE || errno == ESTRPIPE) {
					if (recover_attempts < kAudioRecoverMaxAttempts) {
						++recover_attempts;
						struct timespec ts;
						ts.tv_sec = 0;
						ts.tv_nsec = (long)kAudioRecoverSleepNs;
						nanosleep(&ts, NULL);
						continue;
					}
					return;
				}
				die("SNDRV_PCM_IOCTL_PREPARE failed: %s", strerror(errno));
			}
			g_audio_prepared = true;
		}
		if (ioctl(g_audio_fd, SNDRV_PCM_IOCTL_WRITEI_FRAMES, &xfer) != 0) {
			if (errno == EINTR) {
				continue;
			}
			if (errno == EPIPE || errno == ESTRPIPE) {
				g_audio_prepared = false;
				g_audio_running = false;
				++g_audio_underruns;
				if (recover_attempts < kAudioRecoverMaxAttempts) {
					++recover_attempts;
					struct timespec ts;
					ts.tv_sec = 0;
					ts.tv_nsec = (long)kAudioRecoverSleepNs;
					nanosleep(&ts, NULL);
					continue;
				}
				return;
			}
			die("SNDRV_PCM_IOCTL_WRITEI_FRAMES failed: %s", strerror(errno));
		}
		if (xfer.result <= 0) {
			if (recover_attempts < kAudioRecoverMaxAttempts) {
				++recover_attempts;
				struct timespec ts;
				ts.tv_sec = 0;
				ts.tv_nsec = (long)kAudioRecoverSleepNs;
				nanosleep(&ts, NULL);
				continue;
			}
			return;
		}
		g_audio_running = true;
		remaining -= (size_t)xfer.result;
		src += (size_t)xfer.result * g_audio_channels;
		recover_attempts = 0;
	}
}

static void audio_queue_init(size_t capacity_frames) {
	if (capacity_frames == 0) {
		die("Audio queue capacity must be > 0");
	}
	g_audio_queue.data = (int16_t*)malloc(capacity_frames * g_audio_channels * sizeof(int16_t));
	if (!g_audio_queue.data) {
		die("malloc(%zu) failed for audio queue", capacity_frames * g_audio_channels * sizeof(int16_t));
	}
	g_audio_queue.capacity_frames = capacity_frames;
	g_audio_queue.read_frame = 0;
	g_audio_queue.write_frame = 0;
	g_audio_queue.used_frames = 0;
	pthread_mutexattr_t mattr;
	int err = pthread_mutexattr_init(&mattr);
	if (err != 0) {
		die("pthread_mutexattr_init failed: %s", strerror(err));
	}
	err = pthread_mutexattr_setprotocol(&mattr, PTHREAD_PRIO_INHERIT);
	if (err != 0) {
		die("pthread_mutexattr_setprotocol failed: %s", strerror(err));
	}
	err = pthread_mutex_init(&g_audio_queue.mutex, &mattr);
	if (err != 0) {
		die("pthread_mutex_init failed: %s", strerror(err));
	}
	err = pthread_mutexattr_destroy(&mattr);
	if (err != 0) {
		die("pthread_mutexattr_destroy failed: %s", strerror(err));
	}
	err = pthread_cond_init(&g_audio_queue.can_read, NULL);
	if (err != 0) {
		die("pthread_cond_init(can_read) failed: %s", strerror(err));
	}
	err = pthread_cond_init(&g_audio_queue.can_write, NULL);
	if (err != 0) {
		die("pthread_cond_init(can_write) failed: %s", strerror(err));
	}
	g_audio_queue.running = true;
}

static void audio_queue_destroy(void) {
	if (g_audio_queue.data) {
		free(g_audio_queue.data);
		g_audio_queue.data = NULL;
	}
	int err = pthread_cond_destroy(&g_audio_queue.can_read);
	if (err != 0) {
		die("pthread_cond_destroy(can_read) failed: %s", strerror(err));
	}
	err = pthread_cond_destroy(&g_audio_queue.can_write);
	if (err != 0) {
		die("pthread_cond_destroy(can_write) failed: %s", strerror(err));
	}
	err = pthread_mutex_destroy(&g_audio_queue.mutex);
	if (err != 0) {
		die("pthread_mutex_destroy failed: %s", strerror(err));
	}
	memset(&g_audio_queue, 0, sizeof(g_audio_queue));
}

static void audio_queue_stop(void) {
	int err = pthread_mutex_lock(&g_audio_queue.mutex);
	if (err != 0) {
		die("pthread_mutex_lock failed: %s", strerror(err));
	}
	g_audio_queue.running = false;
	err = pthread_cond_broadcast(&g_audio_queue.can_read);
	if (err != 0) {
		die("pthread_cond_broadcast(can_read) failed: %s", strerror(err));
	}
	err = pthread_cond_broadcast(&g_audio_queue.can_write);
	if (err != 0) {
		die("pthread_cond_broadcast(can_write) failed: %s", strerror(err));
	}
	err = pthread_mutex_unlock(&g_audio_queue.mutex);
	if (err != 0) {
		die("pthread_mutex_unlock failed: %s", strerror(err));
	}
}

static void audio_queue_push_frames(const int16_t* data, size_t frames) {
	if (frames == 0) {
		return;
	}
	if (frames > g_audio_queue.capacity_frames) {
		const size_t skip = frames - g_audio_queue.capacity_frames;
		data += skip * g_audio_channels;
		frames = g_audio_queue.capacity_frames;
	}
	int err = pthread_mutex_lock(&g_audio_queue.mutex);
	if (err != 0) {
		die("pthread_mutex_lock failed: %s", strerror(err));
	}
	if (!g_audio_queue.running) {
		err = pthread_mutex_unlock(&g_audio_queue.mutex);
		if (err != 0) {
			die("pthread_mutex_unlock failed: %s", strerror(err));
		}
		return;
	}
	const size_t capacity = g_audio_queue.capacity_frames;
	const size_t space = capacity - g_audio_queue.used_frames;
	if (frames > space) {
		const size_t drop = frames - space;
		g_audio_queue.read_frame = (g_audio_queue.read_frame + drop) % capacity;
		g_audio_queue.used_frames -= drop;
		g_audio_overruns += (unsigned)drop;
	}
	const size_t tail = capacity - g_audio_queue.write_frame;
	const size_t first = frames < tail ? frames : tail;
	memcpy(g_audio_queue.data + g_audio_queue.write_frame * g_audio_channels,
			data, first * g_audio_channels * sizeof(int16_t));
	if (frames > first) {
		memcpy(g_audio_queue.data, data + first * g_audio_channels,
				(frames - first) * g_audio_channels * sizeof(int16_t));
	}
	g_audio_queue.write_frame = (g_audio_queue.write_frame + frames) % capacity;
	g_audio_queue.used_frames += frames;
	err = pthread_cond_signal(&g_audio_queue.can_read);
	if (err != 0) {
		die("pthread_cond_signal(can_read) failed: %s", strerror(err));
	}
	err = pthread_mutex_unlock(&g_audio_queue.mutex);
	if (err != 0) {
		die("pthread_mutex_unlock failed: %s", strerror(err));
	}
}

static size_t audio_queue_pop_frames(int16_t* out, size_t max_frames, size_t min_frames) {
	if (min_frames > g_audio_queue.capacity_frames) {
		die("Audio queue min_frames=%zu exceeds capacity=%zu", min_frames, g_audio_queue.capacity_frames);
	}
	int err = pthread_mutex_lock(&g_audio_queue.mutex);
	if (err != 0) {
		die("pthread_mutex_lock failed: %s", strerror(err));
	}
	while (g_audio_queue.used_frames < min_frames && g_audio_queue.running) {
		err = pthread_cond_wait(&g_audio_queue.can_read, &g_audio_queue.mutex);
		if (err != 0) {
			die("pthread_cond_wait(can_read) failed: %s", strerror(err));
		}
	}
	if (g_audio_queue.used_frames == 0 && !g_audio_queue.running) {
		err = pthread_mutex_unlock(&g_audio_queue.mutex);
		if (err != 0) {
			die("pthread_mutex_unlock failed: %s", strerror(err));
		}
		return 0;
	}
	size_t frames = g_audio_queue.used_frames < max_frames ? g_audio_queue.used_frames : max_frames;
	size_t tail = g_audio_queue.capacity_frames - g_audio_queue.read_frame;
	size_t first = frames < tail ? frames : tail;
	memcpy(out, g_audio_queue.data + g_audio_queue.read_frame * g_audio_channels,
			first * g_audio_channels * sizeof(int16_t));
	if (frames > first) {
		memcpy(out + first * g_audio_channels, g_audio_queue.data,
				(frames - first) * g_audio_channels * sizeof(int16_t));
	}
	g_audio_queue.read_frame = (g_audio_queue.read_frame + frames) % g_audio_queue.capacity_frames;
	g_audio_queue.used_frames -= frames;
	err = pthread_cond_signal(&g_audio_queue.can_write);
	if (err != 0) {
		die("pthread_cond_signal(can_write) failed: %s", strerror(err));
	}
	err = pthread_mutex_unlock(&g_audio_queue.mutex);
	if (err != 0) {
		die("pthread_mutex_unlock failed: %s", strerror(err));
	}
	return frames;
}

static void audio_thread_set_realtime(void) {
	struct sched_param param;
	memset(&param, 0, sizeof(param));
	param.sched_priority = kAudioThreadPriority;
	int err = pthread_setschedparam(pthread_self(), SCHED_FIFO, &param);
	if (err != 0) {
		fprintf(stderr, "[libretro-host] warning: SCHED_FIFO priority %d unavailable (%s), audio thread runs at normal priority\n",
				kAudioThreadPriority, strerror(err));
	}
}

static void* audio_thread_main(void* arg) {
	(void)arg;
	audio_thread_set_realtime();
	const size_t prime_frames = g_audio_period_frames * kAudioPrimePeriods;
	bool primed = false;
	for (;;) {
		size_t min_frames = primed ? g_audio_period_frames : prime_frames;
		size_t frames = audio_queue_pop_frames(g_audio_thread_buf, g_audio_thread_buf_frames, min_frames);
		if (frames == 0) {
			break;
		}
		primed = true;
		audio_write_frames(g_audio_thread_buf, frames);
	}
	if (ioctl(g_audio_fd, SNDRV_PCM_IOCTL_DRAIN) != 0) {
		die("SNDRV_PCM_IOCTL_DRAIN failed: %s", strerror(errno));
	}
	return NULL;
}

static unsigned audio_compute_sdl_queue_cap_frames(void) {
	if (g_audio_sample_rate <= 0 || g_frame_usec == 0) {
		return g_audio_buffer_frames;
	}
	const double frame_time_sec = (double)g_frame_usec / 1000000.0;
	const unsigned frames_per_frame = (unsigned)ceil((double)g_audio_sample_rate * frame_time_sec);
	const unsigned requested = (unsigned)ceil((double)g_audio_sample_rate * (frame_time_sec + kAudioMixOverheadSec))
		+ kAudioRequestAheadFrames
		+ kAudioRefillMarginFrames;
	unsigned browser_target_frames = requested;
	if (browser_target_frames < kAudioTargetMinFrames) {
		browser_target_frames = kAudioTargetMinFrames;
	} else if (browser_target_frames > kAudioTargetMaxFrames) {
		browser_target_frames = kAudioTargetMaxFrames;
	}
	const unsigned chunk_guard_frames = browser_target_frames + frames_per_frame;
	return chunk_guard_frames > g_audio_buffer_frames ? chunk_guard_frames : g_audio_buffer_frames;
}

static void audio_push_frames(const int16_t* data, size_t frames) {
	if (frames == 0) {
		return;
	}
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		const size_t max_frames = audio_compute_sdl_queue_cap_frames();
		if (frames > max_frames) {
			const size_t drop = frames - max_frames;
			frames = max_frames;
			g_audio_overruns += (unsigned)drop;
		}
		const Uint32 bytes_per_frame = (Uint32)(g_audio_channels * sizeof(int16_t));
		const Uint32 queued_bytes = SDL_GetQueuedAudioSize(g_sdl_audio_device);
		const size_t queued_frames = queued_bytes / bytes_per_frame;
		if (queued_frames >= max_frames) {
			g_audio_overruns += (unsigned)frames;
			return;
		}
		const size_t free_frames = max_frames - queued_frames;
		if (frames > free_frames) {
			g_audio_overruns += (unsigned)(frames - free_frames);
			frames = free_frames;
		}
		if (SDL_QueueAudio(g_sdl_audio_device, data,
				(Uint32)(frames * g_audio_channels * sizeof(int16_t))) != 0) {
			die("SDL_QueueAudio failed: %s", SDL_GetError());
		}
		return;
	}
#endif
	audio_queue_push_frames(data, frames);
}

static void audio_flush_sample_buffer(void) {
	if (g_audio_sample_buf_frames == 0) {
		return;
	}
	audio_push_frames(g_audio_sample_buf, g_audio_sample_buf_frames);
	g_audio_sample_buf_frames = 0;
}

static void hw_params_any(struct snd_pcm_hw_params* params) {
	memset(params, 0, sizeof(*params));
	for (size_t i = 0; i < sizeof(params->masks) / sizeof(params->masks[0]); ++i) {
		for (size_t j = 0; j < sizeof(params->masks[i].bits) / sizeof(params->masks[i].bits[0]); ++j) {
			params->masks[i].bits[j] = 0xFFFFFFFFu;
		}
	}
	for (size_t i = 0; i < sizeof(params->intervals) / sizeof(params->intervals[0]); ++i) {
		params->intervals[i].min = 0;
		params->intervals[i].max = UINT_MAX;
		params->intervals[i].openmin = 0;
		params->intervals[i].openmax = 0;
		params->intervals[i].integer = 0;
		params->intervals[i].empty = 0;
	}
	params->rmask = 0;
	params->cmask = 0;
}

static void hw_param_mask_set(struct snd_pcm_hw_params* params, snd_pcm_hw_param_t param, unsigned value) {
	struct snd_mask* mask = &params->masks[param - SNDRV_PCM_HW_PARAM_FIRST_MASK];
	for (size_t i = 0; i < sizeof(mask->bits) / sizeof(mask->bits[0]); ++i) {
		mask->bits[i] = 0;
	}
	mask->bits[value / 32] |= 1u << (value % 32);
	params->rmask |= 1u << param;
}

static void hw_param_interval_set(struct snd_pcm_hw_params* params, snd_pcm_hw_param_t param, unsigned min, unsigned max) {
	struct snd_interval* interval = &params->intervals[param - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL];
	interval->min = min;
	interval->max = max;
	interval->openmin = 0;
	interval->openmax = 0;
	interval->integer = 1;
	interval->empty = 0;
	params->rmask |= 1u << param;
}

static unsigned hw_param_interval_get_min(const struct snd_pcm_hw_params* params, snd_pcm_hw_param_t param) {
	return params->intervals[param - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL].min;
}

static unsigned hw_param_interval_get_max(const struct snd_pcm_hw_params* params, snd_pcm_hw_param_t param) {
	return params->intervals[param - SNDRV_PCM_HW_PARAM_FIRST_INTERVAL].max;
}

static void audio_set_sw_params(void) {
	struct snd_pcm_sw_params sw;
	memset(&sw, 0, sizeof(sw));
	sw.tstamp_mode = SNDRV_PCM_TSTAMP_ENABLE;
	sw.period_step = 1;
	sw.sleep_min = 0;
	sw.avail_min = 1;
	sw.xfer_align = g_audio_period_frames / 2;
	sw.start_threshold = g_audio_period_frames;
	sw.stop_threshold = g_audio_buffer_frames;
	sw.silence_threshold = 0;
	sw.silence_size = 0;
	sw.boundary = g_audio_buffer_frames;
	while (sw.boundary * 2u <= (unsigned)(INT_MAX - (int)g_audio_buffer_frames)) {
		sw.boundary *= 2u;
	}
	if (ioctl(g_audio_fd, SNDRV_PCM_IOCTL_SW_PARAMS, &sw) != 0) {
		die("SNDRV_PCM_IOCTL_SW_PARAMS failed: %s", strerror(errno));
	}
}

#ifdef BMSX_LIBRETRO_HOST_SDL
static void audio_init_sdl(int sample_rate) {
	SDL_AudioSpec want;
	SDL_AudioSpec have;
	memset(&want, 0, sizeof(want));
	memset(&have, 0, sizeof(have));
	want.freq = sample_rate;
	want.format = AUDIO_S16SYS;
	want.channels = (Uint8)g_audio_channels;
	want.samples = (Uint16)kSdlAudioBufferFrames;
	g_sdl_audio_device = SDL_OpenAudioDevice(NULL, 0, &want, &have, 0);
	if (!g_sdl_audio_device) {
		die("SDL_OpenAudioDevice failed: %s", SDL_GetError());
	}
	if (have.freq != sample_rate) {
		die("SDL audio rate mismatch: requested %d got %d", sample_rate, have.freq);
	}
	if (have.channels != g_audio_channels) {
		die("SDL audio channel mismatch: requested %u got %u", g_audio_channels, have.channels);
	}
	SDL_PauseAudioDevice(g_sdl_audio_device, 0);
	g_audio_sample_rate = have.freq;
	g_audio_buffer_frames = have.samples;
	g_audio_sample_buf_frames = 0;
	fprintf(stderr, "[libretro-host] audio: sdl rate=%d ch=%u samples=%u queue_cap=%u\n",
			have.freq, have.channels, have.samples, audio_compute_sdl_queue_cap_frames());
}

static void audio_shutdown_sdl(void) {
	SDL_CloseAudioDevice(g_sdl_audio_device);
	g_sdl_audio_device = 0;
	g_audio_sample_rate = 0;
	g_audio_buffer_frames = 0;
	g_audio_sample_buf_frames = 0;
	g_audio_underruns = 0;
	g_audio_overruns = 0;
}
#endif

static void audio_init(int sample_rate) {
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		audio_init_sdl(sample_rate);
		return;
	}
#endif
	g_audio_fd = open(g_audio_device, O_WRONLY);
	if (g_audio_fd < 0) {
		die("Failed to open %s: %s", g_audio_device, strerror(errno));
	}
	struct snd_pcm_hw_params hw;
	hw_params_any(&hw);
	hw_param_mask_set(&hw, SNDRV_PCM_HW_PARAM_ACCESS, SNDRV_PCM_ACCESS_RW_INTERLEAVED);
	hw_param_mask_set(&hw, SNDRV_PCM_HW_PARAM_FORMAT, SNDRV_PCM_FORMAT_S16_LE);
	hw_param_mask_set(&hw, SNDRV_PCM_HW_PARAM_SUBFORMAT, SNDRV_PCM_SUBFORMAT_STD);
	hw_param_interval_set(&hw, SNDRV_PCM_HW_PARAM_CHANNELS, g_audio_channels, g_audio_channels);
	hw_param_interval_set(&hw, SNDRV_PCM_HW_PARAM_RATE, (unsigned)sample_rate, (unsigned)sample_rate);
	hw_param_interval_set(&hw, SNDRV_PCM_HW_PARAM_PERIOD_SIZE, kAudioPeriodFrames, kAudioPeriodFrames);
	hw_param_interval_set(&hw, SNDRV_PCM_HW_PARAM_PERIODS, kAudioPeriodCount, kAudioPeriodCount);
	if (ioctl(g_audio_fd, SNDRV_PCM_IOCTL_HW_REFINE, &hw) != 0) {
		die("SNDRV_PCM_IOCTL_HW_REFINE failed: %s", strerror(errno));
	}
	if (ioctl(g_audio_fd, SNDRV_PCM_IOCTL_HW_PARAMS, &hw) != 0) {
		die("SNDRV_PCM_IOCTL_HW_PARAMS failed: %s", strerror(errno));
	}
	unsigned rate_min = hw_param_interval_get_min(&hw, SNDRV_PCM_HW_PARAM_RATE);
	unsigned rate_max = hw_param_interval_get_max(&hw, SNDRV_PCM_HW_PARAM_RATE);
	if (rate_min != (unsigned)sample_rate || rate_max != (unsigned)sample_rate) {
		die("Audio rate mismatch: requested %d got %u-%u", sample_rate, rate_min, rate_max);
	}
	unsigned ch_min = hw_param_interval_get_min(&hw, SNDRV_PCM_HW_PARAM_CHANNELS);
	unsigned ch_max = hw_param_interval_get_max(&hw, SNDRV_PCM_HW_PARAM_CHANNELS);
	if (ch_min != g_audio_channels || ch_max != g_audio_channels) {
		die("Audio channel mismatch: requested %u got %u-%u", g_audio_channels, ch_min, ch_max);
	}
	g_audio_sample_rate = (int)rate_min;
	g_audio_period_frames = hw_param_interval_get_min(&hw, SNDRV_PCM_HW_PARAM_PERIOD_SIZE);
	g_audio_period_count = hw_param_interval_get_min(&hw, SNDRV_PCM_HW_PARAM_PERIODS);
	if (g_audio_period_frames == 0) {
		die("Invalid ALSA period size");
	}
	if (g_audio_period_count == 0) {
		die("Invalid ALSA period count");
	}
	g_audio_buffer_frames = g_audio_period_frames * g_audio_period_count;
	audio_set_sw_params();
	if (ioctl(g_audio_fd, SNDRV_PCM_IOCTL_PREPARE) != 0) {
		die("SNDRV_PCM_IOCTL_PREPARE failed: %s", strerror(errno));
	}
	g_audio_prepared = true;
	g_audio_running = false;
	g_audio_underruns = 0;
	g_audio_overruns = 0;
	g_audio_thread_buf_frames = g_audio_period_frames;
	g_audio_thread_buf = (int16_t*)malloc(g_audio_thread_buf_frames * g_audio_channels * sizeof(int16_t));
	if (!g_audio_thread_buf) {
		die("malloc(%zu) failed for audio thread buffer",
				g_audio_thread_buf_frames * g_audio_channels * sizeof(int16_t));
	}
	audio_queue_init((size_t)g_audio_sample_rate);
	int err = pthread_create(&g_audio_thread, NULL, audio_thread_main, NULL);
	if (err != 0) {
		die("pthread_create failed: %s", strerror(err));
	}
	g_audio_thread_started = true;
	g_audio_sample_buf_frames = 0;
	fprintf(stderr, "[libretro-host] audio: dev=%s rate=%d ch=%u period=%u periods=%u buffer=%u\n",
			g_audio_device, g_audio_sample_rate, g_audio_channels,
			g_audio_period_frames, g_audio_period_count, g_audio_buffer_frames);
}

static void audio_shutdown(void) {
	audio_flush_sample_buffer();
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		audio_shutdown_sdl();
		return;
	}
#endif
	if (g_audio_thread_started) {
		audio_queue_stop();
		int err = pthread_join(g_audio_thread, NULL);
		if (err != 0) {
			die("pthread_join failed: %s", strerror(err));
		}
		g_audio_thread_started = false;
		audio_queue_destroy();
	}
	if (g_audio_thread_buf) {
		free(g_audio_thread_buf);
		g_audio_thread_buf = NULL;
	}
	g_audio_thread_buf_frames = 0;
	if (g_audio_fd >= 0) {
		close(g_audio_fd);
	}
	g_audio_fd = -1;
	g_audio_sample_rate = 0;
	g_audio_period_frames = 0;
	g_audio_period_count = 0;
	g_audio_buffer_frames = 0;
	g_audio_sample_buf_frames = 0;
	g_audio_prepared = false;
	g_audio_running = false;
	if (g_audio_underruns > 0 || g_audio_overruns > 0) {
		fprintf(stderr, "[libretro-host] audio stats: underruns=%u overruns=%u\n",
				g_audio_underruns, g_audio_overruns);
	}
	g_audio_underruns = 0;
	g_audio_overruns = 0;
}

static void audio_sample_cb(int16_t left, int16_t right) {
	const size_t idx = g_audio_sample_buf_frames * g_audio_channels;
	g_audio_sample_buf[idx] = left;
	g_audio_sample_buf[idx + 1] = right;
	++g_audio_sample_buf_frames;
	if (g_audio_sample_buf_frames >= kAudioSampleBufferFrames) {
		audio_push_frames(g_audio_sample_buf, g_audio_sample_buf_frames);
		g_audio_sample_buf_frames = 0;
	}
}

static size_t audio_batch_cb(const int16_t* data, size_t frames) {
	audio_flush_sample_buffer();
	audio_push_frames(data, frames);
	return frames;
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
	if (g_fb.width <= 0 || g_fb.height <= 0) {
		g_mouse_abs_x = 0;
		g_mouse_abs_y = 0;
		g_mouse_position_valid = false;
		return;
	}
	g_mouse_abs_x = clamp_int(g_mouse_abs_x, 0, g_fb.width - 1);
	g_mouse_abs_y = clamp_int(g_mouse_abs_y, 0, g_fb.height - 1);
}

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

static const char* map_ev_key_to_dom_code(uint16_t code) {
	switch (code) {
		case KEY_F1: return "F1";
		case KEY_F2: return "F2";
		case KEY_F3: return "F3";
		case KEY_F4: return "F4";
		case KEY_F5: return "F5";
		case KEY_F6: return "F6";
		case KEY_F7: return "F7";
		case KEY_F8: return "F8";
		case KEY_F9: return "F9";
		case KEY_F10: return "F10";
		case KEY_F11: return "F11";
		case KEY_F12: return "F12";
		case KEY_UP: return "ArrowUp";
		case KEY_DOWN: return "ArrowDown";
		case KEY_LEFT: return "ArrowLeft";
		case KEY_RIGHT: return "ArrowRight";
		case KEY_PAGEUP: return "PageUp";
		case KEY_PAGEDOWN: return "PageDown";
		case KEY_HOME: return "Home";
		case KEY_END: return "End";
		case KEY_INSERT: return "Insert";
		case KEY_DELETE: return "Delete";
		case KEY_BACKSPACE: return "Backspace";
		case KEY_ENTER:
		case KEY_KPENTER:
			return "Enter";
		case KEY_TAB: return "Tab";
		case KEY_ESC: return "Escape";
		case KEY_SPACE: return "Space";
		case KEY_LEFTSHIFT: return "ShiftLeft";
		case KEY_RIGHTSHIFT: return "ShiftRight";
		case KEY_LEFTCTRL: return "ControlLeft";
		case KEY_RIGHTCTRL: return "ControlRight";
		case KEY_LEFTALT: return "AltLeft";
		case KEY_RIGHTALT: return "AltRight";
		case KEY_LEFTMETA: return "MetaLeft";
		case KEY_RIGHTMETA: return "MetaRight";
		case KEY_A: return "KeyA";
		case KEY_B: return "KeyB";
		case KEY_C: return "KeyC";
		case KEY_D: return "KeyD";
		case KEY_E: return "KeyE";
		case KEY_F: return "KeyF";
		case KEY_G: return "KeyG";
		case KEY_H: return "KeyH";
		case KEY_I: return "KeyI";
		case KEY_J: return "KeyJ";
		case KEY_K: return "KeyK";
		case KEY_L: return "KeyL";
		case KEY_M: return "KeyM";
		case KEY_N: return "KeyN";
		case KEY_O: return "KeyO";
		case KEY_P: return "KeyP";
		case KEY_Q: return "KeyQ";
		case KEY_R: return "KeyR";
		case KEY_S: return "KeyS";
		case KEY_T: return "KeyT";
		case KEY_U: return "KeyU";
		case KEY_V: return "KeyV";
		case KEY_W: return "KeyW";
		case KEY_X: return "KeyX";
		case KEY_Y: return "KeyY";
		case KEY_Z: return "KeyZ";
		case KEY_0: return "Digit0";
		case KEY_1: return "Digit1";
		case KEY_2: return "Digit2";
		case KEY_3: return "Digit3";
		case KEY_4: return "Digit4";
		case KEY_5: return "Digit5";
		case KEY_6: return "Digit6";
		case KEY_7: return "Digit7";
		case KEY_8: return "Digit8";
		case KEY_9: return "Digit9";
		case KEY_MINUS: return "Minus";
		case KEY_EQUAL: return "Equal";
		case KEY_LEFTBRACE: return "BracketLeft";
		case KEY_RIGHTBRACE: return "BracketRight";
		case KEY_BACKSLASH: return "Backslash";
		case KEY_SEMICOLON: return "Semicolon";
		case KEY_APOSTROPHE: return "Quote";
		case KEY_COMMA: return "Comma";
		case KEY_DOT: return "Period";
		case KEY_SLASH: return "Slash";
		case KEY_GRAVE: return "Backquote";
		default:
			return NULL;
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
static const char* map_sdl_scancode_to_dom_code(SDL_Scancode scancode) {
	switch (scancode) {
		case SDL_SCANCODE_F1: return "F1";
		case SDL_SCANCODE_F2: return "F2";
		case SDL_SCANCODE_F3: return "F3";
		case SDL_SCANCODE_F4: return "F4";
		case SDL_SCANCODE_F5: return "F5";
		case SDL_SCANCODE_F6: return "F6";
		case SDL_SCANCODE_F7: return "F7";
		case SDL_SCANCODE_F8: return "F8";
		case SDL_SCANCODE_F9: return "F9";
		case SDL_SCANCODE_F10: return "F10";
		case SDL_SCANCODE_F11: return "F11";
		case SDL_SCANCODE_F12: return "F12";
		case SDL_SCANCODE_UP: return "ArrowUp";
		case SDL_SCANCODE_DOWN: return "ArrowDown";
		case SDL_SCANCODE_LEFT: return "ArrowLeft";
		case SDL_SCANCODE_RIGHT: return "ArrowRight";
		case SDL_SCANCODE_PAGEUP: return "PageUp";
		case SDL_SCANCODE_PAGEDOWN: return "PageDown";
		case SDL_SCANCODE_HOME: return "Home";
		case SDL_SCANCODE_END: return "End";
		case SDL_SCANCODE_INSERT: return "Insert";
		case SDL_SCANCODE_DELETE: return "Delete";
		case SDL_SCANCODE_BACKSPACE: return "Backspace";
		case SDL_SCANCODE_RETURN:
		case SDL_SCANCODE_KP_ENTER:
			return "Enter";
		case SDL_SCANCODE_TAB: return "Tab";
		case SDL_SCANCODE_ESCAPE: return "Escape";
		case SDL_SCANCODE_SPACE: return "Space";
		case SDL_SCANCODE_LSHIFT: return "ShiftLeft";
		case SDL_SCANCODE_RSHIFT: return "ShiftRight";
		case SDL_SCANCODE_LCTRL: return "ControlLeft";
		case SDL_SCANCODE_RCTRL: return "ControlRight";
		case SDL_SCANCODE_LALT: return "AltLeft";
		case SDL_SCANCODE_RALT: return "AltRight";
		case SDL_SCANCODE_LGUI: return "MetaLeft";
		case SDL_SCANCODE_RGUI: return "MetaRight";
		case SDL_SCANCODE_A: return "KeyA";
		case SDL_SCANCODE_B: return "KeyB";
		case SDL_SCANCODE_C: return "KeyC";
		case SDL_SCANCODE_D: return "KeyD";
		case SDL_SCANCODE_E: return "KeyE";
		case SDL_SCANCODE_F: return "KeyF";
		case SDL_SCANCODE_G: return "KeyG";
		case SDL_SCANCODE_H: return "KeyH";
		case SDL_SCANCODE_I: return "KeyI";
		case SDL_SCANCODE_J: return "KeyJ";
		case SDL_SCANCODE_K: return "KeyK";
		case SDL_SCANCODE_L: return "KeyL";
		case SDL_SCANCODE_M: return "KeyM";
		case SDL_SCANCODE_N: return "KeyN";
		case SDL_SCANCODE_O: return "KeyO";
		case SDL_SCANCODE_P: return "KeyP";
		case SDL_SCANCODE_Q: return "KeyQ";
		case SDL_SCANCODE_R: return "KeyR";
		case SDL_SCANCODE_S: return "KeyS";
		case SDL_SCANCODE_T: return "KeyT";
		case SDL_SCANCODE_U: return "KeyU";
		case SDL_SCANCODE_V: return "KeyV";
		case SDL_SCANCODE_W: return "KeyW";
		case SDL_SCANCODE_X: return "KeyX";
		case SDL_SCANCODE_Y: return "KeyY";
		case SDL_SCANCODE_Z: return "KeyZ";
		case SDL_SCANCODE_0: return "Digit0";
		case SDL_SCANCODE_1: return "Digit1";
		case SDL_SCANCODE_2: return "Digit2";
		case SDL_SCANCODE_3: return "Digit3";
		case SDL_SCANCODE_4: return "Digit4";
		case SDL_SCANCODE_5: return "Digit5";
		case SDL_SCANCODE_6: return "Digit6";
		case SDL_SCANCODE_7: return "Digit7";
		case SDL_SCANCODE_8: return "Digit8";
		case SDL_SCANCODE_9: return "Digit9";
		case SDL_SCANCODE_MINUS: return "Minus";
		case SDL_SCANCODE_EQUALS: return "Equal";
		case SDL_SCANCODE_LEFTBRACKET: return "BracketLeft";
		case SDL_SCANCODE_RIGHTBRACKET: return "BracketRight";
		case SDL_SCANCODE_BACKSLASH: return "Backslash";
		case SDL_SCANCODE_SEMICOLON: return "Semicolon";
		case SDL_SCANCODE_APOSTROPHE: return "Quote";
		case SDL_SCANCODE_COMMA: return "Comma";
		case SDL_SCANCODE_PERIOD: return "Period";
		case SDL_SCANCODE_SLASH: return "Slash";
		case SDL_SCANCODE_GRAVE: return "Backquote";
		default:
			return NULL;
	}
}

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

static void core_keyboard_event(const char* code, bool down) {
	if (!code || !g_core || !g_core->bmsx_keyboard_event) {
		return;
	}
	g_core->bmsx_keyboard_event(code, down);
}

static void core_focus_changed(bool focused) {
	if (!g_core || !g_core->bmsx_focus_changed) {
		return;
	}
	g_core->bmsx_focus_changed(focused);
}

static bool core_cart_program_active(void) {
	return g_core->bmsx_is_cart_program_active();
}

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
		die("No input devices opened. Are you running as root / do you have permissions for /dev/input/event*?");
	}
}

static bool menu_pad_pressed(uint16_t state, uint16_t prev, unsigned id) {
	const uint16_t bit = (uint16_t)(1u << id);
	return (state & bit) && !(prev & bit);
}

static void menu_handle_input(uint16_t state, uint16_t prev, bool skip_nav) {
	const uint16_t start_bit = (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_START);
	const uint16_t select_bit = (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);
	const uint16_t l_bit = (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_L);
	const uint16_t r_bit = (uint16_t)(1u << RETRO_DEVICE_ID_JOYPAD_R);

	const bool combo_now = (state & start_bit) && (state & select_bit) && (state & l_bit) && (state & r_bit);
	const bool combo_prev = (prev & start_bit) && (prev & select_bit) && (prev & l_bit) && (prev & r_bit);
	if (combo_now && !combo_prev) {
		menu_toggle();
		skip_nav = true;
	}

	if (!g_menu_active || skip_nav) {
		return;
	}

	MenuOption* selected = g_menu_option_count ? &g_menu_options[g_menu_selected] : NULL;
	const bool is_action = menu_option_is_action(selected);
	if (menu_pad_pressed(state, prev, RETRO_DEVICE_ID_JOYPAD_B)) {
		menu_toggle();
		return;
	}

	if (is_action && (menu_pad_pressed(state, prev, RETRO_DEVICE_ID_JOYPAD_A) ||
						menu_pad_pressed(state, prev, RETRO_DEVICE_ID_JOYPAD_START))) {
		menu_execute_action(selected->key);
		return;
	}

	if (menu_pad_pressed(state, prev, RETRO_DEVICE_ID_JOYPAD_UP)) {
		if (g_menu_option_count > 0) {
			size_t next = (g_menu_selected == 0) ? (g_menu_option_count - 1) : (g_menu_selected - 1);
			next = menu_next_selectable(next, -1);
			if (next != g_menu_selected) {
				g_menu_selected = next;
				menu_mark_dirty();
			}
		}
	}
	if (menu_pad_pressed(state, prev, RETRO_DEVICE_ID_JOYPAD_DOWN)) {
		if (g_menu_option_count > 0) {
			size_t next = (g_menu_selected + 1) % g_menu_option_count;
			next = menu_next_selectable(next, 1);
			if (next != g_menu_selected) {
				g_menu_selected = next;
				menu_mark_dirty();
			}
		}
	}
	if (menu_pad_pressed(state, prev, RETRO_DEVICE_ID_JOYPAD_LEFT)) {
		if (g_menu_option_count > 0) {
			MenuOption* opt = &g_menu_options[g_menu_selected];
			if (menu_option_is_action(opt)) {
				menu_execute_action(opt->key);
				return;
			}
			if (menu_option_is_disabled(opt)) {
				return;
			}
			if (opt->value_count > 0) {
				size_t next = (opt->current_index == 0) ? (opt->value_count - 1) : (opt->current_index - 1);
				menu_enable_option(opt, next, true);
			}
		}
	}
	if (menu_pad_pressed(state, prev, RETRO_DEVICE_ID_JOYPAD_RIGHT)) {
		if (g_menu_option_count > 0) {
			MenuOption* opt = &g_menu_options[g_menu_selected];
			if (menu_option_is_action(opt)) {
				menu_execute_action(opt->key);
				return;
			}
			if (menu_option_is_disabled(opt)) {
				return;
			}
			if (opt->value_count > 0) {
				size_t next = (opt->current_index + 1) % opt->value_count;
				menu_enable_option(opt, next, true);
			}
		}
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
	menu_handle_input(g_pad_state_raw, g_menu_prev_pad, combo_down);
	if (g_menu_active) {
		g_pad_state_port0 = 0;
	} else {
		g_pad_state_port0 = g_pad_state_raw;
	}
	g_menu_prev_pad = g_pad_state_raw;
}

static void poll_input_devices(void) {
	uint16_t merged = 0;
	reset_mouse_frame_state();
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

			if (ev.type == EV_KEY) {
				const char* keyboard_code = map_ev_key_to_dom_code(ev.code);
				if (keyboard_code && (ev.value == 0 || ev.value == 1)) {
					core_keyboard_event(keyboard_code, ev.value != 0);
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
			int32_t x_max = dev->abs_x_max;
			int32_t y_min = dev->abs_y_min;
			int32_t y_max = dev->abs_y_max;
			int32_t x_range = x_max - x_min;
			int32_t y_range = y_max - y_min;
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
	const Uint8* keystate = SDL_GetKeyboardState(NULL);
	if (keystate) {
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
				const char* keyboard_code = map_sdl_scancode_to_dom_code(ev.key.keysym.scancode);
				if (keyboard_code) {
					core_keyboard_event(keyboard_code, ev.type == SDL_KEYDOWN);
				}
				break;
			}
			case SDL_WINDOWEVENT:
				if (ev.window.event == SDL_WINDOWEVENT_FOCUS_LOST) {
					core_focus_changed(false);
				} else if (ev.window.event == SDL_WINDOWEVENT_FOCUS_GAINED) {
					core_focus_changed(true);
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
	sdl_update_mouse_position();
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
	return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}

static uint64_t monotonic_ms(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (uint64_t)ts.tv_sec * 1000ull + (uint64_t)ts.tv_nsec / 1000000ull;
}

static uint64_t frame_time_usec_from_scaled(int64_t hz_scaled) {
	const uint64_t numerator = (uint64_t)kHzScale * 1000000ull;
	const uint64_t hz = (uint64_t)hz_scaled;
	return (numerator + hz / 2u) / hz;
}

static uint64_t frame_time_ns_from_scaled(int64_t hz_scaled) {
	const uint64_t numerator = (uint64_t)kHzScale * 1000000000ull;
	const uint64_t hz = (uint64_t)hz_scaled;
	return (numerator + hz / 2u) / hz;
}

static int16_t input_state_cb(unsigned port, unsigned device, unsigned index, unsigned id) {
	(void)index;
	if (port != 0) {
		return 0;
	}
	if (g_menu_active) {
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
				return encode_pointer_axis(g_mouse_abs_x, g_fb.width);
			case kRetroPointerIdY:
				return encode_pointer_axis(g_mouse_abs_y, g_fb.height);
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
	load_symbol(core->handle, "bmsx_set_frame_time_usec", &core->bmsx_set_frame_time_usec);
	load_symbol(core->handle, "bmsx_get_ufps", &core->bmsx_get_ufps);
	load_symbol(core->handle, "bmsx_keyboard_event", &core->bmsx_keyboard_event);
	load_symbol(core->handle, "bmsx_keyboard_reset", &core->bmsx_keyboard_reset);
	load_symbol(core->handle, "bmsx_focus_changed", &core->bmsx_focus_changed);
	load_symbol(core->handle, "bmsx_is_cart_program_active", &core->bmsx_is_cart_program_active);
}

static void usage(const char* argv0) {
	fprintf(stderr,
			"Usage:\n"
			"  %s --core ./bmsx_libretro.so --no-game [--backend software|gles2] [--video fb|sdl] [--system-dir PATH] [--save-dir PATH] [--rom-folder FOLDER] [--input-timeline FILE] [--input-debug]\n"
			"  %s --core ./bmsx_libretro.so GAME.rom [--backend software|gles2] [--video fb|sdl] [--system-dir PATH] [--save-dir PATH] [--rom-folder FOLDER] [--input-timeline FILE] [--input-debug]\n",
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
	const char* rom_folder = "";
	const char* input_timeline = "";
	const char* backend = "software";
	const char* video_backend = "fb";

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
		if (strcmp(argv[i], "--video") == 0) {
			if (i + 1 >= argc) usage(argv[0]);
			video_backend = argv[++i];
			continue;
		}
		if (strcmp(argv[i], "--input-debug") == 0) {
			g_input_debug = true;
			continue;
		}
		if (strcmp(argv[i], "--rom-folder") == 0) {
			if (i + 1 >= argc) usage(argv[0]);
			rom_folder = argv[++i];
			continue;
		}
		if (strcmp(argv[i], "--input-timeline") == 0) {
			if (i + 1 >= argc) usage(argv[0]);
			input_timeline = argv[++i];
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
	if (strcmp(video_backend, "fb") != 0 && strcmp(video_backend, "sdl") != 0) {
		die("Invalid --video %s (expected fb|sdl)", video_backend);
	}
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (strcmp(video_backend, "sdl") == 0) {
		g_use_sdl = true;
		g_sdl_use_gl = (strcmp(backend, "gles2") == 0);
	}
#else
	if (strcmp(video_backend, "sdl") == 0) {
		die("SDL video backend not available in this build");
	}
#endif

	snprintf(g_system_dir, sizeof(g_system_dir), "%s", system_dir);
	snprintf(g_save_dir, sizeof(g_save_dir), "%s", save_dir);
	snprintf(g_opt_render_backend, sizeof(g_opt_render_backend), "%s", backend);

	signal(SIGINT, on_signal);
	signal(SIGTERM, on_signal);

	LibretroCore core;
	load_core(&core, core_path);
	g_core = &core;

	core.retro_set_environment(environ_cb);
	core.retro_set_video_refresh(video_cb);
	core.retro_set_audio_sample(audio_sample_cb);
	core.retro_set_audio_sample_batch(audio_batch_cb);
	core.retro_set_input_poll(input_poll_cb);
	core.retro_set_input_state(input_state_cb);

#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		sdl_init();
	} else {
		fb_init(&g_fb, "/dev/fb0");
		input_open_default_devices();
	}
#else
	fb_init(&g_fb, "/dev/fb0");
	input_open_default_devices();
#endif

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
	fprintf(stderr, "[libretro-host] need_fullpath=%s\n",
			sysinfo.need_fullpath ? "true" : "false");

	struct retro_system_av_info av;
	memset(&av, 0, sizeof(av));
	core.retro_get_system_av_info(&av);
	update_geometry(&av.geometry);
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
		die("retro_load_game failed");
	}

	const int64_t ufps_scaled = core.bmsx_get_ufps();
	g_target_fps = (double)ufps_scaled / (double)kHzScale;
	int audio_rate = (int)(av.timing.sample_rate + 0.5);
	if (audio_rate <= 0) {
		die("Invalid audio sample rate: %.2f", av.timing.sample_rate);
	}
	audio_init(audio_rate);
	g_frame_usec = frame_time_usec_from_scaled(ufps_scaled);
	core.bmsx_set_frame_time_usec((retro_usec_t)g_frame_usec);
	g_frame_ns = frame_time_ns_from_scaled(ufps_scaled);
	input_timeline_bind_keyboard_event(core_keyboard_event);
	input_timeline_configure((input_timeline && input_timeline[0]) ? input_timeline : NULL,
			(rom_folder && rom_folder[0]) ? rom_folder : NULL, game_path, g_frame_usec);
	const bool unpaced_timeline = input_timeline_is_active();
	uint64_t next_frame_ns = monotonic_ns();

	while (!g_should_quit) {
		uint64_t now_ns = monotonic_ns();
		if (!unpaced_timeline && now_ns < next_frame_ns) {
			const uint64_t sleep_ns = next_frame_ns - now_ns;
			struct timespec ts;
			ts.tv_sec = (time_t)(sleep_ns / 1000000000ull);
			ts.tv_nsec = (long)(sleep_ns % 1000000000ull);
			nanosleep(&ts, NULL);
		}
		now_ns = monotonic_ns();
		if (!unpaced_timeline && !g_menu_active && now_ns > next_frame_ns) {
			const uint64_t lag_ns = now_ns - next_frame_ns;
			if (lag_ns > kFrameScheduleResyncNs) {
				next_frame_ns = now_ns;
			}
		}
		if (g_has_frame_time_cb) {
			g_frame_time_cb.callback((retro_usec_t)g_frame_usec);
		}
		if (g_menu_active) {
			input_poll_cb();
				if (g_use_hw_render) {
#ifdef BMSX_LIBRETRO_HOST_SDL
					if (g_use_sdl) {
						sdl_sync_gl_drawable_size();
					}
#endif
					menu_render_hw();
#ifdef BMSX_LIBRETRO_HOST_SDL
					if (g_use_sdl) {
						SDL_GL_SwapWindow(g_sdl_window);
					} else
#endif
					{
						eglSwapBuffers_ptr(g_egl_display, g_egl_surface);
					}
				} else {
					menu_render_software();
#ifdef BMSX_LIBRETRO_HOST_SDL
				if (g_use_sdl) {
					sdl_present();
				}
#endif
			}
		} else {
			if (core_cart_program_active()) {
				input_timeline_tick_frame();
			}
			core.retro_run();
			if (core_cart_program_active() && input_timeline_should_auto_quit(kInputTimelineAutoQuitGraceFrames)) {
				fprintf(stderr, "[libretro-host] input timeline completed, exiting\n");
				g_should_quit = 1;
			}
		}
		g_drop_video = false;
		now_ns = monotonic_ns();
		if (unpaced_timeline) {
			next_frame_ns = now_ns;
		} else {
			const uint64_t scheduled_next_ns = next_frame_ns + g_frame_ns;
			next_frame_ns = now_ns > scheduled_next_ns ? now_ns : scheduled_next_ns;
		}
	}

	core.retro_unload_game();
	core.retro_deinit();
	audio_shutdown();
	input_timeline_shutdown();

	for (size_t i = 0; i < g_input_dev_count; ++i) {
		if (g_input_devs[i].fd >= 0) {
			close(g_input_devs[i].fd);
		}
	}
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (g_use_sdl) {
		sdl_shutdown();
	} else {
		fb_shutdown(&g_fb);
	}
#else
	fb_shutdown(&g_fb);
#endif
	free(g_menu_surface);
	g_menu_surface = NULL;
	free(g_fps_surface);
	g_fps_surface = NULL;
	free(g_msg_surface);
	g_msg_surface = NULL;
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
