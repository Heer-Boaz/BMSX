#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/gpu_command_storage.h"

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

// The caller keeps the frontend GL context. Only the live scheduler section runs
// on the worker; run() consumes every publication before returning machine ownership.
class GlesFrameWorker {
public:
	GlesFrameWorker(Runtime& runtime, OpenGLES2Backend& backend, LibretroInput& input);
	~GlesFrameWorker();
	void run(f64 hostDeltaMs);

private:
	enum class Operation { Commands, Readback, ReplaceVram, Rumble };
	struct Batch {
		Operation operation;
		GxGpuCommandStorage commands;
		GxGpuReadbackRequest readback;
		u64 snapshotSerial;
		unsigned rumblePort;
		u16 rumbleStrength;
	};
	static constexpr size_t QueueCapacity = 2;
	static constexpr size_t SubmissionCommandLimit = 128;
	void workerMain();
	void executeFrame(f64 hostDeltaMs);
	void publishSnapshot();
	Batch& acquireBatch();
	u64 publishBatch();
	void waitConsumed(u64 sequence);
	static bool submitRumble(void* context, unsigned port, u16 strength);

	Runtime& m_runtime;
	OpenGLES2Backend& m_backend;
	LibretroInput& m_input;
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
	f64 m_hostDeltaMs = 0;
	bool m_jobPending = false;
	bool m_frameDone = true;
	bool m_shutdown = false;
	std::exception_ptr m_workerError;
	std::exception_ptr m_submissionError;
	std::thread m_thread;
};

} // namespace bmsx
