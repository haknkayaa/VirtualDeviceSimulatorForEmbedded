#ifndef VDS4E_I2C_CUSE_H
#define VDS4E_I2C_CUSE_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define VDS4E_I2C_DEFAULT_SOCKET "/tmp/vds4e.sock"
#define VDS4E_I2C_DEFAULT_NAME "i2c-0"
#define VDS4E_I2C_MAX_BINDINGS 128U
#define VDS4E_I2C_MAX_MESSAGES 42U
#define VDS4E_I2C_MAX_TRANSFER 4096U

typedef struct {
  uint16_t address;
  char device_id[128];
} vds4e_i2c_binding_t;

typedef struct {
  char device_name[128];
  char socket_path[4096];
  pid_t parent_pid;
  vds4e_i2c_binding_t bindings[VDS4E_I2C_MAX_BINDINGS];
  size_t binding_count;
} vds4e_i2c_config_t;

/* Returns 0 on success, 1 when help was printed, and -1 on invalid input. */
int vds4e_i2c_parse_options(int argc, char **argv,
                            vds4e_i2c_config_t *config);
void vds4e_i2c_print_usage(void);
int vds4e_i2c_cuse_serve(const char *program,
                         vds4e_i2c_config_t *config);

#endif
