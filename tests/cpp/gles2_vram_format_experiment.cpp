#include "gx_gpu_words_shader.h"
#include "support/gles2_vram_probe_shaders.h"
#include "common/hash.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/software/gx_gpu_vram.h"
#include "spec/bmsx/model.h"

#include <EGL/egl.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>

extern "C" {
#include "video_context.h"
}

using namespace bmsx;
namespace shader = bmsx::test::vram_probe;

namespace {

constexpr i32 kWidth = 256;
constexpr size_t kPixels = kWidth * kWidth;
constexpr std::array<const char*, 4> kNames{"rgba4-nibbles", "rgb5-a1", "rgba8-normalized", "rgba8-shift3"};

void require(bool value, const char* message) {
	if (!value) throw std::runtime_error(message);
}

struct Surface {
	GLuint texture = 0, framebuffer = 0;
	i32 width, height;
	Surface(u32 format, i32 w = kWidth, i32 h = kWidth) : width(w), height(h) {
		glGenTextures(1, &texture);
		glBindTexture(GL_TEXTURE_2D, texture);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
		const GLenum type = format == 0 ? GL_UNSIGNED_SHORT_4_4_4_4
			: (format == 1 ? GL_UNSIGNED_SHORT_5_5_5_1 : GL_UNSIGNED_BYTE);
		glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, type, nullptr);
		glGenFramebuffers(1, &framebuffer);
		bind();
		glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
		require(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE, "probe surface is renderable");
		glClearColor(0, 0, 0, 0);
		glClear(GL_COLOR_BUFFER_BIT);
	}
	~Surface() { glDeleteFramebuffers(1, &framebuffer); glDeleteTextures(1, &texture); }
	void bind() const { glBindFramebuffer(GL_FRAMEBUFFER, framebuffer); glViewport(0, 0, width, height); }
};

struct Program {
	GLuint id;
	GLint region, sourceScale, mode, kind, checkMask, forceMask, pixelClass, bias, depth, shift;
	Program(OpenGLES2Backend& backend, u32 format, const char* body, const char* label) {
		const std::string code = std::string("precision mediump float; precision mediump int;\n#define PROBE_FORMAT ")
			+ std::to_string(format) + "\n" + kGxGpuWordFunctions + shader::representation + body;
		const GLES2AttributeBinding bindings[]{{0, "a_position"}};
		id = backend.buildProgram(shader::vertex, code.c_str(), label, nullptr, bindings);
		region = glGetUniformLocation(id, "u_region");
		sourceScale = glGetUniformLocation(id, "u_sourceScale");
		mode = glGetUniformLocation(id, "u_mode");
		kind = glGetUniformLocation(id, "u_kind");
		checkMask = glGetUniformLocation(id, "u_checkMask");
		forceMask = glGetUniformLocation(id, "u_forceMask");
		pixelClass = glGetUniformLocation(id, "u_class");
		bias = glGetUniformLocation(id, "u_bias");
		depth = glGetUniformLocation(id, "u_depth");
		shift = glGetUniformLocation(id, "u_shift");
		glUseProgram(id);
		glUniform1i(glGetUniformLocation(id, "u_source"), 0);
		glUniform1i(glGetUniformLocation(id, "u_destination"), 1);
		glUniform4f(region, 0, 0, 1, 1);
		glUniform2f(sourceScale, 1, 1);
	}
	~Program() { glDeleteProgram(id); }
	void bind(const Surface& target, GLuint source, GLuint destination = 0) const {
		target.bind();
		glUseProgram(id);
		glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D, destination);
		glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, source);
	}
};

struct Difference {
	size_t count = 0, first = 0;
	u16 expected = 0, actual = 0;
};

struct Probe {
	u32 format;
	Program uploadProgram, readProgram, copyProgram, exactProgram, hardwareProgram, clutProgram;
	Surface source, destination, snapshot, palette, readTarget;
	GLuint wordsTexture = 0;
	std::vector<u8> bytes = std::vector<u8>(kPixels * 2), pixels = std::vector<u8>(kPixels * 4);
	std::vector<u16> actual = std::vector<u16>(kPixels);

