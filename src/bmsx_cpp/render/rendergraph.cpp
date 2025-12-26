/*
 * rendergraph.cpp - Render graph runtime implementation
 */

#include "rendergraph.h"
#include "gles2_backend.h"
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <stdexcept>

namespace {
constexpr bool kRenderGraphVerboseLog = false;
}

namespace bmsx {

namespace {

struct GLES2DepthTarget {
    GLuint id = 0;
    i32 width = 0;
    i32 height = 0;
};

} // namespace

/* ============================================================================
 * RenderGraphIO implementation
 * ============================================================================ */

RenderGraphIO::RenderGraphIO(RenderGraphRuntime* runtime, i32 passIndex)
    : m_runtime(runtime)
    , m_passIndex(passIndex) {}

RenderGraphTexHandle RenderGraphIO::createTex(const TexDesc& desc) {
    return m_runtime->allocTex(desc, m_passIndex);
}

void RenderGraphIO::writeTex(RenderGraphTexHandle handle) {
    m_runtime->writeTex(handle, m_passIndex, nullptr, nullptr);
}

void RenderGraphIO::writeTex(RenderGraphTexHandle handle, const std::array<f32, 4>& clearColor) {
    m_runtime->writeTex(handle, m_passIndex, &clearColor, nullptr);
}

void RenderGraphIO::writeTex(RenderGraphTexHandle handle, f32 clearDepth) {
    m_runtime->writeTex(handle, m_passIndex, nullptr, &clearDepth);
}

void RenderGraphIO::exportToBackbuffer(RenderGraphTexHandle handle) {
    m_runtime->exportToBackbuffer(handle, m_passIndex);
}

void RenderGraphIO::readTex(RenderGraphTexHandle handle) {
    m_runtime->readTex(handle, m_passIndex);
}

RenderGraphValueHandle RenderGraphIO::provideValue(const std::any& val) {
    return m_runtime->provideValue(val, m_passIndex);
}

void RenderGraphIO::readValue(RenderGraphValueHandle handle) {
    m_runtime->readValue(handle, m_passIndex);
}

/* ============================================================================
 * RenderGraphContext implementation
 * ============================================================================ */

RenderGraphContext::RenderGraphContext(GPUBackend* backend, RenderGraphRuntime* runtime)
    : m_backend(backend)
    , m_runtime(runtime) {}

TextureHandle RenderGraphContext::getTexture(RenderGraphTexHandle handle) const {
    return m_runtime->getTexture(handle);
}

void* RenderGraphContext::getFBO(RenderGraphTexHandle color, RenderGraphTexHandle depth) {
    return m_runtime->getFBO(color, depth);
}

const std::any& RenderGraphContext::getValue(RenderGraphValueHandle handle) const {
    return m_runtime->m_valueResources[handle].val;
}

/* ============================================================================
 * RenderGraphRuntime implementation
 * ============================================================================ */

RenderGraphRuntime::RenderGraphRuntime(GPUBackend* backend)
    : m_backend(backend) {
}

RenderGraphRuntime::~RenderGraphRuntime() {
    destroyResources();
}

void RenderGraphRuntime::addPass(const RenderGraphPass& pass) {
    if (m_compiled) {
        throw std::runtime_error("Cannot add passes after compilation");
    }
    m_passes.push_back(pass);
}

void RenderGraphRuntime::compile(FrameData* frame) {
    if (m_compiled) return;

    m_passReads.assign(m_passes.size(), {});
    m_passWrites.assign(m_passes.size(), {});
    m_valueReads.assign(m_passes.size(), {});
    m_setupData.clear();

    m_texResources.clear();
    m_valueResources.clear();
    m_texResources.resize(1);
    m_valueResources.resize(1);
    m_presentHandle = -1;
    m_nextHandle = 1;

    for (i32 i = 0; i < static_cast<i32>(m_passes.size()); ++i) {
        RenderGraphIO io(this, i);
        const auto& pass = m_passes[i];
        std::any data = pass.setup ? pass.setup(io, frame) : std::any{};
        m_setupData.push_back(data);
    }

    i32 presentCount = 0;
    for (i32 i = 1; i < static_cast<i32>(m_texResources.size()); ++i) {
        if (m_texResources[i].present) {
            m_presentHandle = i;
            presentCount++;
        }
    }
    if (presentCount != 1) {
        throw std::runtime_error("RenderGraph validation failed: expected exactly 1 present/exported texture");
    }
    if (kRenderGraphVerboseLog) {
        std::fprintf(stderr, "[BMSX][RG] compile passes=%zu presentHandle=%d\n",
                     m_passes.size(), m_presentHandle);
    }

    const i32 passCount = static_cast<i32>(m_passes.size());
    m_reachable.assign(passCount, false);

    std::function<void(i32)> markPass = [&](i32 p) {
        if (m_reachable[p]) return;
        m_reachable[p] = true;

        for (RenderGraphTexHandle h : m_passReads[p]) {
            const auto& res = m_texResources[h];
            for (i32 wp : res.writerPasses) {
                markPass(wp);
            }
        }
        for (RenderGraphValueHandle v : m_valueReads[p]) {
            const auto& res = m_valueResources[v];
            if (res.providerPass >= 0) {
                markPass(res.providerPass);
            }
        }
    };

    const auto& presentRes = m_texResources[m_presentHandle];
    if (presentRes.exportPass >= 0) markPass(presentRes.exportPass);
    for (i32 wp : presentRes.writerPasses) markPass(wp);
    for (i32 rp : presentRes.readPasses) markPass(rp);

    for (i32 p = 0; p < passCount; ++p) {
        if (m_passes[p].alwaysExecute) {
            m_reachable[p] = true;
        }
    }

    std::vector<i32> indegree(passCount, 0);
    std::vector<std::vector<i32>> adj(passCount);

    for (i32 p = 0; p < passCount; ++p) {
        if (!m_reachable[p]) continue;
        for (RenderGraphTexHandle h : m_passReads[p]) {
            const auto& res = m_texResources[h];
            for (i32 wp : res.writerPasses) {
                if (wp != p) adj[wp].push_back(p);
            }
        }
        for (RenderGraphValueHandle v : m_valueReads[p]) {
            const auto& res = m_valueResources[v];
            if (res.providerPass >= 0 && res.providerPass != p) {
                adj[res.providerPass].push_back(p);
            }
        }
    }

    for (const auto& res : m_texResources) {
        if (res.writerPasses.size() > 1) {
            std::vector<i32> writers = res.writerPasses;
            std::sort(writers.begin(), writers.end());
            for (size_t wi = 0; wi + 1 < writers.size(); ++wi) {
                adj[writers[wi]].push_back(writers[wi + 1]);
            }
        }
    }

    for (i32 p = 0; p < passCount; ++p) {
        if (!m_reachable[p]) continue;
        for (i32 to : adj[p]) indegree[to]++;
    }

    std::vector<i32> queue;
    for (i32 p = 0; p < passCount; ++p) {
        if (m_reachable[p] && indegree[p] == 0) queue.push_back(p);
    }

    m_passOrder.clear();
    while (!queue.empty()) {
        i32 n = queue.front();
        queue.erase(queue.begin());
        m_passOrder.push_back(n);
        for (i32 to : adj[n]) {
            indegree[to]--;
            if (indegree[to] == 0 && m_reachable[to]) queue.push_back(to);
        }
    }

    i32 reachableCount = 0;
    for (bool r : m_reachable) if (r) reachableCount++;
    if (static_cast<i32>(m_passOrder.size()) != reachableCount) {
        throw std::runtime_error("RenderGraph cycle detected");
    }

    m_compiled = true;
}

void RenderGraphRuntime::execute(FrameData* frame) {
    if (!m_compiled) compile(frame);
    if (!m_realized) realizeAll();

    RenderGraphContext ctx(m_backend, this);
    const bool hasOrder = !m_passOrder.empty();
    const i32 passCount = static_cast<i32>(m_passes.size());
    const i32 total = hasOrder ? static_cast<i32>(m_passOrder.size()) : passCount;

    for (i32 oi = 0; oi < total; ++oi) {
        const i32 passIndex = hasOrder ? m_passOrder[oi] : oi;
        if (!m_reachable.empty() && !m_reachable[passIndex]) continue;

        auto& pass = m_passes[passIndex];
        const std::any& data = m_setupData[passIndex];
        if (kRenderGraphVerboseLog) {
            std::fprintf(stderr, "[BMSX][RG] execute pass index=%d name=%s\n",
                         passIndex, pass.name.c_str());
        }

        const auto& writes = m_passWrites[passIndex];
        RenderGraphTexHandle colorHandle = -1;
        RenderGraphTexHandle depthHandle = -1;
        for (RenderGraphTexHandle h : writes) {
            const auto& res = m_texResources[h];
            if (res.desc.depth) depthHandle = h; else colorHandle = h;
        }

        bool didBegin = false;
        PassEncoder passEnc{};
        if (colorHandle >= 0) {
            auto& colorRes = m_texResources[colorHandle];
            const i32 width = colorRes.desc.width;
            const i32 height = colorRes.desc.height;
            const void* fboHandle = getFBO(colorHandle, depthHandle);
            if (kRenderGraphVerboseLog) {
                std::fprintf(stderr,
                             "[BMSX][RG] pass=%s colorHandle=%d depthHandle=%d fbo=%u size=%dx%d\n",
                             pass.name.c_str(), colorHandle, depthHandle,
                             static_cast<unsigned>(reinterpret_cast<uintptr_t>(fboHandle)),
                             width, height);
            }

            auto* gles = static_cast<OpenGLES2Backend*>(m_backend);
            gles->setRenderTarget(static_cast<GLuint>(reinterpret_cast<uintptr_t>(fboHandle)), width, height);

            bool clearColor = !colorRes.clearOnWrite.color.has_value() ? false : (colorRes.writerPasses[0] == passIndex);
            bool clearDepth = false;
            if (depthHandle >= 0) {
                const auto& depthRes = m_texResources[depthHandle];
                clearDepth = depthRes.clearOnWrite.depth.has_value() && (depthRes.writerPasses[0] == passIndex);
            }

            if (clearColor || clearDepth) {
                RenderPassDesc desc;
                desc.label = pass.name;
                if (clearColor) {
                    const auto& clr = *colorRes.clearOnWrite.color;
                    ColorAttachmentSpec colorSpec;
                    colorSpec.clear = Color{clr[0], clr[1], clr[2], clr[3]};
                    desc.color = colorSpec;
                }
                if (clearDepth) {
                    DepthAttachmentSpec depthSpec;
                    depthSpec.clearDepth = *m_texResources[depthHandle].clearOnWrite.depth;
                    desc.depth = depthSpec;
                }
                passEnc = m_backend->beginRenderPass(desc);
                didBegin = true;
            }
        }

        pass.execute(ctx, frame, data);

        if (didBegin) {
            m_backend->endRenderPass(passEnc);
        }
    }
}

void RenderGraphRuntime::invalidate() {
    destroyResources();
    m_compiled = false;
    m_realized = false;
}

RenderGraphTexHandle RenderGraphRuntime::allocTex(const TexDesc& desc, i32 passIndex) {
    const RenderGraphTexHandle handle = m_nextHandle++;
    if (static_cast<i32>(m_texResources.size()) <= handle) {
        m_texResources.resize(static_cast<size_t>(handle + 1));
    }
    auto& res = m_texResources[handle];
    res.desc = desc;
    res.firstUse = passIndex;
    res.lastUse = passIndex;
    res.writerPasses.clear();
    res.readPasses.clear();
    res.clearOnWrite = {};
    res.present = false;
    res.exportPass = -1;
    return handle;
}

void RenderGraphRuntime::readTex(RenderGraphTexHandle handle, i32 passIndex) {
    auto& res = m_texResources[handle];
    res.readPasses.push_back(passIndex);
    res.lastUse = std::max(res.lastUse, passIndex);
    if (res.firstUse < 0) res.firstUse = passIndex;
    m_passReads[passIndex].push_back(handle);
}

void RenderGraphRuntime::writeTex(RenderGraphTexHandle handle, i32 passIndex, const std::array<f32, 4>* clearColor, const f32* clearDepth) {
    auto& res = m_texResources[handle];
    if (res.writerPasses.empty() || res.writerPasses.back() != passIndex) {
        res.writerPasses.push_back(passIndex);
    }
    res.firstUse = (res.firstUse < 0) ? passIndex : std::min(res.firstUse, passIndex);
    res.lastUse = std::max(res.lastUse, passIndex);
    if (clearColor) res.clearOnWrite.color = *clearColor;
    if (clearDepth) res.clearOnWrite.depth = *clearDepth;
    m_passWrites[passIndex].push_back(handle);
}

void RenderGraphRuntime::exportToBackbuffer(RenderGraphTexHandle handle, i32 passIndex) {
    auto& res = m_texResources[handle];
    res.present = true;
    res.exportPass = passIndex;
    res.lastUse = std::max(res.lastUse, passIndex);
}

RenderGraphValueHandle RenderGraphRuntime::provideValue(const std::any& val, i32 passIndex) {
    const RenderGraphValueHandle handle = m_nextHandle++;
    if (static_cast<i32>(m_valueResources.size()) <= handle) {
        m_valueResources.resize(static_cast<size_t>(handle + 1));
    }
    auto& res = m_valueResources[handle];
    res.val = val;
    res.providerPass = passIndex;
    res.firstUse = passIndex;
    res.lastUse = passIndex;
    return handle;
}

void RenderGraphRuntime::readValue(RenderGraphValueHandle handle, i32 passIndex) {
    auto& res = m_valueResources[handle];
    res.readPasses.push_back(passIndex);
    res.lastUse = std::max(res.lastUse, passIndex);
    if (res.firstUse < 0) res.firstUse = passIndex;
    m_valueReads[passIndex].push_back(handle);
}

TextureHandle RenderGraphRuntime::getTexture(RenderGraphTexHandle handle) const {
    return m_texResources[handle].tex;
}

void* RenderGraphRuntime::getFBO(RenderGraphTexHandle color, RenderGraphTexHandle depth) {
    if (depth < 0) {
        return m_texResources[color].fboColorOnly;
    }
    return ensureFBO(color, depth);
}

void RenderGraphRuntime::realizeAll() {
    if (m_realized) return;

    auto* gles = static_cast<OpenGLES2Backend*>(m_backend);

    for (i32 i = 1; i < static_cast<i32>(m_texResources.size()); ++i) {
        auto& res = m_texResources[i];

        if (res.desc.depth) {
            auto* depth = new GLES2DepthTarget{};
            depth->width = res.desc.width;
            depth->height = res.desc.height;
            glGenRenderbuffers(1, &depth->id);
            glBindRenderbuffer(GL_RENDERBUFFER, depth->id);
            glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT16, depth->width, depth->height);
            res.tex = reinterpret_cast<TextureHandle>(depth);
            if (kRenderGraphVerboseLog) {
                std::fprintf(stderr,
                             "[BMSX][RG] create depth handle=%d rb=%u size=%dx%d\n",
                             i, static_cast<unsigned>(depth->id), depth->width, depth->height);
            }
        } else {
            res.tex = gles->createTexture(nullptr, res.desc.width, res.desc.height, TextureParams{});
            auto* glTex = OpenGLES2Backend::asTexture(res.tex);
            GLuint fbo = 0;
            glGenFramebuffers(1, &fbo);
            glBindFramebuffer(GL_FRAMEBUFFER, fbo);
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, glTex->id, 0);
            res.fboColorOnly = reinterpret_cast<void*>(static_cast<uintptr_t>(fbo));
            if (kRenderGraphVerboseLog) {
                const GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
                std::fprintf(stderr,
                             "[BMSX][RG] create color handle=%d tex=%u size=%dx%d fbo=%u status=0x%x\n",
                             i, static_cast<unsigned>(glTex->id), res.desc.width, res.desc.height,
                             static_cast<unsigned>(fbo), static_cast<unsigned>(status));
            }
        }
    }

    m_realized = true;
}

