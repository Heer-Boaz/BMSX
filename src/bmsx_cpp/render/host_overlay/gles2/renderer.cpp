#include "render/host_overlay/gles2/renderer.h"

#if BMSX_ENABLE_GLES2
#include "render/host_overlay/gles2/host_overlay_shaders.h"
#include "render/shared/glyphs.h"
#include "rompack/host_system_atlas.h"
#include <cmath>
#include <stdexcept>

namespace bmsx {
namespace {

struct HostOverlayGLES2State {
	GLuint program = 0;
	GLint attribPos = -1;
	GLint attribUv = -1;
	GLint uniformResolution = -1;
	GLint uniformColor = -1;
	GLint uniformTexture = -1;
	GLuint vbo = 0;
	TextureHandle whiteTexture = nullptr;
	TextureHandle hostAtlasTexture = nullptr;
};

HostOverlayGLES2State g_gles2;

GLuint compileShader(GLenum type, const char* source) {
	GLuint shader = glCreateShader(type);
	glShaderSource(shader, 1, &source, nullptr);
	glCompileShader(shader);
	GLint ok = GL_FALSE;
	glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
	if (ok == GL_TRUE) {
		return shader;
	}
	char log[1024];
	glGetShaderInfoLog(shader, sizeof(log), nullptr, log);
	glDeleteShader(shader);
	throw BMSX_RUNTIME_ERROR(std::string("[HostOverlayGLES2] Shader compile failed: ") + log);
}

GLuint linkProgram(GLuint vertexShader, GLuint fragmentShader) {
	GLuint program = glCreateProgram();
	glAttachShader(program, vertexShader);
	glAttachShader(program, fragmentShader);
	glLinkProgram(program);
	GLint ok = GL_FALSE;
	glGetProgramiv(program, GL_LINK_STATUS, &ok);
	glDeleteShader(vertexShader);
	glDeleteShader(fragmentShader);
	if (ok == GL_TRUE) {
		return program;
	}
	char log[1024];
	glGetProgramInfoLog(program, sizeof(log), nullptr, log);
	glDeleteProgram(program);
	throw BMSX_RUNTIME_ERROR(std::string("[HostOverlayGLES2] Program link failed: ") + log);
}

void bindTexture(OpenGLES2Backend& backend, TextureHandle texture) {
	backend.setActiveTextureUnit(0);
	backend.bindTexture2D(texture);
	glUniform1i(g_gles2.uniformTexture, 0);
}

void drawVerticesGLES2(const float (&vertices)[24]) {
	glBindBuffer(GL_ARRAY_BUFFER, g_gles2.vbo);
	glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STREAM_DRAW);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gles2.attribPos));
	glVertexAttribPointer(static_cast<GLuint>(g_gles2.attribPos), 2, GL_FLOAT, GL_FALSE, sizeof(float) * 4, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gles2.attribUv));
	glVertexAttribPointer(static_cast<GLuint>(g_gles2.attribUv), 2, GL_FLOAT, GL_FALSE, sizeof(float) * 4, reinterpret_cast<const void*>(sizeof(float) * 2));
	glDrawArrays(GL_TRIANGLES, 0, 6);
}

void drawQuadGLES2(OpenGLES2Backend& backend, TextureHandle texture, i32 x, i32 y, i32 w, i32 h, f32 u0, f32 v0, f32 u1, f32 v1, const Color& color) {
	const float left = static_cast<float>(x);
	const float top = static_cast<float>(y);
	const float right = static_cast<float>(x + w);
	const float bottom = static_cast<float>(y + h);
	const float vertices[24] = {
		left, top, u0, v0,
		left, bottom, u0, v1,
		right, top, u1, v0,
		right, top, u1, v0,
		left, bottom, u0, v1,
		right, bottom, u1, v1,
	};
	bindTexture(backend, texture);
	glUniform4f(g_gles2.uniformColor, color.r, color.g, color.b, color.a);
	drawVerticesGLES2(vertices);
}

