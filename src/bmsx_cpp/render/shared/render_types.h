/*
 * render_types.h - Render submission types for BMSX
 *
 * Mirrors TypeScript render_types.ts
 * These are the data structures used to submit render commands.
 */

#ifndef BMSX_RENDER_TYPES_H
#define BMSX_RENDER_TYPES_H

#include "../../core/types.h"
#include <cstddef>
#include <optional>
#include <string>
#include <vector>
#include <array>

namespace bmsx {

// Color is already defined in types.h
class BFont;
class Mesh;

using TextureHandle = void*;  // Backend-specific texture pointer

/* ============================================================================
 * Flip options for sprites
 * ============================================================================ */

struct FlipOptions {
	bool flip_h = false;
	bool flip_v = false;
};

struct SpriteParallaxRig {
	f32 vy = 0.0f;
	f32 scale = 1.0f;
	f32 impact = 0.0f;
	f32 impact_t = 0.0f;
	f32 bias_px = 0.0f;
	f32 parallax_strength = 1.0f;
	f32 scale_strength = 1.0f;
	f32 flip_strength = 0.0f;
	f32 flip_window = 0.6f;
};

/* ============================================================================
 * Render layer (determines draw order/pass)
 * ============================================================================ */

enum class RenderLayer {
	World,  // Main game world
	UI,     // User interface overlay
	IDE     // Editor/debug overlay
};

enum class Layer2D : u8 {
	World = 0,
	UI = 1,
	IDE = 2,
};

inline Layer2D renderLayerTo2dLayer(RenderLayer layer) {
	if (layer == RenderLayer::UI) return Layer2D::UI;
	if (layer == RenderLayer::IDE) return Layer2D::IDE;
	return Layer2D::World;
}

/* ============================================================================
 * Rect bounds (for rectangles and hitboxes)
 * ============================================================================ */

struct RectBounds {
	f32 left = 0.0f;
	f32 top = 0.0f;
	f32 right = 0.0f;
	f32 bottom = 0.0f;
	f32 z = 0.0f;

	f32 width() const { return right - left; }
	f32 height() const { return bottom - top; }
};

/* ============================================================================
 * Render submissions - data for each render type
 * ============================================================================ */

// Rectangle render (outline or filled)
struct RectRenderSubmission {
	enum class Kind { Rect, Fill };
	Kind kind = Kind::Rect;
	RectBounds area;
	Color color;
	std::optional<RenderLayer> layer;
};

// Image/sprite render
struct ImgRenderSubmission {
	std::string imgid;
	Vec3 pos{0.0f, 0.0f, 0.0f};  // x, y, z (z for depth sorting)
	std::optional<Vec2> scale;
	std::optional<FlipOptions> flip;
	std::optional<Color> colorize;  // Tint color (white = no tint)
	std::optional<bool> ambient_affected;
	std::optional<f32> ambient_factor;
	std::optional<RenderLayer> layer;
	std::optional<f32> parallax_weight;
};

// Polygon render (outline)
struct PolyRenderSubmission {
	std::vector<f32> points;
	f32 z = 0.0f;
	Color color;
	std::optional<f32> thickness;
	std::optional<RenderLayer> layer;
};

// Mesh render (3D)
struct MeshRenderSubmission {
	Mesh* mesh = nullptr;
	std::array<f32, 16> matrix;
	std::optional<std::vector<std::array<f32, 16>>> joint_matrices;
	std::optional<std::vector<f32>> morph_weights;
	std::optional<bool> receive_shadow;
	std::optional<RenderLayer> layer;
};

// Particle render
struct ParticleRenderSubmission {
	Vec3 position{0.0f, 0.0f, 0.0f};
	f32 size = 1.0f;
	Color color;
	TextureHandle texture = nullptr;
	std::optional<i32> ambient_mode;  // 0 or 1
	std::optional<f32> ambient_factor;
	std::optional<RenderLayer> layer;
};

enum class TextAlign { Left, Right, Center, Start, End };
enum class TextBaseline { Top, Hanging, Middle, Alphabetic, Ideographic, Bottom };

// Glyph/text render
struct GlyphRenderSubmission {
	f32 x = 0.0f;
	f32 y = 0.0f;
	std::optional<f32> z;
	std::vector<std::string> glyphs;
	std::optional<i32> glyph_start;
	std::optional<i32> glyph_end;
	BFont* font = nullptr;
	std::optional<Color> color;
	std::optional<Color> background_color;
	std::optional<i32> wrap_chars;
	std::optional<i32> center_block_width;
	std::optional<TextAlign> align;
	std::optional<TextBaseline> baseline;
	std::optional<RenderLayer> layer;
};

enum class RenderSubmissionType {
	Img,
	Mesh,
	Particle,
	Poly,
	Rect,
	Glyphs,
};

struct RenderSubmission {
	RenderSubmissionType type = RenderSubmissionType::Img;
	ImgRenderSubmission img;
	MeshRenderSubmission mesh;
	ParticleRenderSubmission particle;
	PolyRenderSubmission poly;
	RectRenderSubmission rect;
	GlyphRenderSubmission glyphs;
};


/* ============================================================================
 * Texture parameters
 * ============================================================================ */

struct TextureParams {
	Vec2 size{0.0f, 0.0f};
	bool srgb = true;
	// Wrap modes, filters, etc.
};

struct SkyboxImageIds {
	std::string posx;
	std::string negx;
	std::string posy;
	std::string negy;
	std::string posz;
	std::string negz;
};

} // namespace bmsx

#endif // BMSX_RENDER_TYPES_H
