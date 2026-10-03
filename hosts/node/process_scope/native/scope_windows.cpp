#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <algorithm>
#include <process.h>

#include "protocol.hpp"

class Handle {
public:
	HANDLE value;
	explicit Handle(HANDLE handle) : value(handle) {}
	~Handle() { if (value != nullptr && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
	Handle(const Handle&) = delete;
	Handle& operator=(const Handle&) = delete;
};


static std::wstring wide(const std::string& text) {
	if (text.empty()) return {};
	const int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0);
	if (count == 0) throw ScopeError{"utf8_size", static_cast<int>(GetLastError())};
	std::wstring result(count, L'\0');
	if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), result.data(), count) == 0) throw ScopeError{"utf8", static_cast<int>(GetLastError())};
	return result;
}

// Windows passes a command line, not argv. Quote for the standard CRT decoder;
// no cmd.exe, PowerShell, shell expansion, or interpretation of workload text.
static void append_argument(std::wstring& line, const std::wstring& argument) {
	if (!line.empty()) line += L' ';
	line += L'"';
	size_t slashes = 0;
	for (wchar_t character : argument) {
		if (character == L'\\') { ++slashes; continue; }
		line.append(character == L'"' ? slashes * 2 + 1 : slashes, L'\\');
		line += character;
		slashes = 0;
	}
	line.append(slashes * 2, L'\\');
	line += L'"';
}

static PROCESS_INFORMATION launch(const Launch& command, HANDLE job) {
	std::wstring line;
	for (const auto& argument : command.args) append_argument(line, wide(argument));
	const auto cwd = wide(command.cwd);
	std::wstring search = cwd;
	std::vector<std::wstring> entries;
	for (const auto& value : command.env) {
		entries.push_back(wide(value));
		if (_wcsnicmp(entries.back().c_str(), L"PATH=", 5) == 0) search += L';' + entries.back().substr(5);
	}
	const auto executable = wide(command.args[0]);
	const DWORD path_size = SearchPathW(search.c_str(), executable.c_str(), L".exe", 0, nullptr, nullptr);
	if (path_size == 0) throw ScopeError{"exec", static_cast<int>(GetLastError())};
	std::wstring application(path_size, L'\0');
	const DWORD path_length = SearchPathW(search.c_str(), executable.c_str(), L".exe", path_size, application.data(), nullptr);
	if (path_length == 0) throw ScopeError{"exec", static_cast<int>(GetLastError())};
	application.resize(path_length);
	std::sort(entries.begin(), entries.end(), [](const auto& left, const auto& right) {
		return _wcsicmp(left.c_str(), right.c_str()) < 0;
	});
	std::wstring environment;
	for (const auto& value : entries) { environment += value; environment += L'\0'; }
	environment += L'\0';
	STARTUPINFOEXW startup{};
	startup.StartupInfo.cb = sizeof startup;
	startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
	startup.StartupInfo.hStdInput = reinterpret_cast<HANDLE>(_get_osfhandle(0));
	startup.StartupInfo.hStdOutput = reinterpret_cast<HANDLE>(_get_osfhandle(1));
	startup.StartupInfo.hStdError = reinterpret_cast<HANDLE>(_get_osfhandle(2));
	HANDLE inherited[] = {startup.StartupInfo.hStdInput, startup.StartupInfo.hStdOutput, startup.StartupInfo.hStdError};
	SIZE_T size = 0;
	InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
	std::vector<unsigned char> storage(size);
	startup.lpAttributeList = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
	if (InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &size) == 0) throw ScopeError{"attributes", static_cast<int>(GetLastError())};
	const bool inherited_ok = UpdateProcThreadAttribute(startup.lpAttributeList, 0,
		PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof inherited, nullptr, nullptr) != 0;
	if (!inherited_ok) {
		const int error = static_cast<int>(GetLastError());
		DeleteProcThreadAttributeList(startup.lpAttributeList);
		throw ScopeError{"handle_list", error};
	}
	PROCESS_INFORMATION process{};
	const bool created = CreateProcessW(application.c_str(), line.data(), nullptr, nullptr, TRUE,
		CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
		environment.data(), cwd.c_str(), &startup.StartupInfo, &process) != 0;
	const DWORD error = GetLastError();
	DeleteProcThreadAttributeList(startup.lpAttributeList);
	if (!created) throw ScopeError{"exec", static_cast<int>(error)};
	// The suspended child cannot spawn outside its job before admission.
	if (!AssignProcessToJobObject(job, process.hProcess) || ResumeThread(process.hThread) == DWORD(-1)) {
		const int code = static_cast<int>(GetLastError());
		TerminateProcess(process.hProcess, 1);
		WaitForSingleObject(process.hProcess, INFINITE);
		CloseHandle(process.hThread);
		CloseHandle(process.hProcess);
		throw ScopeError{"job_assign", code};
	}
	return process;
}

static void join_job(HANDLE job, HANDLE completion) {
	for (;;) {
		JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
		if (QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &accounting, sizeof accounting, nullptr) == 0) throw ScopeError{"job_count", static_cast<int>(GetLastError())};
		if (accounting.ActiveProcesses == 0) return;
		DWORD message;
		ULONG_PTR key;
		LPOVERLAPPED overlapped;
		// Notifications wake the join; the kernel's job count proves it. Microsoft
		// explicitly does not guarantee delivery of ordinary job notifications.
		if (!GetQueuedCompletionStatus(completion, &message, &key, &overlapped, 100)) {
			if (GetLastError() != WAIT_TIMEOUT) throw ScopeError{"job_notification", static_cast<int>(GetLastError())};
		}
	}
}

