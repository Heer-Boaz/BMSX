/*
 * renderpasslib.cpp - Render pass library implementation
 *
 * Mirrors TypeScript renderpasslib.ts
 */

#include "renderpasslib.h"
#include "gameview.h"
#include "sprites_pipeline.h"
#if BMSX_ENABLE_GLES2
#include "sprites_pipeline_gles2.h"
#include "crt_pipeline_gles2.h"
#endif
#include "rendergraph.h"
#include "../core/engine.h"
#include "../core/rompack.h"
#include <stdexcept>

namespace bmsx {

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
			throw std::runtime_error("[RenderPassLibrary] OpenGLES2 backend disabled at compile time.");
#endif
			break;
		case BackendType::WebGL2:
			// TODO: WebGL2 passes
			break;
		case BackendType::WebGPU:
			// TODO: WebGPU passes
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
		desc.exec = [](GPUBackend*, void*, std::any&) { /* populated per frame */ };
		registerPass(desc);
	}

	// Sprites pass
	{
		RenderPassDef desc;
		desc.id = "sprites";
		desc.name = "Sprites2D";
		desc.writesDepth = true;
		desc.shouldExecute = []() { return true; };
		desc.exec = [](GPUBackend* backend, void* fbo, std::any&) {
			(void)fbo;
			auto& engine = EngineCore::instance();
			auto* view = engine.view();
			SpritesPipeline::renderSpriteBatch(backend, view);
		};
		desc.prepare = [](GPUBackend*, std::any& state) {
			auto& engine = EngineCore::instance();
			auto* gv = engine.view();

			SpritesPipelineState spriteState;
			spriteState.width = static_cast<i32>(gv->offscreenCanvasSize.x);
			spriteState.height = static_cast<i32>(gv->offscreenCanvasSize.y);
			spriteState.baseWidth = static_cast<i32>(gv->viewportSize.x);
			spriteState.baseHeight = static_cast<i32>(gv->viewportSize.y);

			// Atlas textures
			auto atlasIt = gv->textures.find("_atlas_primary");
			if (atlasIt == gv->textures.end()) {
				throw std::runtime_error("[SpritesPipeline] Texture '_atlas_primary' missing from view textures.");
			}
			spriteState.atlasPrimaryTex = atlasIt->second;
			auto secondaryIt = gv->textures.find("_atlas_secondary");
			if (secondaryIt != gv->textures.end()) {
				spriteState.atlasSecondaryTex = secondaryIt->second;
			}
			auto engineIt = gv->textures.find("_atlas_engine");
			if (engineIt != gv->textures.end()) {
				spriteState.atlasEngineTex = engineIt->second;
			}

			spriteState.ambientEnabledDefault = gv->spriteAmbientEnabledDefault;
			spriteState.ambientFactorDefault = gv->spriteAmbientFactorDefault;
			spriteState.psxDither2dEnabled = gv->psx_dither_2d_enabled;
			spriteState.psxDither2dIntensity = gv->psx_dither2d_intensity;
			spriteState.viewportTypeIde = (gv->viewportTypeIde == GameView::ViewportType::Viewport) ? "viewport" : "offscreen";

			state = spriteState;
		};
		registerPass(desc);
	}

	// CRT post-processing pass
	{
		RenderPassDef desc;
		desc.id = "crt";
		desc.name = "CRT";
		desc.present = true;
		desc.exec = [](GPUBackend* backend, void*, std::any& state) {
			auto& engine = EngineCore::instance();
			auto* view = engine.view();
			auto& crtState = std::any_cast<CRTPipelineState&>(state);
			auto* colorTex = static_cast<SoftwareTexture*>(crtState.colorTex);
			auto* softBackend = static_cast<SoftwareBackend*>(backend);
			view->applyCRTPostProcessing(colorTex->data.data(), colorTex->width,
										 colorTex->height, softBackend->framebuffer(),
										 softBackend->width(), softBackend->height(),
										 softBackend->pitch());
		};
		desc.prepare = [](GPUBackend*, std::any&) {};
		registerPass(desc);
	}
}

