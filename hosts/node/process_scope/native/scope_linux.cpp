#include "protocol.hpp"

#include <csignal>
#include <fcntl.h>
#include <poll.h>
#include <sys/file.h>
#include <sys/prctl.h>
#include <sys/signalfd.h>
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

static pid_t launch(Launch& command) {
	auto args = pointers(command.args);
	auto env = pointers(command.env);
	int pipe[2];
	if (pipe2(pipe, O_CLOEXEC) != 0) throw ScopeError{"exec_pipe", errno};
	Fd input(pipe[0]), output(pipe[1]);
	const pid_t child = fork();
	if (child == -1) throw ScopeError{"fork", errno};
	if (child == 0) {
		close(3);
		close(4);
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
	close(output.value);
	output.value = -1;
	int error;
	ssize_t count;
	do { count = read(input.value, &error, sizeof error); } while (count < 0 && errno == EINTR);
	if (count == sizeof error) report_error({"exec", error});
	return child;
}

// These are unreaped children of this single-threaded subreaper, not a global
// process-tree snapshot. Their pids cannot be reused before our waitpid call.
static void kill_children() {
	char path[96];
	std::snprintf(path, sizeof path, "/proc/self/task/%d/children", getpid());
	FILE* children = std::fopen(path, "r");
	if (children == nullptr) throw ScopeError{"children_open", errno};
	pid_t child;
	while (std::fscanf(children, "%d", &child) == 1) {
		if (kill(child, SIGKILL) != 0 && errno != ESRCH) {
			const int error = errno;
			std::fclose(children);
			throw ScopeError{"kill_child", error};
		}
	}
	const bool failed = std::ferror(children);
	const int error = errno;
	std::fclose(children);
	if (failed) throw ScopeError{"children_read", error};
}

static void run(int signals) {
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
					try { Launch request; main_child = launch(request); }
					catch (const ScopeError& error) {
						report_error(error);
						workload_exit(-1, 0);
						retiring = true;
					}
					break;
				}
				case 'K': retiring = true; break;
				case 'R': retiring = true; releasing = true; break;
			}
		}
		if (events[1].revents) {
			signalfd_siginfo info;
			if (read(signals, &info, sizeof info) != sizeof info) throw ScopeError{"signal_read", errno};
			if (info.ssi_signo != SIGCHLD) { retiring = true; releasing = true; }
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
			if (empty) { drained(); joined = true; }
			else kill_children(); // Death reparents the next generation to us, regardless of setsid.
		}
		if (joined && releasing) return;
	}
}

int main(int argc, char** argv) {
	if (argc != 2) return 2;
	try {
		signal(SIGPIPE, SIG_IGN);
		if (prctl(PR_SET_CHILD_SUBREAPER, 1) != 0) throw ScopeError{"subreaper", errno};
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
		if (status("locked\n")) run(signals.value);
		return 0; // The lock outlives the last waitpid, even when Node was SIGKILLed.
	} catch (const ScopeError& error) {
		report_error(error);
		return 1;
	}
}
