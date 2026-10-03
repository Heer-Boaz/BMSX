#include "protocol.hpp"
#include "linux_unit.hpp"
#include "workspace.hpp"

#include <csignal>
#include <fcntl.h>
#include <poll.h>
#include <sys/file.h>
#include <sys/signalfd.h>
#include <sys/stat.h>
#include <sys/wait.h>

extern char** environ;

class Fd {
public:
	int value;
	explicit Fd(int fd) : value(fd) {}
	~Fd() { if (value >= 0) close(value); }
	Fd(const Fd&) = delete;
	Fd& operator=(const Fd&) = delete;
};

static std::vector<char*> pointers(std::vector<std::string>& values) {
	std::vector<char*> result;
	result.reserve(values.size() + 1);
	for (auto& value : values) result.push_back(value.data());
	result.push_back(nullptr);
	return result;
}

static pid_t launch(Launch& command, LinuxUnit& unit) {
	auto args = pointers(command.args);
	auto env = pointers(command.env);
	int gate[2];
	if (pipe2(gate, O_CLOEXEC) != 0) throw ScopeError{"launch_gate", errno};
	Fd gate_input(gate[0]), gate_output(gate[1]);
	int pipe[2];
	if (pipe2(pipe, O_CLOEXEC) != 0) throw ScopeError{"exec_pipe", errno};
	Fd input(pipe[0]), output(pipe[1]);
	const pid_t child = fork();
	if (child == -1) throw ScopeError{"fork", errno};
	if (child == 0) {
		close(3);
		close(4);
		close(gate_output.value);
		// Nothing may exec (or fork) before the kernel scope owns this child.
		// Controller death before admission closes the gate without launching it.
		char admitted;
		ssize_t count;
		do { count = read(gate_input.value, &admitted, 1); } while (count < 0 && errno == EINTR);
		if (count != 1) _exit(125);
		sigset_t empty;
		sigemptyset(&empty);
		sigprocmask(SIG_SETMASK, &empty, nullptr);
		signal(SIGPIPE, SIG_DFL);
		// PATH resolution, including shebang launchers, uses the admitted environment.
		environ = env.data();
		// Workload group signals must not kill the supervisor that owns its lock.
		if (setpgid(0, 0) == 0 && chdir(command.cwd.c_str()) == 0) execvp(args[0], args.data());
		const int error = errno;
		(void)!write(output.value, &error, sizeof error);
		_exit(127);
	}
	try { unit.start(child); }
	catch (...) {
		close(gate_output.value); gate_output.value = -1;
		while (waitpid(child, nullptr, 0) < 0 && errno == EINTR) {}
		throw;
	}
	if (write(gate_output.value, "S", 1) != 1) throw ScopeError{"launch_admit", errno};
	close(output.value);
	output.value = -1;
	int error;
	ssize_t count;
	do { count = read(input.value, &error, sizeof error); } while (count < 0 && errno == EINTR);
	if (count == sizeof error) report_error({"exec", error});
	return child;
}

static void run(int signals, LinuxUnit& unit) {
	pid_t main_child = -1;
	bool retiring = false, releasing = false, joined = false;
	for (;;) {
		pollfd events[] = {{releasing ? -1 : 3, POLLIN, 0}, {signals, POLLIN, 0}};
		int result;
		do { result = poll(events, 2, -1); } while (result < 0 && errno == EINTR);
		if (result < 0) throw ScopeError{"poll", errno};
		if (events[0].revents) {
			char command;
			if (!read_exact(&command, 1)) { retiring = true; releasing = true; }
			else switch (command) {
				case 'S': {
					try {
						Launch request;
						// A host launch may cross a termination signal in flight.
						if (!retiring) main_child = launch(request, unit);
					}
					catch (const HostClosed&) { retiring = true; releasing = true; }
					catch (const ScopeError& error) {
						report_error(error);
						workload_exit(-1, 0);
						retiring = true;
					}
					break;
				}
				case 'K': retiring = true; break;
			}
		}
		if (events[1].revents) {
			signalfd_siginfo info;
			if (read(signals, &info, sizeof info) != sizeof info) throw ScopeError{"signal_read", errno};
			// Signals retire the workload, but only host EOF releases ownership.
			// Scratch remains owned until that explicit release.
			if (info.ssi_signo != SIGCHLD) {
				if (main_child == -1 && !retiring) workload_exit(-1, static_cast<int>(info.ssi_signo));
				retiring = true;
			}
		}
		bool empty = false;
		for (;;) {
			int code;
			const pid_t child = waitpid(-1, &code, WNOHANG);
			if (child == 0) break;
			if (child == -1) {
				if (errno == EINTR) continue;
				if (errno != ECHILD) throw ScopeError{"waitpid", errno};
				empty = true;
				break;
			}
			if (child == main_child) {
				workload_exit(WIFEXITED(code) ? WEXITSTATUS(code) : -1, WIFSIGNALED(code) ? WTERMSIG(code) : 0);
				retiring = true;
			}
		}
		if (retiring && !joined) {
			unit.stop(); // The same kernel membership barrier is used on reconnect.
			if (!empty) {
				int code;
				pid_t child;
				do { child = waitpid(main_child, &code, 0); } while (child < 0 && errno == EINTR);
				if (child < 0) throw ScopeError{"waitpid", errno};
				workload_exit(WIFEXITED(code) ? WEXITSTATUS(code) : -1, WIFSIGNALED(code) ? WTERMSIG(code) : 0);
			}
			drained(); joined = true;
		}
		if (joined && releasing) return;
	}
}

int main(int argc, char** argv) {
	if (argc < 2) return 2;
	try {
		signal(SIGPIPE, SIG_IGN);
		sigset_t mask;
		sigemptyset(&mask);
		for (int signal : {SIGCHLD, SIGTERM, SIGINT, SIGHUP}) sigaddset(&mask, signal);
		if (sigprocmask(SIG_BLOCK, &mask, nullptr) != 0) throw ScopeError{"signal_mask", errno};
		Fd signals(signalfd(-1, &mask, SFD_CLOEXEC));
		if (signals.value == -1) throw ScopeError{"signalfd", errno};
		Fd lock(open(argv[1], O_RDWR | O_CREAT | O_CLOEXEC, 0600));
		if (lock.value == -1) throw ScopeError{"lock_open", errno};
		if (flock(lock.value, LOCK_EX | LOCK_NB) != 0) {
			if (errno == EWOULDBLOCK) { status("busy\n"); return 0; }
			throw ScopeError{"lock", errno};
		}
		struct stat previous;
		if (fstat(lock.value, &previous) != 0) throw ScopeError{"lock_state", errno};
		// Only older supervisors wrote an unfinished marker; they had no kernel
		// scope to recover. Do not silently admit that incompatible old interval.
		if (previous.st_size != 0) { status("interrupted\n"); return 0; }
		char name[128];
		std::snprintf(name, sizeof name, "bmsx-codex-%llx-%llx.scope",
			static_cast<unsigned long long>(previous.st_dev), static_cast<unsigned long long>(previous.st_ino));
		LinuxUnit unit(name);
		unit.stop(); // Recover the previous kernel scope while holding the file lock.
		Workspace workspace(argc, argv);
		if (status("locked\n")) run(signals.value, unit);
		workspace.remove();
		return 0;

	} catch (const std::filesystem::filesystem_error& error) {
		report_error({"workspace", error.code().value()});
		return 1;
	} catch (const ScopeError& error) {
		report_error(error);
		return 1;
	}
}
