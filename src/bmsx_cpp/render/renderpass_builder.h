/*
 * renderpass_builder.h - Fluent builder for render pass descriptions
 *
 * Mirrors TypeScript renderpass_builder.ts
 */

#ifndef BMSX_RENDERPASS_BUILDER_H
#define BMSX_RENDERPASS_BUILDER_H

#include "backend.h"
#include "render_types.h"
#include <array>
#include <vector>
#include <optional>

namespace bmsx {

/* ============================================================================
 * Color attachment specification
 * ============================================================================ */

struct ColorAttachmentSpec {
    TextureHandle tex = nullptr;
    std::optional<std::array<f32, 4>> clear;  // RGBA clear color
    bool discardAfter = false;
};

/* ============================================================================
 * Depth attachment specification
 * ============================================================================ */

struct DepthAttachmentSpec {
    TextureHandle tex = nullptr;
    std::optional<f32> clearDepth;
    bool discardAfter = false;
};

/* ============================================================================
 * RenderPassBuilder
 *
 * Fluent builder to assemble a RenderPassDesc consistently.
 * Mirrors TypeScript RenderPassBuilder class.
 * ============================================================================ */

class RenderPassBuilder {
public:
    explicit RenderPassBuilder(GPUBackend* backend) : m_backend(backend) {}

    RenderPassBuilder& label(const std::string& l) {
        m_label = l;
        return *this;
    }

    RenderPassBuilder& color(TextureHandle tex,
                             const std::array<f32, 4>* clear = nullptr,
                             bool discardAfter = false) {
        ColorAttachmentSpec spec;
        spec.tex = tex;
        if (clear) spec.clear = *clear;
        spec.discardAfter = discardAfter;
        m_colors.push_back(spec);
        return *this;
    }

    RenderPassBuilder& addColor(TextureHandle tex,
                                const std::array<f32, 4>* clear = nullptr,
                                bool discardAfter = false) {
        return color(tex, clear, discardAfter);
    }

    RenderPassBuilder& colors(const std::vector<ColorAttachmentSpec>& specs) {
        for (const auto& s : specs) {
            m_colors.push_back(s);
        }
        return *this;
    }

    RenderPassBuilder& depth(TextureHandle tex,
                             f32 clearDepth = 1.0f,
                             bool discardAfter = false) {
        m_depth = DepthAttachmentSpec{tex, clearDepth, discardAfter};
        return *this;
    }

    RenderPassDesc buildDesc() const {
        RenderPassDesc desc;
        desc.label = m_label;

        if (!m_colors.empty()) {
            const auto& first = m_colors[0];
            if (first.clear) {
                desc.color.clear = Color{
                    (*first.clear)[0],
                    (*first.clear)[1],
                    (*first.clear)[2],
                    (*first.clear)[3]
                };
            }
        }

        if (m_depth) {
            if (m_depth->clearDepth) {
                desc.depth.clearDepth = *m_depth->clearDepth;
            }
        }

        return desc;
    }

    PassEncoder begin() {
        return m_backend->beginRenderPass(buildDesc());
    }

private:
    GPUBackend* m_backend;
    std::string m_label;
    std::vector<ColorAttachmentSpec> m_colors;
    std::optional<DepthAttachmentSpec> m_depth;
};

} // namespace bmsx

#endif // BMSX_RENDERPASS_BUILDER_H
