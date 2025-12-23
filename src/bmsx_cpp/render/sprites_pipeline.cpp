/*
 * sprites_pipeline.cpp - 2D Sprite rendering pipeline implementation
 *
 * Mirrors TypeScript sprites_pipeline.ts
 */

#include "sprites_pipeline.h"
#include "gameview.h"
#include "../core/engine.h"
#include "../core/assets.h"
#include "../core/rompack.h"
#include <cmath>

namespace bmsx {
namespace SpritesPipeline {

// Default Z coordinate (mirrors TypeScript DEFAULT_ZCOORD)
static constexpr f32 DEFAULT_ZCOORD = 100.0f;
static constexpr f32 ZCOORD_MAX = 1000.0f;

/**
 * Submit an image/sprite for rendering.
 * Mirrors TypeScript SpritesPipeline.drawImg().
 */
void drawImg(const ImgRenderSubmission& options) {
    if (options.imgid == "none" || options.imgid.empty()) return;

    auto& engine = EngineCore::instance();
    const auto* imgAsset = engine.assets().getImg(options.imgid);
    if (!imgAsset) {
        // Image not found - skip silently (matches TypeScript behavior with thrown error)
        return;
    }

    const ImgMeta* imgmeta = &imgAsset->meta;
    RenderQueues::submitSprite(options, imgmeta);
}

/**
 * Correct area start/end to ensure positive dimensions.
 * Mirrors TypeScript correctAreaStartEnd().
 */
static void correctAreaStartEnd(f32& x, f32& y, f32& ex, f32& ey) {
    if (ex < x) std::swap(x, ex);
    if (ey < y) std::swap(y, ey);
}

/**
 * Draw a filled rectangle using the whitepixel sprite.
 * Mirrors TypeScript SpritesPipeline.fillRectangle().
 */
void fillRectangle(const RectRenderSubmission& options) {
    f32 x = options.area.left;
    f32 y = options.area.top;
    f32 ex = options.area.right;
    f32 ey = options.area.bottom;
    f32 z = 0.0f; // TODO: Get z from area if available

    correctAreaStartEnd(x, y, ex, ey);

    ImgRenderSubmission sprite;
    sprite.imgid = "whitepixel";
    sprite.pos = {x, y, z};
    sprite.scale = {static_cast<f32>(static_cast<i32>(ex - x)),
                    static_cast<f32>(static_cast<i32>(ey - y))};
    sprite.colorize = options.color;
    sprite.layer = options.layer;

    drawImg(sprite);
}

/**
 * Draw a rectangle outline using the whitepixel sprite.
 * Mirrors TypeScript SpritesPipeline.drawRectangle().
 */
void drawRectangle(const RectRenderSubmission& options) {
    f32 x = options.area.left;
    f32 y = options.area.top;
    f32 ex = options.area.right;
    f32 ey = options.area.bottom;
    f32 z = 0.0f;

    correctAreaStartEnd(x, y, ex, ey);

    const std::string imgid = "whitepixel";
    const Color& c = options.color;
    RenderLayer layer = options.layer;

    // Top edge
    ImgRenderSubmission top;
    top.imgid = imgid;
    top.pos = {x, y, z};
    top.scale = {static_cast<f32>(static_cast<i32>(ex - x)), 1.0f};
    top.colorize = c;
    top.layer = layer;
    drawImg(top);

    // Bottom edge
    ImgRenderSubmission bottom;
    bottom.imgid = imgid;
    bottom.pos = {x, ey, z};
    bottom.scale = {static_cast<f32>(static_cast<i32>(ex - x)), 1.0f};
    bottom.colorize = c;
    bottom.layer = layer;
    drawImg(bottom);

    // Left edge
    ImgRenderSubmission left;
    left.imgid = imgid;
    left.pos = {x, y, z};
    left.scale = {1.0f, static_cast<f32>(static_cast<i32>(ey - y))};
    left.colorize = c;
    left.layer = layer;
    drawImg(left);

    // Right edge
    ImgRenderSubmission right;
    right.imgid = imgid;
    right.pos = {ex, y, z};
    right.scale = {1.0f, static_cast<f32>(static_cast<i32>(ey - y))};
    right.colorize = c;
    right.layer = layer;
    drawImg(right);
}

/**
 * Draw a polygon outline using the whitepixel sprite (Bresenham line).
 * Mirrors TypeScript SpritesPipeline.drawPolygon().
 */
void drawPolygon(const std::vector<Vec2>& coords, f32 z, const Color& color, f32 thickness, RenderLayer layer) {
    if (coords.size() < 2) return;

    const std::string imgid = "whitepixel";

    // Draw lines between consecutive points
    for (size_t i = 0; i < coords.size(); ++i) {
        size_t next = (i + 1) % coords.size();
        f32 x0 = coords[i].x;
        f32 y0 = coords[i].y;
        f32 x1 = coords[next].x;
        f32 y1 = coords[next].y;

        // Bresenham line algorithm (mirrors TypeScript)
        f32 dx = std::abs(x1 - x0);
        f32 dy = std::abs(y1 - y0);
        f32 sx = x0 < x1 ? 1.0f : -1.0f;
        f32 sy = y0 < y1 ? 1.0f : -1.0f;
        f32 err = dx - dy;

        while (true) {
            // Draw pixel at (x0, y0)
            ImgRenderSubmission pixel;
            pixel.imgid = imgid;
            pixel.pos = {x0, y0, z};
            pixel.scale = {thickness, thickness};
            pixel.colorize = color;
            pixel.layer = layer;
            drawImg(pixel);

            if (x0 == x1 && y0 == y1) break;

            f32 e2 = 2.0f * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (x0 == x1 && y0 == y1) {
                // Draw final pixel
                ImgRenderSubmission finalPixel;
                finalPixel.imgid = imgid;
                finalPixel.pos = {x0, y0, z};
                finalPixel.scale = {thickness, thickness};
                finalPixel.colorize = color;
                finalPixel.layer = layer;
                drawImg(finalPixel);
                break;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }
    }
}

/**
 * Render the sprite batch.
 * Mirrors TypeScript renderSpriteBatch().
 *
 * This is the software rendering implementation for libretro.
 * The TypeScript version uses WebGL/WebGPU with VAOs and shaders.
 */
void renderSpriteBatch(GPUBackend* backend, GameView* context) {
    auto* softBackend = dynamic_cast<SoftwareBackend*>(backend);
    if (!softBackend) return;

    // Swap and sort the sprite queue (returns count)
    i32 spriteCount = RenderQueues::beginSpriteQueue();
    if (spriteCount == 0) return;

    auto& engine = EngineCore::instance();
    const auto& assets = engine.assets();

    // Iterate over all sprites in the sorted front queue
    RenderQueues::forEachSprite([&](const SpriteQueueItem& item) {
        const auto& options = item.options;
        const ImgMeta* imgmeta = item.imgmeta;

        if (!imgmeta) return;

        const auto* imgAsset = assets.getImg(options.imgid);
        const auto& meta = imgAsset->meta;

        TextureHandle tex = nullptr;
        if (meta.atlassed) {
            const std::string atlasName = generateAtlasName(meta.atlasid);
            const auto* atlasAsset = assets.getImg(atlasName);
            tex = reinterpret_cast<TextureHandle>(atlasAsset->textureHandle);
        } else {
            tex = reinterpret_cast<TextureHandle>(imgAsset->textureHandle);
        }

        // Get UV coordinates based on flip options
        f32 u0, v0, u1, v1;
        meta.getUVRect(u0, v0, u1, v1, options.flip.flip_h, options.flip.flip_v);

        auto* softTex = static_cast<SoftwareTexture*>(tex);
        if (!softTex) {
            i32 x = static_cast<i32>(options.pos.x);
            i32 y = static_cast<i32>(options.pos.y);
            i32 w = static_cast<i32>(16 * options.scale.x);
            i32 h = static_cast<i32>(16 * options.scale.y);
            softBackend->fillRect(x, y, w, h, options.colorize);
            return;
        }

        // Calculate source rectangle from UVs
        i32 srcX = static_cast<i32>(u0 * softTex->width);
        i32 srcY = static_cast<i32>(v0 * softTex->height);
        i32 srcW = static_cast<i32>((u1 - u0) * softTex->width);
        i32 srcH = static_cast<i32>((v1 - v0) * softTex->height);

        // Destination position and size
        i32 dstX = static_cast<i32>(options.pos.x);
        i32 dstY = static_cast<i32>(options.pos.y);
        i32 dstW = static_cast<i32>(meta.width * options.scale.x);
        i32 dstH = static_cast<i32>(meta.height * options.scale.y);

        softBackend->blitTexture(tex, srcX, srcY, srcW, srcH,
                                 dstX, dstY, dstW, dstH,
                                 options.colorize,
                                 options.flip.flip_h, options.flip.flip_v);
    });
}

SpriteQueueDebug getSpriteQueueDebug() {
    return { RenderQueues::spriteQueueFrontSize(), RenderQueues::spriteQueueBackSize() };
}

} // namespace SpritesPipeline
} // namespace bmsx
