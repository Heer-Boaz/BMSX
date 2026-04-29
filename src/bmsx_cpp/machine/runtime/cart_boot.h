#pragma once

namespace bmsx {

class RomBootManager;
class Runtime;

class CartBootState {
public:
	CartBootState(Runtime& runtime, RomBootManager& bootManager);
	void reset();
	bool processProgramReloadRequest();
	bool processPending();

private:
	bool pollSystemBootRequest();
	void request();

	Runtime& m_runtime;
	RomBootManager& m_bootManager;
	bool m_pending = false;
};

} // namespace bmsx
