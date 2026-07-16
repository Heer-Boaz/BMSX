#include "video_presenter.h"

#include <GLES2/gl2.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "host_fatal.h"
#include "input_timeline.h"
#include "screenshot.h"

#ifndef GL_APIENTRYP
#define GL_APIENTRYP GL_APIENTRY *
#endif

enum {
	kMessageMaxText = 256,
	kMessageMaxLines = 4,
	kMessageMaxLine = 96,
};

typedef struct VideoMessage {
	char text[kMessageMaxText];
	char lines[kMessageMaxLines][kMessageMaxLine];
	int line_count;
	unsigned frames_left;
	bool dirty;
	bool gl_dirty;
	bool vertex_buffer_dirty;
	uint8_t* surface;
	int surface_width;
	int surface_height;
	int surface_stride;
	int x;
	int y;
	GLuint texture;
	GLuint vertex_buffer;
	int texture_width;
	int texture_height;
} VideoMessage;

typedef struct VideoPresenter {
	BmsxVideoSurface* surface;
	BmsxFrameTimingState* frame_timing;
	enum retro_pixel_format pixel_format;
	struct retro_hw_render_callback hw_render;
	bool uses_hw_render;
	bool core_context_pending_reset;
	unsigned render_target_width;
	unsigned render_target_height;
	unsigned source_width;
	unsigned source_height;
	float geometry_aspect;
	bool render_target_dirty;
	int destination_x;
	int destination_y;
	int destination_width;
	int destination_height;
	bool layout_dirty;
	bool drop_presentation;
	bool presented_frame;
	uint64_t presentation_count;
	double target_fps;
	uint8_t* capture_pixels;
	size_t capture_pixel_capacity;
	GLuint hw_framebuffer;
	GLuint hw_texture;
	unsigned hw_texture_width;
	unsigned hw_texture_height;
	GLuint blit_program;
	GLuint blit_vertex_buffer;
	GLint blit_position_attribute;
	GLint blit_texcoord_attribute;
	GLint blit_texture_uniform;
	GLint blit_flip_uniform;
	VideoMessage message;
} VideoPresenter;

typedef struct OverlayGlyph {
	char character;
	uint8_t rows[7];
} OverlayGlyph;

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
typedef void (GL_APIENTRYP PFNGLDELETEBUFFERSPROC)(GLsizei count, const GLuint* buffers);
typedef void (GL_APIENTRYP PFNGLDELETEFRAMEBUFFERSPROC)(GLsizei count, const GLuint* framebuffers);
typedef void (GL_APIENTRYP PFNGLDELETEPROGRAMPROC)(GLuint program);
typedef void (GL_APIENTRYP PFNGLDELETESHADERPROC)(GLuint shader);
typedef void (GL_APIENTRYP PFNGLDELETETEXTURESPROC)(GLsizei count, const GLuint* textures);
typedef void (GL_APIENTRYP PFNGLDISABLEPROC)(GLenum capability);
typedef void (GL_APIENTRYP PFNGLENABLEPROC)(GLenum capability);
typedef void (GL_APIENTRYP PFNGLBLENDFUNCPROC)(GLenum source, GLenum destination);
typedef void (GL_APIENTRYP PFNGLDRAWARRAYSPROC)(GLenum mode, GLint first, GLsizei count);
typedef void (GL_APIENTRYP PFNGLENABLEVERTEXATTRIBARRAYPROC)(GLuint index);
typedef void (GL_APIENTRYP PFNGLFRAMEBUFFERTEXTURE2DPROC)(GLenum target, GLenum attachment, GLenum texture_target, GLuint texture, GLint level);
typedef void (GL_APIENTRYP PFNGLGENBUFFERSPROC)(GLsizei count, GLuint* buffers);
typedef void (GL_APIENTRYP PFNGLGENFRAMEBUFFERSPROC)(GLsizei count, GLuint* framebuffers);
typedef void (GL_APIENTRYP PFNGLGENTEXTURESPROC)(GLsizei count, GLuint* textures);
typedef GLint (GL_APIENTRYP PFNGLGETATTRIBLOCATIONPROC)(GLuint program, const GLchar* name);
typedef void (GL_APIENTRYP PFNGLGETPROGRAMINFOLOGPROC)(GLuint program, GLsizei buffer_size, GLsizei* length, GLchar* log);
typedef void (GL_APIENTRYP PFNGLGETPROGRAMIVPROC)(GLuint program, GLenum parameter, GLint* value);
typedef void (GL_APIENTRYP PFNGLGETSHADERINFOLOGPROC)(GLuint shader, GLsizei buffer_size, GLsizei* length, GLchar* log);
typedef void (GL_APIENTRYP PFNGLGETSHADERIVPROC)(GLuint shader, GLenum parameter, GLint* value);
typedef GLint (GL_APIENTRYP PFNGLGETUNIFORMLOCATIONPROC)(GLuint program, const GLchar* name);
typedef void (GL_APIENTRYP PFNGLLINKPROGRAMPROC)(GLuint program);
typedef void (GL_APIENTRYP PFNGLSHADERSOURCEPROC)(GLuint shader, GLsizei count, const GLchar* const* source, const GLint* length);
typedef void (GL_APIENTRYP PFNGLTEXIMAGE2DPROC)(GLenum target, GLint level, GLint internal_format, GLsizei width, GLsizei height, GLint border, GLenum format, GLenum type, const void* pixels);
typedef void (GL_APIENTRYP PFNGLTEXPARAMETERIPROC)(GLenum target, GLenum parameter, GLint value);
typedef void (GL_APIENTRYP PFNGLUNIFORM1FPROC)(GLint location, GLfloat value);
typedef void (GL_APIENTRYP PFNGLUNIFORM1IPROC)(GLint location, GLint value);
typedef void (GL_APIENTRYP PFNGLUSEPROGRAMPROC)(GLuint program);
typedef void (GL_APIENTRYP PFNGLVERTEXATTRIBPOINTERPROC)(GLuint index, GLint size, GLenum type, GLboolean normalized, GLsizei stride, const void* pointer);
typedef void (GL_APIENTRYP PFNGLVIEWPORTPROC)(GLint x, GLint y, GLsizei width, GLsizei height);
typedef GLenum (GL_APIENTRYP PFNGLCHECKFRAMEBUFFERSTATUSPROC)(GLenum target);
typedef void (GL_APIENTRYP BmsxGlReadPixelsProc)(GLint x, GLint y, GLsizei width, GLsizei height, GLenum format, GLenum type, void* pixels);

static VideoPresenter g_presenter = {
	.pixel_format = RETRO_PIXEL_FORMAT_XRGB8888,
	.blit_position_attribute = -1,
	.blit_texcoord_attribute = -1,
	.blit_texture_uniform = -1,
	.blit_flip_uniform = -1,
};

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
static BmsxGlReadPixelsProc glReadPixels_ptr = NULL;

