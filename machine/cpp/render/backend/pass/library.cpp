/*
 * library.cpp - Render pass library implementation
 */

#include "library.h"
#include "common/hash.h"
#include "common/primitives.h"
#include "../../video_presenter.h"
#include "../../graph/graph.h"
#include "machine/devices/gx/device_output.h"
#include <algorithm>
#include <stdexcept>
#include <cstddef>
#include <memory>
#include <vector>

namespace bmsx {

namespace {

constexpr f32 kCrtNoiseOffsetScale = 1.0f / 16777216.0f;

void noopRenderPass(
	GPUBackend*,
	VideoPresenter*,
	void*,
	RenderPassStateStorage&,
	void*,
	const GxGpuDeviceOutput&
) {
}

void setSkippedStatePass(RenderPassDef& desc, const char* id, const char* name) {
	desc.id = id;
	desc.name = name;
	desc.stateOnly = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->skip = true;
}

RenderPassDef::RenderPassGraphDef& resetAutoPresentGraph(RenderPassDef& desc) {
	desc.present = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
	return *desc.graph;
}


RenderGraphSlot presentationHistorySlot(u8 index) {
	return index == 0u ? RenderPassDef::RenderGraphSlot::FrameHistoryA : RenderPassDef::RenderGraphSlot::FrameHistoryB;
}

TextureHandle currentFrameSourceTexture(const RenderPassDef::RenderGraphPassContext& ctx) {
	const VideoPresenter& presenter = *ctx.presenter;
	return ctx.deviceColorEnabled && presenter.deviceQuantizeMode() != DeviceQuantizeMode::None
		? ctx.getTexture(RenderPassDef::RenderGraphSlot::DeviceColor)
		: ctx.getTexture(RenderPassDef::RenderGraphSlot::FrameColor);
}

TextureHandle presentedHistoryTexture(const RenderPassDef::RenderGraphPassContext& ctx) {
	const VideoPresenter& presenter = *ctx.presenter;
	const u8 historyIndex = presenter.commitPresentationFrame
		? presenter.presentationHistoryDestinationIndex()
		: presenter.presentationHistorySourceIndex;
	return ctx.getTexture(presentationHistorySlot(historyIndex));
}

void writeAutoPresentPipelineState(
	const RenderPassDef::RenderGraphPassContext& ctx,
	RenderPassStateStorage& state
) {
	auto* presenter = ctx.presenter;
	PresentPipelineState& presentState = state.present;
	presentState.width = static_cast<i32>(presenter->canvasSize.x);
	presentState.height = static_cast<i32>(presenter->canvasSize.y);
	presentState.srcWidth = static_cast<i32>(presenter->offscreenCanvasSize.x);
	presentState.srcHeight = static_cast<i32>(presenter->offscreenCanvasSize.y);
	presentState.colorTex = presentedHistoryTexture(ctx);
}


void writePresentationHistoryPipelineState(
	const RenderPassDef::RenderGraphPassContext& ctx,
	RenderPassStateStorage& state
) {
	auto* presenter = ctx.presenter;
	PresentPipelineState& presentState = state.present;
	presentState.width = static_cast<i32>(presenter->offscreenCanvasSize.x);
	presentState.height = static_cast<i32>(presenter->offscreenCanvasSize.y);
	presentState.srcWidth = static_cast<i32>(presenter->offscreenCanvasSize.x);
	presentState.srcHeight = static_cast<i32>(presenter->offscreenCanvasSize.y);
	presentState.colorTex = currentFrameSourceTexture(ctx);
}

void writeGxGpuPipelineState(
	const RenderPassDef::RenderGraphPassContext& ctx,
	RenderPassStateStorage& state
) {
	GxGpuPipelineState& gxGpuState = state.gxGpu;
	gxGpuState.width = static_cast<i32>(ctx.presenter->offscreenCanvasSize.x);
	gxGpuState.height = static_cast<i32>(ctx.presenter->offscreenCanvasSize.y);
}

void writeAutoCRTPipelineState(
	const RenderPassDef::RenderGraphPassContext& ctx,
	RenderPassStateStorage& state
) {
	auto* presenter = ctx.presenter;
	CRTPipelineState& crtState = state.crt;
	crtState.width = static_cast<i32>(presenter->canvasSize.x);
	crtState.height = static_cast<i32>(presenter->canvasSize.y);
	crtState.srcWidth = static_cast<i32>(presenter->offscreenCanvasSize.x);
	crtState.srcHeight = static_cast<i32>(presenter->offscreenCanvasSize.y);
	crtState.time = static_cast<f32>(ctx.time);

	crtState.colorTex = presentedHistoryTexture(ctx);

	const bool applyCrt = presenter->crt_postprocessing_enabled;
	crtState.options.applyNoise = applyCrt && presenter->applyNoise;
	if (crtState.options.applyNoise) {
		crtState.noiseOffset = static_cast<f32>(fmix32(ctx.frameIndex) >> 8u) * kCrtNoiseOffsetScale;
	}
	crtState.options.noiseIntensity = presenter->noiseIntensity;
	crtState.options.applyColorBleed = applyCrt && presenter->applyColorBleed;
	crtState.options.colorBleed = presenter->colorBleed;
	crtState.options.applyScanlines = applyCrt && presenter->applyScanlines;
	crtState.options.applyBlur = applyCrt && presenter->applyBlur;
	crtState.options.blurIntensity = presenter->blurIntensity;
	crtState.options.applyGlow = applyCrt && presenter->applyGlow;
	crtState.options.glowColor = presenter->glowColor;
	crtState.options.applyFringing = applyCrt && presenter->applyFringing;
	crtState.options.applyAperture = applyCrt && presenter->applyAperture;
}

void writeDeviceQuantizePipelineState(
	const RenderPassDef::RenderGraphPassContext& ctx,
	RenderPassStateStorage& state
) {
	auto* presenter = ctx.presenter;
	DeviceQuantizePipelineState& deviceQuantizeState = state.deviceQuantize;
	const u64 configurationRevision = presenter->deviceQuantizeConfigurationRevision();
	if (deviceQuantizeState.configurationRevision != configurationRevision) {
		deviceQuantizeState.width = static_cast<i32>(presenter->offscreenCanvasSize.x);
		deviceQuantizeState.height = static_cast<i32>(presenter->offscreenCanvasSize.y);
		deviceQuantizeState.colorTex = ctx.getTexture(RenderPassDef::RenderGraphSlot::FrameColor);
		deviceQuantizeState.luts = &DEVICE_QUANTIZE_LUTS[
			static_cast<u32>(presenter->deviceQuantizeMode()) - static_cast<u32>(DeviceQuantizeMode::Rgb565)];
		deviceQuantizeState.configurationRevision = configurationRevision;
	}
}

} // namespace


bool shouldUpdatePresentationHistoryA(VideoPresenter* presenter, void*) {
	return presenter->commitPresentationFrame && presenter->presentationHistoryDestinationIndex() == 0u;
}

bool shouldUpdatePresentationHistoryB(VideoPresenter* presenter, void*) {
	return presenter->commitPresentationFrame && presenter->presentationHistoryDestinationIndex() == 1u;
}

void setPresentationHistoryGraph(RenderPassDef& desc, RenderPassDef::RenderGraphSlot historySlot) {
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->reads = { RenderPassDef::RenderGraphSlot::FrameColor, RenderPassDef::RenderGraphSlot::DeviceColor };
	desc.graph->writes = { historySlot };
	desc.graph->writeState = writePresentationHistoryPipelineState;
}

void setGxGpuGraph(RenderPassDef& desc) {
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor };
	desc.graph->writeState = writeGxGpuPipelineState;
}

