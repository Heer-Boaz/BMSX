/*
 * graph.cpp - Render graph runtime implementation
 */

#include "graph.h"
#include "../backend/pass/library.h"
#include "../gameview.h"
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <stdexcept>

namespace {
constexpr bool kRenderGraphVerboseLog = false;
}

namespace bmsx {

namespace {

constexpr std::array<f32, 4> kFrameClearColor{0.0f, 0.0f, 0.0f, 1.0f};

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

RenderGraphTexHandle RenderGraphRuntime::graphHandle(RenderGraphSlot slot) const {
	switch (slot) {
		case RenderGraphSlot::FrameColor:
			return m_frameColorHandle;
		case RenderGraphSlot::FrameDepth:
			return m_frameDepthHandle;
		case RenderGraphSlot::FrameHistoryA:
			return m_frameHistoryAHandle;
		case RenderGraphSlot::FrameHistoryB:
			return m_frameHistoryBHandle;
		case RenderGraphSlot::DeviceColor:
			return m_deviceColorHandle;
	}
	return -1;
}

void RenderGraphRuntime::addPass(const RenderGraphPass& pass) {
	if (m_compiled) {
		throw BMSX_RUNTIME_ERROR("Cannot add passes after compilation");
	}
	m_passes.push_back(pass);
}

void RenderGraphRuntime::setupPass(const RenderGraphPass& pass, RenderGraphIO& io, FrameData*) {
	switch (pass.kind) {
		case RenderGraphPass::Kind::FrameTargets: {
			const i32 width = static_cast<i32>(pass.view->offscreenCanvasSize.x);
			const i32 height = static_cast<i32>(pass.view->offscreenCanvasSize.y);
			TexDesc colorDesc;
			colorDesc.width = width;
			colorDesc.height = height;
			colorDesc.name = "FrameColor";
			TexDesc depthDesc;
			depthDesc.width = width;
			depthDesc.height = height;
			depthDesc.name = "FrameDepth";
			depthDesc.depth = true;
			TexDesc historyADesc;
			historyADesc.width = width;
			historyADesc.height = height;
			historyADesc.name = "FrameHistoryA";
			historyADesc.initialClearColor = kFrameClearColor;
			TexDesc historyBDesc;
			historyBDesc.width = width;
			historyBDesc.height = height;
			historyBDesc.name = "FrameHistoryB";
			historyBDesc.initialClearColor = kFrameClearColor;
			m_frameColorHandle = io.createTex(colorDesc);
			m_frameDepthHandle = io.createTex(depthDesc);
			m_frameHistoryAHandle = io.createTex(historyADesc);
			m_frameHistoryBHandle = io.createTex(historyBDesc);
			m_deviceColorHandle = -1;
			if (pass.deviceColorEnabled) {
				TexDesc deviceDesc;
				deviceDesc.width = width;
				deviceDesc.height = height;
				deviceDesc.name = "DeviceColor";
				deviceDesc.transient = true;
				m_deviceColorHandle = io.createTex(deviceDesc);
			}
			io.exportToBackbuffer(m_frameHistoryAHandle);
			break;
		}
		case RenderGraphPass::Kind::FrameClear:
			io.writeTex(m_frameColorHandle);
			io.writeTex(m_frameDepthHandle);
			break;
		case RenderGraphPass::Kind::FrameResolve:
			io.writeTex(m_frameColorHandle);
			break;
		case RenderGraphPass::Kind::Registered:
			if (pass.isPresent) {
				io.readTex(m_frameHistoryAHandle);
				io.readTex(m_frameHistoryBHandle);
			} else if (!pass.reads.empty() || !pass.writes.empty()) {
				for (const auto& slot : pass.reads) {
					if (slot != RenderGraphSlot::DeviceColor || m_deviceColorHandle >= 0) {
						io.readTex(graphHandle(slot));
					}
				}
				for (const auto& slot : pass.writes) {
					io.writeTex(graphHandle(slot));
				}
			} else if (!pass.isStateOnly) {
				io.writeTex(m_frameColorHandle);
				if (pass.writesDepth) io.writeTex(m_frameDepthHandle);
				else if (pass.depthTest) io.readTex(m_frameDepthHandle);
			}
			break;
	}
}

void RenderGraphRuntime::executePass(RenderGraphPass& pass, RenderGraphContext& ctx, FrameData* frame) {
	switch (pass.kind) {
		case RenderGraphPass::Kind::FrameTargets:
			break;
		case RenderGraphPass::Kind::FrameClear: {
			GPUBackend* backend = pass.view->backend();
			RenderPassDesc clearDesc;
			ColorAttachmentSpec colorSpec;
			colorSpec.tex = ctx.getTexture(m_frameColorHandle);
			colorSpec.clear = std::array<f32, 4>{0.0f, 0.0f, 0.0f, 1.0f};
			clearDesc.color = colorSpec;
			DepthAttachmentSpec depthSpec;
			depthSpec.tex = ctx.getTexture(m_frameDepthHandle);
			depthSpec.clearDepth = 1.0f;
			clearDesc.depth = depthSpec;
			auto clearPass = backend->beginRenderPass(clearDesc);
			backend->endRenderPass(clearPass);
			break;
		}
		case RenderGraphPass::Kind::FrameResolve:
			pass.registry->execute("frame_resolve", nullptr);
			break;
		case RenderGraphPass::Kind::Registered: {
			if (!pass.registry->isPassEnabled(pass.passId)) return;
			if (pass.shouldExecute && !pass.shouldExecute(pass.view, pass.passContext)) return;

			if (pass.writeState) {
				RenderGraphPassContext passCtx;
				passCtx.view = pass.view;
				passCtx.time = frame->time;
				passCtx.delta = frame->delta;
				passCtx.frameIndex = frame->frameIndex;
				passCtx.deviceColorEnabled = pass.deviceColorEnabled;
				passCtx.graphContext = &ctx;
				passCtx.textureHandles = {
					m_frameColorHandle,
					m_frameDepthHandle,
					m_frameHistoryAHandle,
					m_frameHistoryBHandle,
					m_deviceColorHandle,
				};
				pass.registry->writeGraphState(pass.passId, passCtx, pass.writeState);
			}

			if (pass.isPresent || pass.isStateOnly) {
				pass.registry->execute(pass.passId, nullptr);
				return;
			}

			RenderGraphTexHandle colorHandle = m_frameColorHandle;
			RenderGraphTexHandle depthHandle = (pass.writesDepth || pass.depthTest) ? m_frameDepthHandle : -1;
			if (!pass.writes.empty()) {
				colorHandle = -1;
				depthHandle = -1;
				for (const auto& slot : pass.writes) {
					if (slot == RenderGraphSlot::FrameDepth) depthHandle = m_frameDepthHandle;
					else colorHandle = graphHandle(slot);
				}
			}
			pass.registry->execute(pass.passId, ctx.getFBO(colorHandle, depthHandle));
			break;
		}
	}
	(void)frame;
}

void RenderGraphRuntime::compile(FrameData* frame) {
	if (m_compiled) return;

	m_passReads.assign(m_passes.size(), {});
	m_passWrites.assign(m_passes.size(), {});

	m_texResources.clear();
	m_texResources.resize(1);
	m_presentHandle = -1;
	m_nextHandle = 1;

	for (i32 i = 0; i < static_cast<i32>(m_passes.size()); ++i) {
		RenderGraphIO io(this, i);
		const auto& pass = m_passes[i];
		setupPass(pass, io, frame);
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

	auto markPass = [&](i32 start) {
		std::vector<i32> stack;
		stack.push_back(start);
		while (!stack.empty()) {
			const i32 p = stack.back();
			stack.pop_back();
			if (m_reachable[p]) continue;
			m_reachable[p] = true;
			for (RenderGraphTexHandle h : m_passReads[p]) {
				const auto& res = m_texResources[h];
				for (i32 wp : res.writerPasses) stack.push_back(wp);
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

	for (i32 oi = 0; oi < total; ++oi) {
		ExecutablePass exec;
		if (!resolveExecutablePass(oi, hasOrder, exec)) {
			continue;
		}
		const RenderGraphTexHandle colorHandle = exec.targets.color;
		const RenderGraphTexHandle depthHandle = exec.targets.depth;
		PassEncoder passEnc{};
		bool didBegin = false;

		if (colorHandle >= 0) {
			auto& colorRes = m_texResources[colorHandle];
			void* fboHandle = getFBO(colorHandle, depthHandle);
			if (kRenderGraphVerboseLog) {
				std::fprintf(stderr,
								"[BMSX][RG] pass=%s colorHandle=%d depthHandle=%d fbo=%p size=%dx%d\n",
								exec.pass->name.c_str(), colorHandle, depthHandle,
								fboHandle,
								colorRes.desc.width, colorRes.desc.height);
			}
			m_backend->activateRenderTarget(fboHandle, colorRes.desc.width, colorRes.desc.height);
		} else if (m_presentHandle >= 0) {
			const auto& reads = m_passReads[exec.index];
			const bool readsPresent = std::find(reads.begin(), reads.end(), m_presentHandle) != reads.end();
			if (readsPresent) {
				m_backend->activateDefaultRenderTarget();
			}
		}
		didBegin = beginClearPass(colorHandle, depthHandle, exec.index, exec.pass->name, passEnc);

		executePass(*exec.pass, ctx, frame);
		if (didBegin) {
			m_backend->endRenderPass(passEnc);
		}
	}
	m_backend->activateDefaultRenderTarget();
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

RenderGraphRuntime::InternalTexResource& RenderGraphRuntime::colorResourceForDepthAttachment(RenderGraphTexHandle colorHandle, RenderGraphTexHandle depthHandle) {
	auto& colorRes = m_texResources[colorHandle];
	if (colorRes.fboDepthHandle != nullptr && colorRes.fboDepthAttachment != depthHandle) {
		throw BMSX_RUNTIME_ERROR("[RenderGraph] Color target has more than one depth attachment.");
	}
	return colorRes;
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
	auto& colorRes = m_texResources[color];
	if (colorRes.fboDepthAttachment != depth) {
		throw BMSX_RUNTIME_ERROR("[RenderGraph] Requested color+depth framebuffer was not compiled.");
	}
	return colorRes.fboDepthHandle;
}

void RenderGraphRuntime::realizeAll() {
	if (m_realized) return;

	for (i32 i = 1; i < static_cast<i32>(m_texResources.size()); ++i) {
		auto& res = m_texResources[i];
		const TexDesc& desc = res.desc;
		if (desc.depth) {
			res.tex = m_backend->createDepthTexture(desc.width, desc.height);
			if (kRenderGraphVerboseLog) {
				std::fprintf(stderr,
							"[BMSX][RG] create depth handle=%d size=%dx%d\n",
							i, desc.width, desc.height);
			}
			continue;
		}

		const std::array<f32, 4>* initialClearColor = nullptr;
		if (desc.initialClearColor) {
			initialClearColor = &*desc.initialClearColor;
		}
		res.tex = m_backend->createColorTexture(desc.width, desc.height, initialClearColor);
		res.fboColorOnly = m_backend->createRenderTarget(res.tex, nullptr);
		if (kRenderGraphVerboseLog) {
			std::fprintf(stderr,
						"[BMSX][RG] create color handle=%d size=%dx%d target=%p\n",
						i, desc.width, desc.height, res.fboColorOnly);
		}
	}

	for (i32 passIndex = 0; passIndex < static_cast<i32>(m_passWrites.size()); ++passIndex) {
		const WriteTargets targets = writeTargetsForPass(passIndex);
		if (targets.color >= 0 && targets.depth >= 0) {
			auto& colorRes = colorResourceForDepthAttachment(targets.color, targets.depth);
			if (colorRes.fboDepthHandle == nullptr) {
				auto& depthRes = m_texResources[targets.depth];
				colorRes.fboDepthHandle = m_backend->createRenderTarget(colorRes.tex, depthRes.tex);
				colorRes.fboDepthAttachment = targets.depth;
				if (kRenderGraphVerboseLog) {
					std::fprintf(stderr,
								"[BMSX][RG] create color+depth target=%p colorHandle=%d depthHandle=%d\n",
								colorRes.fboDepthHandle, targets.color, targets.depth);
				}
			}
		}
	}

	m_realized = true;
}

void RenderGraphRuntime::destroyResources() {
	for (i32 i = 1; i < static_cast<i32>(m_texResources.size()); ++i) {
		auto& res = m_texResources[i];
		if (res.fboDepthHandle != nullptr && res.fboDepthHandle != res.fboColorOnly) {
			m_backend->destroyRenderTarget(res.fboDepthHandle);
		}
		if (res.fboColorOnly != nullptr) {
			m_backend->destroyRenderTarget(res.fboColorOnly);
		}
		if (res.tex != nullptr) {
			if (res.desc.depth) {
				m_backend->destroyDepthTexture(res.tex);
			} else {
				m_backend->destroyTexture(res.tex);
			}
		}
		res = InternalTexResource{};
	}
	m_realized = false;
}

} // namespace bmsx
