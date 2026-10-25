/**
 * Preloaded into snx-rs. It sets a few of the tunnel interface's sysctls (rp_filter and the like),
 * but Docker mounts /proc/sys read-only and snx-rs gives up when a write fails. The container
 * presets those values for new interfaces (CHECKPOINT_SYSCTLS) and this turns the refused writes
 * under /proc/sys/net/ into no-ops. snx-rs reads every value back, so one that isn't preset still
 * fails the connect, with snx-rs's own message. (A writable /proc/sys would also let it change
 * the host kernel's settings.)
 */
export const SYSCTL_SHIM = `#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <string.h>

static int refused_sysctl(const char *path, int flags) {
  return errno == EROFS && (flags & O_ACCMODE) != O_RDONLY && strncmp(path, "/proc/sys/net/", 14) == 0;
}

static int mode_of(int flags, va_list args) {
  return (flags & O_CREAT) || (flags & O_TMPFILE) == O_TMPFILE ? va_arg(args, int) : 0;
}

#define WRAP_OPEN(name) \\
  int name(const char *path, int flags, ...) { \\
    static int (*real)(const char *, int, ...); \\
    if (!real) real = (int (*)(const char *, int, ...))dlsym(RTLD_NEXT, #name); \\
    va_list args; va_start(args, flags); int mode = mode_of(flags, args); va_end(args); \\
    int fd = real(path, flags, mode); \\
    return fd < 0 && refused_sysctl(path, flags) ? real("/dev/null", O_WRONLY | O_CLOEXEC) : fd; \\
  }

#define WRAP_OPENAT(name) \\
  int name(int dir, const char *path, int flags, ...) { \\
    static int (*real)(int, const char *, int, ...); \\
    if (!real) real = (int (*)(int, const char *, int, ...))dlsym(RTLD_NEXT, #name); \\
    va_list args; va_start(args, flags); int mode = mode_of(flags, args); va_end(args); \\
    int fd = real(dir, path, flags, mode); \\
    return fd < 0 && refused_sysctl(path, flags) ? real(AT_FDCWD, "/dev/null", O_WRONLY | O_CLOEXEC) : fd; \\
  }

WRAP_OPEN(open)
WRAP_OPEN(open64)
WRAP_OPENAT(openat)
WRAP_OPENAT(openat64)
`;

/** The values snx-rs sets on its tunnel interface, preset for new interfaces (see SYSCTL_SHIM). */
export const CHECKPOINT_SYSCTLS = [
  'net.ipv4.conf.default.rp_filter=2',
  'net.ipv4.conf.default.promote_secondaries=1',
  'net.ipv4.conf.default.forwarding=0',
  'net.ipv4.conf.default.disable_policy=0',
];
