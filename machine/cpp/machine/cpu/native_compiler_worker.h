#pragma once

#include <atomic>
#include <condition_variable>
#include <exception>
#include <mutex>
#include <thread>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_compiler.h"

namespace bmsx {

// One bounded compilation slot. The CPU captures source while Idle, the worker
// owns all emission while Compiling, and the CPU consumes the result at Ready.
// No generated code or decoded-page state is published by the worker.
class NativeCompilerWorker {
public:
	NativeCompilerWorker();
	~NativeCompilerWorker();
	NativeCompilerWorker(const NativeCompilerWorker&) = delete;
	NativeCompilerWorker& operator=(const NativeCompilerWorker&) = delete;

	bool idle() const { return m_state.load(std::memory_order_acquire) == State::Idle; }
	bool ready() const { return m_state.load(std::memory_order_acquire) == State::Ready; }
	void submit(std::span<const NativeBlockSource> sources, ConstValueSpan constants,
		const NativeCodeBindings& bindings, NativeCompilationOptions options = {}, bool profile = false);
	void wait();
	std::vector<std::unique_ptr<NativeBlock>> take();
	u64 compilationNanoseconds() const { return m_compilationNanoseconds; }

private:
	enum class State : u8 { Idle, Compiling, Ready };
	void run();

	std::atomic<State> m_state{State::Idle};
	std::mutex m_mutex;
	std::condition_variable m_changed;
	bool m_stop = false;
	// A decoded page supplies at most one primary instruction per word and
	// one skipped instruction per segment. Reuse this storage across requests.
	std::array<DecodedInstruction, DECODED_PAGE_WORDS * 2u> m_decoded;
	std::array<NativeBlockInstruction, DECODED_PAGE_WORDS> m_instructions;
	std::vector<NativeBlockSource> m_sources;
	ConstValueSpan m_constants; // CPU owns immutable compilation input until take().
	NativeCodeBindings m_bindings;
	NativeCompilationOptions m_options;
	std::vector<std::unique_ptr<NativeBlock>> m_blocks;
	std::exception_ptr m_error;
	u64 m_compilationNanoseconds = 0;
	bool m_profile = false;
	std::thread m_thread;
};

} // namespace bmsx
