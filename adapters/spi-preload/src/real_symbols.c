#define _GNU_SOURCE
#include "vds4e_spi_preload_internal.h"

#include <dlfcn.h>
#include <stdlib.h>

static vds_real_symbols_t symbols;
static pthread_once_t symbols_once = PTHREAD_ONCE_INIT;

static void *required_symbol(const char *name) {
    void *symbol = dlsym(RTLD_NEXT, name);
    if (symbol == NULL) {
        _Exit(127);
    }
    return symbol;
}

static void resolve_symbols(void) {
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
    symbols.open_fn = (int (*)(const char *, int, ...))required_symbol("open");
    symbols.open64_fn = (int (*)(const char *, int, ...))required_symbol("open64");
    symbols.close_fn = (int (*)(int))required_symbol("close");
    symbols.dup_fn = (int (*)(int))required_symbol("dup");
    symbols.dup2_fn = (int (*)(int, int))required_symbol("dup2");
    symbols.dup3_fn = (int (*)(int, int, int))required_symbol("dup3");
    symbols.fcntl_fn = (int (*)(int, int, ...))required_symbol("fcntl");
    symbols.ioctl_fn =
        (int (*)(int, unsigned long, ...))required_symbol("ioctl");
#pragma GCC diagnostic pop
}

const vds_real_symbols_t *vds_real_symbols(void) {
    if (pthread_once(&symbols_once, resolve_symbols) != 0) {
        _Exit(127);
    }
    return &symbols;
}