static unsigned __stdcall control_requests(void* stop) {
	try {
		char command;
		while (read_exact(&command, 1)) {
			if (command == 'K') SetEvent(stop);
		}
	} catch (const ScopeError&) { /* A failed control pipe is host departure. */ }
	SetEvent(stop);
	return 0;
}

static void run() {
	char command;
	if (!read_exact(&command, 1)) return;
	Launch request;
	Handle job(CreateJobObjectW(nullptr, nullptr));
	if (job.value == nullptr) throw ScopeError{"job_create", static_cast<int>(GetLastError())};
	JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
	limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
	if (SetInformationJobObject(job.value, JobObjectExtendedLimitInformation, &limits, sizeof limits) == 0) throw ScopeError{"job_limits", static_cast<int>(GetLastError())};
	Handle completion(CreateIoCompletionPort(INVALID_HANDLE_VALUE, nullptr, 0, 1));
	if (completion.value == nullptr) throw ScopeError{"completion_port", static_cast<int>(GetLastError())};
	Handle stop(CreateEventW(nullptr, TRUE, FALSE, nullptr));
	if (stop.value == nullptr) throw ScopeError{"stop_event", static_cast<int>(GetLastError())};
	// Establish control ownership before starting a workload: allocating its
	// reader thread must not fail after the child has already begun executing.
	Handle controller(reinterpret_cast<HANDLE>(_beginthreadex(nullptr, 0, control_requests, stop.value, 0, nullptr)));
	if (controller.value == nullptr) throw ScopeError{"controller_errno", errno};
	PROCESS_INFORMATION process;
	try { process = launch(request, job.value); }
	catch (const ScopeError& error) {
		report_error(error);
		workload_exit(-1, 0);
		drained();
		WaitForSingleObject(controller.value, INFINITE);
		return;
	}
	Handle child(process.hProcess), thread(process.hThread);
	HANDLE waits[] = {child.value, stop.value};
	const DWORD event = WaitForMultipleObjects(2, waits, FALSE, INFINITE);
	if (event != WAIT_OBJECT_0 && event != WAIT_OBJECT_0 + 1) throw ScopeError{"process_wait", static_cast<int>(GetLastError())};
	// Subscribe only for retirement. A long conversation must not accumulate
	// per-command job notifications that nobody needs during normal execution.
	JOBOBJECT_ASSOCIATE_COMPLETION_PORT association{job.value, completion.value};
	if (SetInformationJobObject(job.value, JobObjectAssociateCompletionPortInformation, &association, sizeof association) == 0) throw ScopeError{"job_port", static_cast<int>(GetLastError())};
	if (TerminateJobObject(job.value, 1) == 0) throw ScopeError{"job_terminate", static_cast<int>(GetLastError())};
	if (WaitForSingleObject(child.value, INFINITE) != WAIT_OBJECT_0) throw ScopeError{"process_join", static_cast<int>(GetLastError())};
	DWORD code;
	if (GetExitCodeProcess(child.value, &code) == 0) throw ScopeError{"exit_code", static_cast<int>(GetLastError())};
	workload_exit(code, 0);
	join_job(job.value, completion.value);
	drained();
	WaitForSingleObject(controller.value, INFINITE);
}

int wmain(int argc, wchar_t** argv) {
	if (argc != 2) return 2;
	try {
		Handle lock(CreateFileW(argv[1], GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
			nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr));
		if (lock.value == INVALID_HANDLE_VALUE) throw ScopeError{"lock_open", static_cast<int>(GetLastError())};
		OVERLAPPED position{};
		if (!LockFileEx(lock.value, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &position)) {
			if (GetLastError() == ERROR_LOCK_VIOLATION) { status("busy\n"); return 0; }
			throw ScopeError{"lock", static_cast<int>(GetLastError())};
		}
		LARGE_INTEGER size{};
		if (!GetFileSizeEx(lock.value, &size)) throw ScopeError{"lock_state", static_cast<int>(GetLastError())};
		if (size.QuadPart != 0) { status("interrupted\n"); return 0; }
		size.QuadPart = 1;
		if (!SetFilePointerEx(lock.value, size, nullptr, FILE_BEGIN) || !SetEndOfFile(lock.value) || !FlushFileBuffers(lock.value)) {
			throw ScopeError{"lock_begin", static_cast<int>(GetLastError())};
		}
		if (status("locked\n")) {
			try { run(); }
			catch (const HostClosed&) { /* EOF while decoding launch: no child has been created. */ }
		}
		size.QuadPart = 0;
		if (!SetFilePointerEx(lock.value, size, nullptr, FILE_BEGIN) || !SetEndOfFile(lock.value) || !FlushFileBuffers(lock.value)) {
			throw ScopeError{"lock_release", static_cast<int>(GetLastError())};
		}
		return 0;
	} catch (const ScopeError& error) {
		report_error(error);
		return 1;
	}
}
