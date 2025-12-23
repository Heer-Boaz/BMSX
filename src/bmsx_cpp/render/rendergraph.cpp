/*
 * rendergraph.cpp - Render graph runtime implementation
 */

#include "rendergraph.h"
#include <stdexcept>

namespace bmsx {

/* ============================================================================
 * RenderGraphIO implementation
 * ============================================================================ */

RenderGraphTexHandle RenderGraphIO::createTex(i32 width, i32 height, const std::string& name, bool isDepth) {
    (void)width;
    (void)height;
    (void)name;
    (void)isDepth;

    auto handle = m_nextHandle++;
    m_createdTextures.push_back(handle);
    return handle;
}

void RenderGraphIO::writeTex(RenderGraphTexHandle handle, const std::array<f32, 4>& clearColor) {
    (void)handle;
    (void)clearColor;
    // Mark texture for writing with clear color
}

void RenderGraphIO::writeTex(RenderGraphTexHandle handle, f32 clearDepth) {
    (void)handle;
    (void)clearDepth;
    // Mark depth texture for writing
}

void RenderGraphIO::exportToBackbuffer(RenderGraphTexHandle handle) {
    m_backbufferExport = handle;
}

void RenderGraphIO::readTex(RenderGraphTexHandle handle) {
    (void)handle;
    // Mark texture for reading
}

/* ============================================================================
 * RenderGraphContext implementation
 * ============================================================================ */

TextureHandle RenderGraphContext::getTexture(RenderGraphTexHandle handle) const {
    auto it = m_textures.find(handle);
    if (it != m_textures.end()) {
        return it->second;
    }
    return nullptr;
}

void RenderGraphContext::setRenderTarget(RenderGraphTexHandle handle) {
    (void)handle;
    // Set current render target
}

/* ============================================================================
 * RenderGraphRuntime implementation
 * ============================================================================ */

RenderGraphRuntime::RenderGraphRuntime(GPUBackend* backend)
    : m_backend(backend)
{
}

RenderGraphRuntime::~RenderGraphRuntime() = default;

void RenderGraphRuntime::addPass(const RenderGraphPass& pass) {
    if (m_compiled) {
        throw std::runtime_error("Cannot add passes after compilation");
    }
    m_passes.push_back(pass);
}

void RenderGraphRuntime::compile() {
    if (m_compiled) return;

    // Run setup phase for all passes
    m_passIOs.resize(m_passes.size());
    for (size_t i = 0; i < m_passes.size(); ++i) {
        auto& pass = m_passes[i];
        if (pass.setup) {
            pass.setup(m_passIOs[i]);
        }
    }

    // TODO: Optimize pass order, detect resource dependencies, cull unused passes

    m_compiled = true;
}

void RenderGraphRuntime::execute(FrameData* frame) {
    if (!m_compiled) {
        compile();
    }

    RenderGraphContext ctx(m_backend);

    for (size_t i = 0; i < m_passes.size(); ++i) {
        auto& pass = m_passes[i];

        // Execute the pass
        if (pass.execute) {
            pass.execute(ctx, frame);
        }
    }
}

} // namespace bmsx
