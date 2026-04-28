#pragma once

namespace bmsx {

class CartBootState {
public:
	void reset();
	bool processProgramReloadRequest();
	bool processPending();

private:
	void prepareIfNeeded();
	bool pollSystemBootRequest();
	void setReadyFlag(bool value);
	void request();

	bool m_prepared = false;
	bool m_pending = false;
};

} // namespace bmsx
