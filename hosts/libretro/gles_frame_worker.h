#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/gpu_command_storage.h"
#include "presentation_state.h"
#include "host_overlay_menu.h"

#include <array>
#include <condition_variable>
#include <exception>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

namespace bmsx {

class Runtime;
class LibretroInput;
class OpenGLES2Backend;

// The worker owns the live scheduler and immutable frame publication. The caller
// keeps the frontend GL context and consumes commands, scanout, CRT and overlays.
// run() joins every publication before returning machine ownership; it admits no
// next-frame input or cycle grant while the selected presentation is consumed.
// The caller reacquires backend context state before this interval if an external
// frontend used GL. Nested jobs within one owned interval need no invalidation.
class GlesFrameWorker {
public:
	GlesFrameWorker(Runtime& runtime, VideoPresenter& presenter, LibretroInput& input,
		RenderPresentationState& presentation, HostOverlayMenu& overlayMenu, bool singleGuestTick);
	~GlesFrameWorker();
	bool run(f64 currentTime, f64 deltaTime);

private:
	enum class Operation { Commands, Readback, ReplaceVram, Rumble, Present };
	struct Batch {
		Operation operation;
		GxGpuCommandStorage commands;
		GxGpuReadbackRequest readback;
		u64 snapshotSerial;
		unsigned rumblePort;
		u16 rumbleStrength;
		RenderPresentation presentation;
		HostResourceUsage usage;
	};
	static constexpr size_t QueueCapacity = 2;
	static constexpr size_t SubmissionCommandLimit = 128;
	void workerMain();
	void executeFrame(f64 hostDeltaMs);
	void publishSnapshot();
	void publishPresentation(i64 previousTickSequence);
	Batch& acquireBatch();
	u64 publishBatch();
	void waitConsumed(u64 sequence);
	static bool submitRumble(void* context, unsigned port, u16 strength);

	Runtime& m_runtime;
	OpenGLES2Backend& m_backend;
	LibretroInput& m_input;
	VideoPresenter& m_presenter;
	RenderPresentationState& m_presentation;
	HostOverlayMenu& m_overlayMenu;
	const bool m_singleGuestTick;
	bool m_rumbleApplied = false;
	std::unique_ptr<std::array<Batch, QueueCapacity>> m_batches;
	std::vector<u8> m_snapshotBytes;
	std::vector<u8> m_readbackBytes;
	u64 m_snapshotSerial = 0;
	std::mutex m_mutex;
	std::condition_variable m_workAvailable;
	std::condition_variable m_queueChanged;
	u64 m_readSequence = 0;
	u64 m_writeSequence = 0;
	f64 m_currentTime = 0;
	f64 m_deltaTime = 0;
	bool m_presented = false;
	bool m_overlayPresent = false;
	bool m_captureUsage = false;
	bool m_jobPending = false;
	bool m_frameDone = true;
	bool m_shutdown = false;
	std::exception_ptr m_workerError;
	std::exception_ptr m_submissionError;
	std::thread m_thread;
};

} // namespace bmsx
