/*
 * rendergraph.h - Render graph runtime for scheduling and executing passes
 *
 * Mirrors TypeScript RenderGraphRuntime concept.
 */

#ifndef BMSX_RENDERGRAPH_H
#define BMSX_RENDERGRAPH_H

#include "backend.h"
#include "render_types.h"
#include <string>
#include <vector>
#include <functional>
#include <memory>
#include <unordered_map>

namespace bmsx {

/* ============================================================================
 * Frame data passed to render graph execution
 * ============================================================================ */

struct FrameData {
    f64 time = 0;    // Total elapsed time
    f64 delta = 0;   // Delta time for this frame
    u32 frameIndex = 0;
};

/* ============================================================================
 * Render graph I/O for pass setup
 * ============================================================================ */

using RenderGraphTexHandle = i32;

class RenderGraphIO {
public:
    RenderGraphTexHandle createTex(i32 width, i32 height, const std::string& name, bool isDepth = false);
    void writeTex(RenderGraphTexHandle handle, const std::array<f32, 4>& clearColor);
    void writeTex(RenderGraphTexHandle handle, f32 clearDepth);
    void exportToBackbuffer(RenderGraphTexHandle handle);
    void readTex(RenderGraphTexHandle handle);

    // Access created textures
    const std::vector<RenderGraphTexHandle>& getCreatedTextures() const { return m_createdTextures; }
    RenderGraphTexHandle getBackbufferExport() const { return m_backbufferExport; }

private:
    std::vector<RenderGraphTexHandle> m_createdTextures;
    RenderGraphTexHandle m_backbufferExport = -1;
    i32 m_nextHandle = 0;
};

/* ============================================================================
 * Render graph execution context
 * ============================================================================ */

class RenderGraphContext {
public:
    explicit RenderGraphContext(GPUBackend* backend) : m_backend(backend) {}

    GPUBackend* backend() const { return m_backend; }

    // Get a texture by handle
    TextureHandle getTexture(RenderGraphTexHandle handle) const;

    // Set current render target
    void setRenderTarget(RenderGraphTexHandle handle);

private:
    GPUBackend* m_backend;
    std::unordered_map<RenderGraphTexHandle, TextureHandle> m_textures;
};

/* ============================================================================
 * Render graph pass definition
 * ============================================================================ */

struct RenderGraphPass {
    std::string name;
    bool alwaysExecute = false;

    std::function<void*(RenderGraphIO&)> setup;
    std::function<void(RenderGraphContext&, FrameData*)> execute;
};

/* ============================================================================
 * RenderGraphRuntime
 *
 * Manages pass scheduling and execution order.
 * ============================================================================ */

class RenderGraphRuntime {
public:
    explicit RenderGraphRuntime(GPUBackend* backend);
    ~RenderGraphRuntime();

    // Add a pass to the render graph
    void addPass(const RenderGraphPass& pass);

    // Compile/optimize the graph (call after all passes added)
    void compile();

    // Execute all passes for a frame
    void execute(FrameData* frame);

    // Get pass count
    size_t passCount() const { return m_passes.size(); }

private:
    GPUBackend* m_backend;
    std::vector<RenderGraphPass> m_passes;
    std::vector<RenderGraphIO> m_passIOs;
    bool m_compiled = false;
};

} // namespace bmsx

#endif // BMSX_RENDERGRAPH_H
