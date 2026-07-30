#pragma once

#include "render/backend/pass/library.h"

namespace bmsx {

class VideoPresenter;

void writeHostOverlayPassState(
	const RenderPassDef::RenderGraphPassContext& ctx,
	RenderPassStateStorage& state
);
void writeHostMenuPassState(
	const RenderPassDef::RenderGraphPassContext& ctx,
	RenderPassStateStorage& state
);
bool shouldExecuteHostOverlayPass(VideoPresenter* presenter, void*);
bool shouldExecuteHostMenuPass(VideoPresenter* presenter, void*);

} // namespace bmsx
