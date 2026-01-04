/*
 * rendergraph.h - Render graph runtime for scheduling and executing passes
 *
 * Mirrors TypeScript RenderGraphRuntime concept.
 */

#ifndef BMSX_RENDERGRAPH_H
#define BMSX_RENDERGRAPH_H

#include "backend.h"
#include "render_types.h"
#include <any>
#include <array>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
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
using RenderGraphValueHandle = i32;

class RenderGraphRuntime;

class RenderGraphIO {
public:
	RenderGraphIO(RenderGraphRuntime* runtime, i32 passIndex);

	RenderGraphTexHandle createTex(const TexDesc& desc);
	void writeTex(RenderGraphTexHandle handle);
	void writeTex(RenderGraphTexHandle handle, const std::array<f32, 4>& clearColor);
	void writeTex(RenderGraphTexHandle handle, f32 clearDepth);
	void exportToBackbuffer(RenderGraphTexHandle handle);
	void readTex(RenderGraphTexHandle handle);

	RenderGraphValueHandle provideValue(const std::any& val);
	void readValue(RenderGraphValueHandle handle);

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
	const std::any& getValue(RenderGraphValueHandle handle) const;

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
		std::unordered_map<RenderGraphTexHandle, void*> fboWithDepth;
		std::vector<i32> writerPasses;
		std::vector<i32> readPasses;
		bool present = false;
		i32 exportPass = -1;
		i32 firstUse = -1;
		i32 lastUse = -1;
		ClearInfo clearOnWrite;
	};

	struct InternalValueResource {
		std::any val;
		i32 providerPass = -1;
		std::vector<i32> readPasses;
		i32 firstUse = -1;
		i32 lastUse = -1;
	};

	RenderGraphTexHandle allocTex(const TexDesc& desc, i32 passIndex);
	void readTex(RenderGraphTexHandle handle, i32 passIndex);
	void writeTex(RenderGraphTexHandle handle, i32 passIndex, const std::array<f32, 4>* clearColor, const f32* clearDepth);
	void exportToBackbuffer(RenderGraphTexHandle handle, i32 passIndex);

	RenderGraphValueHandle provideValue(const std::any& val, i32 passIndex);
	void readValue(RenderGraphValueHandle handle, i32 passIndex);

	TextureHandle getTexture(RenderGraphTexHandle handle) const;
	void* getFBO(RenderGraphTexHandle color, RenderGraphTexHandle depth);

	void realizeAll();
	void destroyResources();
	void* ensureFBO(RenderGraphTexHandle color, RenderGraphTexHandle depth);

	GPUBackend* m_backend;
	std::vector<RenderGraphPass> m_passes;
	std::vector<std::any> m_setupData;
	std::vector<std::vector<RenderGraphTexHandle>> m_passReads;
	std::vector<std::vector<RenderGraphTexHandle>> m_passWrites;
	std::vector<std::vector<RenderGraphValueHandle>> m_valueReads;
	std::vector<i32> m_passOrder;
	std::vector<bool> m_reachable;
	std::vector<InternalTexResource> m_texResources;
	std::vector<InternalValueResource> m_valueResources;

	bool m_compiled = false;
	bool m_realized = false;
	RenderGraphTexHandle m_presentHandle = -1;
	i32 m_nextHandle = 1;
};

} // namespace bmsx

#endif // BMSX_RENDERGRAPH_H
