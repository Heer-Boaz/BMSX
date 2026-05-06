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

using Host2DRef = const void*;

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
		const size_t ref = m_img.size();
		m_img.push(std::move(item));
		submitRef(Host2DKind::Img, ref);
	}

	void submit(RectRenderSubmission item) {
		const size_t ref = m_rect.size();
		m_rect.push(std::move(item));
		submitRef(Host2DKind::Rect, ref);
	}

	void submit(PolyRenderSubmission item) {
		const size_t ref = m_poly.size();
		m_poly.push(std::move(item));
		submitRef(Host2DKind::Poly, ref);
	}

	void submit(GlyphRenderSubmission item) {
		const size_t ref = m_glyphs.size();
		m_glyphs.push(std::move(item));
		submitRef(Host2DKind::Glyphs, ref);
	}

	Host2DKind kind(size_t index) const {
		return m_kind.get(index);
	}

	Host2DRef ref(size_t index) const {
		const size_t ref = m_ref.get(index);
		switch (m_kind.get(index)) {
			case Host2DKind::Img:
				return &m_img.get(ref);
			case Host2DKind::Poly:
				return &m_poly.get(ref);
			case Host2DKind::Rect:
				return &m_rect.get(ref);
			case Host2DKind::Glyphs:
				return &m_glyphs.get(ref);
		}
		__builtin_unreachable();
	}

private:
	ScratchBatch<Host2DKind> m_kind;
	ScratchBatch<size_t> m_ref;
	ScratchBatch<HostImageRenderSubmission> m_img;
	ScratchBatch<PolyRenderSubmission> m_poly;
	ScratchBatch<RectRenderSubmission> m_rect;
	ScratchBatch<GlyphRenderSubmission> m_glyphs;

	void submitRef(Host2DKind kind, size_t ref) {
		m_kind.push(kind);
		m_ref.push(ref);
	}
};

} // namespace RenderQueues
} // namespace bmsx
