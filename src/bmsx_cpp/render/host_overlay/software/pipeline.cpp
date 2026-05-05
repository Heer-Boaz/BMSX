#include "render/host_overlay/software/pipeline.h"

#include "render/backend/pass/library.h"
#include "render/host_menu/queue.h"
#include "render/host_overlay/overlay_queue.h"
#include "render/host_overlay/pipeline.h"
#include "render/host_overlay/software/renderer.h"

namespace bmsx {
namespace {

void executeOverlayCommands(SoftwareBackend& backend, const HostOverlayPipelineState& state) {
	beginHostOverlaySoftware(backend, state);
	for (size_t index = 0; index < state.commandCount; index += 1) {
		renderHost2DEntrySoftware(backend, HostOverlayQueue::commandAt(index));
	}
	const size_t queueSize = RenderQueues::beginHost2DQueue();
	for (size_t index = 0; index < queueSize; index += 1) {
		renderHost2DEntrySoftware(backend, RenderQueues::host2DQueueEntry(index));
	}
	endHostOverlaySoftware(backend);
}

void executeMenuCommands(SoftwareBackend& backend, const HostMenuPipelineState& state) {
	beginHostOverlaySoftware(backend, state);
	for (size_t index = 0; index < HostMenuQueue::size(); index += 1) {
		renderHost2DEntrySoftware(backend, HostMenuQueue::at(index));
	}
	endHostOverlaySoftware(backend);
}

} // namespace

void registerHostOverlayPassesSoftware(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "host_overlay";
	desc.name = "HostOverlay";
	desc.present = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
	desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
		return buildHostOverlayState(*ctx.view);
	};
	desc.shouldExecute = []() {
		return HostOverlayQueue::hasPendingOverlayFrame() || RenderQueues::beginHost2DQueue() != 0u;
	};
	desc.exec = [](GPUBackend* backend, void*, std::any& stateAny) {
		executeOverlayCommands(*static_cast<SoftwareBackend*>(backend), std::any_cast<HostOverlayPipelineState&>(stateAny));
	};
	registry.registerPass(desc);
}

void registerHostMenuPassesSoftware(RenderPassLibrary& registry) {
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
		executeMenuCommands(*static_cast<SoftwareBackend*>(backend), std::any_cast<HostMenuPipelineState&>(stateAny));
	};
	registry.registerPass(desc);
}

} // namespace bmsx
