#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <linux/i2c-dev.h>
#include <linux/i2c.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

#define AT24C128_SIZE (16u * 1024u)
#define AT24C256_SIZE (32u * 1024u)
#define AT24C_PAGE_SIZE 64u
#define AT24C_WRITE_TIMEOUT_MS 100u
#define AT24C_MAX_TRANSFER 4096u

struct at24c {
  int fd;
  uint8_t slave_address;
  uint32_t size_bytes;
  const char *model;
};

static void die_errno(const char *what) {
  fprintf(stderr, "%s: %s\n", what, strerror(errno));
  exit(EXIT_FAILURE);
}

static void die_message(const char *what) {
  fprintf(stderr, "%s\n", what);
  exit(EXIT_FAILURE);
}

static uint32_t parse_u32(const char *text) {
  char *end = NULL;
  errno = 0;
  const unsigned long value = strtoul(text, &end, 0);
  if (errno != 0 || end == text || *end != '\0' || value > UINT32_MAX)
    die_message("Gecersiz sayi; decimal veya 0x... kullanin.");
  return (uint32_t)value;
}

static uint64_t monotonic_ms(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0)
    die_errno("clock_gettime");
  return (uint64_t)now.tv_sec * 1000u +
         (uint64_t)now.tv_nsec / 1000000u;
}

static int at24c_open(struct at24c *device, const char *path,
                      uint8_t slave_address, uint32_t size_bytes,
                      const char *model) {
  memset(device, 0, sizeof(*device));
  device->fd = open(path, O_RDWR | O_CLOEXEC);
  if (device->fd < 0)
    return -errno;
  if (ioctl(device->fd, I2C_SLAVE, (unsigned long)slave_address) < 0) {
    const int saved = errno;
    close(device->fd);
    device->fd = -1;
    return -saved;
  }
  device->slave_address = slave_address;
  device->size_bytes = size_bytes;
  device->model = model;
  return 0;
}

static void at24c_close(struct at24c *device) {
  if (device->fd >= 0)
    close(device->fd);
  device->fd = -1;
}

static int at24c_read(struct at24c *device, uint32_t address, uint8_t *data,
                      size_t length) {
  if (address >= device->size_bytes || length > UINT16_MAX ||
      (uint64_t)address + length > device->size_bytes)
    return -EINVAL;
  uint8_t word_address[2] = {(uint8_t)(address >> 8), (uint8_t)address};
  struct i2c_msg messages[2] = {
      {.addr = device->slave_address,
       .flags = 0,
       .len = sizeof(word_address),
       .buf = word_address},
      {.addr = device->slave_address,
       .flags = I2C_M_RD,
       .len = (uint16_t)length,
       .buf = data},
  };
  struct i2c_rdwr_ioctl_data transfer = {.msgs = messages, .nmsgs = 2};
  const int result = ioctl(device->fd, I2C_RDWR, &transfer);
  if (result < 0)
    return -errno;
  return result == 2 ? 0 : -EIO;
}

static int at24c_ack_poll(struct at24c *device) {
  const uint64_t deadline = monotonic_ms() + AT24C_WRITE_TIMEOUT_MS;
  union i2c_smbus_data data;
  struct i2c_smbus_ioctl_data request = {
      .read_write = I2C_SMBUS_WRITE,
      .command = 0,
      .size = I2C_SMBUS_QUICK,
      .data = &data,
  };
  for (;;) {
    if (ioctl(device->fd, I2C_SMBUS, &request) == 0)
      return 0;
    if (errno != ENXIO && errno != EREMOTEIO && errno != EIO)
      return -errno;
    if (monotonic_ms() >= deadline)
      return -ETIMEDOUT;
    const struct timespec delay = {.tv_sec = 0, .tv_nsec = 250000L};
    (void)nanosleep(&delay, NULL);
  }
}

static int at24c_write_page(struct at24c *device, uint32_t address,
                            const uint8_t *data, size_t length) {
  uint8_t request[2 + AT24C_PAGE_SIZE];
  request[0] = (uint8_t)(address >> 8);
  request[1] = (uint8_t)address;
  memcpy(request + 2, data, length);
  struct i2c_msg message = {
      .addr = device->slave_address,
      .flags = 0,
      .len = (uint16_t)(length + 2u),
      .buf = request,
  };
  struct i2c_rdwr_ioctl_data transfer = {.msgs = &message, .nmsgs = 1};
  const int result = ioctl(device->fd, I2C_RDWR, &transfer);
  if (result < 0)
    return -errno;
  if (result != 1)
    return -EIO;
  return at24c_ack_poll(device);
}

static int at24c_write(struct at24c *device, uint32_t address,
                       const uint8_t *data, size_t length) {
  if (address >= device->size_bytes ||
      (uint64_t)address + length > device->size_bytes)
    return -EINVAL;
  size_t offset = 0;
  while (offset < length) {
    const uint32_t current = address + (uint32_t)offset;
    const size_t page_remaining =
        AT24C_PAGE_SIZE - current % AT24C_PAGE_SIZE;
    const size_t chunk =
        length - offset < page_remaining ? length - offset : page_remaining;
    const int result =
        at24c_write_page(device, current, data + offset, chunk);
    if (result < 0)
      return result;
    offset += chunk;
  }
  return 0;
}