static void message_rebuild_surface(void);

#define ASSIGN_PROC(destination, source) do { \
	void* proc_value = (source); \
	memcpy(&(destination), &proc_value, sizeof(destination)); \
} while (0)

static uint64_t presenter_monotonic_ns(void) {
	struct timespec time;
	clock_gettime(CLOCK_MONOTONIC, &time);
	return (uint64_t)time.tv_sec * 1000000000ull + (uint64_t)time.tv_nsec;
}

static inline uint16_t rgb888_to_rgb565(uint8_t red, uint8_t green, uint8_t blue) {
	return (uint16_t)(((red & 0xF8) << 8) | ((green & 0xFC) << 3) | (blue >> 3));
}

static inline uint32_t rgb565_to_xrgb8888(uint16_t pixel) {
	const uint8_t red5 = (uint8_t)((pixel >> 11) & 0x1F);
	const uint8_t green6 = (uint8_t)((pixel >> 5) & 0x3F);
	const uint8_t blue5 = (uint8_t)(pixel & 0x1F);
	const uint8_t red = (uint8_t)((red5 << 3) | (red5 >> 2));
	const uint8_t green = (uint8_t)((green6 << 2) | (green6 >> 4));
	const uint8_t blue = (uint8_t)((blue5 << 3) | (blue5 >> 2));
	return (uint32_t)((red << 16) | (green << 8) | blue);
}

static void presenter_update_layout(void) {
	VideoPresenter* presenter = &g_presenter;
	const int surface_width = presenter->surface->width;
	const int surface_height = presenter->surface->height;
	const unsigned source_width = presenter->source_width;
	const unsigned source_height = presenter->source_height;
	const double aspect = presenter->geometry_aspect;
	int destination_width = surface_width;
	int destination_height = (int)((double)surface_width / aspect + 0.5);
	if (destination_height > surface_height) {
		destination_height = surface_height;
		destination_width = (int)((double)surface_height * aspect + 0.5);
	}
	const double source_aspect = (double)source_width / (double)source_height;
	if (fabs(aspect - source_aspect) <= 0.01) {
		const double scale_x = (double)destination_width / (double)source_width;
		const double scale_y = (double)destination_height / (double)source_height;
		const int integer_scale = (int)(scale_x < scale_y ? scale_x : scale_y);
		if (integer_scale >= 1) {
			const int snapped_width = (int)source_width * integer_scale;
			const int snapped_height = (int)source_height * integer_scale;
			if (snapped_width <= surface_width && snapped_height <= surface_height) {
				destination_width = snapped_width;
				destination_height = snapped_height;
			}
		}
	}
	if (destination_width < 1) destination_width = 1;
	if (destination_height < 1) destination_height = 1;
	presenter->destination_x = (surface_width - destination_width) / 2;
	presenter->destination_y = (surface_height - destination_height) / 2;
	presenter->destination_width = destination_width;
	presenter->destination_height = destination_height;
	presenter->layout_dirty = false;
}

static void presenter_set_source_size(unsigned width, unsigned height) {
	VideoPresenter* presenter = &g_presenter;
	if (presenter->source_width != width || presenter->source_height != height) {
		presenter->source_width = width;
		presenter->source_height = height;
		presenter->layout_dirty = true;
	}
}

