/*
 * library.h - Render pass library and registry
 *
 * Manages render pass registration, state, and execution.
 */

#ifndef BMSX_RENDERPASSLIB_H
#define BMSX_RENDERPASSLIB_H

#include "../backend.h"
#include "../../graph/graph.h"
#include "../../lighting/system.h"
#include "../../shared/submissions.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include <array>
#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <type_traits>
#include <utility>

namespace bmsx {

class GameView;
class RenderGraphRuntime;
class Runtime;
struct GxGpuCommandBuffer;
struct VdpRpuFrameOutput;
enum class Host2DKind : u8;
using Host2DRef = const void*;

void writeRenderPassViewportSize(i32& width, i32& height, i32& baseWidth, i32& baseHeight, const GameView& view);

/* ============================================================================
 * Render pass state types
 * ============================================================================ */

struct Framebuffer2DPipelineState {
	i32 width = 0;
	i32 height = 0;
	i32 baseWidth = 0;
	i32 baseHeight = 0;
	TextureHandle colorTex = nullptr;
};

struct VdpRpuPipelineState {
	i32 width = 0;
	i32 height = 0;
	const VdpRpuFrameOutput* frame = nullptr;
};

struct GxGpuPipelineState {
	i32 width = 0;
	i32 height = 0;
	const GxGpuCommandBuffer* commandBuffer = nullptr;
	u32 statusWord = 0u;
	u32 displayModeWord = 0u;
	u32 displayStartWord = 0u;
	u32 horizontalDisplayRangeWord = 0u;
	u32 verticalDisplayRangeWord = 0u;
	const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>* vramSnapshotBytes = nullptr;
	u32 vramSnapshotSerial = 0u;
};

struct CRTPipelineOptions {
	bool applyNoise = true;
	f32 noiseIntensity = 0.4f;
	bool applyColorBleed = true;
	std::array<f32, 3> colorBleed = {0.02f, 0.0f, 0.0f};
	bool applyScanlines = true;
	bool applyBlur = true;
	bool applyGlow = true;
	bool applyFringing = true;
	bool applyAperture = false;
	f32 blurIntensity = 0.6f;
	std::array<f32, 3> glowColor = {0.12f, 0.10f, 0.09f};
};

struct PresentPipelineState {
	i32 width = 0;
	i32 height = 0;
	i32 srcWidth = 0;
	i32 srcHeight = 0;
	TextureHandle colorTex = nullptr;
	TextureHandle targetColorTex = nullptr;
};

struct CRTPipelineState {
	i32 width = 0;
	i32 height = 0;
	i32 baseWidth = 0;
	i32 baseHeight = 0;
	i32 srcWidth = 0;
	i32 srcHeight = 0;
	f32 time = 0.0f;
	TextureHandle colorTex = nullptr;
	CRTPipelineOptions options;
};

struct DeviceQuantizePipelineState {
	i32 width = 0;
	i32 height = 0;
	i32 baseWidth = 0;
	i32 baseHeight = 0;
	TextureHandle colorTex = nullptr;
	i32 ditherType = 0;
};

struct FrameSharedState {
	struct {
		std::array<f32, 3> camPos;
		std::array<f32, 16> viewProj;
		std::array<f32, 16> viewRotationInverse;
		std::array<f32, 16> proj;
	} view;

	LightingFrameState lighting;

	struct {
		f32 fogD50;
		f32 fogStart;
		std::array<f32, 3> fogColorLow;
		std::array<f32, 3> fogColorHigh;
		f32 fogYMin;
		f32 fogYMax;
	} fog;
};

struct Host2DPipelineState {
	i32 width = 0;
	i32 height = 0;
	i32 overlayWidth = 0;
	i32 overlayHeight = 0;
	f64 time = 0.0;
	f64 delta = 0.0;
};

struct HostOverlayPipelineState : Host2DPipelineState {
	const Host2DKind* commandKinds = nullptr;
	const Host2DRef* commandRefs = nullptr;
	size_t commandCount = 0;
};

using HostMenuPipelineState = Host2DPipelineState;

struct RenderPassStateStorage {
	GxGpuPipelineState gxGpu;
	Framebuffer2DPipelineState framebuffer2D;
	PresentPipelineState present;
	CRTPipelineState crt;
	DeviceQuantizePipelineState deviceQuantize;
	FrameSharedState frameShared;
	HostOverlayPipelineState hostOverlay;
	HostMenuPipelineState hostMenu;
};

/* ============================================================================
 * Render pass definition
 * ============================================================================ */

using RenderPassId = std::string;
using RenderPassInstanceHandle = void*;

struct RenderPassDef {
	RenderPassId id;
	std::string name;

	std::string vsCode;
	std::string fsCode;

	struct BindingLayout {
		std::vector<std::string> uniforms;
		std::vector<std::string> textures;
		std::vector<std::string> samplers;
	};
	std::optional<BindingLayout> bindingLayout;

	using RenderGraphSlot = bmsx::RenderGraphSlot;
	using RenderGraphPassContext = bmsx::RenderGraphPassContext;

	struct RenderPassGraphDef {
		using PresentInput = bmsx::RenderGraphPresentInput;
		std::vector<bmsx::RenderGraphSlot> reads;
		std::vector<bmsx::RenderGraphSlot> writes;
		PresentInput presentInput = PresentInput::Auto;
		bool skip = false;
		void (*writeState)(const RenderGraphPassContext&, RenderPassStateStorage&) = nullptr;
	};
	std::optional<RenderPassGraphDef> graph;

