/*
 * render_types.h - Render submission types for BMSX
 *
 * Mirrors TypeScript render_types.ts
 * These are the data structures used to submit render commands.
 */

#ifndef BMSX_RENDER_TYPES_H
#define BMSX_RENDER_TYPES_H

#include "../core/types.h"
#include <string>
#include <vector>
#include <array>

namespace bmsx {

// Color is already defined in types.h
class BFont;

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

/* ============================================================================
 * Rect bounds (for rectangles and hitboxes)
 * ============================================================================ */

struct RectBounds {
    f32 left = 0.0f;
    f32 top = 0.0f;
    f32 right = 0.0f;
    f32 bottom = 0.0f;

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
    RenderLayer layer = RenderLayer::World;
};

// Image/sprite render
struct ImgRenderSubmission {
    std::string imgid;
    Vec3 pos{0.0f, 0.0f, 0.0f};  // x, y, z (z for depth sorting)
    Vec2 scale{1.0f, 1.0f};
    FlipOptions flip;
    Color colorize{1.0f, 1.0f, 1.0f, 1.0f};  // Tint color (white = no tint)
    bool ambient_affected = false;
    f32 ambient_factor = 1.0f;
    RenderLayer layer = RenderLayer::World;
};

// Polygon render (outline)
struct PolyRenderSubmission {
    std::vector<Vec2> points;
    f32 z = 0.0f;
    Color color;
    f32 thickness = 1.0f;
    RenderLayer layer = RenderLayer::World;
};

// Mesh render (3D)
struct MeshRenderSubmission {
    // TODO: Mesh pointer, matrices, etc.
    std::array<f32, 16> matrix;
    bool receive_shadow = false;
    RenderLayer layer = RenderLayer::World;
};

// Particle render
struct ParticleRenderSubmission {
    Vec3 position{0.0f, 0.0f, 0.0f};
    f32 size = 1.0f;
    Color color;
    // texture handle
    i32 ambient_mode = 0;  // 0 or 1
    f32 ambient_factor = 1.0f;
    RenderLayer layer = RenderLayer::World;
};

// Glyph/text render
struct GlyphRenderSubmission {
    f32 x = 0.0f;
    f32 y = 0.0f;
    f32 z = 950.0f;  // Default Z for UI text
    std::string text;
    BFont* font = nullptr;
    i32 glyph_start = 0;
    i32 glyph_end = -1;
    Color color{1.0f, 1.0f, 1.0f, 1.0f};
    Color background_color{0.0f, 0.0f, 0.0f, 0.0f};
    i32 wrap_chars = 0;
    i32 center_block_width = 0;
    RenderLayer layer = RenderLayer::World;
};

/* ============================================================================
 * Texture handle (abstract, backend-specific)
 * ============================================================================ */

using TextureHandle = void*;  // Backend-specific texture pointer

/* ============================================================================
 * Texture parameters
 * ============================================================================ */

struct TextureParams {
    Vec2 size{0.0f, 0.0f};
    // Wrap modes, filters, etc.
};

} // namespace bmsx

#endif // BMSX_RENDER_TYPES_H
