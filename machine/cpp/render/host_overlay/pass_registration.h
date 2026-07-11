#pragma once

#include "render/backend/pass/library.h"
#include "render/host_overlay/overlay_queue.h"
#include "render/host_overlay/pipeline.h"

namespace bmsx {

inline void writeHostOverlayPassState(const RenderPassDef::RenderGraphPassContext&, RenderPassStateStorage& state) {
	writeHostOverlayState(state.hostOverlay);
}

inline void writeHostMenuPassState(const RenderPassDef::RenderGraphPassContext& ctx, RenderPassStateStorage& state) {
	writeHostMenuState(state.hostMenu, *ctx.view);
}

template<typename Backend, auto Bootstrap>
void bootstrapHostOverlayPass(GPUBackend* backend, void*) {
	if constexpr (Bootstrap != nullptr) {
		Bootstrap(*static_cast<Backend*>(backend));
	}
}

inline bool shouldExecuteHostOverlayPass(GameView*, void*) {
	return hasPendingOverlayFrame();
}

inline bool shouldExecuteHostMenuPass(GameView*, void*) {
	return hasPendingHostMenuFrame();
}

template<typename Backend, auto Begin, auto RenderEntry, auto End>
void renderHostOverlayPass(GPUBackend* backend, GameView*, void*, RenderPassStateStorage& stateStorage, void*) {
	Backend& typedBackend = *static_cast<Backend*>(backend);
	const HostOverlayPipelineState& state = stateStorage.hostOverlay;
	Begin(typedBackend, state);
	for (size_t index = 0; index < state.commandCount; index += 1) {
		RenderEntry(typedBackend, state.commandKinds[index], state.commandRefs[index]);
	}
	End(typedBackend);
}

template<typename Backend, auto Begin, auto RenderEntry, auto End>
void renderHostMenuPass(GPUBackend* backend, GameView*, void*, RenderPassStateStorage& stateStorage, void*) {
	Backend& typedBackend = *static_cast<Backend*>(backend);
	const HostMenuPipelineState& state = stateStorage.hostMenu;
	Begin(typedBackend, state);
	for (size_t index = 0; index < state.commandCount; index += 1) {
		RenderEntry(typedBackend, state.commandKinds[index], state.commandRefs[index]);
	}
	End(typedBackend);
}

template<typename Backend, auto Bootstrap, auto Begin, auto RenderEntry, auto End>
void registerHostOverlayPass(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "host_overlay";
	desc.name = "HostOverlay";
	desc.present = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
	desc.graph->writeState = writeHostOverlayPassState;
	if constexpr (Bootstrap != nullptr) {
		desc.bootstrap = bootstrapHostOverlayPass<Backend, Bootstrap>;
	}
	desc.shouldExecute = shouldExecuteHostOverlayPass;
	desc.exec = renderHostOverlayPass<Backend, Begin, RenderEntry, End>;
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
	desc.graph->writeState = writeHostMenuPassState;
	desc.shouldExecute = shouldExecuteHostMenuPass;
	desc.exec = renderHostMenuPass<Backend, Begin, RenderEntry, End>;
	registry.registerPass(desc);
}

template<typename Backend, auto Bootstrap, auto Begin, auto RenderEntry, auto End>
void registerHostOverlayBackendPasses(RenderPassLibrary& registry) {
	registerHostOverlayPass<Backend, Bootstrap, Begin, RenderEntry, End>(registry);
	registerHostMenuPass<Backend, Begin, RenderEntry, End>(registry);
}

} // namespace bmsx
