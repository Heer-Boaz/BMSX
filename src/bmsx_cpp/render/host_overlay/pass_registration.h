#pragma once

#include "core/host_overlay_menu.h"
#include "render/backend/pass/library.h"
#include "render/host_overlay/overlay_queue.h"
#include "render/host_overlay/pipeline.h"

namespace bmsx {

template<typename Backend, auto Bootstrap, auto Begin, auto RenderEntry, auto End, auto ShouldExecuteExtra = nullptr>
void registerHostOverlayPass(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "host_overlay";
	desc.name = "HostOverlay";
	desc.present = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
	desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext&) -> std::any {
		return buildHostOverlayState();
	};
	if constexpr (Bootstrap != nullptr) {
		desc.bootstrap = [](GPUBackend* backend) {
			Bootstrap(*static_cast<Backend*>(backend));
		};
	}
	desc.shouldExecute = []() {
		if constexpr (ShouldExecuteExtra != nullptr) {
			return hasPendingOverlayFrame() || ShouldExecuteExtra();
		} else {
			return hasPendingOverlayFrame();
		}
	};
	desc.exec = [](GPUBackend* backend, void*, std::any& stateAny) {
		Backend& typedBackend = *static_cast<Backend*>(backend);
		const HostOverlayPipelineState& state = std::any_cast<HostOverlayPipelineState&>(stateAny);
		Begin(typedBackend, state);
		for (size_t index = 0; index < state.commandCount; index += 1) {
			RenderEntry(typedBackend, state.commandKinds[index], state.commandRefs[index]);
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
			RenderEntry(typedBackend, menu.commandKind(index), menu.commandRef(index));
		}
		End(typedBackend);
	};
	registry.registerPass(desc);
}

template<typename Backend, auto Bootstrap, auto Begin, auto RenderEntry, auto End, auto ShouldExecuteExtra = nullptr>
void registerHostOverlayBackendPasses(RenderPassLibrary& registry) {
	registerHostOverlayPass<Backend, Bootstrap, Begin, RenderEntry, End, ShouldExecuteExtra>(registry);
	registerHostMenuPass<Backend, Begin, RenderEntry, End>(registry);
}

} // namespace bmsx