	Probe(OpenGLES2Backend& backend, u32 f)
		: format(f), uploadProgram(backend, f, shader::upload, "probe_upload"),
		  readProgram(backend, f, shader::read, "probe_read"),
		  copyProgram(backend, f, shader::copy, "probe_copy"),
		  exactProgram(backend, f, shader::exact, "probe_exact"),
		  hardwareProgram(backend, f, shader::hardware, "probe_hardware"),
		  clutProgram(backend, f, shader::clut, "probe_clut"),
		  source(f), destination(f), snapshot(f), palette(f, 256, 1), readTarget(2) {
		glGenTextures(1, &wordsTexture); glBindTexture(GL_TEXTURE_2D, wordsTexture);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
		glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE_ALPHA, kWidth, kWidth, 0, GL_LUMINANCE_ALPHA, GL_UNSIGNED_BYTE, nullptr);
		destination.bind();
		std::array<GLint, 4> bits{};
		for (size_t i = 0; i < bits.size(); ++i) glGetIntegerv(GL_RED_BITS + i, &bits[i]);
		std::printf("VRAM format=%s actual_bits=%d/%d/%d/%d\n", kNames[f], bits[0], bits[1], bits[2], bits[3]);
		if (f == 1) require(bits == std::array<GLint, 4>{5, 5, 5, 1}, "RGB5_A1 closed-state premise needs an actual five-bit attachment");
	}
	~Probe() { glDeleteTextures(1, &wordsTexture); }

	void upload(Surface& target, std::span<const u16> words) {
		for (size_t i = 0; i < words.size(); ++i) { bytes[i * 2] = static_cast<u8>(words[i]); bytes[i * 2 + 1] = static_cast<u8>(words[i] >> 8); }
		glDisable(GL_BLEND);
		glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, wordsTexture);
		glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, target.width, target.height, GL_LUMINANCE_ALPHA, GL_UNSIGNED_BYTE, bytes.data());
		uploadProgram.bind(target, wordsTexture);
		glDrawArrays(GL_TRIANGLES, 0, 3);
	}

	Difference compare(const Surface& target, std::span<const u16> expected) {
		glDisable(GL_BLEND);
		readProgram.bind(readTarget, target.texture);
		glDrawArrays(GL_TRIANGLES, 0, 3);
		glReadPixels(0, 0, kWidth, kWidth, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
		Difference diff;
		for (size_t i = 0; i < expected.size(); ++i) {
			actual[i] = static_cast<u16>(((pixels[i * 4] / 17) << 12) | ((pixels[i * 4 + 1] / 17) << 8)
				| ((pixels[i * 4 + 2] / 17) << 4) | (pixels[i * 4 + 3] / 17));
			if (actual[i] == expected[i]) continue;
			if (diff.count++ == 0) { diff.first = i; diff.expected = expected[i]; diff.actual = actual[i]; }
		}
		return diff;
	}

	void exactDraw(i32 mode, i32 kind, bool check, bool force) {
		glDisable(GL_BLEND);
		copyProgram.bind(snapshot, destination.texture);
		glDrawArrays(GL_TRIANGLES, 0, 3);
		exactProgram.bind(destination, source.texture, snapshot.texture);
		glUniform1i(exactProgram.mode, mode); glUniform1i(exactProgram.kind, kind);
		glUniform1i(exactProgram.checkMask, check); glUniform1i(exactProgram.forceMask, force);
		glDrawArrays(GL_TRIANGLES, 0, 3);
	}

	void hardwareDraw(const Surface& target, u32 mode, u32 kind, bool force, u32 variant, GLsizei vertices = 3) {
		hardwareProgram.bind(target, source.texture);
		glUniform1i(hardwareProgram.mode, mode); glUniform1i(hardwareProgram.kind, kind);
		glUniform1i(hardwareProgram.forceMask, force); glUniform1i(hardwareProgram.bias, variant);
		if (kind == 1) {
			glDisable(GL_BLEND); glUniform1i(hardwareProgram.pixelClass, 0);
			glDrawArrays(GL_TRIANGLES, 0, vertices);
		}
		glEnable(GL_BLEND); glUniform1i(hardwareProgram.pixelClass, 1);
		GLenum src = GL_ONE, dst = GL_ONE;
		if (mode == 0) {
			const f32 factor = variant == 2 ? 0.5f - 1.0f / 256.0f : 0.5f;
			glBlendColor(factor, factor, factor, factor); src = dst = GL_CONSTANT_COLOR;
		} else if (mode == 3 && variant != 2) {
			glBlendColor(0.25f, 0.25f, 0.25f, 0.25f); src = GL_CONSTANT_COLOR;
		}
		glBlendEquationSeparate(mode == 2 ? GL_FUNC_REVERSE_SUBTRACT : GL_FUNC_ADD, GL_FUNC_ADD);
		glBlendFuncSeparate(src, dst, GL_ONE, GL_ZERO);
		glDrawArrays(GL_TRIANGLES, 0, vertices);
		glDisable(GL_BLEND);
	}
};

