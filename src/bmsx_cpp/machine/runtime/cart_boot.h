#pragma once

namespace bmsx {

class Runtime;

class CartBootState {
public:
	void reset(Runtime& runtime);
	bool processProgramReloadRequest(Runtime& runtime);
	bool processPending(Runtime& runtime);

private:
	void prepareIfNeeded(Runtime& runtime);
	bool pollSystemBootRequest(Runtime& runtime);
	void setReadyFlag(Runtime& runtime, bool value);
	void request(Runtime& runtime);

	bool m_prepared = false;
	bool m_pending = false;
};

} // namespace bmsx
