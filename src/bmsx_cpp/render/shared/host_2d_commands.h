#pragma once

#include "common/scratchbatch.h"
#include "render/shared/submissions.h"
#include <cstddef>
#include <utility>

namespace bmsx {
namespace RenderQueues {

enum class Host2DKind : u8 {
	Img,
	Poly,
	Rect,
	Glyphs,
};

struct Host2DEntry {
	Host2DKind kind = Host2DKind::Rect;
	const HostImageRenderSubmission* img = nullptr;
	const PolyRenderSubmission* poly = nullptr;
	const RectRenderSubmission* rect = nullptr;
	const GlyphRenderSubmission* glyphs = nullptr;
};

class Host2DCommandList {
public:
	explicit Host2DCommandList(size_t capacity)
		: m_kind(capacity)
		, m_ref(capacity)
		, m_img(capacity)
		, m_poly(capacity)
		, m_rect(capacity)
		, m_glyphs(capacity) {}

	void clear() {
		m_kind.clear();
		m_ref.clear();
		m_img.clear();
		m_poly.clear();
		m_rect.clear();
		m_glyphs.clear();
	}

	size_t size() const {
		return m_ref.size();
	}

	void submit(HostImageRenderSubmission item) {
		const Host2DRef ref{m_img.size()};
		m_img.push(std::move(item));
		submitRef(Host2DKind::Img, ref);
	}

	void submit(RectRenderSubmission item) {
		const Host2DRef ref{m_rect.size()};
		m_rect.push(std::move(item));
		submitRef(Host2DKind::Rect, ref);
	}

	void submit(PolyRenderSubmission item) {
		const Host2DRef ref{m_poly.size()};
		m_poly.push(std::move(item));
		submitRef(Host2DKind::Poly, ref);
	}

	void submit(GlyphRenderSubmission item) {
		const Host2DRef ref{m_glyphs.size()};
		m_glyphs.push(std::move(item));
		submitRef(Host2DKind::Glyphs, ref);
	}

	Host2DEntry entry(size_t index) const {
		Host2DEntry result;
		result.kind = m_kind.get(index);
		const Host2DRef& ref = m_ref.get(index);
		switch (result.kind) {
			case Host2DKind::Img:
				result.img = &m_img.get(ref.index);
				return result;
			case Host2DKind::Poly:
				result.poly = &m_poly.get(ref.index);
				return result;
			case Host2DKind::Rect:
				result.rect = &m_rect.get(ref.index);
				return result;
			case Host2DKind::Glyphs:
				result.glyphs = &m_glyphs.get(ref.index);
				return result;
		}
		return result;
	}

private:
	struct Host2DRef {
		size_t index = 0;
	};

	ScratchBatch<Host2DKind> m_kind;
	ScratchBatch<Host2DRef> m_ref;
	ScratchBatch<HostImageRenderSubmission> m_img;
	ScratchBatch<PolyRenderSubmission> m_poly;
	ScratchBatch<RectRenderSubmission> m_rect;
	ScratchBatch<GlyphRenderSubmission> m_glyphs;

	void submitRef(Host2DKind kind, Host2DRef ref) {
		m_kind.push(kind);
		m_ref.push(ref);
	}
};

} // namespace RenderQueues
} // namespace bmsx
