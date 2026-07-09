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

void renderPresentSoftware(GPUBackend* backend, GameView*, void* fbo, RenderPassStateStorage& state, void*) {
	auto& software = *static_cast<SoftwareBackend*>(backend);
	if (fbo != nullptr) {
		auto* target = static_cast<SoftwareTexture*>(fbo);
		software.activateRenderTarget(fbo, target->width, target->height);
	}
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

} // namespace

void registerPresentationHistorySoftwarePass(
	RenderPassLibrary& registry,
	const char* id,
	const char* name,
	RenderPassDef::RenderGraphSlot historySlot,
	bool (*shouldExecute)(GameView*, void*)) {
	RenderPassDef desc;
	desc.id = id;
	desc.name = name;
	setPresentationHistoryGraph(desc, historySlot);
	desc.exec = renderPresentSoftware;
	desc.shouldExecute = shouldExecute;
	registry.registerPass(desc);
}

void registerCRTPostSoftwarePass(RenderPassLibrary& registry) {

	registerPresentationHistorySoftwarePass(
		registry,
		"presentation_history_a",
		"PresentationHistoryA",
		RenderPassDef::RenderGraphSlot::FrameHistoryA,
		shouldUpdatePresentationHistoryA);
	registerPresentationHistorySoftwarePass(
		registry,
		"presentation_history_b",
		"PresentationHistoryB",
		RenderPassDef::RenderGraphSlot::FrameHistoryB,
		shouldUpdatePresentationHistoryB);

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
	crt.exec = executeStateRenderPass<
		SoftwareBackend,
		CRTPipelineState,
		&RenderPassStateStorage::crt,
		Software::renderCRT>;
	crt.shouldExecute = shouldExecuteAutoCRTPass;
	registry.registerPass(crt);
}

} // namespace CRTPipeline
} // namespace bmsx