void RenderGraphRuntime::destroyResources() {
    auto* gles = static_cast<OpenGLES2Backend*>(m_backend);

    for (i32 i = 1; i < static_cast<i32>(m_texResources.size()); ++i) {
        auto& res = m_texResources[i];
        if (res.desc.depth) {
            auto* depth = static_cast<GLES2DepthTarget*>(res.tex);
            glDeleteRenderbuffers(1, &depth->id);
            delete depth;
        } else {
            GLuint fbo = static_cast<GLuint>(reinterpret_cast<uintptr_t>(res.fboColorOnly));
            glDeleteFramebuffers(1, &fbo);
            for (const auto& kv : res.fboWithDepth) {
                GLuint fbo = static_cast<GLuint>(reinterpret_cast<uintptr_t>(kv.second));
                glDeleteFramebuffers(1, &fbo);
            }
            gles->destroyTexture(res.tex);
        }
        res = InternalTexResource{};
    }

    m_realized = false;
}

void* RenderGraphRuntime::ensureFBO(RenderGraphTexHandle color, RenderGraphTexHandle depth) {
    auto& colorRes = m_texResources[color];
    auto it = colorRes.fboWithDepth.find(depth);
    if (it != colorRes.fboWithDepth.end()) return it->second;

    auto* glTex = OpenGLES2Backend::asTexture(colorRes.tex);
    auto& depthRes = m_texResources[depth];
    auto* depthTarget = static_cast<GLES2DepthTarget*>(depthRes.tex);

    GLuint fbo = 0;
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, glTex->id, 0);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, depthTarget->id);

    void* handle = reinterpret_cast<void*>(static_cast<uintptr_t>(fbo));
    colorRes.fboWithDepth[depth] = handle;
    if (kRenderGraphVerboseLog) {
        const GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
        std::fprintf(stderr,
                     "[BMSX][RG] create color+depth fbo=%u colorHandle=%d depthHandle=%d status=0x%x\n",
                     static_cast<unsigned>(fbo), color, depth,
                     static_cast<unsigned>(status));
    }
    return handle;
}

} // namespace bmsx
