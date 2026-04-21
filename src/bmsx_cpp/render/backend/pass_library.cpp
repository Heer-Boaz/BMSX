/*
 * pass_library.cpp - Render pass library implementation
 */

#include "pass_library.h"
#include "../gameview.h"
#if BMSX_ENABLE_GLES2
#include "../post/crt_pipeline_gles2.h"
#endif
#include "../graph/graph.h"
#include "core/engine.h"
#include "../../machine/runtime/runtime.h"
#include "rompack/format.h"
#include <algorithm>
#include <stdexcept>

namespace bmsx {

namespace {

CRTPipelineState buildCRTPipelineState(const RenderPassDef::RenderGraphPassContext& ctx,
										RenderPassDef::RenderPassGraphDef::PresentInput presentInput) {
	auto* view = ctx.view;
	CRTPipelineState crtState;
	crtState.width = static_cast<i32>(view->canvasSize.x);
	crtState.height = static_cast<i32>(view->canvasSize.y);
	crtState.baseWidth = static_cast<i32>(view->viewportSize.x);
	crtState.baseHeight = static_cast<i32>(view->viewportSize.y);
	crtState.srcWidth = static_cast<i32>(view->offscreenCanvasSize.x);
	crtState.srcHeight = static_cast<i32>(view->offscreenCanvasSize.y);

	const bool allowDevice = presentInput == RenderPassDef::RenderPassGraphDef::PresentInput::Auto
		|| presentInput == RenderPassDef::RenderPassGraphDef::PresentInput::DeviceColor;
	const bool useDither = allowDevice && ctx.deviceColorEnabled && static_cast<i32>(view->dither_type) != 0;
		TextureHandle baseTex = ctx.getTexture(RenderPassDef::RenderGraphSlot::FrameColor);
		TextureHandle deviceTex = nullptr;
		if (ctx.deviceColorEnabled) {
			deviceTex = ctx.getTexture(RenderPassDef::RenderGraphSlot::DeviceColor);
		}
	crtState.colorTex = useDither ? deviceTex : baseTex;

	if (view->crt_postprocessing_enabled) {
		crtState.options.applyNoise = view->applyNoise;
		crtState.options.noiseIntensity = view->noiseIntensity;
		crtState.options.applyColorBleed = view->applyColorBleed;
		crtState.options.colorBleed = view->colorBleed;
		crtState.options.applyScanlines = view->applyScanlines;
		crtState.options.applyBlur = view->applyBlur;
		crtState.options.blurIntensity = view->blurIntensity;
		crtState.options.applyGlow = view->applyGlow;
		crtState.options.glowColor = view->glowColor;
		crtState.options.applyFringing = view->applyFringing;
		crtState.options.applyAperture = view->applyAperture;
	} else {
		crtState.options.applyNoise = false;
		crtState.options.applyColorBleed = false;
		crtState.options.applyScanlines = false;
		crtState.options.applyBlur = false;
		crtState.options.applyGlow = false;
		crtState.options.applyFringing = false;
		crtState.options.applyAperture = false;
		crtState.options.noiseIntensity = view->noiseIntensity;
		crtState.options.colorBleed = view->colorBleed;
		crtState.options.blurIntensity = view->blurIntensity;
		crtState.options.glowColor = view->glowColor;
	}

	return crtState;
}

} // namespace

RenderPassLibrary::RenderPassLibrary(GPUBackend* backend)
	: m_backend(backend)
{
}

RenderPassLibrary::~RenderPassLibrary() = default;

void RenderPassLibrary::registerBuiltin() {
	switch (m_backend->type()) {
		case BackendType::Software:
			registerBuiltinPassesSoftware();
			break;
		case BackendType::OpenGLES2:
#if BMSX_ENABLE_GLES2
			registerBuiltinPassesOpenGLES2();
#else
			throw BMSX_RUNTIME_ERROR("[RenderPassLibrary] OpenGLES2 backend disabled at compile time.");
#endif
			break;
		case BackendType::Headless:
			// Minimal headless passes
			break;
	}
}

void RenderPassLibrary::registerBuiltinPassesSoftware() {
	// FrameResolve: per-frame state setup
	{
		RenderPassDef desc;
		desc.id = "frame_resolve";
		desc.name = "FrameResolve";
		desc.stateOnly = true;
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->skip = true;
		desc.exec = [](GPUBackend*, void*, std::any&) { /* state only */ };
		desc.prepare = [](GPUBackend*, std::any&) {
			// Upload minimal frame-shared values
			// TODO: updateAndBindFrameUniforms equivalent
		};
		registerPass(desc);
	}

	// FrameShared: aggregated frame state
	{
		RenderPassDef desc;
		desc.id = "frame_shared";
		desc.name = "FrameShared";
		desc.stateOnly = true;
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->skip = true;
		desc.exec = [](GPUBackend*, void*, std::any&) { /* populated per frame */ };
		registerPass(desc);
	}

	{
		RenderPassDef desc;
		desc.id = "framebuffer_2d";
		desc.name = "Framebuffer2D";
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor };
		desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
			auto* view = ctx.view;
			Framebuffer2DPipelineState state;
			state.width = static_cast<i32>(view->offscreenCanvasSize.x);
			state.height = static_cast<i32>(view->offscreenCanvasSize.y);
			state.baseWidth = static_cast<i32>(view->viewportSize.x);
			state.baseHeight = static_cast<i32>(view->viewportSize.y);
			state.colorTex = view->textures.at(FRAMEBUFFER_TEXTURE_KEY);
			return state;
		};
		desc.exec = [](GPUBackend* backend, void*, std::any& state) {
			auto& fbState = std::any_cast<Framebuffer2DPipelineState&>(state);
			auto* softBackend = static_cast<SoftwareBackend*>(backend);
			softBackend->blitTexture(fbState.colorTex,
				0,
				0,
				fbState.baseWidth,
				fbState.baseHeight,
				0,
				0,
				fbState.width,
				fbState.height,
				0.0f,
				Color{1.0f, 1.0f, 1.0f, 1.0f},
				false,
				false,
				DitherParams{},
				false);
		};
		registerPass(desc);
	}

	// Present pass (software: direct blit)
	{
		RenderPassDef desc;
		desc.id = "present";
		desc.name = "Present";
		desc.present = true;
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
		desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
			return buildCRTPipelineState(ctx, RenderPassDef::RenderPassGraphDef::PresentInput::Auto);
		};
		desc.exec = [](GPUBackend* backend, void*, std::any& state) {
			auto& crtState = std::any_cast<CRTPipelineState&>(state);
			auto* view = EngineCore::instance().view();
			auto* colorTex = static_cast<SoftwareTexture*>(crtState.colorTex);
			auto* softBackend = static_cast<SoftwareBackend*>(backend);
			view->applyCRTPostProcessing(colorTex->data.data(),
											colorTex->width,
											colorTex->height,
											softBackend->framebuffer(),
											softBackend->width(),
											softBackend->height(),
											softBackend->pitch());
		};
		desc.prepare = [](GPUBackend*, std::any&) {};
		registerPass(desc);
	}
}