void drawRectGLES2(OpenGLES2Backend& backend, const RectRenderSubmission& command) {
	const i32 left = static_cast<i32>(command.area.left);
	const i32 top = static_cast<i32>(command.area.top);
	const i32 width = static_cast<i32>(command.area.right - command.area.left);
	const i32 height = static_cast<i32>(command.area.bottom - command.area.top);
	if (command.kind == RectRenderSubmission::Kind::Fill) {
		drawQuadGLES2(backend, g_gles2.whiteTexture, left, top, width, height, 0.0f, 0.0f, 1.0f, 1.0f, command.color);
		return;
	}
	drawQuadGLES2(backend, g_gles2.whiteTexture, left, top, width, 1, 0.0f, 0.0f, 1.0f, 1.0f, command.color);
	drawQuadGLES2(backend, g_gles2.whiteTexture, left, top + height - 1, width, 1, 0.0f, 0.0f, 1.0f, 1.0f, command.color);
	drawQuadGLES2(backend, g_gles2.whiteTexture, left, top, 1, height, 0.0f, 0.0f, 1.0f, 1.0f, command.color);
	drawQuadGLES2(backend, g_gles2.whiteTexture, left + width - 1, top, 1, height, 0.0f, 0.0f, 1.0f, 1.0f, command.color);
}

void drawLineGLES2(OpenGLES2Backend& backend, f32 x0, f32 y0, f32 x1, f32 y1, const Color& color, f32 thickness) {
	const f32 dx = x1 - x0;
	const f32 dy = y1 - y0;
	if (dx == 0.0f && dy == 0.0f) {
		drawQuadGLES2(backend, g_gles2.whiteTexture, static_cast<i32>(x0), static_cast<i32>(y0), static_cast<i32>(thickness), static_cast<i32>(thickness), 0.0f, 0.0f, 1.0f, 1.0f, color);
		return;
	}
	const f32 length = std::sqrt(dx * dx + dy * dy);
	const f32 half = thickness * 0.5f;
	const f32 normalX = -dy / length;
	const f32 normalY = dx / length;
	const float vertices[24] = {
		x0 - normalX * half, y0 - normalY * half, 0.0f, 0.0f,
		x0 + normalX * half, y0 + normalY * half, 0.0f, 1.0f,
		x1 - normalX * half, y1 - normalY * half, 1.0f, 0.0f,
		x1 - normalX * half, y1 - normalY * half, 1.0f, 0.0f,
		x0 + normalX * half, y0 + normalY * half, 0.0f, 1.0f,
		x1 + normalX * half, y1 + normalY * half, 1.0f, 1.0f,
	};
	bindTexture(backend, g_gles2.whiteTexture);
	glUniform4f(g_gles2.uniformColor, color.r, color.g, color.b, color.a);
	drawVerticesGLES2(vertices);
}

void drawPolyGLES2(OpenGLES2Backend& backend, const PolyRenderSubmission& command) {
	for (size_t index = 0; index + 3u < command.points.size(); index += 2u) {
		drawLineGLES2(backend, command.points[index], command.points[index + 1u], command.points[index + 2u], command.points[index + 3u], command.color, command.thickness);
	}
}

void drawImageGLES2(OpenGLES2Backend& backend, const HostImageRenderSubmission& command) {
	const HostSystemAtlasGeneratedImage& source = hostSystemAtlasImage(command.imgid);
	f32 u0 = static_cast<f32>(source.u) / static_cast<f32>(hostSystemAtlasWidth());
	f32 v0 = static_cast<f32>(source.v) / static_cast<f32>(hostSystemAtlasHeight());
	f32 u1 = static_cast<f32>(source.u + source.w) / static_cast<f32>(hostSystemAtlasWidth());
	f32 v1 = static_cast<f32>(source.v + source.h) / static_cast<f32>(hostSystemAtlasHeight());
	const FlipOptions& flip = command.flip;
	if (flip.flip_h) {
		const f32 swap = u0;
		u0 = u1;
		u1 = swap;
	}
	if (flip.flip_v) {
		const f32 swap = v0;
		v0 = v1;
		v1 = swap;
	}
	const Vec2& scale = command.scale;
	drawQuadGLES2(
		backend,
		g_gles2.hostAtlasTexture,
		static_cast<i32>(command.pos.x),
		static_cast<i32>(command.pos.y),
		static_cast<i32>(static_cast<f32>(source.width) * scale.x),
		static_cast<i32>(static_cast<f32>(source.height) * scale.y),
		u0,
		v0,
		u1,
		v1,
		command.colorize
	);
}

