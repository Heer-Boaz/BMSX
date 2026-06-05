/*
 * pipeline.cpp - Software CRT post-processing pass registration
 */

#include "pipeline.h"

#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/post/crt/software/crt_processor.h"

namespace bmsx {
namespace CRTPipeline {
namespace {

void renderPresentSoftware(GPUBackend* backend, GameView*, void*, RenderPassStateStorage& state, void*) {
	auto& software = *static_cast<SoftwareBackend*>(backend);
	const PresentPipelineState& present = state.present;
	software.blitTexture(present.colorTex,
		0,
		0,
		present.srcWidth,
		present.srcHeight,
		0,
		0,
		software.width(),
		software.height(),
		0.0f,
		0xffffffffu,
		false,
		false,
		DitherParams{},
		false);
}

void renderCRTSoftware(GPUBackend* backend, GameView*, void*, RenderPassStateStorage& state, void*) {
	Software::renderCRT(*static_cast<SoftwareBackend*>(backend), state.crt);
}

} // namespace

void registerCRTPostSoftwarePass(RenderPassLibrary& registry) {
	RenderPassDef present;
	present.id = "present";
	present.name = "Present";
	setAutoPresentGraph(present);
	present.exec = renderPresentSoftware;
	present.shouldExecute = shouldExecuteAutoPresentPass;
	registry.registerPass(present);

	RenderPassDef crt;
	crt.id = "crt";
	crt.name = "Present/CRT";
	setAutoCRTGraph(crt);
	crt.exec = renderCRTSoftware;
	crt.shouldExecute = shouldExecuteAutoCRTPass;
	registry.registerPass(crt);
}

} // namespace CRTPipeline
} // namespace bmsx
