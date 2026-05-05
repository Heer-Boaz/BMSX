#pragma once

#include "core/host_overlay_menu.h"
#include "render/backend/pass/library.h"
#include "render/host_overlay/pipeline.h"

namespace bmsx {

template<typename Backend, auto Bootstrap, auto Begin, auto RenderEntry, auto End>
void registerHostOverlayPass(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "host_overlay";
	desc.name = "HostOverlay";
	desc.present = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
	desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
		return buildHostOverlayState(*ctx.view);
	};
	if constexpr (Bootstrap != nullptr) {
		desc.bootstrap = [](GPUBackend* backend) {
			Bootstrap(*static_cast<Backend*>(backend));
		};
	}
	desc.shouldExecute = []() {
		return RenderQueues::beginHost2DQueue() != 0u;
	};
	desc.exec = [](GPUBackend* backend, void*, std::any& stateAny) {
		Backend& typedBackend = *static_cast<Backend*>(backend);
		const HostOverlayPipelineState& state = std::any_cast<HostOverlayPipelineState&>(stateAny);
		Begin(typedBackend, state);
		const size_t queueSize = RenderQueues::beginHost2DQueue();
		for (size_t index = 0; index < queueSize; index += 1) {
			RenderEntry(typedBackend, RenderQueues::host2DQueueEntry(index));
		}
		End(typedBackend);
	};
	registry.registerPass(desc);
}

template<typename Backend, auto Begin, auto RenderEntry, auto End>
void registerHostMenuPass(RenderPassLibrary& registry) {
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
		return hostOverlayMenu().queuedCommandCount() != 0u;
	};
	desc.exec = [](GPUBackend* backend, void*, std::any& stateAny) {
		Backend& typedBackend = *static_cast<Backend*>(backend);
		HostOverlayMenu& menu = hostOverlayMenu();
		Begin(typedBackend, std::any_cast<HostMenuPipelineState&>(stateAny));
		const size_t commandCount = menu.queuedCommandCount();
		for (size_t index = 0; index < commandCount; index += 1) {
			RenderEntry(typedBackend, menu.commandAt(index));
		}
		End(typedBackend);
	};
	registry.registerPass(desc);
}

template<typename Backend, auto Bootstrap, auto Begin, auto RenderEntry, auto End>
void registerHostOverlayBackendPasses(RenderPassLibrary& registry) {
	registerHostOverlayPass<Backend, Bootstrap, Begin, RenderEntry, End>(registry);
	registerHostMenuPass<Backend, Begin, RenderEntry, End>(registry);
}

} // namespace bmsx