static void print_hex(const uint8_t *data, size_t length, uint32_t address) {
  for (size_t offset = 0; offset < length; offset += 16u) {
    printf("%04" PRIX32 ":", address + (uint32_t)offset);
    const size_t row = length - offset < 16u ? length - offset : 16u;
    for (size_t index = 0; index < row; ++index)
      printf(" %02X", data[offset + index]);
    putchar('\n');
  }
}

static void print_info(const struct at24c *device, const char *path) {
  printf("I2C device : %s\n", path);
  printf("Slave addr : 0x%02X\n", device->slave_address);
  printf("Device     : Atmel %s\n", device->model);
  printf("Geometry   : %" PRIu32 " bytes, page=%u B, word-address=2 B\n",
         device->size_bytes, AT24C_PAGE_SIZE);
}

static void usage(const char *program) {
  fprintf(stderr,
          "Kullanim:\n"
          "  %s [-d /dev/i2c-N] [-a 0x50] [-m 128|256] info\n"
          "  %s [-d /dev/i2c-N] [-a 0x50] [-m 128|256] read <adres> "
          "<uzunluk>\n"
          "  %s [-d /dev/i2c-N] [-a 0x50] [-m 128|256] write <adres> "
          "<byte> [byte ...]\n"
          "  %s [-d /dev/i2c-N] [-a 0x50] [-m 128|256] test <adres>\n",
          program, program, program, program);
}

int main(int argc, char **argv) {
  const char *path = "/dev/i2c-0";
  uint32_t slave_address = 0x50;
  uint32_t size_bytes = AT24C256_SIZE;
  const char *model = "AT24C256";
  int option;
  while ((option = getopt(argc, argv, "d:a:m:h")) != -1) {
    switch (option) {
    case 'd':
      path = optarg;
      break;
    case 'a':
      slave_address = parse_u32(optarg);
      if (slave_address > 0x7f)
        die_message("7-bit I2C adresi 0x00..0x7F araliginda olmali.");
      break;
    case 'm': {
      const uint32_t selected = parse_u32(optarg);
      if (selected == 128) {
        size_bytes = AT24C128_SIZE;
        model = "AT24C128";
      } else if (selected != 256) {
        die_message("Model 128 veya 256 olmali.");
      }
      break;
    }
    case 'h':
      usage(argv[0]);
      return EXIT_SUCCESS;
    default:
      usage(argv[0]);
      return EXIT_FAILURE;
    }
  }
  if (optind >= argc)
    die_message("Komut eksik; -h ile kullanimi gorun.");

  struct at24c device;
  int result = at24c_open(&device, path, (uint8_t)slave_address, size_bytes,
                          model);
  if (result < 0) {
    errno = -result;
    die_errno("I2C cihazi acilamadi");
  }
  print_info(&device, path);

  const char *command = argv[optind++];
  if (strcmp(command, "info") == 0) {
    result = optind == argc ? 0 : -EINVAL;
  } else if (strcmp(command, "read") == 0 && optind + 2 == argc) {
    const uint32_t address = parse_u32(argv[optind]);
    const uint32_t requested = parse_u32(argv[optind + 1]);
    if (requested > AT24C_MAX_TRANSFER) {
      result = -EMSGSIZE;
    } else {
      uint8_t *data = malloc(requested == 0 ? 1u : requested);
      if (data == NULL)
        die_errno("malloc");
      result = at24c_read(&device, address, data, requested);
      if (result == 0)
        print_hex(data, requested, address);
      free(data);
    }
  } else if (strcmp(command, "write") == 0 && optind + 2 <= argc) {
    const uint32_t address = parse_u32(argv[optind++]);
    const size_t length = (size_t)(argc - optind);
    uint8_t *data = malloc(length);
    if (data == NULL)
      die_errno("malloc");
    for (size_t index = 0; index < length; ++index) {
      const uint32_t value = parse_u32(argv[optind + (int)index]);
      if (value > UINT8_MAX)
        die_message("Byte degeri 0x00..0xFF araliginda olmali.");
      data[index] = (uint8_t)value;
    }
    result = at24c_write(&device, address, data, length);
    if (result == 0)
      printf("%zu byte 0x%04" PRIX32 " adresine yazildi.\n", length,
             address);
    free(data);
  } else if (strcmp(command, "test") == 0 && optind + 1 == argc) {
    const uint32_t address = parse_u32(argv[optind]);
    uint8_t original = 0;
    const uint8_t pattern = 0xa5;
    result = at24c_read(&device, address, &original, 1);
    if (result == 0)
      result = at24c_write(&device, address, &pattern, 1);
    uint8_t observed = 0;
    if (result == 0)
      result = at24c_read(&device, address, &observed, 1);
    if (result == 0 && observed != pattern)
      result = -EIO;
    if (result == 0)
      result = at24c_write(&device, address, &original, 1);
    if (result == 0)
      printf("R/W test basarili; 0x%04" PRIX32
             " adresindeki eski deger geri yuklendi.\n",
             address);
  } else {
    result = -EINVAL;
  }

  at24c_close(&device);
  if (result < 0) {
    usage(argv[0]);
    errno = -result;
    die_errno("islem basarisiz");
  }
  return EXIT_SUCCESS;
}