void RenderPassLibrary::registerBuiltinPassesOpenGLES2() {
#if !BMSX_ENABLE_GLES2
	throw std::runtime_error("[RenderPassLibrary] OpenGLES2 backend disabled at compile time.");
#else
	// FrameResolve: per-frame state setup
	{
		RenderPassDef desc;
		desc.id = "frame_resolve";
		desc.name = "FrameResolve";
		desc.stateOnly = true;
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
		desc.exec = [](GPUBackend*, void*, std::any&) { };
		registerPass(desc);
	}

	// Sprites pass (GLES2)
	{
		RenderPassDef desc;
		desc.id = "sprites";
		desc.name = "Sprites2D";
		desc.writesDepth = true;
		desc.bootstrap = [](GPUBackend* backend) {
			auto& engine = EngineCore::instance();
			SpritesPipeline::initGLES2(static_cast<OpenGLES2Backend*>(backend), engine.view());
		};
		desc.shouldExecute = []() { return true; };
		desc.exec = [](GPUBackend* backend, void* fbo, std::any& state) {
			(void)fbo;
			auto& engine = EngineCore::instance();
			auto& spriteState = std::any_cast<SpritesPipelineState&>(state);
			SpritesPipeline::renderSpriteBatchGLES2(static_cast<OpenGLES2Backend*>(backend), engine.view(), spriteState);
		};
		desc.prepare = [](GPUBackend*, std::any& state) {
			auto& engine = EngineCore::instance();
			auto* gv = engine.view();
			auto& assets = engine.assets();

			SpritesPipelineState spriteState;
			spriteState.width = static_cast<i32>(gv->offscreenCanvasSize.x);
			spriteState.height = static_cast<i32>(gv->offscreenCanvasSize.y);
			spriteState.baseWidth = static_cast<i32>(gv->viewportSize.x);
			spriteState.baseHeight = static_cast<i32>(gv->viewportSize.y);

			const auto& primaryAtlas = assets.img.at(generateAtlasName(0));
			spriteState.atlasPrimaryTex = reinterpret_cast<TextureHandle>(primaryAtlas.textureHandle);
			const auto secondaryName = generateAtlasName(1);
			auto secondaryIt = assets.img.find(secondaryName);
			if (secondaryIt != assets.img.end()) {
				spriteState.atlasSecondaryTex = reinterpret_cast<TextureHandle>(secondaryIt->second.textureHandle);
			}
			const auto engineName = generateAtlasName(254);
			auto engineIt = assets.img.find(engineName);
			if (engineIt != assets.img.end()) {
				spriteState.atlasEngineTex = reinterpret_cast<TextureHandle>(engineIt->second.textureHandle);
			}

			spriteState.ambientEnabledDefault = gv->spriteAmbientEnabledDefault;
			spriteState.ambientFactorDefault = gv->spriteAmbientFactorDefault;
			spriteState.psxDither2dEnabled = gv->psx_dither_2d_enabled;
			spriteState.psxDither2dIntensity = gv->psx_dither2d_intensity;
			spriteState.viewportTypeIde = (gv->viewportTypeIde == GameView::ViewportType::Viewport) ? "viewport" : "offscreen";

			state = spriteState;
		};
		registerPass(desc);
	}

	// CRT post-processing / present pass (GLES2)
	{
		RenderPassDef desc;
		desc.id = "crt";
		desc.name = "Present/CRT";
		desc.present = true;
		desc.bootstrap = [](GPUBackend* backend) {
			CRTPipeline::initGLES2(static_cast<OpenGLES2Backend*>(backend));
		};
		desc.exec = [](GPUBackend* backend, void*, std::any& state) {
			auto& engine = EngineCore::instance();
			auto& crtState = std::any_cast<CRTPipelineState&>(state);
			CRTPipeline::renderCRTGLES2(static_cast<OpenGLES2Backend*>(backend), engine.view(), crtState);
		};
		desc.prepare = [](GPUBackend*, std::any&) { };
		registerPass(desc);
	}
#endif
}

void RenderPassLibrary::registerPass(const RenderPassDef& desc) {
	const std::string& idStr = desc.id;
	if (m_registered.find(idStr) != m_registered.end()) {
		throw std::runtime_error("Pipeline '" + idStr + "' already registered");
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
		throw std::runtime_error("Pipeline '" + id + "' not found");
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
	struct GraphHandles {
		RenderGraphTexHandle color = -1;
		RenderGraphTexHandle depth = -1;
	};
	auto handles = std::make_shared<GraphHandles>();

	// Clear pass
	{
		RenderGraphPass pass;
		pass.name = "Clear";
		pass.setup = [view, handles](RenderGraphIO& io, FrameData*) -> std::any {
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
			io.writeTex(handles->color, {0, 0, 0, 1});
			io.writeTex(handles->depth, 1.0f);
			io.exportToBackbuffer(handles->color);
			return std::any{};
		};
		pass.execute = [](RenderGraphContext&, FrameData*, const std::any&) {};
		rg->addPass(pass);
	}

	// Frame shared state pass
	{
		RenderGraphPass pass;
		pass.name = "FrameSharedState";
		pass.alwaysExecute = true;
		pass.setup = [](RenderGraphIO&, FrameData*) -> std::any { return std::any{}; };
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
	for (const auto& desc : m_passes) {
		RenderGraphPass pass;
		pass.name = desc.name;
		pass.alwaysExecute = desc.stateOnly;

		const std::string passId = desc.id;
		const bool isPresent = desc.present;
		const bool isStateOnly = desc.stateOnly;
		const bool writesDepth = desc.writesDepth;
		const bool depthTest = desc.depthTest;
		const auto shouldExecute = desc.shouldExecute;

		pass.setup = [handles, isPresent, isStateOnly, writesDepth, depthTest](RenderGraphIO& io, FrameData*) -> std::any {
			if (!isPresent && !isStateOnly) {
				io.writeTex(handles->color);
				if (writesDepth) io.writeTex(handles->depth);
				else if (depthTest) io.readTex(handles->depth);
			} else {
				io.readTex(handles->color);
			}
			return std::any{};
		};

		pass.execute = [this, view, handles, passId, isPresent, isStateOnly, shouldExecute](RenderGraphContext& ctx, FrameData*, const std::any&) {
			if (!isPassEnabled(passId)) return;
			if (shouldExecute && !shouldExecute()) return;

			if (isPresent) {
				CRTPipelineState crtState;
				crtState.width = static_cast<i32>(view->canvasSize.x);
				crtState.height = static_cast<i32>(view->canvasSize.y);
				crtState.baseWidth = static_cast<i32>(view->viewportSize.x);
				crtState.baseHeight = static_cast<i32>(view->viewportSize.y);
				crtState.srcWidth = static_cast<i32>(view->offscreenCanvasSize.x);
				crtState.srcHeight = static_cast<i32>(view->offscreenCanvasSize.y);
				crtState.colorTex = ctx.getTexture(handles->color);

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

				setState("crt", crtState);
				execute(passId, nullptr);
			} else if (isStateOnly) {
				execute(passId, nullptr);
			} else {
				execute(passId, ctx.getFBO(handles->color, handles->depth));
			}
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
