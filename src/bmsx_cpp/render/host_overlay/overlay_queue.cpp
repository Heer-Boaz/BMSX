#include "render/host_overlay/overlay_queue.h"

#include <array>
#include <utility>

namespace bmsx::HostOverlayQueue {
namespace {
constexpr size_t kMaxOverlayCommands = 512;
HostOverlayFrame g_pendingFrame;
std::array<RenderQueues::Host2DEntry, kMaxOverlayCommands> g_commands;
std::array<HostImageRenderSubmission, kMaxOverlayCommands> g_images;
std::array<PolyRenderSubmission, kMaxOverlayCommands> g_polys;
std::array<RectRenderSubmission, kMaxOverlayCommands> g_rects;
std::array<GlyphRenderSubmission, kMaxOverlayCommands> g_glyphs;
size_t g_commandCount = 0;
size_t g_imageCount = 0;
size_t g_polyCount = 0;
size_t g_rectCount = 0;
size_t g_glyphCount = 0;
bool g_hasPendingFrame = false;
}

void clearOverlayCommands() {
	g_commandCount = 0;
	g_imageCount = 0;
	g_polyCount = 0;
	g_rectCount = 0;
	g_glyphCount = 0;
}

void submitImage(HostImageRenderSubmission command) {
	HostImageRenderSubmission& payload = g_images[g_imageCount++];
	payload = std::move(command);
	RenderQueues::Host2DEntry& entry = g_commands[g_commandCount++];
	entry.kind = RenderQueues::Host2DKind::Img;
	entry.img = &payload;
}

void submitRectangle(RectRenderSubmission command) {
	RectRenderSubmission& payload = g_rects[g_rectCount++];
	payload = std::move(command);
	RenderQueues::Host2DEntry& entry = g_commands[g_commandCount++];
	entry.kind = RenderQueues::Host2DKind::Rect;
	entry.rect = &payload;
}

void submitDrawPolygon(PolyRenderSubmission command) {
	PolyRenderSubmission& payload = g_polys[g_polyCount++];
	payload = std::move(command);
	RenderQueues::Host2DEntry& entry = g_commands[g_commandCount++];
	entry.kind = RenderQueues::Host2DKind::Poly;
	entry.poly = &payload;
}

void submitGlyphs(GlyphRenderSubmission command) {
	GlyphRenderSubmission& payload = g_glyphs[g_glyphCount++];
	payload = std::move(command);
	RenderQueues::Host2DEntry& entry = g_commands[g_commandCount++];
	entry.kind = RenderQueues::Host2DKind::Glyphs;
	entry.glyphs = &payload;
}

void publishOverlayFrame(const HostOverlayFrame& frame) {
	g_pendingFrame = frame;
	g_pendingFrame.commandCount = g_commandCount;
	g_hasPendingFrame = true;
}

bool hasPendingOverlayFrame() {
	return g_hasPendingFrame;
}

const HostOverlayFrame& consumeOverlayFrame() {
	g_hasPendingFrame = false;
	return g_pendingFrame;
}

const RenderQueues::Host2DEntry& commandAt(size_t index) {
	return g_commands[index];
}

void clearOverlayFrame() {
	g_hasPendingFrame = false;
	g_pendingFrame.commandCount = 0;
	clearOverlayCommands();
}

} // namespace bmsx::HostOverlayQueue
