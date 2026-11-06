#pragma once

#include "render/backend/backend.h"
#include "render/shared/bitmap_font.h"
#include <array>
#include <iterator>
#include <vector>

namespace bmsx {

struct HostAtlasGLES2Texture {
	TextureHandle texture;
	FontSampling sampling = FontSampling::Nearest;
};

struct HostOverlayGLES2Vertex {
	f32 x, y, u, v;
	std::array<u8, 4> color;
};
static_assert(sizeof(HostOverlayGLES2Vertex) == 20);

struct HostOverlayGLES2DrawState {
	TextureHandle texture;
	HostAtlasGLES2Texture* atlas = nullptr;
	FontSampling sampling = FontSampling::Nearest;
	i32 glyphMode = 0;
	f32 screenRange = 1;
	std::array<i32, 4> scissor;
	bool operator==(const HostOverlayGLES2DrawState&) const = default;
};

struct HostOverlayGLES2Batch {
	HostOverlayGLES2DrawState state;
	i32 first;
	i32 count;
};

// ES2 has no core instancing. Retain expanded vertices and ordered state runs;
// submission uploads the list once, never one buffer per glyph or primitive.
class HostOverlayGLES2DrawList {
public:
	std::vector<HostOverlayGLES2Vertex> vertices;
	std::vector<HostOverlayGLES2Batch> batches;

	void reset() {
		vertices.clear();
		batches.clear();
	}

	void setState(const HostOverlayGLES2DrawState& state) {
		if (!batches.empty() && batches.back().count == 0) batches.pop_back();
		if (!batches.empty() && batches.back().state == state) return;
		batches.push_back({state, static_cast<i32>(vertices.size()), 0});
	}

	void appendQuad(const f32 (&xyuv)[24], u32 color) {
		const std::array<u8, 4> rgba{static_cast<u8>(color >> 16), static_cast<u8>(color >> 8),
			static_cast<u8>(color), static_cast<u8>(color >> 24)};
		HostOverlayGLES2Vertex quad[6];
		for (size_t i = 0; i < 6; ++i) {
			quad[i] = {xyuv[i * 4], xyuv[i * 4 + 1], xyuv[i * 4 + 2], xyuv[i * 4 + 3], rgba};
		}
		vertices.insert(vertices.end(), std::begin(quad), std::end(quad));
		batches.back().count += 6;
	}
};

} // namespace bmsx
