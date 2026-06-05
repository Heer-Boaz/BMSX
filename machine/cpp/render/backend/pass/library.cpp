/*
 * library.cpp - Render pass library implementation
 */

// TODO: TOTAAL ANDERS DAN `library.ts`!!

#include "library.h"
#include "common/primitives.h"
#include "../../gameview.h"
#include "../../vdp/framebuffer.h"
#include "../../graph/graph.h"
#include "machine/runtime/runtime.h"
#include <algorithm>
#include <stdexcept>
#include <cstddef>
#include <memory>
#include <vector>

namespace bmsx {

void writeRenderPassViewportSize(i32& width, i32& height, i32& baseWidth, i32& baseHeight, const GameView& view) {
	width = static_cast<i32>(view.offscreenCanvasSize.x);
	height = static_cast<i32>(view.offscreenCanvasSize.y);
	baseWidth = static_cast<i32>(view.viewportSize.x);
	baseHeight = static_cast<i32>(view.viewportSize.y);
}

namespace {

void noopRenderPass(GPUBackend*, GameView*, void*, RenderPassStateStorage&, void*) {
}

void setSkippedStatePass(RenderPassDef& desc, const char* id, const char* name) {
	desc.id = id;
	desc.name = name;
	desc.stateOnly = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->skip = true;
}

void writeAutoPresentPipelineState(PresentPipelineState& presentState, const RenderPassDef::RenderGraphPassContext& ctx,
													RenderPassDef::RenderPassGraphDef::PresentInput presentInput) {
	auto* view = ctx.view;
	presentState.width = static_cast<i32>(view->canvasSize.x);
	presentState.height = static_cast<i32>(view->canvasSize.y);
	presentState.srcWidth = static_cast<i32>(view->offscreenCanvasSize.x);
	presentState.srcHeight = static_cast<i32>(view->offscreenCanvasSize.y);

	const bool allowDevice = presentInput == RenderPassDef::RenderPassGraphDef::PresentInput::Auto
		|| presentInput == RenderPassDef::RenderPassGraphDef::PresentInput::DeviceColor;
	const bool useDither = allowDevice && ctx.deviceColorEnabled && static_cast<i32>(view->dither_type) != 0;
	presentState.colorTex = useDither
		? ctx.getTexture(RenderPassDef::RenderGraphSlot::DeviceColor)
		: ctx.getTexture(RenderPassDef::RenderGraphSlot::FrameColor);
}

void writeAutoPresentPipelineState(const RenderPassDef::RenderGraphPassContext& ctx, RenderPassStateStorage& state) {
	writeAutoPresentPipelineState(
		state.present,
		ctx,
		RenderPassDef::RenderPassGraphDef::PresentInput::Auto);
}

void writeAutoCRTPipelineState(CRTPipelineState& crtState, const RenderPassDef::RenderGraphPassContext& ctx,
													RenderPassDef::RenderPassGraphDef::PresentInput presentInput) {
	auto* view = ctx.view;
	crtState.width = static_cast<i32>(view->canvasSize.x);
	crtState.height = static_cast<i32>(view->canvasSize.y);
	crtState.baseWidth = static_cast<i32>(view->viewportSize.x);
	crtState.baseHeight = static_cast<i32>(view->viewportSize.y);
	crtState.srcWidth = static_cast<i32>(view->offscreenCanvasSize.x);
	crtState.srcHeight = static_cast<i32>(view->offscreenCanvasSize.y);
	crtState.time = static_cast<f32>(ctx.time);

	const bool allowDevice = presentInput == RenderPassDef::RenderPassGraphDef::PresentInput::Auto
		|| presentInput == RenderPassDef::RenderPassGraphDef::PresentInput::DeviceColor;
	const bool useDither = allowDevice && ctx.deviceColorEnabled && static_cast<i32>(view->dither_type) != 0;
	TextureHandle baseTex = ctx.getTexture(RenderPassDef::RenderGraphSlot::FrameColor);
	TextureHandle deviceTex = nullptr;
	if (ctx.deviceColorEnabled) {
		deviceTex = ctx.getTexture(RenderPassDef::RenderGraphSlot::DeviceColor);
	}
	crtState.colorTex = useDither ? deviceTex : baseTex;

	const bool applyCrt = view->crt_postprocessing_enabled;
	crtState.options.applyNoise = applyCrt && view->applyNoise;
	crtState.options.noiseIntensity = view->noiseIntensity;
	crtState.options.applyColorBleed = applyCrt && view->applyColorBleed;
	crtState.options.colorBleed = view->colorBleed;
	crtState.options.applyScanlines = applyCrt && view->applyScanlines;
	crtState.options.applyBlur = applyCrt && view->applyBlur;
	crtState.options.blurIntensity = view->blurIntensity;
	crtState.options.applyGlow = applyCrt && view->applyGlow;
	crtState.options.glowColor = view->glowColor;
	crtState.options.applyFringing = applyCrt && view->applyFringing;
	crtState.options.applyAperture = applyCrt && view->applyAperture;
}

void writeAutoCRTPipelineState(const RenderPassDef::RenderGraphPassContext& ctx, RenderPassStateStorage& state) {
	writeAutoCRTPipelineState(
		state.crt,
		ctx,
		RenderPassDef::RenderPassGraphDef::PresentInput::Auto);
}

bool hasEnabledCRTEffects(const GameView& view) {
	return view.crt_postprocessing_enabled
		&& (view.applyNoise
			|| view.applyColorBleed
			|| view.applyScanlines
			|| view.applyBlur
			|| view.applyGlow
			|| view.applyFringing
			|| view.applyAperture);
}

} // namespace

void setAutoPresentGraph(RenderPassDef& desc) {
	desc.present = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
	desc.graph->writeState = writeAutoPresentPipelineState;
}

void setAutoCRTGraph(RenderPassDef& desc) {
	desc.present = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
	desc.graph->writeState = writeAutoCRTPipelineState;
}

bool shouldExecuteAutoPresentPass(GameView* view, void*) {
	return !hasEnabledCRTEffects(*view);
}

bool shouldExecuteAutoCRTPass(GameView* view, void*) {
	return hasEnabledCRTEffects(*view);
}

void registerFrameStatePasses(RenderPassLibrary& registry) {
	RenderPassDef frameResolve;
	setSkippedStatePass(frameResolve, "frame_resolve", "FrameResolve");
	frameResolve.exec = noopRenderPass;
	registry.registerPass(frameResolve);

	RenderPassDef frameShared;
	setSkippedStatePass(frameShared, "frame_shared", "FrameShared");
	frameShared.exec = noopRenderPass;
	registry.registerPass(frameShared);
}
RenderPassLibrary::RenderPassLibrary(GPUBackend* backend, GameView* view)
	: m_backend(backend)
	, m_view(view)
{
	m_backend->registerBuiltinPasses(*this);
}

RenderPassLibrary::~RenderPassLibrary() = default;


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

void RenderPassLibrary::execute(const std::string& id, void* fbo) {
	auto it = m_registered.find(id);
	if (it == m_registered.end()) {
		throw BMSX_RUNTIME_ERROR("Render pass '" + id + "' not found");
	}

	auto& rec = it->second;
	if (rec.exec) rec.exec(m_backend, m_view, fbo, rec.state, rec.context);
}

void RenderPassLibrary::writeGraphState(const std::string& id, const RenderPassDef::RenderGraphPassContext& ctx, void (*writeState)(const RenderGraphPassContext&, RenderPassStateStorage&)) {
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

std::unique_ptr<RenderGraphRuntime> RenderPassLibrary::buildRenderGraph(GameView* view, LightingSystem& lightingSystem) {
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
		pass.view = view;
		pass.deviceColorEnabled = deviceColorEnabled;
		rg->addPass(pass);
	}

	{
		RenderGraphPass pass;
		pass.name = "FrameClear";
		pass.alwaysExecute = true;
		pass.kind = RenderGraphPass::Kind::FrameClear;
		pass.view = view;
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

	{
		RenderGraphPass pass;
		pass.name = "FrameSharedState";
		pass.alwaysExecute = true;
		pass.kind = RenderGraphPass::Kind::FrameShared;
		pass.registry = this;
		pass.view = view;
		pass.lightingSystem = &lightingSystem;
		rg->addPass(pass);
	}

	for (const auto* descPtr : passList) {
		const auto& desc = *descPtr;
		RenderGraphPass pass;
		pass.name = desc.name;
		pass.alwaysExecute = desc.stateOnly;
		pass.kind = RenderGraphPass::Kind::Registered;
		pass.registry = this;
		pass.view = view;
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
