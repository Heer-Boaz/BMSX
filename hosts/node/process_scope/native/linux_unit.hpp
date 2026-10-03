#pragma once

#include <string>
#include <systemd/sd-bus.h>

// A named kernel cgroup, managed by the user's systemd instance. Its identity
// and membership survive this controller; the profile lock serializes recovery.
class LinuxUnit {
	sd_bus* bus = nullptr;
	sd_bus_slot* slot = nullptr;
	std::string name;
	std::string result;
	std::string job;
	static int job_removed(sd_bus_message* message, void* data, sd_bus_error*);
	void watch_job();
	void wait_job(sd_bus_message* reply);
public:
	explicit LinuxUnit(std::string name);
	~LinuxUnit();
	LinuxUnit(const LinuxUnit&) = delete;
	LinuxUnit& operator=(const LinuxUnit&) = delete;
	void start(pid_t child);
	void stop();
};