static bool gl_load(void) {
#define GL_LOAD(name) do { \
	void* source_proc = bmsx_video_context_get_gl_proc(#name); \
	if (!source_proc) { \
		fprintf(stderr, "[libretro-host] missing GL proc %s\n", #name); \
		return false; \
	} \
	ASSIGN_PROC(name##_ptr, source_proc); \
} while (0)
#define BMSX_RUNTIME_SYMBOL(name) GL_LOAD(name)
#include "gles2_symbols.inc"
#undef BMSX_RUNTIME_SYMBOL
#undef GL_LOAD
	return true;
}

static void gl_set_nearest_clamp_texture_2d(void) {
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
}

static GLuint compile_shader(GLenum type, const char* source) {
	const GLuint shader = glCreateShader_ptr(type);
	if (!shader) {
		return 0;
	}
	glShaderSource_ptr(shader, 1, &source, NULL);
	glCompileShader_ptr(shader);
	GLint status = 0;
	glGetShaderiv_ptr(shader, GL_COMPILE_STATUS, &status);
	if (!status) {
		char log[512];
		GLsizei log_length = 0;
		glGetShaderInfoLog_ptr(shader, sizeof(log), &log_length, log);
		fprintf(stderr, "[libretro-host] shader compile failed: %s\n", log_length ? log : "(no log)");
		glDeleteShader_ptr(shader);
		return 0;
	}
	return shader;
}

static bool hw_init_blitter(void) {
	static const char* vertex_source =
		"attribute vec2 a_pos;\n"
		"attribute vec2 a_uv;\n"
		"varying vec2 v_uv;\n"
		"void main() {\n"
		"  gl_Position = vec4(a_pos, 0.0, 1.0);\n"
		"  v_uv = a_uv;\n"
		"}\n";
	static const char* fragment_source =
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
	const GLuint vertex_shader = compile_shader(GL_VERTEX_SHADER, vertex_source);
	if (!vertex_shader) {
		return false;
	}
	const GLuint fragment_shader = compile_shader(GL_FRAGMENT_SHADER, fragment_source);
	if (!fragment_shader) {
		glDeleteShader_ptr(vertex_shader);
		return false;
	}
	const GLuint program = glCreateProgram_ptr();
	glAttachShader_ptr(program, vertex_shader);
	glAttachShader_ptr(program, fragment_shader);
	glLinkProgram_ptr(program);
	glDeleteShader_ptr(vertex_shader);
	glDeleteShader_ptr(fragment_shader);
	GLint linked = 0;
	glGetProgramiv_ptr(program, GL_LINK_STATUS, &linked);
	if (!linked) {
		char log[512];
		GLsizei log_length = 0;
		glGetProgramInfoLog_ptr(program, sizeof(log), &log_length, log);
		fprintf(stderr, "[libretro-host] program link failed: %s\n", log_length ? log : "(no log)");
		glDeleteProgram_ptr(program);
		return false;
	}
	VideoPresenter* presenter = &g_presenter;
	presenter->blit_program = program;
	presenter->blit_position_attribute = glGetAttribLocation_ptr(program, "a_pos");
	presenter->blit_texcoord_attribute = glGetAttribLocation_ptr(program, "a_uv");
	presenter->blit_texture_uniform = glGetUniformLocation_ptr(program, "u_tex");
	presenter->blit_flip_uniform = glGetUniformLocation_ptr(program, "u_flip_y");
	const float quad[] = {
		-1.0f, -1.0f, 0.0f, 0.0f,
		1.0f, -1.0f, 1.0f, 0.0f,
		-1.0f,  1.0f, 0.0f, 1.0f,
		1.0f,  1.0f, 1.0f, 1.0f,
	};
	glGenBuffers_ptr(1, &presenter->blit_vertex_buffer);
	glBindBuffer_ptr(GL_ARRAY_BUFFER, presenter->blit_vertex_buffer);
	glBufferData_ptr(GL_ARRAY_BUFFER, (GLsizeiptr)sizeof(quad), quad, GL_STATIC_DRAW);
	return true;
}

static bool hw_ensure_framebuffer(unsigned width, unsigned height) {
	VideoPresenter* presenter = &g_presenter;
	if (presenter->hw_texture &&
			presenter->hw_texture_width == width &&
			presenter->hw_texture_height == height) {
		return true;
	}
	if (presenter->hw_texture) {
		glDeleteTextures_ptr(1, &presenter->hw_texture);
	}
	if (presenter->hw_framebuffer) {
		glDeleteFramebuffers_ptr(1, &presenter->hw_framebuffer);
	}
	glGenTextures_ptr(1, &presenter->hw_texture);
	glBindTexture_ptr(GL_TEXTURE_2D, presenter->hw_texture);
	gl_set_nearest_clamp_texture_2d();
	glTexImage2D_ptr(
			GL_TEXTURE_2D,
			0,
			GL_RGBA,
			(GLsizei)width,
			(GLsizei)height,
			0,
			GL_RGBA,
			GL_UNSIGNED_BYTE,
			NULL);
	glGenFramebuffers_ptr(1, &presenter->hw_framebuffer);
	glBindFramebuffer_ptr(GL_FRAMEBUFFER, presenter->hw_framebuffer);
	glFramebufferTexture2D_ptr(
			GL_FRAMEBUFFER,
			GL_COLOR_ATTACHMENT0,
			GL_TEXTURE_2D,
			presenter->hw_texture,
			0);
	if (glCheckFramebufferStatus_ptr(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
		fprintf(stderr, "[libretro-host] FBO incomplete\n");
		glBindFramebuffer_ptr(GL_FRAMEBUFFER, 0);
		return false;
	}
	glBindFramebuffer_ptr(GL_FRAMEBUFFER, 0);
	presenter->hw_texture_width = width;
	presenter->hw_texture_height = height;
	fprintf(stderr, "[libretro-host] hw render target %ux%u\n", width, height);
	return true;
}

static uintptr_t RETRO_CALLCONV hw_get_current_framebuffer(void) {
	VideoPresenter* presenter = &g_presenter;
	if (presenter->render_target_dirty ||
			!presenter->hw_texture ||
			presenter->hw_texture_width != presenter->render_target_width ||
			presenter->hw_texture_height != presenter->render_target_height) {
		if (!hw_ensure_framebuffer(
				presenter->render_target_width,
				presenter->render_target_height)) {
			return 0;
		}
		presenter->render_target_dirty = false;
	}
	glBindFramebuffer_ptr(GL_FRAMEBUFFER, presenter->hw_framebuffer);
	return (uintptr_t)presenter->hw_framebuffer;
}

static retro_proc_address_t RETRO_CALLCONV hw_get_proc_address(const char* symbol) {
	void* source_proc = bmsx_video_context_get_gl_proc(symbol);
	if (!source_proc) {
		return NULL;
	}
	retro_proc_address_t proc = NULL;
	memcpy(&proc, &source_proc, sizeof(proc));
	return proc;
}

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

static const uint8_t* overlay_glyph_rows(char character) {
	static const uint8_t unknown[7] = {0x0E, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04};
	for (size_t index = 0; index < sizeof(kOverlayGlyphs) / sizeof(kOverlayGlyphs[0]); ++index) {
		if (kOverlayGlyphs[index].character == character) {
			return kOverlayGlyphs[index].rows;
		}
	}
	return unknown;
}

static void message_draw_pixel(
		uint8_t* surface,
		int surface_width,
		int surface_height,
		int surface_stride,
		int x,
		int y,
		uint8_t red,
		uint8_t green,
		uint8_t blue,
		uint8_t alpha) {
	if (x < 0 || y < 0 || x >= surface_width || y >= surface_height) {
		return;
	}
	uint8_t* pixel = surface + (size_t)y * (size_t)surface_stride + (size_t)x * 4u;
	pixel[0] = red;
	pixel[1] = green;
	pixel[2] = blue;
	pixel[3] = alpha;
}

static void message_draw_rect(
		uint8_t* surface,
		int surface_stride,
		int x,
		int y,
		int width,
		int height,
		uint8_t red,
		uint8_t green,
		uint8_t blue,
		uint8_t alpha) {
	for (int row = 0; row < height; ++row) {
		uint8_t* pixel = surface +
				(size_t)(y + row) * (size_t)surface_stride +
				(size_t)x * 4u;
		for (int column = 0; column < width; ++column) {
			pixel[0] = red;
			pixel[1] = green;
			pixel[2] = blue;
			pixel[3] = alpha;
			pixel += 4;
		}
	}
}

static void message_draw_character(
		uint8_t* surface,
		int surface_width,
		int surface_height,
		int surface_stride,
		int x,
		int y,
		char character,
		uint8_t red,
		uint8_t green,
		uint8_t blue,
		uint8_t alpha,
		int scale) {
	if (character >= 'a' && character <= 'z') {
		character = (char)(character - ('a' - 'A'));
	}
	const uint8_t* rows = overlay_glyph_rows(character);
	for (int row = 0; row < 7; ++row) {
		const uint8_t bits = rows[row];
		for (int column = 0; column < 5; ++column) {
			if (!(bits & (1u << (4 - column)))) {
				continue;
			}
			for (int scale_y = 0; scale_y < scale; ++scale_y) {
				for (int scale_x = 0; scale_x < scale; ++scale_x) {
					message_draw_pixel(
							surface,
							surface_width,
							surface_height,
							surface_stride,
							x + column * scale + scale_x,
							y + row * scale + scale_y,
							red,
							green,
							blue,
							alpha);
				}
			}
		}
	}
}

static void message_draw_text(
		uint8_t* surface,
		int surface_width,
		int surface_height,
		int surface_stride,
		int x,
		int y,
		const char* text,
		uint8_t red,
		uint8_t green,
		uint8_t blue,
		uint8_t alpha,
		int scale) {
	const int advance = 6 * scale;
	for (const char* character = text; *character; ++character) {
		message_draw_character(
				surface,
				surface_width,
				surface_height,
				surface_stride,
				x,
				y,
				*character,
				red,
				green,
				blue,
				alpha,
				scale);
		x += advance;
	}
}

static inline uint8_t blend_channel_u8(uint8_t source, uint8_t target, uint8_t alpha) {
	return (uint8_t)((source * alpha + target * (255 - alpha) + 127) / 255);
}

static inline uint32_t pack_xrgb8888(uint8_t red, uint8_t green, uint8_t blue) {
	return (uint32_t)((red << 16) | (green << 8) | blue);
}

static inline uint32_t blend_rgba_over_xrgb8888(
		uint32_t target,
		uint8_t red,
		uint8_t green,
		uint8_t blue,
		uint8_t alpha) {
	if (alpha == 255) {
		return pack_xrgb8888(red, green, blue);
	}
	return pack_xrgb8888(
			blend_channel_u8(red, (uint8_t)((target >> 16) & 0xFF), alpha),
			blend_channel_u8(green, (uint8_t)((target >> 8) & 0xFF), alpha),
			blend_channel_u8(blue, (uint8_t)(target & 0xFF), alpha));
}

static inline uint16_t blend_rgba_over_rgb565(
		uint16_t target,
		uint8_t red,
		uint8_t green,
		uint8_t blue,
		uint8_t alpha) {
	if (alpha == 255) {
		return rgb888_to_rgb565(red, green, blue);
	}
	const uint32_t expanded = rgb565_to_xrgb8888(target);
	return rgb888_to_rgb565(
			blend_channel_u8(red, (uint8_t)((expanded >> 16) & 0xFF), alpha),
			blend_channel_u8(green, (uint8_t)((expanded >> 8) & 0xFF), alpha),
			blend_channel_u8(blue, (uint8_t)(expanded & 0xFF), alpha));
}

static void blit_rgba_line_xrgb8888(uint32_t* target, const uint8_t* source, int width) {
	for (int x = 0; x < width; ++x) {
		const uint8_t* rgba = source + (size_t)x * 4u;
		if (rgba[3]) {
			target[x] = blend_rgba_over_xrgb8888(
					target[x],
					rgba[0],
					rgba[1],
					rgba[2],
					rgba[3]);
		}
	}
}

static void blit_rgba_line_rgb565(uint16_t* target, const uint8_t* source, int width) {
	for (int x = 0; x < width; ++x) {
		const uint8_t* rgba = source + (size_t)x * 4u;
		if (rgba[3]) {
			target[x] = blend_rgba_over_rgb565(
					target[x],
					rgba[0],
					rgba[1],
					rgba[2],
					rgba[3]);
		}
	}
}

static void message_blit_software(void) {
	VideoPresenter* presenter = &g_presenter;
	VideoMessage* message = &presenter->message;
	int source_x = 0;
	int source_y = 0;
	int source_x_end = message->surface_width;
	int source_y_end = message->surface_height;
	if (message->x < 0) source_x = -message->x;
	if (message->y < 0) source_y = -message->y;
	if (message->x + source_x_end > presenter->surface->width) {
		source_x_end = presenter->surface->width - message->x;
	}
	if (message->y + source_y_end > presenter->surface->height) {
		source_y_end = presenter->surface->height - message->y;
	}
	if (source_x >= source_x_end || source_y >= source_y_end) {
		return;
	}
	const int width = source_x_end - source_x;
	switch (presenter->surface->bits_per_pixel) {
		case 32:
			for (int y = source_y; y < source_y_end; ++y) {
				uint8_t* target = presenter->surface->pixels +
						(size_t)(message->y + y) * (size_t)presenter->surface->stride +
						(size_t)(message->x + source_x) * 4u;
				const uint8_t* source = message->surface +
						(size_t)y * (size_t)message->surface_stride +
						(size_t)source_x * 4u;
				blit_rgba_line_xrgb8888((uint32_t*)target, source, width);
			}
			break;
		case 16:
			for (int y = source_y; y < source_y_end; ++y) {
				uint8_t* target = presenter->surface->pixels +
						(size_t)(message->y + y) * (size_t)presenter->surface->stride +
						(size_t)(message->x + source_x) * 2u;
				const uint8_t* source = message->surface +
						(size_t)y * (size_t)message->surface_stride +
						(size_t)source_x * 4u;
				blit_rgba_line_rgb565((uint16_t*)target, source, width);
			}
			break;
		default:
			host_fatal("Unsupported video surface bpp: %d", presenter->surface->bits_per_pixel);
	}
}

static void hw_begin_blit(GLuint texture, float flip_y) {
	VideoPresenter* presenter = &g_presenter;
	glUseProgram_ptr(presenter->blit_program);
	glActiveTexture_ptr(GL_TEXTURE0);
	glBindTexture_ptr(GL_TEXTURE_2D, texture);
	if (presenter->blit_texture_uniform >= 0) {
		glUniform1i_ptr(presenter->blit_texture_uniform, 0);
	}
	if (presenter->blit_flip_uniform >= 0) {
		glUniform1f_ptr(presenter->blit_flip_uniform, flip_y);
	}
}

static void hw_enable_blit_attributes(void) {
	VideoPresenter* presenter = &g_presenter;
	if (presenter->blit_position_attribute >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)presenter->blit_position_attribute);
		glVertexAttribPointer_ptr(
				(GLuint)presenter->blit_position_attribute,
				2,
				GL_FLOAT,
				GL_FALSE,
				4 * (GLsizei)sizeof(float),
				(void*)0);
	}
	if (presenter->blit_texcoord_attribute >= 0) {
		glEnableVertexAttribArray_ptr((GLuint)presenter->blit_texcoord_attribute);
		glVertexAttribPointer_ptr(
				(GLuint)presenter->blit_texcoord_attribute,
				2,
				GL_FLOAT,
				GL_FALSE,
				4 * (GLsizei)sizeof(float),
				(void*)(2 * sizeof(float)));
	}
}

static void hw_bind_static_blit_vertex_buffer(void) {
	glBindBuffer_ptr(GL_ARRAY_BUFFER, g_presenter.blit_vertex_buffer);
	hw_enable_blit_attributes();
}

static void message_update_gl_texture(void) {
	VideoMessage* message = &g_presenter.message;
	if (!message->texture ||
			message->texture_width != message->surface_width ||
			message->texture_height != message->surface_height) {
		if (message->texture) {
			glDeleteTextures_ptr(1, &message->texture);
		}
		glGenTextures_ptr(1, &message->texture);
		glBindTexture_ptr(GL_TEXTURE_2D, message->texture);
		gl_set_nearest_clamp_texture_2d();
		message->texture_width = message->surface_width;
		message->texture_height = message->surface_height;
	} else {
		glBindTexture_ptr(GL_TEXTURE_2D, message->texture);
	}
	glTexImage2D_ptr(
			GL_TEXTURE_2D,
			0,
			GL_RGBA,
			(GLsizei)message->surface_width,
			(GLsizei)message->surface_height,
			0,
			GL_RGBA,
			GL_UNSIGNED_BYTE,
			message->surface);
	message->gl_dirty = false;
}

static void message_update_gl_vertex_buffer(void) {
	VideoPresenter* presenter = &g_presenter;
	VideoMessage* message = &presenter->message;
	if (!message->vertex_buffer) {
		glGenBuffers_ptr(1, &message->vertex_buffer);
	}
	const float left = ((float)message->x / (float)presenter->surface->width) * 2.0f - 1.0f;
	const float right =
			((float)(message->x + message->surface_width) /
				(float)presenter->surface->width) * 2.0f - 1.0f;
	const float top = 1.0f -
			((float)message->y / (float)presenter->surface->height) * 2.0f;
	const float bottom = 1.0f -
			((float)(message->y + message->surface_height) /
				(float)presenter->surface->height) * 2.0f;
	const float quad[] = {
		left,  bottom, 0.0f, 0.0f,
		right, bottom, 1.0f, 0.0f,
		left,  top,    0.0f, 1.0f,
		right, top,    1.0f, 1.0f,
	};
	glBindBuffer_ptr(GL_ARRAY_BUFFER, message->vertex_buffer);
	glBufferData_ptr(GL_ARRAY_BUFFER, (GLsizeiptr)sizeof(quad), quad, GL_DYNAMIC_DRAW);
	message->vertex_buffer_dirty = false;
}

static void message_render_hardware(void) {
	VideoPresenter* presenter = &g_presenter;
	VideoMessage* message = &presenter->message;
	if (!message->frames_left) {
		return;
	}
	if (message->dirty) {
		message_rebuild_surface();
	}
	if (message->gl_dirty) {
		message_update_gl_texture();
	}
	if (message->vertex_buffer_dirty) {
		message_update_gl_vertex_buffer();
	} else {
		glBindBuffer_ptr(GL_ARRAY_BUFFER, message->vertex_buffer);
	}
	glViewport_ptr(0, 0, presenter->surface->width, presenter->surface->height);
	glDisable_ptr(GL_DEPTH_TEST);
	glDisable_ptr(GL_CULL_FACE);
	glEnable_ptr(GL_BLEND);
	glBlendFunc_ptr(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	hw_begin_blit(message->texture, 1.0f);
	hw_enable_blit_attributes();
	glDrawArrays_ptr(GL_TRIANGLE_STRIP, 0, 4);
	glDisable_ptr(GL_BLEND);
}

static void message_mark_dirty(void) {
	VideoMessage* message = &g_presenter.message;
	message->dirty = true;
	message->gl_dirty = true;
	message->vertex_buffer_dirty = true;
}

static unsigned message_default_frames(void) {
	const unsigned frames = (unsigned)(g_presenter.target_fps * 2.0 + 0.5);
	return frames < 60 ? 60 : frames;
}

static void message_clear(void) {
	VideoMessage* message = &g_presenter.message;
	message->text[0] = '\0';
	message->line_count = 0;
	message->frames_left = 0;
	message_mark_dirty();
}

static void message_tick(void) {
	VideoMessage* message = &g_presenter.message;
	--message->frames_left;
	if (!message->frames_left) {
		message_clear();
	}
}

static void message_build_lines(int maximum_characters) {
	VideoMessage* message = &g_presenter.message;
	message->line_count = 0;
	const char* text = message->text;
	while (*text && message->line_count < kMessageMaxLines) {
		while (*text == ' ' || *text == '\t' || *text == '\r') {
			++text;
		}
		if (*text == '\n') {
			++text;
			continue;
		}
		int length = 0;
		int last_space = -1;
		while (text[length] && text[length] != '\n' && length < maximum_characters) {
			if (text[length] == ' ' || text[length] == '\t') {
				last_space = length;
			}
			++length;
		}
		int take = length;
		if (text[length] != '\n' && length >= maximum_characters && last_space > 0) {
			take = last_space;
		}
		if (take <= 0) {
			break;
		}
		if (take >= kMessageMaxLine) {
			take = kMessageMaxLine - 1;
		}
		char* line = message->lines[message->line_count];
		memcpy(line, text, (size_t)take);
		line[take] = '\0';
		size_t line_length = strlen(line);
		while (line_length > 0 &&
				(line[line_length - 1] == ' ' || line[line_length - 1] == '\t')) {
			line[--line_length] = '\0';
		}
		++message->line_count;
		text += take;
		while (*text == ' ' || *text == '\t') {
			++text;
		}
		if (*text == '\n') {
			++text;
		}
	}
	if (*text && message->line_count > 0) {
		char* line = message->lines[message->line_count - 1];
		const size_t line_length = strlen(line);
		if (line_length + 3 < kMessageMaxLine) {
			strcat(line, "...");
		} else if (line_length >= 3) {
			line[line_length - 3] = '.';
			line[line_length - 2] = '.';
			line[line_length - 1] = '.';
		}
	}
}

static void message_rebuild_surface(void) {
	VideoPresenter* presenter = &g_presenter;
	VideoMessage* message = &presenter->message;
	BmsxVideoSurface* output = presenter->surface;
	int scale = 2;
	const int padding = 6;
	const int maximum_width = output->width - 24;
	if (maximum_width < 40) {
		return;
	}
	int maximum_characters = maximum_width / (6 * scale);
	if (maximum_characters < 12) {
		scale = 1;
		maximum_characters = maximum_width / 6;
	}
	if (maximum_characters < 8) {
		maximum_characters = 8;
	}
	message_build_lines(maximum_characters);
	if (!message->line_count) {
		return;
	}
	int maximum_line_length = 0;
	for (int line_index = 0; line_index < message->line_count; ++line_index) {
		const int line_length = (int)strlen(message->lines[line_index]);
		if (line_length > maximum_line_length) {
			maximum_line_length = line_length;
		}
	}
	const int line_height = 7 * scale + 2;
	int surface_width = maximum_line_length * 6 * scale + padding * 2;
	int surface_height = message->line_count * line_height + padding * 2;
	if (surface_width > output->width - 8) {
		surface_width = output->width - 8;
	}
	if (surface_height > output->height - 8) {
		surface_height = output->height - 8;
	}
	if (surface_width < 1 || surface_height < 1) {
		return;
	}
	if (surface_width != message->surface_width || surface_height != message->surface_height) {
		uint8_t* surface = (uint8_t*)realloc(
				message->surface,
				(size_t)surface_width * (size_t)surface_height * 4u);
		if (!surface) {
			host_fatal(
					"Message surface allocation failed for %dx%d",
					surface_width,
					surface_height);
		}
		message->surface = surface;
		message->surface_width = surface_width;
		message->surface_height = surface_height;
		message->surface_stride = surface_width * 4;
	}
	message->x = 8;
	message->y = output->height - message->surface_height - 12;
	if (message->y < 0) message->y = 0;
	message_draw_rect(
			message->surface,
			message->surface_stride,
			0,
			0,
			message->surface_width,
			message->surface_height,
			8,
			8,
			8,
			180);
	for (int line_index = 0; line_index < message->line_count; ++line_index) {
		message_draw_text(
				message->surface,
				message->surface_width,
				message->surface_height,
				message->surface_stride,
				padding,
				padding + line_index * line_height,
				message->lines[line_index],
				240,
				240,
				240,
				255,
				scale);
	}
	message->dirty = false;
	message->gl_dirty = true;
	message->vertex_buffer_dirty = true;
}

static void message_render_software(void) {
	VideoMessage* message = &g_presenter.message;
	if (!message->frames_left) {
		return;
	}
	if (message->dirty) {
		message_rebuild_surface();
	}
	message_blit_software();
}

static inline void write_xrgb8888_as_rgba(uint8_t* target, uint32_t pixel) {
	target[0] = (uint8_t)((pixel >> 16) & 0xFF);
	target[1] = (uint8_t)((pixel >> 8) & 0xFF);
	target[2] = (uint8_t)(pixel & 0xFF);
	target[3] = 255;
}

static void copy_surface_row_to_rgba(uint8_t* target, const uint8_t* source, int width) {
	switch (g_presenter.surface->bits_per_pixel) {
		case 32: {
			const uint32_t* pixels = (const uint32_t*)source;
			for (int x = 0; x < width; ++x) {
				write_xrgb8888_as_rgba(target + (size_t)x * 4u, pixels[x]);
			}
			break;
		}
		case 16: {
			const uint16_t* pixels = (const uint16_t*)source;
			for (int x = 0; x < width; ++x) {
				write_xrgb8888_as_rgba(
						target + (size_t)x * 4u,
						rgb565_to_xrgb8888(pixels[x]));
			}
			break;
		}
		default:
			host_fatal(
					"Unsupported video surface bpp: %d",
					g_presenter.surface->bits_per_pixel);
	}
}

static uint8_t* capture_pixels(size_t required_bytes) {
	VideoPresenter* presenter = &g_presenter;
	if (required_bytes > presenter->capture_pixel_capacity) {
		uint8_t* pixels = (uint8_t*)realloc(
				presenter->capture_pixels,
				required_bytes);
		if (!pixels) {
			host_fatal("Screenshot allocation failed for %zu bytes", required_bytes);
		}
		presenter->capture_pixels = pixels;
		presenter->capture_pixel_capacity = required_bytes;
	}
	return presenter->capture_pixels;
}

static void capture_software_frame(void) {
	VideoPresenter* presenter = &g_presenter;
	uint64_t capture_frame;
	if (!input_timeline_consume_presented_capture(
			presenter->presentation_count,
			&capture_frame)) {
		return;
	}
	BmsxVideoSurface* surface = presenter->surface;
	fprintf(stderr,
			"[SCREENSHOT] Capturing frame %llu (%dx%d)\n",
			(unsigned long long)capture_frame,
			surface->width,
			surface->height);
	const size_t pixel_count =
			(size_t)surface->width * (size_t)surface->height;
	uint8_t* pixels = capture_pixels(pixel_count * 4u);
	for (int y = 0; y < surface->height; ++y) {
		const int source_y = surface->height - 1 - y;
		copy_surface_row_to_rgba(
				pixels + (size_t)y * (size_t)surface->width * 4u,
				surface->pixels + (size_t)source_y * (size_t)surface->stride,
				surface->width);
	}
	char filename[128];
	snprintf(
			filename,
			sizeof(filename),
			"frame_%05llu.png",
			(unsigned long long)capture_frame);
	if (!screenshot_save_png(
			filename,
			(uint32_t)surface->width,
			(uint32_t)surface->height,
			pixels)) {
		host_fatal("Screenshot save failed: %s", filename);
	}
}

static void capture_hardware_frame(unsigned width, unsigned height) {
	VideoPresenter* presenter = &g_presenter;
	uint64_t capture_frame;
	if (!input_timeline_consume_presented_capture(
			presenter->presentation_count,
			&capture_frame)) {
		return;
	}
	fprintf(stderr,
			"[SCREENSHOT] Capturing frame %llu (%ux%u)\n",
			(unsigned long long)capture_frame,
			width,
			height);
	uint8_t* pixels = capture_pixels((size_t)width * (size_t)height * 4u);
	glBindFramebuffer_ptr(GL_FRAMEBUFFER, presenter->hw_framebuffer);
	glReadPixels_ptr(
			0,
			0,
			(GLsizei)width,
			(GLsizei)height,
			GL_RGBA,
			GL_UNSIGNED_BYTE,
			pixels);
	char filename[128];
	snprintf(
			filename,
			sizeof(filename),
			"frame_%05llu.png",
			(unsigned long long)capture_frame);
	if (!screenshot_save_png(filename, width, height, pixels)) {
		host_fatal("Screenshot save failed: %s", filename);
	}
	glBindFramebuffer_ptr(GL_FRAMEBUFFER, 0);
}

static bool present_hardware_frame(void) {
	VideoPresenter* presenter = &g_presenter;
	const uint64_t timing_start_ns =
			presenter->frame_timing->record_frame ? presenter_monotonic_ns() : 0u;
	if (!presenter->hw_texture) {
		return false;
	}
	if (presenter->layout_dirty) {
		presenter_update_layout();
	}
	glBindFramebuffer_ptr(GL_FRAMEBUFFER, 0);
	glViewport_ptr(0, 0, presenter->surface->width, presenter->surface->height);
	glClearColor_ptr(0.0f, 0.0f, 0.0f, 1.0f);
	glClear_ptr(GL_COLOR_BUFFER_BIT);
	glViewport_ptr(
			presenter->destination_x,
			presenter->destination_y,
			presenter->destination_width,
			presenter->destination_height);
	glDisable_ptr(GL_BLEND);
	glDisable_ptr(GL_DEPTH_TEST);
	glDisable_ptr(GL_CULL_FACE);
	hw_begin_blit(
			presenter->hw_texture,
			presenter->hw_render.bottom_left_origin ? 0.0f : 1.0f);
	hw_bind_static_blit_vertex_buffer();
	glDrawArrays_ptr(GL_TRIANGLE_STRIP, 0, 4);
	message_render_hardware();
	capture_hardware_frame(
			presenter->hw_texture_width,
			presenter->hw_texture_height);
	if (presenter->frame_timing->record_frame) {
		presenter->frame_timing->current_blit_ns +=
				presenter_monotonic_ns() - timing_start_ns;
		presenter->frame_timing->current_blit_ran = true;
	}
	return true;
}

static void copy_software_frame(
		const void* data,
		unsigned width,
		unsigned height,
		size_t pitch) {
	VideoPresenter* presenter = &g_presenter;
	BmsxVideoSurface* surface = presenter->surface;
	if (presenter->layout_dirty) {
		presenter_update_layout();
	}
	const int destination_x = presenter->destination_x;
	const int destination_y = presenter->destination_y;
	const int destination_width = presenter->destination_width;
	const int destination_height = presenter->destination_height;
	unsigned copy_width = width;
	unsigned copy_height = height;
	if ((int)copy_width > surface->width - destination_x) {
		copy_width = (unsigned)(surface->width - destination_x);
	}
	if ((int)copy_height > surface->height - destination_y) {
		copy_height = (unsigned)(surface->height - destination_y);
	}
	if (surface->bits_per_pixel == 16) {
		if (destination_width == (int)width && destination_height == (int)height) {
				for (unsigned y = 0; y < copy_height; ++y) {
					uint16_t* target = (uint16_t*)(
							surface->pixels +
							(size_t)(destination_y + (int)y) *
								(size_t)surface->stride +
						(size_t)destination_x * 2u);
				const uint8_t* source = (const uint8_t*)data + (size_t)y * pitch;
				if (presenter->pixel_format == RETRO_PIXEL_FORMAT_RGB565) {
					memcpy(target, source, copy_width * 2u);
				} else {
					const uint32_t* pixels = (const uint32_t*)source;
					for (unsigned x = 0; x < copy_width; ++x) {
						const uint32_t pixel = pixels[x];
						target[x] = rgb888_to_rgb565(
								(uint8_t)((pixel >> 16) & 0xFF),
								(uint8_t)((pixel >> 8) & 0xFF),
								(uint8_t)(pixel & 0xFF));
					}
				}
			}
		} else {
			const uint32_t step_x =
					(uint32_t)(((uint64_t)width << 16) /
						(uint32_t)destination_width);
			const uint32_t step_y =
					(uint32_t)(((uint64_t)height << 16) /
						(uint32_t)destination_height);
			for (int y = 0; y < destination_height; ++y) {
				const uint32_t source_y =
						(uint32_t)(((uint64_t)y * step_y) >> 16);
				uint16_t* target = (uint16_t*)(
						surface->pixels +
						(size_t)(destination_y + y) *
							(size_t)surface->stride +
						(size_t)destination_x * 2u);
				const uint8_t* source =
						(const uint8_t*)data + (size_t)source_y * pitch;
				uint32_t source_x = 0;
				if (presenter->pixel_format == RETRO_PIXEL_FORMAT_RGB565) {
					const uint16_t* pixels = (const uint16_t*)source;
					for (int x = 0; x < destination_width; ++x) {
						target[x] = pixels[source_x >> 16];
						source_x += step_x;
					}
				} else {
					const uint32_t* pixels = (const uint32_t*)source;
					for (int x = 0; x < destination_width; ++x) {
						const uint32_t pixel = pixels[source_x >> 16];
						target[x] = rgb888_to_rgb565(
								(uint8_t)((pixel >> 16) & 0xFF),
								(uint8_t)((pixel >> 8) & 0xFF),
								(uint8_t)(pixel & 0xFF));
						source_x += step_x;
					}
				}
			}
		}
		return;
	}
	if (surface->bits_per_pixel == 32) {
		if (destination_width == (int)width && destination_height == (int)height) {
				for (unsigned y = 0; y < copy_height; ++y) {
					uint32_t* target = (uint32_t*)(
							surface->pixels +
							(size_t)(destination_y + (int)y) *
								(size_t)surface->stride +
						(size_t)destination_x * 4u);
				const uint8_t* source = (const uint8_t*)data + (size_t)y * pitch;
				if (presenter->pixel_format == RETRO_PIXEL_FORMAT_XRGB8888) {
					memcpy(target, source, copy_width * 4u);
				} else {
					const uint16_t* pixels = (const uint16_t*)source;
					for (unsigned x = 0; x < copy_width; ++x) {
						target[x] = rgb565_to_xrgb8888(pixels[x]);
					}
				}
			}
		} else {
			const uint32_t step_x =
					(uint32_t)(((uint64_t)width << 16) /
						(uint32_t)destination_width);
			const uint32_t step_y =
					(uint32_t)(((uint64_t)height << 16) /
						(uint32_t)destination_height);
			for (int y = 0; y < destination_height; ++y) {
				const uint32_t source_y =
						(uint32_t)(((uint64_t)y * step_y) >> 16);
				uint32_t* target = (uint32_t*)(
						surface->pixels +
						(size_t)(destination_y + y) *
							(size_t)surface->stride +
						(size_t)destination_x * 4u);
				const uint8_t* source =
						(const uint8_t*)data + (size_t)source_y * pitch;
				uint32_t source_x = 0;
				if (presenter->pixel_format == RETRO_PIXEL_FORMAT_XRGB8888) {
					const uint32_t* pixels = (const uint32_t*)source;
					for (int x = 0; x < destination_width; ++x) {
						target[x] = pixels[source_x >> 16];
						source_x += step_x;
					}
				} else {
					const uint16_t* pixels = (const uint16_t*)source;
					for (int x = 0; x < destination_width; ++x) {
						target[x] = rgb565_to_xrgb8888(pixels[source_x >> 16]);
						source_x += step_x;
					}
				}
			}
		}
		return;
	}
	host_fatal(
			"Unsupported video surface bpp: %d",
			surface->bits_per_pixel);
}

void video_presenter_open(
		BmsxVideoSurface* surface,
		BmsxFrameTimingState* frame_timing) {
	g_presenter = (VideoPresenter){
		.surface = surface,
		.frame_timing = frame_timing,
		.pixel_format = RETRO_PIXEL_FORMAT_XRGB8888,
		.source_width = 320,
		.source_height = 240,
		.geometry_aspect = 4.0f / 3.0f,
		.layout_dirty = true,
		.blit_position_attribute = -1,
		.blit_texcoord_attribute = -1,
		.blit_texture_uniform = -1,
		.blit_flip_uniform = -1,
	};
	presenter_update_layout();
}

void video_presenter_close(void) {
	VideoPresenter* presenter = &g_presenter;
	if (presenter->uses_hw_render) {
		const GLuint buffers[] = {
			presenter->blit_vertex_buffer,
			presenter->message.vertex_buffer,
		};
		const GLuint textures[] = {
			presenter->hw_texture,
			presenter->message.texture,
		};
		glDeleteBuffers_ptr(2, buffers);
		glDeleteTextures_ptr(2, textures);
		glDeleteFramebuffers_ptr(1, &presenter->hw_framebuffer);
		glDeleteProgram_ptr(presenter->blit_program);
	}
	free(presenter->message.surface);
	free(presenter->capture_pixels);
	memset(presenter, 0, sizeof(*presenter));
}

void video_presenter_update_geometry(const struct retro_game_geometry* geometry) {
	VideoPresenter* presenter = &g_presenter;
	presenter->render_target_width = geometry->base_width;
	presenter->render_target_height = geometry->base_height;
	presenter->geometry_aspect = geometry->aspect_ratio > 0.0f
		? geometry->aspect_ratio
		: (float)geometry->base_width / (float)geometry->base_height;
	presenter->render_target_dirty = true;
	presenter->layout_dirty = true;
	presenter_set_source_size(geometry->base_width, geometry->base_height);
#ifdef BMSX_LIBRETRO_HOST_SDL
	if (bmsx_video_context_prepare_software_frame(
			geometry->base_width,
			geometry->base_height)) {
		video_presenter_surface_changed();
	}
#endif
}

void video_presenter_update_av_info(const struct retro_system_av_info* av_info) {
	video_presenter_update_geometry(&av_info->geometry);
	g_presenter.target_fps = av_info->timing.fps;
}

bool video_presenter_accept_pixel_format(enum retro_pixel_format pixel_format) {
	switch (pixel_format) {
		case RETRO_PIXEL_FORMAT_XRGB8888:
		case RETRO_PIXEL_FORMAT_RGB565:
			g_presenter.pixel_format = pixel_format;
			return true;
		default:
			return false;
	}
}

bool video_presenter_negotiate_hw_render(
		struct retro_hw_render_callback* callback) {
	if (callback->context_type != RETRO_HW_CONTEXT_OPENGLES2 ||
			!bmsx_video_context_enable_gles2() ||
			!gl_load() ||
			!hw_init_blitter()) {
		return false;
	}
	callback->get_current_framebuffer = hw_get_current_framebuffer;
	callback->get_proc_address = hw_get_proc_address;
	g_presenter.hw_render = *callback;
	g_presenter.uses_hw_render = true;
	g_presenter.core_context_pending_reset =
			g_presenter.hw_render.context_reset != NULL;
	return true;
}

void video_presenter_activate_core_context(void) {
	VideoPresenter* presenter = &g_presenter;
	if (presenter->core_context_pending_reset) {
		presenter->hw_render.context_reset();
		presenter->core_context_pending_reset = false;
	}
}

void video_presenter_destroy_core_context(void) {
	VideoPresenter* presenter = &g_presenter;
	if (presenter->uses_hw_render && presenter->hw_render.context_destroy) {
		presenter->hw_render.context_destroy();
	}
}

void video_presenter_post_message(const struct retro_message* message) {
	if (!message || !message->msg || !message->msg[0]) {
		return;
	}
	fprintf(stderr,
			"[libretro-host][MSG] (%u) %s\n",
			message->frames,
			message->msg);
	VideoMessage* active_message = &g_presenter.message;
	snprintf(
			active_message->text,
			sizeof(active_message->text),
			"%s",
			message->msg);
	active_message->frames_left =
			message->frames ? message->frames : message_default_frames();
	message_mark_dirty();
}

void video_presenter_surface_changed(void) {
	g_presenter.layout_dirty = true;
	message_mark_dirty();
}

void video_presenter_begin_frame(bool drop_presentation) {
	VideoPresenter* presenter = &g_presenter;
	presenter->drop_presentation = drop_presentation;
	presenter->presented_frame = false;
	presenter->frame_timing->current_video_frame_received = false;
	presenter->frame_timing->current_blit_ns = 0u;
	presenter->frame_timing->current_swap_ns = 0u;
	presenter->frame_timing->current_blit_ran = false;
	presenter->frame_timing->current_swap_ran = false;
}

bool video_presenter_end_frame(void) {
	return g_presenter.presented_frame;
}

void video_presenter_refresh(
		const void* data,
		unsigned width,
		unsigned height,
		size_t pitch) {
	VideoPresenter* presenter = &g_presenter;
	presenter->frame_timing->current_video_frame_received = data != NULL;
	if (presenter->message.frames_left) {
		message_tick();
	}
	if (width && height) {
		presenter_set_source_size(width, height);
	}
	if (presenter->drop_presentation) {
		return;
	}
	if (presenter->uses_hw_render && data == RETRO_HW_FRAME_BUFFER_VALID) {
		if (present_hardware_frame()) {
			presenter->presented_frame = true;
			++presenter->presentation_count;
		}
		const uint64_t swap_start_ns =
				presenter->frame_timing->record_frame
					? presenter_monotonic_ns()
					: 0u;
		bmsx_video_context_swap_buffers();
		if (presenter->frame_timing->record_frame) {
			presenter->frame_timing->current_swap_ns +=
					presenter_monotonic_ns() - swap_start_ns;
			presenter->frame_timing->current_swap_ran = true;
		}
		return;
	}
	if (!data || !width || !height) {
		return;
	}
	copy_software_frame(data, width, height, pitch);
	capture_software_frame();
	message_render_software();
	presenter->presented_frame = true;
	++presenter->presentation_count;
#ifdef BMSX_LIBRETRO_HOST_SDL
	bmsx_video_context_present_software();
#endif
}

uint64_t video_presenter_presentation_count(void) {
	return g_presenter.presentation_count;
}

void video_presenter_reset_presentation_timeline(void) {
	g_presenter.presentation_count = 0;
}

static int16_t pointer_axis(int position, int start, int extent) {
	if (extent <= 1) {
		return 0;
	}
	if (position < start) {
		position = start;
	} else if (position >= start + extent) {
		position = start + extent - 1;
	}
	const int64_t range = extent - 1;
	return (int16_t)(
			(((int64_t)(position - start) * 65534 + range / 2) / range) -
			32767);
}

void video_presenter_map_surface_point(
		int surface_x,
		int surface_y,
		int16_t* pointer_x,
		int16_t* pointer_y,
		bool* inside_game_viewport) {
	VideoPresenter* presenter = &g_presenter;
	if (presenter->layout_dirty) {
		presenter_update_layout();
	}
	*pointer_x = pointer_axis(
			surface_x,
			presenter->destination_x,
			presenter->destination_width);
	*pointer_y = pointer_axis(
			surface_y,
			presenter->destination_y,
			presenter->destination_height);
	*inside_game_viewport =
			surface_x >= presenter->destination_x &&
			surface_y >= presenter->destination_y &&
			surface_x < presenter->destination_x + presenter->destination_width &&
			surface_y < presenter->destination_y + presenter->destination_height;
}