u16 softwareDraw(u16 source, u16 destination, u32 mode, i32 kind, bool check, bool force) {
	if ((kind == 1 && source == 0) || (check && (destination & 0x8000u))) return destination;
	u32 color = source & 0x7fffu;
	if (kind >= 0 && (kind == 0 || (source & 0x8000u))) color = gxGpuSoftwareBlendRgb555(source, destination, mode);
	return static_cast<u16>(color | (force ? 0x8000u : (kind == 0 ? 0u : source & 0x8000u)));
}

void report(u32 format, const char* operation, const Difference& diff) {
	std::printf("VRAM format=%s operation=%s mismatches=%zu first=%zu expected=%04x actual=%04x\n",
		kNames[format], operation, diff.count, diff.first, diff.expected, diff.actual);
}

void probeFormat(OpenGLES2Backend& backend, u32 format) {
	Probe probe(backend, format);
	std::vector<u16> words(kPixels), background(kPixels), foreground(kPixels), expected(kPixels);
	for (size_t i = 0; i < kPixels; ++i) words[i] = static_cast<u16>(i);
	probe.upload(probe.source, words);
	const auto storage = probe.compare(probe.source, words);
	report(format, "all-65536-words", storage);
	require(storage.count == 0, "candidate must preserve all raw words before testing operations");
	probe.copyProgram.bind(probe.destination, probe.source.texture); glDrawArrays(GL_TRIANGLES, 0, 3);
	const auto copy = probe.compare(probe.destination, words);
	report(format, "raw-copy", copy); require(copy.count == 0, "same-format VRAM copy preserves every bit");
	probe.source.bind();
	glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, probe.destination.texture);
	glCopyTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 0, 0, kWidth, kWidth);
	const auto copyTex = probe.compare(probe.destination, words);
	report(format, "raw-copy-tex", copyTex); require(copyTex.count == 0, "CopyTexSubImage preserves every raw word");

	std::array<u16, 256> palette;
	for (u32 i = 0; i < palette.size(); ++i) palette[i] = static_cast<u16>(i * 337u);
	palette[0] = 0; palette[1] = 0x8000; palette[2] = 0x7fff; palette[3] = 0xffff;
	probe.upload(probe.palette, palette);
	for (const i32 depth : {4, 8}) for (i32 shift = 0; shift < (depth == 4 ? 4 : 2); ++shift) {
		probe.clutProgram.bind(probe.destination, probe.source.texture, probe.palette.texture);
		glUniform1i(probe.clutProgram.depth, depth); glUniform1i(probe.clutProgram.shift, shift);
		glDrawArrays(GL_TRIANGLES, 0, 3);
		for (size_t i = 0; i < kPixels; ++i) expected[i] = palette[(words[i] >> (depth * shift)) & (depth == 4 ? 15u : 255u)];
		const auto diff = probe.compare(probe.destination, expected);
		report(format, depth == 4 ? "clut4" : "clut8", diff); require(diff.count == 0, "CLUT lookup reconstructs raw words exactly");
	}
	for (u32 y = 0; y < kWidth; ++y) for (u32 x = 0; x < kWidth; ++x) {
		const size_t i = y * kWidth + x;
		background[i] = static_cast<u16>((x & 31u) | (((x * 5u) & 31u) << 5u) | (((x * 11u) & 31u) << 10u) | ((x & 32u) << 10u));
		foreground[i] = static_cast<u16>((y & 31u) | (((y * 7u) & 31u) << 5u) | (((y * 3u) & 31u) << 10u) | ((y & 32u) << 10u));
	}
	probe.upload(probe.source, foreground);
	size_t exactCases = 0;
	for (i32 kind : {-1, 0, 1}) for (u32 mode = 0; mode < (kind < 0 ? 1u : 4u); ++mode)
	for (bool check : {false, true}) for (bool force : {false, true}) {
		probe.upload(probe.destination, background);
		probe.exactDraw(mode, kind, check, force);
		for (size_t i = 0; i < kPixels; ++i) expected[i] = softwareDraw(foreground[i], background[i], mode, kind, check, force);
		const auto diff = probe.compare(probe.destination, expected);
		if (diff.count) report(format, "exact-draw", diff);
		require(diff.count == 0, "exact shader retains transfer, source-zero, mask and per-texel blend semantics");
		++exactCases;
	}
	std::printf("VRAM format=%s operation=exact-draw cases=%zu pixels_per_case=%zu mismatches=0\n", kNames[format], exactCases, kPixels);
	if (format == 0) return;
	std::vector<u8> rawBackground(kPixels * 4);
	std::vector<u16> decodedBackground(kPixels);
	if (format >= 2) for (u32 y = 0; y < kWidth; ++y) for (u32 x = 0; x < kWidth; ++x) {
		const size_t i = y * kWidth + x;
		u32 word = 0;
		for (u32 channel = 0; channel < 3; ++channel) {
			const u32 byte = (x * (channel == 0 ? 1u : (channel == 1 ? 5u : 11u))) & 255u;
			rawBackground[i * 4 + channel] = static_cast<u8>(byte);
			word |= (format == 3 ? byte >> 3u : (byte * 31u + 127u) / 255u) << (channel * 5u);
		}
		rawBackground[i * 4 + 3] = (x & 32u) ? 255u : 0u;
		decodedBackground[i] = static_cast<u16>(word | ((x & 32u) << 10u));
	}
	for (u32 variant = 0; variant < 3; ++variant) {
		for (u32 mode = 0; mode < 4; ++mode) {
			size_t mismatches = 0;
			for (u32 kind : {0u, 1u}) for (bool force : {false, true}) {
				probe.upload(probe.destination, background);
				probe.hardwareDraw(probe.destination, mode, kind, force, variant);
				if (format == 3 && mode == 0 && kind == 0 && !force) {
					std::array<GLfloat, 4> factor{}; std::array<u8, 4> sample{};
					glGetFloatv(GL_BLEND_COLOR, factor.data());
					glReadPixels(31, 31, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, sample.data());
					std::printf("VRAM format=%s operation=physical-half-sample variant=%u factor=%.8f sample=%u/%u/%u/%u\n",
						kNames[format], variant, factor[0], sample[0], sample[1], sample[2], sample[3]);
				}
				for (size_t i = 0; i < kPixels; ++i) expected[i] = softwareDraw(foreground[i], background[i], mode, kind, false, force);
				const auto diff = probe.compare(probe.destination, expected);
				mismatches += diff.count;
			}
			std::printf("VRAM format=%s operation=hardware-blend variant=%u mode=%u cases=4 mismatches=%zu\n", kNames[format], variant, mode, mismatches);
		}
		// RGBA8 has 256 physical destination states per channel, not 32. This
		// over-approximates reachable hidden states and tests the decode/operate
		// law without silently re-encoding the destination before every draw.
		if (format >= 2) for (u32 mode = 0; mode < 4; ++mode) {
			probe.readTarget.bind();
			glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, probe.destination.texture);
			glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, kWidth, kWidth, GL_RGBA, GL_UNSIGNED_BYTE, rawBackground.data());
			probe.hardwareDraw(probe.destination, mode, 0, false, variant);
			for (size_t i = 0; i < kPixels; ++i) expected[i] = softwareDraw(foreground[i], decodedBackground[i], mode, 0, false, false);
			const auto diff = probe.compare(probe.destination, expected);
			std::printf("VRAM format=%s operation=all-8bit-destinations variant=%u mode=%u mismatches=%zu expected=%04x actual=%04x\n",
				kNames[format], variant, mode, diff.count, diff.expected, diff.actual);
		}
		std::fill(background.begin(), background.end(), 0);
		probe.upload(probe.destination, background);
		for (u32 step = 0; step < 6; ++step) {
			constexpr std::array<u32, 6> modes{0, 3, 1, 2, 0, 3};
			for (size_t i = 0; i < kPixels; ++i) {
				const u32 f = step == 0 ? 1u : (step == 1 ? 2u : (i * 7u + step * 3u) & 31u);
				foreground[i] = static_cast<u16>(f | (f << 5u) | (f << 10u));
				background[i] = softwareDraw(foreground[i], background[i], modes[step], 0, false, false);
			}
			probe.upload(probe.source, foreground);
			probe.hardwareDraw(probe.destination, modes[step], 0, false, variant);
			const auto diff = probe.compare(probe.destination, background);
			std::printf("VRAM format=%s operation=chain variant=%u step=%u mode=%u mismatches=%zu expected=%04x actual=%04x\n",
				kNames[format], variant, step, modes[step], diff.count, diff.expected, diff.actual);
		}
		// Restore the complete one-step corpus, not the GPU destination state
		// during a chain. Every chain above retained all intermediate GPU bits.
		for (u32 y = 0; y < kWidth; ++y) for (u32 x = 0; x < kWidth; ++x) {
			background[y * kWidth + x] = static_cast<u16>((x & 31u) | (((x * 5u) & 31u) << 5u) | (((x * 11u) & 31u) << 10u) | ((x & 32u) << 10u));
			foreground[y * kWidth + x] = static_cast<u16>((y & 31u) | (((y * 7u) & 31u) << 5u) | (((y * 3u) & 31u) << 10u) | ((y & 32u) << 10u));
		}
		probe.upload(probe.source, foreground);
	}
}

