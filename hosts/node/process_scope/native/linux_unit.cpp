#include "linux_unit.hpp"
#include "protocol.hpp"

#include <fcntl.h>
#include <memory>
#include <poll.h>
#include <linux/magic.h>
#include <sys/vfs.h>

using Message = std::unique_ptr<sd_bus_message, decltype(&sd_bus_message_unref)>;

static void bus_check(int code) {
	if (code < 0) throw ScopeError{"systemd_user_scope", -code};
}

LinuxUnit::LinuxUnit(std::string unit) : name(std::move(unit)) {
	// Only the host controller receives XDG_RUNTIME_DIR / the session-bus address.
	// They are not added to the explicit workload environment.
	struct statfs filesystem;
	if (statfs("/sys/fs/cgroup", &filesystem) < 0) throw ScopeError{"cgroup_mount", errno};
	if (filesystem.f_type != CGROUP2_SUPER_MAGIC) throw ScopeError{"cgroup_v2", ENOTSUP};
	bus_check(sd_bus_open_user(&bus));
}

LinuxUnit::~LinuxUnit() {
	sd_bus_slot_unref(slot);
	sd_bus_unref(bus);
}

int LinuxUnit::job_removed(sd_bus_message* message, void* data, sd_bus_error*) {
	uint32_t id;
	const char *path, *unit, *outcome;
	const int code = sd_bus_message_read(message, "uoss", &id, &path, &unit, &outcome);
	if (code < 0) return code;
	auto* owner = static_cast<LinuxUnit*>(data);
	if (owner->job == path) owner->result = outcome;
	return 1;
}

void LinuxUnit::watch_job() {
	result.clear();
	bus_check(sd_bus_match_signal(bus, &slot, "org.freedesktop.systemd1",
		"/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager", "JobRemoved", job_removed, this));
}

void LinuxUnit::wait_job(sd_bus_message* reply) {
	const char* path;
	bus_check(sd_bus_message_read(reply, "o", &path));
	job = path;
	while (result.empty()) {
		const int code = sd_bus_process(bus, nullptr);
		bus_check(code);
		if (code == 0) bus_check(sd_bus_wait(bus, UINT64_MAX));
	}
	slot = sd_bus_slot_unref(slot);
	if (result != "done") throw ScopeError{"systemd_job", EIO};
}

void LinuxUnit::start(pid_t child) {
	watch_job();
	sd_bus_message* raw = nullptr;
	bus_check(sd_bus_message_new_method_call(bus, &raw, "org.freedesktop.systemd1",
		"/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager", "StartTransientUnit"));
	Message message(raw, sd_bus_message_unref);
	bus_check(sd_bus_message_append(raw, "ss", name.c_str(), "fail"));
	bus_check(sd_bus_message_open_container(raw, 'a', "(sv)"));
	bus_check(sd_bus_message_append(raw, "(sv)", "PIDs", "au", 1, static_cast<uint32_t>(child)));
	bus_check(sd_bus_message_append(raw, "(sv)", "KillMode", "s", "control-group"));
	bus_check(sd_bus_message_append(raw, "(sv)", "KillSignal", "i", SIGKILL));
	bus_check(sd_bus_message_append(raw, "(sv)", "CollectMode", "s", "inactive-or-failed"));
	bus_check(sd_bus_message_close_container(raw));
	bus_check(sd_bus_message_append(raw, "a(sa(sv))", 0));
	sd_bus_message* response = nullptr;
	bus_check(sd_bus_call(bus, raw, 0, nullptr, &response));
	Message reply(response, sd_bus_message_unref);
	wait_job(response);
}

void LinuxUnit::stop() {
	sd_bus_error error = SD_BUS_ERROR_NULL;
	sd_bus_message* raw = nullptr;
	const int lookup = sd_bus_call_method(bus, "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
		"org.freedesktop.systemd1.Manager", "RefUnit", &error, nullptr, "s", name.c_str());
	const bool absent = sd_bus_error_has_name(&error, "org.freedesktop.systemd1.NoSuchUnit");
	sd_bus_error_free(&error);
	if (absent) return; // systemd cannot collect a scope with living members.
	bus_check(lookup);
	// RefUnit pins the object while GetUnit / ControlGroup / StopUnit run.
	// A fast natural exit must not let GC remove it between those operations.
	bus_check(sd_bus_call_method(bus, "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
		"org.freedesktop.systemd1.Manager", "GetUnit", nullptr, &raw, "s", name.c_str()));
	Message message(raw, sd_bus_message_unref);
	const char* object;
	bus_check(sd_bus_message_read(raw, "o", &object));
	char* group = nullptr;
	bus_check(sd_bus_get_property_string(bus, "org.freedesktop.systemd1", object,
		"org.freedesktop.systemd1.Scope", "ControlGroup", nullptr, &group));
	const std::string events = "/sys/fs/cgroup" + std::string(group) + "/cgroup.events";
	const bool has_group = group[0] != '\0';
	free(group);
	const int fd = has_group ? open(events.c_str(), O_RDONLY | O_CLOEXEC) : -1;
	if (has_group && fd < 0 && errno != ENOENT) throw ScopeError{"cgroup_events_open", errno};
	// Open before stopping: a completed systemd job alone is not a proof that
	// a process stuck in uninterruptible kernel IO has actually exited.
	try {
		watch_job();
		sd_bus_message* response = nullptr;
		bus_check(sd_bus_call_method(bus, "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
			"org.freedesktop.systemd1.Manager", "StopUnit", nullptr, &response, "ss", name.c_str(), "replace"));
		Message reply(response, sd_bus_message_unref);
		wait_job(response);
		if (fd >= 0) {
			for (;;) {
				char buffer[256];
				const auto count = pread(fd, buffer, sizeof buffer - 1, 0);
				if (count < 0) {
					if (errno == ENODEV) break; // The kernel removed the now-empty cgroup.
					throw ScopeError{"cgroup_events_read", errno};
				}
				buffer[count] = '\0';
				if (std::string_view(buffer).find("populated 0\n") != std::string_view::npos) break;
				pollfd event{fd, POLLPRI, 0};
				int code;
				do { code = poll(&event, 1, -1); } while (code < 0 && errno == EINTR);
				if (code < 0) throw ScopeError{"cgroup_events_wait", errno};
			}
		}
	} catch (...) { if (fd >= 0) close(fd); throw; }
	if (fd >= 0) close(fd);
	bus_check(sd_bus_call_method(bus, "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
		"org.freedesktop.systemd1.Manager", "UnrefUnit", nullptr, nullptr, "s", name.c_str()));
}
