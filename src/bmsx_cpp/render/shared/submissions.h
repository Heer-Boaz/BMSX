/*
 * submissions.h - Render submission types for BMSX
 *
 * These are the data structures used to submit render commands.
 */

#ifndef BMSX_RENDER_TYPES_H
#define BMSX_RENDER_TYPES_H

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include <cstddef>
#include <limits>
#include <string>
#include <vector>
#include <array>

namespace bmsx {

class BFont;
class Mesh;

/* ============================================================================
 * Flip options for sprites
 * ============================================================================ */

struct FlipOptions {
	bool flip_h = false;
	bool flip_v = false;
};

/* ============================================================================
 * Render layer (determines draw order/pass)
 * ============================================================================ */

enum class RenderLayer {
	World,  // Main game world
	UI,     // User interface overlay
	IDE     // Editor/debug overlay
};

using color = u32;
using RenderRectBounds = RectBounds;
using RenderVec2 = Vec3;
using RenderScale2 = Vec2;

inline Layer2D renderLayerTo2dLayer(RenderLayer layer) {
	if (layer == RenderLayer::UI) return Layer2D::UI;
	if (layer == RenderLayer::IDE) return Layer2D::IDE;
	return Layer2D::World;
}

/* ============================================================================
 * Render submissions - data for each render type
 * ============================================================================ */

// Rectangle render (outline or filled)
struct RectRenderSubmission {
	enum class Kind { Rect, Fill };
	Kind kind = Kind::Rect;
	RenderRectBounds area;
	u32 color = 0xffffffffu; // ARGB32
	RenderLayer layer = RenderLayer::World;
};

// Image/sprite render
struct ImgRenderSubmission {
	uint32_t slot = 0;
	uint32_t u = 0;
	uint32_t v = 0;
	uint32_t w = 0;
	uint32_t h = 0;
	RenderVec2 pos{0.0f, 0.0f, 0.0f};  // x, y, z (z for depth sorting)
	RenderScale2 scale{1.0f, 1.0f};
	FlipOptions flip;
	u32 colorize = 0xffffffffu; // ARGB32 tint; white = no tint
	bool ambient_affected = false;
	f32 ambient_factor = 1.0f;
	RenderLayer layer = RenderLayer::World;
	f32 parallax_weight = 0.0f;
};

struct HostImageRenderSubmission {
	std::string imgid;
	RenderVec2 pos{0.0f, 0.0f, 0.0f};
	RenderScale2 scale{1.0f, 1.0f};
	FlipOptions flip;
	u32 colorize = 0xffffffffu; // ARGB32 tint; white = no tint
	bool ambient_affected = false;
	f32 ambient_factor = 1.0f;
	RenderLayer layer = RenderLayer::World;
	f32 parallax_weight = 0.0f;
};

// Polygon render (outline)
struct PolyRenderSubmission {
	std::vector<f32> points;
	f32 z = 0.0f;
	u32 color = 0xffffffffu; // ARGB32
	f32 thickness = 1.0f;
	RenderLayer layer = RenderLayer::World;
};

// Mesh render (3D)
struct MeshRenderSubmission {
	Mesh* mesh = nullptr;
	std::array<f32, 16> matrix;
	std::vector<std::array<f32, 16>> joint_matrices;
	std::vector<f32> morph_weights;
	bool receive_shadow = false;
	RenderLayer layer = RenderLayer::World;
};

// Particle render
struct ParticleRenderSubmission {
	Vec3 position{0.0f, 0.0f, 0.0f};
	f32 size = 1.0f;
	u32 color = 0xffffffffu; // ARGB32
	uint32_t slot = 0;
	uint32_t u = 0;
	uint32_t v = 0;
	uint32_t w = 0;
	uint32_t h = 0;
	std::array<f32, 2> uv0{0.0f, 0.0f};
	std::array<f32, 2> uv1{0.0f, 0.0f};
	i32 ambient_mode = 0;  // 0 or 1
	f32 ambient_factor = 1.0f;
	RenderLayer layer = RenderLayer::World;
};

enum class TextAlign { Left, Right, Center, Start, End };
enum class TextBaseline { Top, Hanging, Middle, Alphabetic, Ideographic, Bottom };

// Glyph/text render
struct GlyphRenderSubmission {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 z = 0.0f;
	std::vector<std::string> glyphs;
	i32 glyph_start = 0;
	i32 glyph_end = std::numeric_limits<i32>::max();
	BFont* font = nullptr;
	u32 color = 0xffffffffu; // ARGB32
	bool has_background_color = false;
	u32 background_color = 0xff000000u; // ARGB32
	i32 wrap_chars = 0;
	i32 center_block_width = 0;
	TextAlign align = TextAlign::Start;
	TextBaseline baseline = TextBaseline::Alphabetic;
	RenderLayer layer = RenderLayer::World;
};


/* ============================================================================
 * Texture parameters
 * ============================================================================ */

struct TextureParams {
	Vec2 size{0.0f, 0.0f};
	i32 wrapS = 0;
	i32 wrapT = 0;
	i32 minFilter = 0;
	i32 magFilter = 0;
	bool srgb = true;
};

} // namespace bmsx

#endif // BMSX_RENDER_TYPES_H
