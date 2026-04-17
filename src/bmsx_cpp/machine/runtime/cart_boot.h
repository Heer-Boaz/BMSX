#pragma once

namespace bmsx {

class Runtime;

class CartBootState {
public:
	void reset(Runtime& runtime);
	void prepareIfNeeded(Runtime& runtime);
	bool pollSystemBootRequest(Runtime& runtime);
	bool processPending(Runtime& runtime);

private:
	void setReadyFlag(Runtime& runtime, bool value);
	void request(Runtime& runtime);

	bool m_prepared = false;
	bool m_pending = false;
};

} // namespace bmsx