void RenderPassLibrary::registerBuiltinPassesOpenGLES2() {
#if !BMSX_ENABLE_GLES2
	throw BMSX_RUNTIME_ERROR("[RenderPassLibrary] OpenGLES2 backend disabled at compile time.");
#else
	// FrameResolve: per-frame state setup
	{
		RenderPassDef desc;
		desc.id = "frame_resolve";
		desc.name = "FrameResolve";
		desc.stateOnly = true;
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->skip = true;
		desc.exec = [](GPUBackend*, void*, std::any&) { };
		desc.prepare = [](GPUBackend*, std::any&) { };
		registerPass(desc);
	}

	// FrameShared: aggregated frame state
	{
		RenderPassDef desc;
		desc.id = "frame_shared";
		desc.name = "FrameShared";
		desc.stateOnly = true;
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->skip = true;
		desc.exec = [](GPUBackend*, void*, std::any&) { };
		registerPass(desc);
	}

	{
		RenderPassDef desc;
		desc.id = "framebuffer_2d";
		desc.name = "Framebuffer2D";
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor };
		desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
			auto* view = ctx.view;
			Framebuffer2DPipelineState state;
			state.width = static_cast<i32>(view->offscreenCanvasSize.x);
			state.height = static_cast<i32>(view->offscreenCanvasSize.y);
			state.baseWidth = static_cast<i32>(view->viewportSize.x);
			state.baseHeight = static_cast<i32>(view->viewportSize.y);
			state.colorTex = view->textures.at(FRAMEBUFFER_TEXTURE_KEY);
			return state;
		};
		desc.bootstrap = [](GPUBackend* backend) {
			CRTPipeline::initPresentGLES2(static_cast<OpenGLES2Backend*>(backend));
		};
		desc.exec = [](GPUBackend* backend, void*, std::any& state) {
			auto& engine = EngineCore::instance();
			auto& fbState = std::any_cast<Framebuffer2DPipelineState&>(state);
			CRTPipeline::renderPresentToCurrentTargetGLES2(static_cast<OpenGLES2Backend*>(backend), engine.view(), fbState);
		};
		registerPass(desc);
	}

	// Device quantize/dither pass (GLES2)
	{
		RenderPassDef desc;
		desc.id = "device_quantize";
		desc.name = "DeviceQuantize";
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->reads = { RenderPassDef::RenderGraphSlot::FrameColor };
		desc.graph->writes = { RenderPassDef::RenderGraphSlot::DeviceColor };
		desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
			auto* view = ctx.view;
			DeviceQuantizePipelineState deviceState;
			deviceState.width = static_cast<i32>(view->offscreenCanvasSize.x);
			deviceState.height = static_cast<i32>(view->offscreenCanvasSize.y);
			deviceState.baseWidth = static_cast<i32>(view->viewportSize.x);
			deviceState.baseHeight = static_cast<i32>(view->viewportSize.y);
			deviceState.colorTex = ctx.getTexture(RenderPassDef::RenderGraphSlot::FrameColor);
			deviceState.ditherType = static_cast<i32>(view->dither_type);
			return deviceState;
		};
		desc.bootstrap = [](GPUBackend* backend) {
			CRTPipeline::initDeviceQuantizeGLES2(static_cast<OpenGLES2Backend*>(backend));
		};
		desc.exec = [](GPUBackend* backend, void* fbo, std::any& state) {
			(void)fbo;
			auto& engine = EngineCore::instance();
			auto& deviceState = std::any_cast<DeviceQuantizePipelineState&>(state);
			CRTPipeline::renderDeviceQuantizeGLES2(static_cast<OpenGLES2Backend*>(backend), engine.view(), deviceState);
		};
		desc.shouldExecute = []() {
			const auto* view = EngineCore::instance().view();
			return static_cast<i32>(view->dither_type) != 0;
		};
		desc.prepare = [](GPUBackend*, std::any&) { };
		registerPass(desc);
	}

	// Present pass (GLES2, no CRT)
	{
		RenderPassDef desc;
		desc.id = "present";
		desc.name = "Present";
		desc.present = true;
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
		desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
			return buildCRTPipelineState(ctx, RenderPassDef::RenderPassGraphDef::PresentInput::Auto);
		};
		desc.exec = [](GPUBackend* backend, void*, std::any& state) {
			auto& engine = EngineCore::instance();
			auto& crtState = std::any_cast<CRTPipelineState&>(state);
			CRTPipeline::renderPresentGLES2(static_cast<OpenGLES2Backend*>(backend), engine.view(), crtState);
		};
		desc.shouldExecute = []() {
			const auto* view = EngineCore::instance().view();
			return !view->crt_postprocessing_enabled;
		};
		desc.prepare = [](GPUBackend*, std::any&) { };
		registerPass(desc);
	}

	// CRT post-processing / present pass (GLES2)
	{
		RenderPassDef desc;
		desc.id = "crt";
		desc.name = "Present/CRT";
		desc.present = true;
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->presentInput = RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
		desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
			return buildCRTPipelineState(ctx, RenderPassDef::RenderPassGraphDef::PresentInput::Auto);
		};
		desc.bootstrap = [](GPUBackend* backend) {
			CRTPipeline::initGLES2(static_cast<OpenGLES2Backend*>(backend));
		};
		desc.exec = [](GPUBackend* backend, void*, std::any& state) {
			auto& engine = EngineCore::instance();
			auto& crtState = std::any_cast<CRTPipelineState&>(state);
			CRTPipeline::renderCRTGLES2(static_cast<OpenGLES2Backend*>(backend), engine.view(), crtState);
		};
		desc.shouldExecute = []() {
			const auto* view = EngineCore::instance().view();
			return view->crt_postprocessing_enabled;
		};
		desc.prepare = [](GPUBackend*, std::any&) { };
		registerPass(desc);
	}
