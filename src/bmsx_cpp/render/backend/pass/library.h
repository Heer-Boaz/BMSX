/*
 * library.h - Render pass library and registry
 *
 * Manages render pass registration, state, and execution.
 */

#ifndef BMSX_RENDERPASSLIB_H
#define BMSX_RENDERPASSLIB_H

#include "../backend.h"
#include "../../lighting/system.h"
#include "../../shared/submissions.h"
#include <string>
#include <vector>
#include <unordered_map>
#include <functional>
#include <memory>
#include <any>
#include <optional>
#include <stdexcept>
#include <utility>

namespace bmsx {

class GameView;
class RenderGraphRuntime;
class RenderGraphContext;

/* ============================================================================
 * Render pass state types
 * ============================================================================ */

struct SkyboxPipelineState {
	// Camera view matrix for skybox
	std::array<f32, 16> skyboxView;
};

struct MeshBatchPipelineState {
	i32 width = 0;
	i32 height = 0;
	// Additional mesh batch state
};

struct ParticlePipelineState {
	i32 width = 0;
	i32 height = 0;
	i32 ambientMode = 0;
	f32 ambientFactor = 1.0f;
};

struct Framebuffer2DPipelineState {
	i32 width = 0;
	i32 height = 0;
	i32 baseWidth = 0;
	i32 baseHeight = 0;
	TextureHandle colorTex = nullptr;
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

struct CRTPipelineState {
	i32 width = 0;
	i32 height = 0;
	i32 baseWidth = 0;
	i32 baseHeight = 0;
	i32 srcWidth = 0;
	i32 srcHeight = 0;
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
	// View state
	struct {
		std::array<f32, 3> camPos;
		std::array<f32, 16> viewProj;
		std::array<f32, 16> skyboxView;
		std::array<f32, 16> proj;
	} view;

	LightingFrameState lighting;

	// Fog state
	struct {
		f32 fogD50;
		f32 fogStart;
		std::array<f32, 3> fogColorLow;
		std::array<f32, 3> fogColorHigh;
		f32 fogYMin;
		f32 fogYMax;
	} fog;
};

/* ============================================================================
 * Render pass definition
 * ============================================================================ */

using RenderPassId = std::string;
using RenderPassInstanceHandle = void*;

struct RenderPassDef {
	RenderPassId id;
	std::string name;

	// Shader code (optional)
	std::string vsCode;
	std::string fsCode;

	// Binding layout description
	struct BindingLayout {
		std::vector<std::string> uniforms;
		std::vector<std::string> textures;
		std::vector<std::string> samplers;
	};
	std::optional<BindingLayout> bindingLayout;

	enum class RenderGraphSlot {
		FrameColor,
		FrameDepth,
		FrameHistoryA,
		FrameHistoryB,
		DeviceColor,
	};

	struct RenderGraphPassContext {
		GameView* view = nullptr;
		bool deviceColorEnabled = false;
		std::function<TextureHandle(RenderGraphSlot)> getTexture;
	};

	struct RenderPassGraphDef {
		enum class PresentInput {
			Auto,
			FrameColor,
			DeviceColor,
		};
		std::vector<RenderGraphSlot> reads;
		std::vector<RenderGraphSlot> writes;
		PresentInput presentInput = PresentInput::Auto;
		bool skip = false;
		std::function<std::any(const RenderGraphPassContext&)> buildState;
	};
	std::optional<RenderPassGraphDef> graph;

	// Execution callbacks
	std::function<void(GPUBackend*, void*, std::any&)> exec;
	std::function<void(GPUBackend*, std::any&)> prepare;
	std::function<void(GPUBackend*)> bootstrap;

	// Pass behavior flags
	bool stateOnly = false;     // No rendering, just state management
	bool present = false;       // Is this a presentation pass
	bool writesDepth = false;
	bool depthTest = false;
	bool depthWrite = false;

	// Should this pass execute this frame
	std::function<bool()> shouldExecute;
};

/* ============================================================================
 * Render pass token
 *
 * Handle for enabling/disabling passes at runtime.
 * ============================================================================ */

struct RenderPassToken {
	RenderPassId id;
	std::function<void()> enable;
	std::function<void()> disable;
	std::function<void(bool)> set;
	std::function<bool()> isEnabled;
};

/* ============================================================================
 * RenderPassLibrary
 * ============================================================================ */

class RenderPassLibrary {
public:
	explicit RenderPassLibrary(GPUBackend* backend);
	~RenderPassLibrary();

	// Register builtin passes based on backend type
	void registerBuiltin();

	// Pass registration
	void registerPass(const RenderPassDef& desc);
	bool has(const std::string& id) const;

	// State management
	template<typename T>
	void setState(const std::string& id, T&& state) {
		auto it = m_registered.find(id);
		if (it == m_registered.end()) {
			throw BMSX_RUNTIME_ERROR("Pipeline '" + id + "' not found");
		}
		it->second.state = std::forward<T>(state);
	}

	template<typename T>
	T getState(const std::string& id) const {
		auto it = m_registered.find(id);
		if (it == m_registered.end()) {
			throw BMSX_RUNTIME_ERROR("Pipeline '" + id + "' not found");
		}
		return std::any_cast<T>(it->second.state);
	}

	template<typename T>
	T& getStateRef(const std::string& id) {
		auto it = m_registered.find(id);
		if (it == m_registered.end()) {
			throw BMSX_RUNTIME_ERROR("Pipeline '" + id + "' not found");
		}
		return std::any_cast<T&>(it->second.state);
	}

	template<typename T>
	const T& getStateRef(const std::string& id) const {
		auto it = m_registered.find(id);
		if (it == m_registered.end()) {
			throw BMSX_RUNTIME_ERROR("Pipeline '" + id + "' not found");
		}
		return std::any_cast<const T&>(it->second.state);
	}

	// Pass execution
	void execute(const std::string& id, void* fbo);

	// Pass list access
	const std::vector<RenderPassDef>& getPipelinePasses() const { return m_passes; }
	i32 findPipelinePassIndex(const std::string& id) const;

	// Enable/disable passes
	void setPassEnabled(const std::string& id, bool enabled);
	bool isPassEnabled(const std::string& id) const;

	// Create pass token for runtime control
	RenderPassToken createPassToken(const std::string& id, bool initialEnabled = true);

	// Build render graph from current pass registry
	std::unique_ptr<RenderGraphRuntime> buildRenderGraph(GameView* view, LightingSystem& lightingSystem);

	// Resource validation
	void validatePassResources(const std::string& passId);

private:
	struct RegisteredPassRec {
		std::string id;
		std::function<void(GPUBackend*, void*, std::any&)> exec;
		std::function<void(GPUBackend*, std::any&)> prepare;
		RenderPassInstanceHandle pipelineHandle = nullptr;
		std::any state;
		std::optional<RenderPassDef::BindingLayout> bindingLayout;
		bool present = false;
	};

	void registerBuiltinPassesSoftware();
	void registerBuiltinPassesOpenGLES2();

	GPUBackend* m_backend;
	std::vector<RenderPassDef> m_passes;
	std::unordered_map<std::string, RegisteredPassRec> m_registered;
	std::unordered_map<std::string, bool> m_passEnabled;
	std::unordered_map<std::string, RenderPassToken> m_tokensById;
};

} // namespace bmsx

#endif // BMSX_RENDERPASSLIB_H