void measureCopies(OpenGLES2Backend& backend, u32 format, i32 width, i32 height) {
	Surface a(format, width, height), b(format, width, height);
	Program copy(backend, format, shader::copy, "probe_sync");
	for (bool copyTex : {false, true}) {
		double total = 0;
		for (u32 frame = 0; frame < 29; ++frame) {
			glFinish();
			const auto start = std::chrono::steady_clock::now();
			for (u32 sync = 0; sync < 10; ++sync) {
				a.bind(); glEnable(GL_SCISSOR_TEST); glScissor(16, 16, 128, 128);
				glClearColor(static_cast<f32>((frame + sync) & 15u) / 15.0f, 0.5f, 0.25f, 1);
				glClear(GL_COLOR_BUFFER_BIT); glDisable(GL_SCISSOR_TEST);
				if (copyTex) {
					glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, b.texture);
					glCopyTexSubImage2D(GL_TEXTURE_2D, 0, 16, 16, 16, 16, 128, 128);
				} else {
					copy.bind(b, a.texture); glViewport(16, 16, 128, 128);
					glUniform4f(copy.region, 16.0f / width, 16.0f / height, 128.0f / width, 128.0f / height);
					glDrawArrays(GL_TRIANGLES, 0, 3);
				}
				copy.bind(a, b.texture); glViewport(16, 16, 128, 128);
				glUniform4f(copy.region, 16.0f / width, 16.0f / height, 128.0f / width, 128.0f / height);
				glDrawArrays(GL_TRIANGLES, 0, 3);
			}
			glFinish();
			if (frame >= 5) total += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
		}
		std::printf("VRAM format=%s operation=sync-measure target=%dx%d path=%s syncs=10 copied_pixels=163840 samples=24 avg_ms=%.3f\n",
			kNames[format], width, height, copyTex ? "copy-tex" : "copy-fbo", total / 24.0);
	}
}

