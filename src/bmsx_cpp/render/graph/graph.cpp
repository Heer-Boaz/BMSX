/*
 * graph.cpp - Render graph runtime implementation
 */

#include "graph.h"
#if BMSX_ENABLE_GLES2
#include "../backend/gles2_backend.h"
#endif
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <stdexcept>

namespace {
constexpr bool kRenderGraphVerboseLog = false;
}

namespace bmsx {

namespace {

#if BMSX_ENABLE_GLES2
struct GLES2DepthTarget {
	GLuint id = 0;
	i32 width = 0;
	i32 height = 0;
};

GLuint createGLES2ColorFramebuffer(GLuint textureId) {
	GLuint fbo = 0;
	glGenFramebuffers(1, &fbo);
	glBindFramebuffer(GL_FRAMEBUFFER, fbo);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, textureId, 0);
	return fbo;
}
#endif

struct SoftwareDepthTarget {
	i32 width = 0;
	i32 height = 0;
};

template<typename Resource, typename Handle>
void recordGraphRead(Resource& resource, std::vector<Handle>& passReads, Handle handle, i32 passIndex) {
	resource.readPasses.push_back(passIndex);
	resource.lastUse = std::max(resource.lastUse, passIndex);
	if (resource.firstUse < 0) {
		resource.firstUse = passIndex;
	}
	passReads.push_back(handle);
}

} // namespace

/* ============================================================================
 * RenderGraphIO implementation
 * ============================================================================ */

RenderGraphIO::RenderGraphIO(RenderGraphRuntime* runtime, i32 passIndex)
	: m_runtime(runtime)
	, m_passIndex(passIndex) {}

RenderGraphTexHandle RenderGraphIO::createTex(const TexDesc& desc) {
	RenderGraphRuntime& runtime = *m_runtime;
	const RenderGraphTexHandle handle = runtime.m_nextHandle++;
	if (static_cast<i32>(runtime.m_texResources.size()) <= handle) {
		runtime.m_texResources.resize(static_cast<size_t>(handle + 1));
	}
	auto& resource = runtime.m_texResources[handle];
	resource.desc = desc;
	resource.firstUse = m_passIndex;
	resource.lastUse = m_passIndex;
	resource.writerPasses.clear();
	resource.readPasses.clear();
	resource.clearOnWrite = {};
	resource.present = false;
	resource.exportPass = -1;
	return handle;
}

void RenderGraphIO::writeTex(RenderGraphTexHandle handle) {
	RenderGraphRuntime& runtime = *m_runtime;
	auto& resource = runtime.m_texResources[handle];
	if (resource.writerPasses.empty() || resource.writerPasses.back() != m_passIndex) {
		resource.writerPasses.push_back(m_passIndex);
	}
	resource.firstUse = (resource.firstUse < 0) ? m_passIndex : std::min(resource.firstUse, m_passIndex);
	resource.lastUse = std::max(resource.lastUse, m_passIndex);
	runtime.m_passWrites[m_passIndex].push_back(handle);
}

void RenderGraphIO::exportToBackbuffer(RenderGraphTexHandle handle) {
	auto& resource = m_runtime->m_texResources[handle];
	resource.present = true;
	resource.exportPass = m_passIndex;
	resource.lastUse = std::max(resource.lastUse, m_passIndex);
}

void RenderGraphIO::readTex(RenderGraphTexHandle handle) {
	RenderGraphRuntime& runtime = *m_runtime;
	recordGraphRead(runtime.m_texResources[handle], runtime.m_passReads[m_passIndex], handle, m_passIndex);
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
		throw BMSX_RUNTIME_ERROR("Cannot add passes after compilation");
	}
	m_passes.push_back(pass);
}