#endif
}

void RenderPassLibrary::registerPass(const RenderPassDef& desc) {
	const std::string& idStr = desc.id;
	if (m_registered.find(idStr) != m_registered.end()) {
		throw BMSX_RUNTIME_ERROR("Pipeline '" + idStr + "' already registered");
	}

	RegisteredPassRec rec;
	rec.id = idStr;
	rec.exec = desc.exec;
	rec.prepare = desc.prepare;
	rec.bindingLayout = desc.bindingLayout;
	rec.present = desc.present;

	// Bootstrap if needed
	if (desc.bootstrap) {
		desc.bootstrap(m_backend);
	}

	m_registered[idStr] = rec;
	m_passes.push_back(desc);
}

bool RenderPassLibrary::has(const std::string& id) const {
	return m_registered.find(id) != m_registered.end();
}

void RenderPassLibrary::execute(const std::string& id, void* fbo) {
	auto it = m_registered.find(id);
	if (it == m_registered.end()) {
		throw BMSX_RUNTIME_ERROR("Pipeline '" + id + "' not found");
	}

	auto& rec = it->second;

	// Prepare state
	if (rec.prepare) {
		rec.prepare(m_backend, rec.state);
	}

	// Execute
	if (rec.exec) {
		rec.exec(m_backend, fbo, rec.state);
	}
}