void setAutoPresentGraph(RenderPassDef& desc) {
	RenderPassDef::RenderPassGraphDef& graph = resetAutoPresentGraph(desc);
	graph.writeState = writeAutoPresentPipelineState;
}

void setAutoCRTGraph(RenderPassDef& desc) {
	RenderPassDef::RenderPassGraphDef& graph = resetAutoPresentGraph(desc);
	graph.writeState = writeAutoCRTPipelineState;
}

void setDeviceQuantizeGraph(RenderPassDef& desc) {
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->reads = { RenderPassDef::RenderGraphSlot::FrameColor };
	desc.graph->writes = { RenderPassDef::RenderGraphSlot::DeviceColor };
	desc.graph->writeState = writeDeviceQuantizePipelineState;
}

bool shouldExecuteAutoPresentPass(VideoPresenter* presenter, void*) {
	return !presenter->crt_postprocessing_enabled
		|| (!presenter->applyNoise
			&& !presenter->applyColorBleed
			&& !presenter->applyScanlines
			&& !presenter->applyBlur
			&& !presenter->applyGlow
			&& !presenter->applyFringing
			&& !presenter->applyAperture);
}

bool shouldExecuteAutoCRTPass(VideoPresenter* presenter, void*) {
	return presenter->crt_postprocessing_enabled
		&& (presenter->applyNoise
			|| presenter->applyColorBleed
			|| presenter->applyScanlines
			|| presenter->applyBlur
			|| presenter->applyGlow
			|| presenter->applyFringing
			|| presenter->applyAperture);
}

bool shouldExecuteDeviceQuantizePass(VideoPresenter* presenter, void*) {
	return presenter->deviceQuantizeMode() != DeviceQuantizeMode::None;
}

void registerFrameResolvePass(RenderPassLibrary& registry) {
	RenderPassDef frameResolve;
	setSkippedStatePass(frameResolve, "frame_resolve", "FrameResolve");
	frameResolve.exec = noopRenderPass;
	registry.registerPass(frameResolve);
}

RenderPassLibrary::RenderPassLibrary(GPUBackend* backend, VideoPresenter* presenter)
	: m_backend(backend)
	, m_presenter(presenter)
{
	m_backend->registerBuiltinPasses(*this);
}

