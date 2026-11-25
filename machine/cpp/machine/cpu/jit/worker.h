#pragma once

#include <atomic>
#include <condition_variable>
#include <exception>
#include <mutex>
#include <thread>

#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/compiler.h"
#include "machine/cpu/jit/source.h"

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
	NativeSourceWorkspace& beginCapture(size_t instructionBound);
	const DecodedInstruction* captureInstruction(const DecodedInstruction& row) {
		return &m_decoded.emplace_back(row);
	}
	void submit(const NativeCodeBindings& bindings, NativeCompilationOptions options = {}, bool profile = false);
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
	// A run supplies its instructions and may also consume one skipped
	// instruction. Reuse the largest previously needed snapshot.
	std::vector<DecodedInstruction> m_decoded;
	NativeSourceWorkspace m_workspace;
	std::vector<NativeCodeSourcePage> m_sourcePages;
	NativeCodeBindings m_bindings;
	NativeCompilationOptions m_options;
	NativeCompiler m_compiler;
	std::vector<std::unique_ptr<NativeBlock>> m_blocks;
	std::exception_ptr m_error;
	u64 m_compilationNanoseconds = 0;
	bool m_profile = false;
	std::thread m_thread;
};

} // namespace bmsx