// Synthetic throughput, not a second BMSX backend: affine/Q12 setup, CLUT
// command decoding, DMA, PCRTC and CRT are deliberately outside this probe.
// Each layer has disjoint primitives; successive layers overlap. Two-pass
// textured drawing therefore preserves order without pretending that an
// arbitrary overlapping transparent batch can be reordered in this way.
std::vector<u8> measureWorkload(OpenGLES2Backend& backend, u32 format, bool hardware,
	i32 width, i32 height, bool scene3d, GLuint fullscreen,
	std::span<const u8> reference) {
	constexpr i32 activeWidth = 320, activeHeight = 240;
	Probe probe(backend, format);
	Surface a(format, width, height), b(format, width, height), output(2, activeWidth, activeHeight);
	std::vector<u16> words(kPixels);
	for (u32 i = 0; i < words.size(); ++i) words[i] = static_cast<u16>(i * 337u);
	probe.upload(probe.source, words);
	glUseProgram(probe.exactProgram.id);
	glUniform2f(probe.exactProgram.sourceScale, static_cast<f32>(width) / activeWidth, static_cast<f32>(height) / activeHeight);
	glUseProgram(probe.hardwareProgram.id);
	glUniform2f(probe.hardwareProgram.sourceScale, static_cast<f32>(width) / activeWidth, static_cast<f32>(height) / activeHeight);
	const i32 columns = 16, rows = scene3d ? 12 : 8;
	const u32 layers = scene3d ? 4u : 1u;
	std::vector<GLfloat> positions;
	positions.reserve(columns * rows * 12);
	for (i32 y = 0; y < rows; ++y) for (i32 x = 0; x < columns; ++x) {
		const GLfloat l = static_cast<f32>(x * (activeWidth / columns)) * 2 / width - 1;
		const GLfloat r = static_cast<f32>((x + 1) * (activeWidth / columns)) * 2 / width - 1;
		const GLfloat t = static_cast<f32>(y * (activeHeight / rows)) * 2 / height - 1;
		const GLfloat d = static_cast<f32>((y + 1) * (activeHeight / rows)) * 2 / height - 1;
		positions.insert(positions.end(), {l, t, r, t, l, d, r, t, r, d, l, d});
	}
	const GLsizei vertices = static_cast<GLsizei>(positions.size() / 2);
	GLuint geometry;
	glGenBuffers(1, &geometry); glBindBuffer(GL_ARRAY_BUFFER, geometry);
	glBufferData(GL_ARRAY_BUFFER, positions.size() * sizeof(GLfloat), positions.data(), GL_STATIC_DRAW);
	double total = 0;
	for (u32 frame = 0; frame < 29; ++frame) {
		glFinish();
		const auto start = std::chrono::steady_clock::now();
		a.bind(); glEnable(GL_SCISSOR_TEST); glScissor(0, 0, activeWidth, activeHeight);
		glClearColor(0, 0, 0, 0); glClear(GL_COLOR_BUFFER_BIT); glDisable(GL_SCISSOR_TEST);
		for (u32 layer = 0; layer < layers; ++layer) {
			// One checked layer explicitly exercises the retained exact path.
			const bool checkMask = scene3d && layer == 3;
			if (!hardware || checkMask) {
				glDisable(GL_BLEND);
				glBindBuffer(GL_ARRAY_BUFFER, fullscreen); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
				probe.copyProgram.bind(b, a.texture); glViewport(0, 0, activeWidth, activeHeight);
				glUniform4f(probe.copyProgram.region, 0, 0, static_cast<f32>(activeWidth) / width, static_cast<f32>(activeHeight) / height);
				glDrawArrays(GL_TRIANGLES, 0, 3);
				probe.exactProgram.bind(a, probe.source.texture, b.texture);
				glUniform1i(probe.exactProgram.mode, layer); glUniform1i(probe.exactProgram.kind, 1);
				glUniform1i(probe.exactProgram.checkMask, checkMask); glUniform1i(probe.exactProgram.forceMask, 0);
				glBindBuffer(GL_ARRAY_BUFFER, geometry); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
				glDrawArrays(GL_TRIANGLES, 0, vertices);
			} else {
				glBindBuffer(GL_ARRAY_BUFFER, geometry); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
				probe.hardwareDraw(a, layer, 1, false, 2, vertices);
			}
		}
		glDisable(GL_BLEND);
		glBindBuffer(GL_ARRAY_BUFFER, fullscreen); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
		probe.readProgram.bind(output, a.texture);
		glUniform4f(probe.readProgram.region, 0, 0, static_cast<f32>(activeWidth) / width, static_cast<f32>(activeHeight) / height);
		glDrawArrays(GL_TRIANGLES, 0, 3);
		glFinish();
		if (frame >= 5) total += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
	}
	std::vector<u8> pixels(activeWidth * activeHeight * 4);
	glReadPixels(0, 0, activeWidth, activeHeight, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
	size_t mismatches = 0, nonzero = 0;
	u32 fingerprint = 0x12345678u;
	for (size_t i = 0; i < pixels.size(); i += 4) {
		const u32 word = pixels[i] | (pixels[i + 1] << 8u) | (pixels[i + 2] << 16u) | (pixels[i + 3] << 24u);
		nonzero += word != 0u;
		fingerprint = fmix32(fingerprint ^ word);
		if (!reference.empty()) mismatches += !std::equal(pixels.begin() + i, pixels.begin() + i + 4, reference.begin() + i);
	}
	require(nonzero != 0u, "throughput work actually produces VRAM pixels");
	std::printf("VRAM format=%s operation=synthetic-%s path=%s target=%dx%d active=320x240 triangles=%u layers=%u checked_layers=%u samples=24 avg_ms=%.3f reference_pixels=%zu mismatches=%zu nonzero=%zu fingerprint=%08x\n",
		kNames[format], scene3d ? "3d-layers" : "2d-quads", hardware ? "hybrid-hardware" : "exact-shader",
		width, height, static_cast<u32>(vertices / 3) * layers, layers, scene3d ? 1u : 0u, total / 24.0, reference.size() / 4, mismatches, nonzero, fingerprint);
	glDeleteBuffers(1, &geometry);
	return pixels;
}

} // namespace

