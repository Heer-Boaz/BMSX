/*
 * graph.h - Render graph runtime for scheduling and executing passes
 */

#ifndef BMSX_RENDERGRAPH_H
#define BMSX_RENDERGRAPH_H

#include "../backend/backend.h"
#include "../shared/submissions.h"
#include <any>
#include <array>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

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

struct TexDesc {
	i32 width = 0;
	i32 height = 0;
	i32 format = 0;
	bool depth = false;
	std::string name;
	bool transient = false;
};

using RenderGraphTexHandle = i32;

class RenderGraphRuntime;

class RenderGraphIO {
public:
	RenderGraphIO(RenderGraphRuntime* runtime, i32 passIndex);

	RenderGraphTexHandle createTex(const TexDesc& desc);
	void writeTex(RenderGraphTexHandle handle);
	void exportToBackbuffer(RenderGraphTexHandle handle);
	void readTex(RenderGraphTexHandle handle);

private:
	RenderGraphRuntime* m_runtime;
	i32 m_passIndex;
};

/* ============================================================================
 * Render graph execution context
 * ============================================================================ */

class RenderGraphContext {
public:
	RenderGraphContext(GPUBackend* backend, RenderGraphRuntime* runtime);

	GPUBackend* backend() const { return m_backend; }
	TextureHandle getTexture(RenderGraphTexHandle handle) const;
	void* getFBO(RenderGraphTexHandle color, RenderGraphTexHandle depth);

private:
	GPUBackend* m_backend;
	RenderGraphRuntime* m_runtime;
};

/* ============================================================================
 * Render graph pass definition
 * ============================================================================ */

struct RenderGraphPass {
	std::string name;
	bool alwaysExecute = false;

	std::function<std::any(RenderGraphIO&, FrameData*)> setup;
	std::function<void(RenderGraphContext&, FrameData*, const std::any&)> execute;
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

	void addPass(const RenderGraphPass& pass);
	void compile(FrameData* frame);
	void execute(FrameData* frame);
	void invalidate();

	size_t passCount() const { return m_passes.size(); }

private:
	friend class RenderGraphIO;
	friend class RenderGraphContext;

	struct ClearInfo {
		std::optional<std::array<f32, 4>> color;
		std::optional<f32> depth;
	};

	struct InternalTexResource {
		TexDesc desc;
		TextureHandle tex = nullptr;
		void* fboColorOnly = nullptr;
		void* fboDepthHandle = nullptr;
		RenderGraphTexHandle fboDepthAttachment = -1;
		std::vector<i32> writerPasses;
		std::vector<i32> readPasses;
		bool present = false;
		i32 exportPass = -1;
		i32 firstUse = -1;
		i32 lastUse = -1;
		ClearInfo clearOnWrite;
	};

	struct WriteTargets {
		RenderGraphTexHandle color = -1;
		RenderGraphTexHandle depth = -1;
	};

	struct ExecutablePass {
		i32 index = -1;
		RenderGraphPass* pass = nullptr;
		const std::any* data = nullptr;
		WriteTargets targets;
	};

	TextureHandle getTexture(RenderGraphTexHandle handle) const;
	void* getFBO(RenderGraphTexHandle color, RenderGraphTexHandle depth);

	void realizeAll();
	void destroyResources();
	bool resolveExecutablePass(i32 orderIndex, bool hasOrder, ExecutablePass& out);
	WriteTargets writeTargetsForPass(i32 passIndex) const;
	bool beginClearPass(RenderGraphTexHandle color, RenderGraphTexHandle depth, i32 passIndex, const std::string& label, PassEncoder& passEnc);

	GPUBackend* m_backend;
	std::vector<RenderGraphPass> m_passes;
	std::vector<std::any> m_setupData;
	std::vector<std::vector<RenderGraphTexHandle>> m_passReads;
	std::vector<std::vector<RenderGraphTexHandle>> m_passWrites;
	std::vector<i32> m_passOrder;
	std::vector<bool> m_reachable;
	std::vector<InternalTexResource> m_texResources;

	bool m_compiled = false;
	bool m_realized = false;
	RenderGraphTexHandle m_presentHandle = -1;
	i32 m_nextHandle = 1;
};

} // namespace bmsx

#endif // BMSX_RENDERGRAPH_H