	void (*exec)(GPUBackend*, GameView*, void*, RenderPassStateStorage&, void*) = nullptr;
	void (*bootstrap)(GPUBackend*, void*) = nullptr;
	bool (*shouldExecute)(GameView*, void*) = nullptr;
	void* context = nullptr;

	bool stateOnly = false;
	bool present = false;
	bool writesDepth = false;
	bool depthTest = false;
	bool depthWrite = false;
};

template<typename Backend, typename State, State RenderPassStateStorage::* StateMember, void (*Render)(Backend&, const State&)>
void executeStateRenderPass(GPUBackend* backend, GameView*, void*, RenderPassStateStorage& state, void*) {
	auto& typedBackend = *static_cast<Backend*>(backend);
	const auto& typedState = state.*StateMember;
	Render(typedBackend, typedState);
}

template<typename Backend, typename Pipeline, typename State, State RenderPassStateStorage::* StateMember, void (*Render)(Backend&, Pipeline&, const State&)>
void executePipelineRenderPass(GPUBackend* backend, GameView*, void*, RenderPassStateStorage& state, void* context) {
	auto& typedBackend = *static_cast<Backend*>(backend);
	auto& typedPipeline = *static_cast<Pipeline*>(context);
	const auto& typedState = state.*StateMember;
	Render(typedBackend, typedPipeline, typedState);
}

template<typename Backend, void (*Bootstrap)(Backend&)>
void bootstrapBackendRenderPass(GPUBackend* backend, void*) {
	auto& typedBackend = *static_cast<Backend*>(backend);
	Bootstrap(typedBackend);
}

void setPresentationHistoryGraph(RenderPassDef& desc, RenderPassDef::RenderGraphSlot historySlot);
bool shouldUpdatePresentationHistoryA(GameView* view, void* context);
bool shouldUpdatePresentationHistoryB(GameView* view, void* context);
void setFramebuffer2DGraph(RenderPassDef& desc);
void setGxGpuGraph(RenderPassDef& desc);
void setAutoPresentGraph(RenderPassDef& desc);
void setAutoCRTGraph(RenderPassDef& desc);
void setDeviceQuantizeGraph(RenderPassDef& desc);
bool shouldExecuteFramebuffer2DPass(GameView* view, void*);
bool shouldExecuteAutoPresentPass(GameView* view, void*);
bool shouldExecuteAutoCRTPass(GameView* view, void*);
bool shouldExecuteDeviceQuantizePass(GameView* view, void*);
void registerFrameStatePasses(RenderPassLibrary& registry);

/* ============================================================================
 * RenderPassLibrary
 * ============================================================================ */

class RenderPassLibrary {
public:
	RenderPassLibrary(GPUBackend* backend, GameView* view);
	~RenderPassLibrary();

	GameView* view() const { return m_view; }

	void registerPass(const RenderPassDef& desc);
	bool has(const std::string& id) const;

	template<typename T>
	T& getStateRef(const std::string& id) {
		auto it = m_registered.find(id);
		if (it == m_registered.end()) {
			throw BMSX_RUNTIME_ERROR("Render pass '" + id + "' not found");
		}
		return stateRef<T>(it->second.state);
	}

	void execute(const std::string& id, void* fbo);
	void writeGraphState(const std::string& id, const RenderPassDef::RenderGraphPassContext& ctx, void (*writeState)(const RenderGraphPassContext&, RenderPassStateStorage&));

	const std::vector<RenderPassDef>& getPipelinePasses() const { return m_passes; }
	i32 findPipelinePassIndex(const std::string& id) const;

	void setPassEnabled(const std::string& id, bool enabled);
	bool isPassEnabled(const std::string& id) const;

	std::unique_ptr<RenderGraphRuntime> buildRenderGraph(GameView* view, LightingSystem& lightingSystem);

private:
	struct RegisteredPassRec {
		std::string id;
		void (*exec)(GPUBackend*, GameView*, void*, RenderPassStateStorage&, void*) = nullptr;
		void* context = nullptr;
		RenderPassInstanceHandle pipelineHandle = nullptr;
		RenderPassStateStorage state;
		std::optional<RenderPassDef::BindingLayout> bindingLayout;
		bool present = false;
	};

	template<typename T>
	static T& stateRef(RenderPassStateStorage& state) {
		if constexpr (std::is_same_v<T, Framebuffer2DPipelineState>) return state.framebuffer2D;
		else if constexpr (std::is_same_v<T, PresentPipelineState>) return state.present;
		else if constexpr (std::is_same_v<T, CRTPipelineState>) return state.crt;
		else if constexpr (std::is_same_v<T, DeviceQuantizePipelineState>) return state.deviceQuantize;
		else if constexpr (std::is_same_v<T, FrameSharedState>) return state.frameShared;
		else if constexpr (std::is_same_v<T, HostOverlayPipelineState>) return state.hostOverlay;
		else if constexpr (std::is_same_v<T, HostMenuPipelineState>) return state.hostMenu;
		else static_assert(!std::is_same_v<T, T>, "Unsupported render pass state type");
	}

	template<typename T>
	static const T& stateRef(const RenderPassStateStorage& state) {
		return stateRef<T>(const_cast<RenderPassStateStorage&>(state));
	}

	GPUBackend* m_backend;
	GameView* m_view;
	std::vector<RenderPassDef> m_passes;
	std::unordered_map<std::string, RegisteredPassRec> m_registered;
	std::unordered_map<std::string, bool> m_passEnabled;
};

} // namespace bmsx

#endif // BMSX_RENDERPASSLIB_H
