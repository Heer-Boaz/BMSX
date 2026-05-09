#pragma once

namespace bmsx {

class Runtime;

class CartBootState {
public:
		CartBootState(Runtime& runtime);
		void reset();
		bool processPending();

private:
		bool pollSystemBootRequest();
		void request();

		Runtime& m_runtime;

		bool m_pending = false;
};

} // namespace bmsx