void RenderPassLibrary::appendPipelinePass(const RenderPassDef& pass) {
	registerPass(pass);
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

RenderPassToken RenderPassLibrary::createPassToken(const std::string& id, bool initialEnabled) {
	auto existingIt = m_tokensById.find(id);
	if (existingIt != m_tokensById.end()) {
		return existingIt->second;
	}

	setPassEnabled(id, initialEnabled);

	RenderPassToken token;
	token.id = id;
	token.enable = [this, id]() { setPassEnabled(id, true); };
	token.disable = [this, id]() { setPassEnabled(id, false); };
	token.set = [this, id](bool enabled) { setPassEnabled(id, enabled); };
	token.isEnabled = [this, id]() { return isPassEnabled(id); };

	m_tokensById[id] = token;
	return token;
}

std::unique_ptr<RenderGraphRuntime> RenderPassLibrary::buildRenderGraph(GameView* view, LightingSystem* lightingSystem) {
	(void)lightingSystem; // TODO: Use for lighting state

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
			return std::find(writes.begin(), writes.end(), RenderPassDef::RenderGraphSlot::DeviceColor) != writes.end();
		});
	struct GraphHandles {
		RenderGraphTexHandle color = -1;
		RenderGraphTexHandle depth = -1;
		RenderGraphTexHandle device = -1;
	};
	auto handles = std::make_shared<GraphHandles>();

	// Frame root pass: allocate the working targets and export the working color target.
	{
		RenderGraphPass pass;
		pass.name = "FrameTargets";
		pass.setup = [view, handles, deviceColorEnabled](RenderGraphIO& io, FrameData*) -> std::any {
			TexDesc colorDesc;
			colorDesc.width = static_cast<i32>(view->offscreenCanvasSize.x);
			colorDesc.height = static_cast<i32>(view->offscreenCanvasSize.y);
			colorDesc.name = "FrameColor";

			TexDesc depthDesc;
			depthDesc.width = static_cast<i32>(view->offscreenCanvasSize.x);
			depthDesc.height = static_cast<i32>(view->offscreenCanvasSize.y);
			depthDesc.name = "FrameDepth";
			depthDesc.depth = true;

			handles->color = io.createTex(colorDesc);
			handles->depth = io.createTex(depthDesc);
			if (deviceColorEnabled) {
				TexDesc deviceDesc;
				deviceDesc.width = static_cast<i32>(view->offscreenCanvasSize.x);
				deviceDesc.height = static_cast<i32>(view->offscreenCanvasSize.y);
				deviceDesc.name = "DeviceColor";
				deviceDesc.transient = true;
				handles->device = io.createTex(deviceDesc);
			}
			io.exportToBackbuffer(handles->color);
			return std::any{};
		};
		pass.execute = [](RenderGraphContext&, FrameData*, const std::any&) {};
		rg->addPass(pass);
	}

	{
		RenderGraphPass pass;
		pass.name = "FrameClear";
		pass.alwaysExecute = true;
		pass.setup = [handles](RenderGraphIO& io, FrameData*) -> std::any {
			io.writeTex(handles->color);
			io.writeTex(handles->depth);
			return std::any{};
		};
		pass.execute = [view, handles](RenderGraphContext& ctx, FrameData*, const std::any&) {
			RenderPassDesc clearDesc;
			ColorAttachmentSpec colorSpec;
			colorSpec.tex = ctx.getTexture(handles->color);
			colorSpec.clear = Color{ 0.0f, 0.0f, 0.0f, 1.0f };
			clearDesc.color = colorSpec;
			DepthAttachmentSpec depthSpec;
			depthSpec.tex = ctx.getTexture(handles->depth);
			depthSpec.clearDepth = 1.0f;
			clearDesc.depth = depthSpec;
			auto clearPass = view->backend()->beginRenderPass(clearDesc);
			view->backend()->endRenderPass(clearPass);
		};
		rg->addPass(pass);
	}

	// Frame resolve pass
	{
		RenderGraphPass pass;
		pass.name = "FrameResolve";
		pass.alwaysExecute = true;
		pass.setup = [handles](RenderGraphIO& io, FrameData*) -> std::any {
			io.writeTex(handles->color);
			return std::any{};
		};
		pass.execute = [this](RenderGraphContext&, FrameData*, const std::any&) {
			execute("frame_resolve", nullptr);
		};
		rg->addPass(pass);
	}

	// Frame shared state pass
	{
		RenderGraphPass pass;
		pass.name = "FrameSharedState";
		pass.alwaysExecute = true;
		pass.setup = [handles](RenderGraphIO& io, FrameData*) -> std::any {
			io.writeTex(handles->color);
			return std::any{};
		};
		pass.execute = [this, view](RenderGraphContext&, FrameData* frame, const std::any&) {
			FrameSharedState frameShared;
			// TODO: Fill from camera and lighting
			frameShared.fog.fogD50 = view->atmosphere.fogD50;
			frameShared.fog.fogStart = view->atmosphere.fogStart;
			frameShared.fog.fogColorLow = view->atmosphere.fogColorLow;
			frameShared.fog.fogColorHigh = view->atmosphere.fogColorHigh;
			frameShared.fog.fogYMin = view->atmosphere.fogYMin;
			frameShared.fog.fogYMax = view->atmosphere.fogYMax;

			setState("frame_shared", frameShared);
			(void)frame;
		};
		rg->addPass(pass);
	}

	// Add registered passes
	for (const auto* descPtr : passList) {
		const auto& desc = *descPtr;
		RenderGraphPass pass;
		pass.name = desc.name;
		pass.alwaysExecute = desc.stateOnly;

		const std::string passId = desc.id;
		const bool isPresent = desc.present;
		const bool isStateOnly = desc.stateOnly;
		const bool writesDepth = desc.writesDepth;
		const bool depthTest = desc.depthTest;
		const auto shouldExecute = desc.shouldExecute;

			const RenderPassDef::RenderPassGraphDef* graph = nullptr;
			if (desc.graph) {
				graph = &desc.graph.value();
			}
		auto getHandle = [handles](RenderPassDef::RenderGraphSlot slot) -> RenderGraphTexHandle {
			if (slot == RenderPassDef::RenderGraphSlot::FrameColor) return handles->color;
			if (slot == RenderPassDef::RenderGraphSlot::FrameDepth) return handles->depth;
			if (slot == RenderPassDef::RenderGraphSlot::FrameHistoryA) return -1;
			if (slot == RenderPassDef::RenderGraphSlot::FrameHistoryB) return -1;
			return handles->device;
		};

		pass.setup = [handles, isPresent, isStateOnly, writesDepth, depthTest, graph, deviceColorEnabled, getHandle](RenderGraphIO& io, FrameData*) -> std::any {
			if (isPresent) {
				const auto presentInput = graph ? graph->presentInput : RenderPassDef::RenderPassGraphDef::PresentInput::Auto;
				io.readTex(handles->color);
				if (deviceColorEnabled && presentInput != RenderPassDef::RenderPassGraphDef::PresentInput::FrameColor) {
					io.readTex(handles->device);
				}
			} else if (graph && (!graph->reads.empty() || !graph->writes.empty())) {
				for (const auto& slot : graph->reads) io.readTex(getHandle(slot));
				for (const auto& slot : graph->writes) io.writeTex(getHandle(slot));
			} else if (!isPresent && !isStateOnly) {
				io.writeTex(handles->color);
				if (writesDepth) io.writeTex(handles->depth);
				else if (depthTest) io.readTex(handles->depth);
			}
			return std::any{};
		};

		pass.execute = [this, view, handles, passId, isPresent, isStateOnly, writesDepth, depthTest, shouldExecute,
						graph, deviceColorEnabled, getHandle](RenderGraphContext& ctx, FrameData*, const std::any&) {
			if (!isPassEnabled(passId)) return;
			if (shouldExecute && !shouldExecute()) return;

			if (graph && graph->buildState) {
				RenderPassDef::RenderGraphPassContext passCtx;
				passCtx.view = view;
				passCtx.deviceColorEnabled = deviceColorEnabled;
				passCtx.getTexture = [&ctx, getHandle](RenderPassDef::RenderGraphSlot slot) -> TextureHandle {
					return ctx.getTexture(getHandle(slot));
				};
				std::any builtState = graph->buildState(passCtx);
				setState(passId, builtState);
			}

			if (isPresent) {
				execute(passId, nullptr);
				return;
			}
			if (isStateOnly) {
				execute(passId, nullptr);
				return;
			}

			RenderGraphTexHandle colorHandle = handles->color;
			RenderGraphTexHandle depthHandle = (writesDepth || depthTest) ? handles->depth : -1;
			if (graph && !graph->writes.empty()) {
				colorHandle = -1;
				depthHandle = -1;
				for (const auto& slot : graph->writes) {
					if (slot == RenderPassDef::RenderGraphSlot::FrameDepth) depthHandle = handles->depth;
					else colorHandle = getHandle(slot);
				}
			}
			execute(passId, ctx.getFBO(colorHandle, depthHandle));
		};
		rg->addPass(pass);
	}

	return rg;
}

void RenderPassLibrary::validatePassResources(const std::string& passId) {
	auto idx = findPipelinePassIndex(passId);
	if (idx < 0) return;

	// TODO: Validate binding layout vs available resources
}

} // namespace bmsx