void drawGlyphImageGLES2(OpenGLES2Backend& backend, const FontGlyph& glyph, f32 imageX, f32 imageY, const Color& color) {
	const ImageAtlasRect& rect = glyph.rect;
	const f32 atlasWidth = static_cast<f32>(hostSystemAtlasWidth());
	const f32 atlasHeight = static_cast<f32>(hostSystemAtlasHeight());
	drawQuadGLES2(
		backend,
		g_gles2.hostAtlasTexture,
		static_cast<i32>(imageX),
		static_cast<i32>(imageY),
		static_cast<i32>(rect.w),
		static_cast<i32>(rect.h),
		static_cast<f32>(rect.u) / atlasWidth,
		static_cast<f32>(rect.v) / atlasHeight,
		static_cast<f32>(rect.u + rect.w) / atlasWidth,
		static_cast<f32>(rect.v + rect.h) / atlasHeight,
		color
	);
}

void drawGlyphsGLES2(OpenGLES2Backend& backend, const GlyphRenderSubmission& command) {
	if (command.has_background_color) {
		const Color& background = command.background_color;
		const i32 lineHeight = command.font->lineHeight();
		forEachGlyphImage(command, [&](const FontGlyph& glyph, f32 imageX, f32 imageY, f32, const Color&) {
			drawQuadGLES2(
				backend,
				g_gles2.whiteTexture,
				static_cast<i32>(imageX),
				static_cast<i32>(imageY),
				glyph.advance,
				lineHeight,
				0.0f,
				0.0f,
				1.0f,
				1.0f,
				background
			);
		});
	}
	forEachGlyphImage(command, [&](const FontGlyph& glyph, f32 imageX, f32 imageY, f32, const Color& color) {
		drawGlyphImageGLES2(backend, glyph, imageX, imageY, color);
	});
}

} // namespace

void bootstrapHostOverlayGLES2(OpenGLES2Backend& backend) {
	const GLuint vs = compileShader(GL_VERTEX_SHADER, kHostOverlayVertexShader);
	const GLuint fs = compileShader(GL_FRAGMENT_SHADER, kHostOverlayFragmentShader);
	g_gles2.program = linkProgram(vs, fs);
	g_gles2.attribPos = glGetAttribLocation(g_gles2.program, "a_position");
	g_gles2.attribUv = glGetAttribLocation(g_gles2.program, "a_texcoord");
	g_gles2.uniformResolution = glGetUniformLocation(g_gles2.program, "u_resolution");
	g_gles2.uniformColor = glGetUniformLocation(g_gles2.program, "u_color");
	g_gles2.uniformTexture = glGetUniformLocation(g_gles2.program, "u_texture");
	glGenBuffers(1, &g_gles2.vbo);
	TextureParams params;
	params.srgb = false;
	const u8 whitePixel[4] = {255u, 255u, 255u, 255u};
	g_gles2.whiteTexture = backend.createTexture(whitePixel, 1, 1, params);
	g_gles2.hostAtlasTexture = backend.createTexture(hostSystemAtlasPixels().data(), static_cast<i32>(hostSystemAtlasWidth()), static_cast<i32>(hostSystemAtlasHeight()), params);
}

void beginHostOverlayGLES2(OpenGLES2Backend& backend, const Host2DPipelineState& state) {
	backend.setRenderTarget(backend.backbuffer(), state.overlayWidth, state.overlayHeight);
	glViewport(0, 0, state.overlayWidth, state.overlayHeight);
	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glEnable(GL_BLEND);
	glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	glUseProgram(g_gles2.program);
	glUniform2f(g_gles2.uniformResolution, static_cast<float>(state.overlayWidth), static_cast<float>(state.overlayHeight));
}

void renderHost2DEntryGLES2(OpenGLES2Backend& backend, Host2DKind kind, Host2DRef ref) {
	switch (kind) {
		case Host2DKind::Img: drawImageGLES2(backend, *static_cast<const HostImageRenderSubmission*>(ref)); return;
		case Host2DKind::Rect: drawRectGLES2(backend, *static_cast<const RectRenderSubmission*>(ref)); return;
		case Host2DKind::Poly: drawPolyGLES2(backend, *static_cast<const PolyRenderSubmission*>(ref)); return;
		case Host2DKind::Glyphs: drawGlyphsGLES2(backend, *static_cast<const GlyphRenderSubmission*>(ref)); return;
	}
}

void endHostOverlayGLES2(OpenGLES2Backend& backend) {
	(void)backend;
	glDisable(GL_BLEND);
}

} // namespace bmsx
#endif
