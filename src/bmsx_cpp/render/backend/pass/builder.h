/*
 * builder.h - Fluent builder for render pass descriptions
 */

#ifndef BMSX_RENDERPASS_BUILDER_H
#define BMSX_RENDERPASS_BUILDER_H

#include "../backend.h"
#include "../../shared/submissions.h"
#include <array>
#include <vector>
#include <optional>

namespace bmsx {

/* ============================================================================
 * Color attachment specification
 * ============================================================================ */

struct BuilderColorAttachmentSpec {
	TextureHandle tex = nullptr;
	std::optional<std::array<f32, 4>> clear;  // RGBA clear color
	bool discardAfter = false;
};

/* ============================================================================
 * Depth attachment specification
 * ============================================================================ */

struct BuilderDepthAttachmentSpec {
	TextureHandle tex = nullptr;
	std::optional<f32> clearDepth;
	bool discardAfter = false;
};

/* ============================================================================
 * RenderPassBuilder
 *
 * Fluent builder to assemble a RenderPassDesc consistently.
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
		BuilderColorAttachmentSpec spec;
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

	RenderPassBuilder& colors(const std::vector<BuilderColorAttachmentSpec>& specs) {
		for (const auto& s : specs) {
			m_colors.push_back(s);
		}
		return *this;
	}

	RenderPassBuilder& depth(TextureHandle tex,
								const f32* clearDepth = nullptr,
								bool discardAfter = false) {
		BuilderDepthAttachmentSpec spec;
		spec.tex = tex;
		if (clearDepth) spec.clearDepth = *clearDepth;
		spec.discardAfter = discardAfter;
		m_depth = spec;
		return *this;
	}

	RenderPassDesc buildDesc() const {
		RenderPassDesc desc;
		if (m_label) {
			desc.label = *m_label;
		}

		if (!m_colors.empty()) {
			desc.colors.reserve(m_colors.size());
			for (const auto& colorSpec : m_colors) {
				ColorAttachmentSpec out;
				out.tex = colorSpec.tex;
				out.discardAfter = colorSpec.discardAfter;
				if (colorSpec.clear) {
					out.clear = *colorSpec.clear;
				}
				desc.colors.push_back(out);
			}
			desc.color = desc.colors.front();
		}

		if (m_depth) {
			DepthAttachmentSpec out;
			out.tex = m_depth->tex;
			out.discardAfter = m_depth->discardAfter;
			if (m_depth->clearDepth) {
				out.clearDepth = *m_depth->clearDepth;
			}
			desc.depth = out;
		}

		return desc;
	}

	PassEncoder begin() {
		return m_backend->beginRenderPass(buildDesc());
	}

private:
	GPUBackend* m_backend;
	std::optional<std::string> m_label;
	std::vector<BuilderColorAttachmentSpec> m_colors;
	std::optional<BuilderDepthAttachmentSpec> m_depth;
};

} // namespace bmsx

#endif // BMSX_RENDERPASS_BUILDER_H