RenderPassLibrary::~RenderPassLibrary() {
	for (auto pass = m_passes.rbegin(); pass != m_passes.rend(); ++pass) {
		if (pass->teardown) {
			pass->teardown(m_backend, pass->context);
		}
	}
}


void RenderPassLibrary::registerPass(const RenderPassDef& desc) {
	const std::string& idStr = desc.id;
	if (m_registered.find(idStr) != m_registered.end()) {
		throw BMSX_RUNTIME_ERROR("Render pass '" + idStr + "' already registered");
	}

	RegisteredPassRec rec;
	rec.id = idStr;
	rec.exec = desc.exec;
	rec.context = desc.context;
	rec.bindingLayout = desc.bindingLayout;
	rec.present = desc.present;

	if (desc.bootstrap) {
		desc.bootstrap(m_backend, desc.context);
	}

	m_registered.emplace(idStr, std::move(rec));
	m_passes.push_back(desc);
}

bool RenderPassLibrary::has(const std::string& id) const {
	return m_registered.find(id) != m_registered.end();
}

void RenderPassLibrary::execute(
	const std::string& id,
	void* fbo,
	const GxGpuDeviceOutput& output
) {
	auto it = m_registered.find(id);
	if (it == m_registered.end()) {
		throw BMSX_RUNTIME_ERROR("Render pass '" + id + "' not found");
	}

	auto& rec = it->second;
	if (rec.exec) rec.exec(m_backend, m_presenter, fbo, rec.state, rec.context, output);
}

void RenderPassLibrary::writeGraphState(
	const std::string& id,
	const RenderPassDef::RenderGraphPassContext& ctx,
	void (*writeState)(const RenderGraphPassContext&, RenderPassStateStorage&)
) {
	auto it = m_registered.find(id);
	if (it == m_registered.end()) {
		throw BMSX_RUNTIME_ERROR("Render pass '" + id + "' not found");
	}
	writeState(ctx, it->second.state);
}

i32 RenderPassLibrary::findPipelinePassIndex(const std::string& id) const {
	for (size_t i = 0; i < m_passes.size(); ++i) {
		if (m_passes[i].id == id) {
			return static_cast<i32>(i);
		}
	}
	return -1;
}

void RenderPassLibrary::setPassEnabled(const std::string& id, bool enabled) {
	m_passEnabled[id] = enabled;
}

bool RenderPassLibrary::isPassEnabled(const std::string& id) const {
	auto it = m_passEnabled.find(id);
	return it == m_passEnabled.end() || it->second;
}

std::unique_ptr<RenderGraphRuntime> RenderPassLibrary::buildRenderGraph() {
	VideoPresenter* presenter = m_presenter;
	auto rg = std::make_unique<RenderGraphRuntime>(m_backend);
	std::vector<const RenderPassDef*> passList;
	passList.reserve(m_passes.size());
	for (const auto& desc : m_passes) {
		if (desc.graph && desc.graph->skip) continue;
		passList.push_back(&desc);
	}
	const bool deviceColorEnabled = std::any_of(passList.begin(), passList.end(),
		[](const RenderPassDef* pass) {
			if (!pass->graph) return false;
			const auto& writes = pass->graph->writes;
			return std::find(writes.begin(), writes.end(), RenderGraphSlot::DeviceColor) != writes.end();
		});

	{
		RenderGraphPass pass;
		pass.name = "FrameTargets";
		pass.kind = RenderGraphPass::Kind::FrameTargets;
		pass.presenter = presenter;
		pass.deviceColorEnabled = deviceColorEnabled;
		rg->addPass(pass);
	}

	{
		RenderGraphPass pass;
		pass.name = "FrameClear";
		pass.alwaysExecute = true;
		pass.kind = RenderGraphPass::Kind::FrameClear;
		pass.presenter = presenter;
		rg->addPass(pass);
	}

	{
		RenderGraphPass pass;
		pass.name = "FrameResolve";
		pass.alwaysExecute = true;
		pass.kind = RenderGraphPass::Kind::FrameResolve;
		pass.registry = this;
		rg->addPass(pass);
	}

	for (const auto* descPtr : passList) {
		const auto& desc = *descPtr;
		RenderGraphPass pass;
		pass.name = desc.name;
		pass.alwaysExecute = desc.stateOnly;
		pass.kind = RenderGraphPass::Kind::Registered;
		pass.registry = this;
		pass.presenter = presenter;
		pass.passId = desc.id;
		pass.passContext = desc.context;
		pass.shouldExecute = desc.shouldExecute;
		pass.deviceColorEnabled = deviceColorEnabled;
		pass.isPresent = desc.present;
		pass.isStateOnly = desc.stateOnly;
		pass.writesDepth = desc.writesDepth;
		pass.depthTest = desc.depthTest;
		if (desc.graph) {
			pass.reads = desc.graph->reads;
			pass.writes = desc.graph->writes;
			pass.presentInput = desc.graph->presentInput;
			pass.writeState = desc.graph->writeState;
		}
		rg->addPass(pass);
	}

	return rg;
}} // namespace bmsx
