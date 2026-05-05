#pragma once

#include "render/shared/queues.h"
#include <cstddef>

namespace bmsx::HostMenuQueue {

void clear();
void submitRectangle(const RectRenderSubmission& item);
void submitGlyphs(const GlyphRenderSubmission& item);
size_t size();
const RenderQueues::Host2DEntry& at(size_t index);

} // namespace bmsx::HostMenuQueue
