#pragma once

#include "render/backend/pass/library.h"
#include "render/host_overlay/pipeline.h"

#include <type_traits>

namespace bmsx {

template<
	typename Backend,
	typename Pipeline,
	typename State,
	State RenderPassStateStorage::*StateMember,
	auto Begin,
	auto RenderEntry,
	auto End
>
void renderHost2DPass(
	GPUBackend* backend,
	VideoPresenter*,
	void*,
	RenderPassStateStorage& stateStorage,
	void* context,
	const GxGpuDeviceOutput&
) {
	Backend& typedBackend = *static_cast<Backend*>(backend);
	const State& state = stateStorage.*StateMember;
	Pipeline* pipeline = static_cast<Pipeline*>(context);
	if constexpr (std::is_void_v<Pipeline>) {
		Begin(typedBackend, state);
	} else {
		Begin(typedBackend, *pipeline, state);
	}
	for (size_t index = 0; index < state.commandCount; index += 1) {
		if constexpr (std::is_void_v<Pipeline>) {
			RenderEntry(typedBackend, state.commandKinds[index], state.commandRefs[index]);
		} else {
			RenderEntry(typedBackend, *pipeline, state.commandKinds[index], state.commandRefs[index]);
		}
	}
	if constexpr (std::is_void_v<Pipeline>) {
		End(typedBackend);
	} else {
		End(typedBackend, *pipeline);
	}
}

template<
	typename Backend,
	typename Pipeline,
	typename State,
	State RenderPassStateStorage::*StateMember,
	auto Begin,
	auto RenderEntry,
	auto End
>
RenderPassDef makeHost2DPassDefinition(
	const char* id,
	const char* name,
	void (*writeState)(const RenderPassDef::RenderGraphPassContext&, RenderPassStateStorage&),
	bool (*shouldExecute)(VideoPresenter*, void*),
	Pipeline* pipeline
) {
	RenderPassDef desc;
	desc.id = id;
	desc.name = name;
	desc.present = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
	desc.graph->writeState = writeState;
	desc.shouldExecute = shouldExecute;
	desc.exec = renderHost2DPass<
		Backend,
		Pipeline,
		State,
		StateMember,
		Begin,
		RenderEntry,
		End
	>;
	desc.context = pipeline;
	return desc;
}

template<typename Backend, auto Begin, auto RenderEntry, auto End>
void registerHostOverlayBackendPasses(RenderPassLibrary& registry) {
	registry.registerPass(
		makeHost2DPassDefinition<
			Backend,
			void,
			HostOverlayPipelineState,
			&RenderPassStateStorage::hostOverlay,
			Begin,
			RenderEntry,
			End
		>("host_overlay", "HostOverlay", writeHostOverlayPassState, shouldExecuteHostOverlayPass, nullptr));
	registry.registerPass(
		makeHost2DPassDefinition<
			Backend,
			void,
			HostMenuPipelineState,
			&RenderPassStateStorage::hostMenu,
			Begin,
			RenderEntry,
			End
		>("host_menu", "HostMenu", writeHostMenuPassState, shouldExecuteHostMenuPass, nullptr));
}

template<typename Backend, typename Pipeline, auto Bootstrap, auto Teardown, auto Begin, auto RenderEntry, auto End>
void registerHostOverlayBackendPassesWithLifecycle(RenderPassLibrary& registry, Pipeline& pipeline) {
	RenderPassDef overlay = makeHost2DPassDefinition<
		Backend,
		Pipeline,
		HostOverlayPipelineState,
		&RenderPassStateStorage::hostOverlay,
		Begin,
		RenderEntry,
		End
	>("host_overlay", "HostOverlay", writeHostOverlayPassState, shouldExecuteHostOverlayPass, &pipeline);
	overlay.bootstrap = bootstrapPipelineRenderPass<Backend, Pipeline, Bootstrap>;
	overlay.teardown = teardownPipelineRenderPass<Backend, Pipeline, Teardown>;
	registry.registerPass(overlay);
	registry.registerPass(
		makeHost2DPassDefinition<
			Backend,
			Pipeline,
			HostMenuPipelineState,
			&RenderPassStateStorage::hostMenu,
			Begin,
			RenderEntry,
			End
		>("host_menu", "HostMenu", writeHostMenuPassState, shouldExecuteHostMenuPass, &pipeline));
}

} // namespace bmsx
