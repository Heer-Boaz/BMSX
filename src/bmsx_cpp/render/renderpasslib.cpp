/*
 * renderpasslib.cpp - Render pass library implementation
 *
 * Mirrors TypeScript renderpasslib.ts
 */

#include "renderpasslib.h"
#include "gameview.h"
#include "sprites_pipeline.h"
#include "rendergraph.h"
#include "../core/engine.h"
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
            if (atlasIt != gv->textures.end()) {
                spriteState.atlasPrimaryTex = atlasIt->second;
            }
            auto secondaryIt = gv->textures.find("_atlas_secondary");
            if (secondaryIt != gv->textures.end()) {
                spriteState.atlasSecondaryTex = secondaryIt->second;
            }

            spriteState.ambientEnabledDefault = gv->spriteAmbientEnabledDefault;
            spriteState.ambientFactorDefault = gv->spriteAmbientFactorDefault;
            spriteState.psxDither2dEnabled = gv->psx_dither_2d_enabled;
            spriteState.psxDither2dIntensity = gv->psx_dither2d_intensity;

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
        desc.shouldExecute = []() {
            auto& engine = EngineCore::instance();
            return engine.view()->crt_postprocessing_enabled;
        };
        desc.exec = [](GPUBackend*, void*, std::any&) {
            // CRT is applied in GameView::applyCRTPostProcessing for software
        };
        desc.prepare = [](GPUBackend*, std::any& state) {
            auto& engine = EngineCore::instance();
            auto* gv = engine.view();

            CRTPipelineState crtState;
            crtState.width = static_cast<i32>(gv->viewportSize.x);
            crtState.height = static_cast<i32>(gv->viewportSize.y);
            crtState.applyNoise = gv->applyNoise;
            crtState.noiseIntensity = gv->noiseIntensity;
            crtState.applyColorBleed = gv->applyColorBleed;
            crtState.colorBleed = gv->colorBleed;
            crtState.applyScanlines = gv->applyScanlines;
            crtState.applyBlur = gv->applyBlur;
            crtState.blurIntensity = gv->blurIntensity;
            crtState.applyGlow = gv->applyGlow;
            crtState.glowColor = gv->glowColor;
            crtState.applyFringing = gv->applyFringing;
            crtState.applyAperture = gv->applyAperture;

            state = crtState;
        };
        registerPass(desc);
    }
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

    // Clear pass
    {
        RenderGraphPass pass;
        pass.name = "Clear";
        pass.setup = [view](RenderGraphIO& io) -> void* {
            auto color = io.createTex(static_cast<i32>(view->offscreenCanvasSize.x),
                                      static_cast<i32>(view->offscreenCanvasSize.y),
                                      "FrameColor");
            auto depth = io.createTex(static_cast<i32>(view->offscreenCanvasSize.x),
                                      static_cast<i32>(view->offscreenCanvasSize.y),
                                      "FrameDepth", true);
            io.writeTex(color, {0, 0, 0, 1});
            io.writeTex(depth, 1.0f);
            io.exportToBackbuffer(color);
            return nullptr;
        };
        pass.execute = [](RenderGraphContext&, FrameData*) {};
        rg->addPass(pass);
    }

    // Frame shared state pass
    {
        RenderGraphPass pass;
        pass.name = "FrameSharedState";
        pass.alwaysExecute = true;
        pass.setup = [](RenderGraphIO&) -> void* { return nullptr; };
        pass.execute = [this, view](RenderGraphContext&, FrameData* frame) {
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
        if (desc.stateOnly) continue;

        RenderGraphPass pass;
        pass.name = desc.name;
        pass.alwaysExecute = false;
        pass.setup = [](RenderGraphIO&) -> void* { return nullptr; };

        std::string passId = desc.id;
        pass.execute = [this, passId](RenderGraphContext& ctx, FrameData*) {
            if (!isPassEnabled(passId)) return;
            execute(passId, nullptr);
            (void)ctx;
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
