#include "render/host_overlay/gles2/pipeline.h"

#if BMSX_ENABLE_GLES2
#include "render/backend/pass/library.h"
#include "render/host_menu/queue.h"
#include "render/host_overlay/gles2/renderer.h"
#include "render/host_overlay/overlay_queue.h"
#include "render/host_overlay/pipeline.h"

namespace bmsx {
namespace {

void executeOverlayCommands(OpenGLES2Backend& backend, const HostOverlayPipelineState& state) {
	beginHostOverlayGLES2(backend, state);
	for (size_t index = 0; index < state.commandCount; index += 1) {
		renderHost2DEntryGLES2(backend, HostOverlayQueue::commandAt(index));
	}
	const size_t queueSize = RenderQueues::beginHost2DQueue();
	for (size_t index = 0; index < queueSize; index += 1) {
		renderHost2DEntryGLES2(backend, RenderQueues::host2DQueueEntry(index));
	}
	endHostOverlayGLES2(backend);
}

void executeMenuCommands(OpenGLES2Backend& backend, const HostMenuPipelineState& state) {
	beginHostOverlayGLES2(backend, state);
	for (size_t index = 0; index < HostMenuQueue::size(); index += 1) {
		renderHost2DEntryGLES2(backend, HostMenuQueue::at(index));
	}
	endHostOverlayGLES2(backend);
}

} // namespace

void registerHostOverlayPassesGLES2(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "host_overlay";
	desc.name = "HostOverlay";
	desc.present = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
	desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
		return buildHostOverlayState(*ctx.view);
	};
	desc.bootstrap = [](GPUBackend* backend) {
		bootstrapHostOverlayGLES2(*static_cast<OpenGLES2Backend*>(backend));
	};
	desc.shouldExecute = []() {
		return HostOverlayQueue::hasPendingOverlayFrame() || RenderQueues::beginHost2DQueue() != 0u;
	};
	desc.exec = [](GPUBackend* backend, void*, std::any& stateAny) {
		executeOverlayCommands(*static_cast<OpenGLES2Backend*>(backend), std::any_cast<HostOverlayPipelineState&>(stateAny));
	};
	registry.registerPass(desc);
}

void registerHostMenuPassesGLES2(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "host_menu";
	desc.name = "HostMenu";
	desc.present = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
	desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
		return buildHostMenuState(*ctx.view);
	};
	desc.shouldExecute = []() {
		return HostMenuQueue::size() != 0u;
	};
	desc.exec = [](GPUBackend* backend, void*, std::any& stateAny) {
		executeMenuCommands(*static_cast<OpenGLES2Backend*>(backend), std::any_cast<HostMenuPipelineState&>(stateAny));
	};
	registry.registerPass(desc);
}

} // namespace bmsx
#endif
