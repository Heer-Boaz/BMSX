#pragma once

#include <functional>

namespace bmsx {

class MicrotaskQueue {
public:
	virtual ~MicrotaskQueue() = default;
	virtual void queueMicrotask(std::function<void()> task) = 0;
	virtual void flush() = 0;
};

} // namespace bmsx