void RenderGraphRuntime::compile(FrameData* frame) {
	if (m_compiled) return;

	m_passReads.assign(m_passes.size(), {});
	m_passWrites.assign(m_passes.size(), {});
	m_setupData.clear();

	m_texResources.clear();
	m_texResources.resize(1);
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
		throw BMSX_RUNTIME_ERROR("RenderGraph validation failed: expected exactly 1 present/exported texture");
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
	}

	for (const auto& res : m_texResources) {
		if (res.writerPasses.size() > 1) {
			for (size_t wi = 0; wi + 1 < res.writerPasses.size(); ++wi) {
				adj[res.writerPasses[wi]].push_back(res.writerPasses[wi + 1]);
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
		throw BMSX_RUNTIME_ERROR("RenderGraph cycle detected");
	}

	m_compiled = true;
}

bool RenderGraphRuntime::resolveExecutablePass(i32 orderIndex, bool hasOrder, ExecutablePass& out) {
	out.index = hasOrder ? m_passOrder[orderIndex] : orderIndex;
	if (!m_reachable.empty() && !m_reachable[out.index]) {
		return false;
	}
	out.pass = &m_passes[out.index];
	out.data = &m_setupData[out.index];
	out.targets = writeTargetsForPass(out.index);
	if (kRenderGraphVerboseLog) {
		std::fprintf(stderr, "[BMSX][RG] execute pass index=%d name=%s\n",
						out.index, out.pass->name.c_str());
	}
	return true;
}

void RenderGraphRuntime::execute(FrameData* frame) {
	if (!m_compiled) compile(frame);
	if (!m_realized) realizeAll();

	RenderGraphContext ctx(m_backend, this);
	const bool hasOrder = !m_passOrder.empty();
	const i32 passCount = static_cast<i32>(m_passes.size());
	const i32 total = hasOrder ? static_cast<i32>(m_passOrder.size()) : passCount;
	const BackendType backendType = m_backend->type();

#if !BMSX_ENABLE_GLES2
	if (backendType == BackendType::OpenGLES2) {
		throw BMSX_RUNTIME_ERROR("[RenderGraph] OpenGLES2 backend disabled at compile time.");
	}
#endif

	if (backendType != BackendType::OpenGLES2 && backendType != BackendType::Software) {
		throw BMSX_RUNTIME_ERROR("[RenderGraph] Backend type not supported.");
	}

	SoftwareBackend* softBackend = nullptr;
	if (backendType == BackendType::Software) {
		softBackend = static_cast<SoftwareBackend*>(m_backend);
	}
	u32* outputFb = nullptr;
	i32 outputWidth = 0;
	i32 outputHeight = 0;
	i32 outputPitch = 0;
	if (softBackend) {
		outputFb = softBackend->framebuffer();
		outputWidth = softBackend->width();
		outputHeight = softBackend->height();
		outputPitch = softBackend->pitch();
	}

	for (i32 oi = 0; oi < total; ++oi) {
		ExecutablePass exec;
		if (!resolveExecutablePass(oi, hasOrder, exec)) {
			continue;
		}
		const RenderGraphTexHandle colorHandle = exec.targets.color;
		const RenderGraphTexHandle depthHandle = exec.targets.depth;
		PassEncoder passEnc{};
		bool didBegin = false;

		switch (backendType) {
			case BackendType::OpenGLES2:
#if BMSX_ENABLE_GLES2
				if (colorHandle >= 0) {
					auto& colorRes = m_texResources[colorHandle];
					const i32 width = colorRes.desc.width;
					const i32 height = colorRes.desc.height;
					const void* fboHandle = getFBO(colorHandle, depthHandle);
					if (kRenderGraphVerboseLog) {
						std::fprintf(stderr,
										"[BMSX][RG] pass=%s colorHandle=%d depthHandle=%d fbo=%u size=%dx%d\n",
										exec.pass->name.c_str(), colorHandle, depthHandle,
										static_cast<unsigned>(reinterpret_cast<uintptr_t>(fboHandle)),
										width, height);
					}

					auto* gles = static_cast<OpenGLES2Backend*>(m_backend);
					gles->setRenderTarget(static_cast<GLuint>(reinterpret_cast<uintptr_t>(fboHandle)), width, height);
				}
				didBegin = beginClearPass(colorHandle, depthHandle, exec.index, exec.pass->name, passEnc);
#endif
				break;

			case BackendType::Software:
				if (colorHandle >= 0) {
					auto* colorTex = static_cast<SoftwareTexture*>(m_texResources[colorHandle].tex);
					const i32 width = colorTex->width;
					const i32 height = colorTex->height;
					softBackend->setFramebuffer(colorTex->data.data(), width, height,
												width * static_cast<i32>(sizeof(u32)));
				} else if (m_presentHandle >= 0) {
					const auto& reads = m_passReads[exec.index];
					const bool readsPresent = std::find(reads.begin(), reads.end(), m_presentHandle) != reads.end();
					if (readsPresent) {
						softBackend->setFramebuffer(outputFb, outputWidth, outputHeight, outputPitch);
					}
				}
				didBegin = beginClearPass(colorHandle, depthHandle, exec.index, exec.pass->name, passEnc);
				break;

			case BackendType::Headless:
				break;
		}

		exec.pass->execute(ctx, frame, *exec.data);
		if (didBegin) {
			m_backend->endRenderPass(passEnc);
		}
	}

	if (softBackend) {
		softBackend->setFramebuffer(outputFb, outputWidth, outputHeight, outputPitch);
	}
}

void RenderGraphRuntime::invalidate() {
	destroyResources();
	m_compiled = false;
	m_realized = false;
}

RenderGraphRuntime::WriteTargets RenderGraphRuntime::writeTargetsForPass(i32 passIndex) const {
	WriteTargets targets;
	const auto& writes = m_passWrites[passIndex];
	for (RenderGraphTexHandle handle : writes) {
		const auto& res = m_texResources[handle];
		if (res.desc.depth) {
			targets.depth = handle;
		} else {
			targets.color = handle;
		}
	}
	return targets;
}

bool RenderGraphRuntime::beginClearPass(RenderGraphTexHandle colorHandle,
										RenderGraphTexHandle depthHandle,
										i32 passIndex,
										const std::string& label,
										PassEncoder& passEnc) {
	if (colorHandle < 0) {
		return false;
	}
	auto& colorRes = m_texResources[colorHandle];
	const bool clearColor = colorRes.clearOnWrite.color.has_value() && colorRes.writerPasses[0] == passIndex;
	bool clearDepth = false;
	if (depthHandle >= 0) {
		const auto& depthRes = m_texResources[depthHandle];
		clearDepth = depthRes.clearOnWrite.depth.has_value() && depthRes.writerPasses[0] == passIndex;
	}
	if (!clearColor && !clearDepth) {
		return false;
	}

	RenderPassDesc desc;
	desc.label = label;
	if (clearColor) {
		const auto& clear = *colorRes.clearOnWrite.color;
		ColorAttachmentSpec colorSpec;
		colorSpec.clear = clear;
		desc.color = colorSpec;
	}
	if (clearDepth) {
		DepthAttachmentSpec depthSpec;
		depthSpec.clearDepth = *m_texResources[depthHandle].clearOnWrite.depth;
		desc.depth = depthSpec;
	}
	passEnc = m_backend->beginRenderPass(desc);
	return true;
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

	const BackendType backendType = m_backend->type();

	if (backendType == BackendType::OpenGLES2) {
#if !BMSX_ENABLE_GLES2
		throw BMSX_RUNTIME_ERROR("[RenderGraph] OpenGLES2 backend disabled at compile time.");
#else
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
				TextureParams params;
					params.srgb = false;
					res.tex = gles->createTexture(nullptr, res.desc.width, res.desc.height, params);
					auto* glTex = OpenGLES2Backend::asTexture(res.tex);
					const GLuint fbo = createGLES2ColorFramebuffer(glTex->id);
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
#endif
		m_realized = true;
		return;
	}

	if (backendType == BackendType::Software) {
		for (i32 i = 1; i < static_cast<i32>(m_texResources.size()); ++i) {
			auto& res = m_texResources[i];

			if (res.desc.depth) {
				auto* depth = new SoftwareDepthTarget{};
				depth->width = res.desc.width;
				depth->height = res.desc.height;
				res.tex = reinterpret_cast<TextureHandle>(depth);
				continue;
			}

			auto* tex = new SoftwareTexture{};
			tex->width = res.desc.width;
			tex->height = res.desc.height;
			tex->data.resize(static_cast<size_t>(tex->width) * static_cast<size_t>(tex->height));
			res.tex = reinterpret_cast<TextureHandle>(tex);
			res.fboColorOnly = reinterpret_cast<void*>(tex);
		}

		m_realized = true;
		return;
	}

	throw BMSX_RUNTIME_ERROR("[RenderGraph] Backend type not supported.");
}

void RenderGraphRuntime::destroyResources() {
	const BackendType backendType = m_backend->type();

	if (backendType == BackendType::OpenGLES2) {
#if BMSX_ENABLE_GLES2
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
		return;
#else
		throw BMSX_RUNTIME_ERROR("[RenderGraph] OpenGLES2 backend disabled at compile time.");
#endif
	}

	if (backendType == BackendType::Software) {
		for (i32 i = 1; i < static_cast<i32>(m_texResources.size()); ++i) {
			auto& res = m_texResources[i];
			if (res.desc.depth) {
				delete static_cast<SoftwareDepthTarget*>(res.tex);
			} else {
				delete static_cast<SoftwareTexture*>(res.tex);
			}
			res = InternalTexResource{};
		}
		m_realized = false;
		return;
	}

	for (i32 i = 1; i < static_cast<i32>(m_texResources.size()); ++i) {
		m_texResources[i] = InternalTexResource{};
	}
	m_realized = false;
}

void* RenderGraphRuntime::ensureFBO(RenderGraphTexHandle color, RenderGraphTexHandle depth) {
	(void)depth;
	const BackendType backendType = m_backend->type();
	if (backendType == BackendType::OpenGLES2) {
#if !BMSX_ENABLE_GLES2
		throw BMSX_RUNTIME_ERROR("[RenderGraph] OpenGLES2 backend disabled at compile time.");
#else
		auto& colorRes = m_texResources[color];
		auto it = colorRes.fboWithDepth.find(depth);
		if (it != colorRes.fboWithDepth.end()) return it->second;

		auto* glTex = OpenGLES2Backend::asTexture(colorRes.tex);
		auto& depthRes = m_texResources[depth];
		auto* depthTarget = static_cast<GLES2DepthTarget*>(depthRes.tex);

			const GLuint fbo = createGLES2ColorFramebuffer(glTex->id);
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
#endif
	}

	if (backendType == BackendType::Software) {
		return m_texResources[color].fboColorOnly;
	}

	throw BMSX_RUNTIME_ERROR("[RenderGraph] Backend type not supported.");
}

} // namespace bmsx