int main(int argc, char** argv) {
	std::setvbuf(stdout, nullptr, _IOLBF, 0);
	bool framebuffer = false, measure = false;
	for (int i = 1; i < argc; ++i) {
		if (std::strcmp(argv[i], "--fb") == 0) framebuffer = true;
		else if (std::strcmp(argv[i], "--measure") == 0) measure = true;
		else throw std::runtime_error("unknown VRAM experiment argument");
	}
	EGLDisplay display = EGL_NO_DISPLAY;
	EGLSurface surface = EGL_NO_SURFACE;
	EGLContext context = EGL_NO_CONTEXT;
	if (framebuffer) {
		bmsx_video_context_open(BMSX_VIDEO_CONTEXT_FBDEV, false);
		require(bmsx_video_context_enable_gles2(), "open Mini framebuffer context");
	} else {
		display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
		require(eglInitialize(display, nullptr, nullptr), "initialize experiment EGL");
		require(eglBindAPI(EGL_OPENGL_ES_API), "bind GLES");
		const EGLint attributes[]{EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
			EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
		EGLConfig config; EGLint count;
		require(eglChooseConfig(display, attributes, &config, 1, &count) && count == 1, "choose experiment EGL config");
		const EGLint size[]{EGL_WIDTH, kWidth, EGL_HEIGHT, kWidth, EGL_NONE};
		surface = eglCreatePbufferSurface(display, config, size);
		const EGLint ctx[]{EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
		context = eglCreateContext(display, config, EGL_NO_CONTEXT, ctx);
		require(eglMakeCurrent(display, surface, surface, context), "make experiment EGL current");
	}
	{
		OpenGLES2Backend backend(kWidth, kWidth, false, PSX_MACHINE_SPEC.gxGpuVramBytes);
		backend.setContextCallbacks([]() -> uintptr_t { return 0; }, eglGetProcAddress);
		backend.onContextReset();
		glDisable(GL_DITHER); glDisable(GL_BLEND); glDisable(GL_DEPTH_TEST); glDisable(GL_STENCIL_TEST);
		glDisable(GL_CULL_FACE); glDisable(GL_SCISSOR_TEST); glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
		GLuint vbo;
		const GLfloat triangle[]{-1, -1, 3, -1, -1, 3};
		glGenBuffers(1, &vbo); glBindBuffer(GL_ARRAY_BUFFER, vbo);
		glBufferData(GL_ARRAY_BUFFER, sizeof(triangle), triangle, GL_STATIC_DRAW);
		glEnableVertexAttribArray(0); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
		std::printf("VRAM renderer=%s GL_DITHER=0 hardware_variants=plain,source-bias,biased-half-and-integer-quarter\n", glGetString(GL_RENDERER));
		for (u32 format = 0; format < kNames.size(); ++format) probeFormat(backend, format);
		if (measure) for (u32 format = 0; format < 3; ++format)
			for (const auto size : {std::array<i32, 2>{320, 256}, std::array<i32, 2>{1024, 1024}})
				measureCopies(backend, format, size[0], size[1]);
		if (measure) for (const auto size : {std::array<i32, 2>{320, 256}, std::array<i32, 2>{1024, 1024}})
		for (bool scene3d : {false, true}) {
			const auto reference = measureWorkload(backend, 0, false, size[0], size[1], scene3d, vbo, {});
			measureWorkload(backend, 1, false, size[0], size[1], scene3d, vbo, reference);
			measureWorkload(backend, 1, true, size[0], size[1], scene3d, vbo, reference);
			measureWorkload(backend, 2, false, size[0], size[1], scene3d, vbo, reference);
		}
		require(glGetError() == GL_NO_ERROR, "VRAM experiment leaves no GL errors");
		glDeleteBuffers(1, &vbo);
		std::puts("VRAM-EXPERIMENT:COMPLETE exact-path assertions passed; hardware mismatch counts are results, not passes");
	}
	if (framebuffer) bmsx_video_context_close();
	else {
		eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
		eglDestroyContext(display, context); eglDestroySurface(display, surface); eglTerminate(display);
	}
}
