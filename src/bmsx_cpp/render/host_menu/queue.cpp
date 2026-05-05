#include "render/host_menu/queue.h"

#include <array>

namespace bmsx::HostMenuQueue {
namespace {
constexpr size_t kMaxEntries = 128;
std::array<RenderQueues::Host2DEntry, kMaxEntries> g_entries;
size_t g_count = 0;
}

void clear() {
	g_count = 0;
}

void submitRectangle(const RectRenderSubmission& item) {
	RenderQueues::Host2DEntry& entry = g_entries[g_count++];
	entry.kind = RenderQueues::Host2DKind::Rect;
	entry.rect = &item;
}

void submitGlyphs(const GlyphRenderSubmission& item) {
	RenderQueues::Host2DEntry& entry = g_entries[g_count++];
	entry.kind = RenderQueues::Host2DKind::Glyphs;
	entry.glyphs = &item;
}

size_t size() {
	return g_count;
}

const RenderQueues::Host2DEntry& at(size_t index) {
	return g_entries[index];
}

} // namespace bmsx::HostMenuQueue
