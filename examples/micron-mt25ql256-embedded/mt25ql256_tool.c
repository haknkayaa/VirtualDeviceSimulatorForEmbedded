#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <linux/spi/spidev.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define MT25Q_SIZE_BYTES (32u * 1024u * 1024u)
#define MT25Q_PAGE_SIZE 256u
#define MT25Q_SUBSECTOR_4K 4096u
#define MT25Q_SECTOR_64K (64u * 1024u)

#define CMD_RESET_ENABLE 0x66u
#define CMD_RESET_MEMORY 0x99u
#define CMD_READ_ID 0x9Fu
#define CMD_READ_STATUS 0x05u
#define CMD_READ_FLAG_STATUS 0x70u
#define CMD_CLEAR_FLAG_STATUS 0x50u
#define CMD_WRITE_ENABLE 0x06u
#define CMD_WRITE_DISABLE 0x04u
#define CMD_READ_4BYTE 0x13u
#define CMD_PAGE_PROGRAM_4BYTE 0x12u
#define CMD_ERASE_4K_4BYTE 0x21u
#define CMD_ERASE_64K_4BYTE 0xDCu

#define SR_WIP (1u << 0)
#define SR_WEL (1u << 1)

#define FSR_READY (1u << 7)
#define FSR_ERASE_ERROR (1u << 5)
#define FSR_PROGRAM_ERROR (1u << 4)
#define FSR_PROTECTION_ERROR (1u << 1)
#define FSR_ADDR_4BYTE (1u << 0)

struct mt25q {
  int fd;
  uint32_t speed_hz;
  uint8_t mode;
  uint8_t bits_per_word;
};

static volatile sig_atomic_t stop_requested;

static void request_stop(int signal_number) {
  (void)signal_number;
  stop_requested = 1;
}

static void die_errno(const char *what) {
  fprintf(stderr, "%s: %s\n", what, strerror(errno));
  exit(EXIT_FAILURE);
}

static void die_msg(const char *what) {
  fprintf(stderr, "%s\n", what);
  exit(EXIT_FAILURE);
}

static uint64_t monotonic_ms(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0)
    die_errno("clock_gettime");
  return (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
}

static int spi_transfer(struct mt25q *dev, const void *tx_buf, void *rx_buf,
                        size_t len) {
  struct spi_ioc_transfer tr = {
      .tx_buf = (uintptr_t)tx_buf,
      .rx_buf = (uintptr_t)rx_buf,
      .len = (uint32_t)len,
      .speed_hz = dev->speed_hz,
      .bits_per_word = dev->bits_per_word,
      .delay_usecs = 0,
      .cs_change = 0,
  };

  int rc = ioctl(dev->fd, SPI_IOC_MESSAGE(1), &tr);
  if (rc < 0)
    return -errno;
  if ((size_t)rc != len)
    return -EIO;
  return 0;
}

static int spi_command(struct mt25q *dev, uint8_t cmd) {
  return spi_transfer(dev, &cmd, NULL, 1);
}

static int mt25q_open(struct mt25q *dev, const char *path, uint32_t speed_hz) {
  memset(dev, 0, sizeof(*dev));
  dev->fd = open(path, O_RDWR | O_CLOEXEC);
  if (dev->fd < 0)
    return -errno;

  dev->speed_hz = speed_hz;
  dev->mode = SPI_MODE_0;
  dev->bits_per_word = 8;

  if (ioctl(dev->fd, SPI_IOC_WR_MODE, &dev->mode) < 0)
    goto fail;
  if (ioctl(dev->fd, SPI_IOC_RD_MODE, &dev->mode) < 0)
    goto fail;
  if (ioctl(dev->fd, SPI_IOC_WR_BITS_PER_WORD, &dev->bits_per_word) < 0)
    goto fail;
  if (ioctl(dev->fd, SPI_IOC_RD_BITS_PER_WORD, &dev->bits_per_word) < 0)
    goto fail;
  if (ioctl(dev->fd, SPI_IOC_WR_MAX_SPEED_HZ, &dev->speed_hz) < 0)
    goto fail;
  if (ioctl(dev->fd, SPI_IOC_RD_MAX_SPEED_HZ, &dev->speed_hz) < 0)
    goto fail;

  return 0;

fail : {
  int saved = errno;
  close(dev->fd);
  dev->fd = -1;
  return -saved;
}
}

static void mt25q_close(struct mt25q *dev) {
  if (dev->fd >= 0)
    close(dev->fd);
  dev->fd = -1;
}

static int mt25q_read_register(struct mt25q *dev, uint8_t cmd, uint8_t *value) {
  uint8_t tx[2] = {cmd, 0x00};
  uint8_t rx[2] = {0};
  int rc = spi_transfer(dev, tx, rx, sizeof(tx));
  if (rc < 0)
    return rc;
  *value = rx[1];
  return 0;
}

static int mt25q_read_status(struct mt25q *dev, uint8_t *status) {
  return mt25q_read_register(dev, CMD_READ_STATUS, status);
}

static int mt25q_read_flag_status(struct mt25q *dev, uint8_t *status) {
  return mt25q_read_register(dev, CMD_READ_FLAG_STATUS, status);
}

static int mt25q_clear_flag_status(struct mt25q *dev) {
  return spi_command(dev, CMD_CLEAR_FLAG_STATUS);
}

static int mt25q_write_enable(struct mt25q *dev) {
  int rc = spi_command(dev, CMD_WRITE_ENABLE);
  if (rc < 0) {
    fprintf(stderr, "WRITE ENABLE (0x06) komutu reddedildi.\n");
    return rc;
  }

  uint8_t sr = 0;
  rc = mt25q_read_status(dev, &sr);
  if (rc < 0)
    return rc;

  if ((sr & SR_WEL) == 0) {
    fprintf(stderr, "WRITE ENABLE sonrasi WEL biti set olmadi (SR=0x%02X).\n",
            sr);
    return -EACCES;
  }
  return 0;
}

static int mt25q_wait_ready(struct mt25q *dev, uint32_t timeout_ms,
                            uint8_t *final_fsr) {
  const uint64_t deadline = monotonic_ms() + timeout_ms;

  for (;;) {
    uint8_t fsr = 0;
    int rc = mt25q_read_flag_status(dev, &fsr);
    if (rc < 0)
      return rc;

    if (fsr & FSR_READY) {
      if (final_fsr)
        *final_fsr = fsr;

      if (fsr & (FSR_ERASE_ERROR | FSR_PROGRAM_ERROR | FSR_PROTECTION_ERROR)) {
        (void)mt25q_clear_flag_status(dev);
        return -EIO;
      }
      return 0;
    }

    if (monotonic_ms() >= deadline)
      return -ETIMEDOUT;

    struct timespec req = {.tv_sec = 0, .tv_nsec = 1000000L};
    (void)nanosleep(&req, NULL);
  }
}

static int mt25q_reset(struct mt25q *dev) {
  int rc = spi_command(dev, CMD_RESET_ENABLE);
  if (rc < 0) {
    fprintf(stderr, "RESET ENABLE (0x66) basarisiz: %s\n", strerror(-rc));
    return rc;
  }

  struct timespec req = {.tv_sec = 0, .tv_nsec = 1000L};
  (void)nanosleep(&req, NULL);

  rc = spi_command(dev, CMD_RESET_MEMORY);
  if (rc < 0) {
    fprintf(stderr, "RESET MEMORY (0x99) basarisiz: %s\n", strerror(-rc));
    return rc;
  }

  req.tv_nsec = 100000L;
  (void)nanosleep(&req, NULL);
  rc = mt25q_wait_ready(dev, 100, NULL);
  if (rc < 0)
    fprintf(stderr, "Reset sonrasi FLAG STATUS (0x70) bekleme basarisiz: %s\n",
            strerror(-rc));
  return rc;
}

static int mt25q_read_id(struct mt25q *dev, uint8_t id[3]) {
  uint8_t tx[4] = {CMD_READ_ID, 0, 0, 0};
  uint8_t rx[4] = {0};
  int rc = spi_transfer(dev, tx, rx, sizeof(tx));
  if (rc < 0)
    return rc;

  memcpy(id, &rx[1], 3);
  return 0;
}

static int mt25q_print_device_info(struct mt25q *dev, const char *path) {
  uint8_t id[3] = {0};
  uint8_t sr = 0;
  uint8_t fsr = 0;

  int rc = mt25q_read_id(dev, id);
  if (rc < 0) {
    fprintf(stderr, "JEDEC ID (0x9F) okunamadi: %s\n", strerror(-rc));
    return rc;
  }

  printf("SPI device : %s\n", path);
  printf("SPI config : mode=%u bits=%u speed=%" PRIu32 " Hz\n", dev->mode,
         dev->bits_per_word, dev->speed_hz);
  printf("JEDEC ID   : %02X %02X %02X\n", id[0], id[1], id[2]);
  if (id[0] == 0x20 && id[1] == 0xBA && id[2] == 0x19) {
    puts("Device     : Micron MT25QL256ABA");
  } else {
    puts("Device     : Bilinmeyen veya farkli SPI NOR modeli");
  }
  printf("Geometry   : 32 MiB, page=%u B, erase=4 KiB/64 KiB\n",
         MT25Q_PAGE_SIZE);

  rc = mt25q_read_status(dev, &sr);
  if (rc < 0) {
    fprintf(stderr, "STATUS REGISTER (0x05) okunamadi: %s\n", strerror(-rc));
    return rc;
  }
  rc = mt25q_read_flag_status(dev, &fsr);
  if (rc < 0) {
    fprintf(stderr, "FLAG STATUS REGISTER (0x70) okunamadi: %s\n",
            strerror(-rc));
    return rc;
  }

  printf("Status     : SR=0x%02X (WIP=%u WEL=%u), FSR=0x%02X (READY=%u)\n",
         sr, !!(sr & SR_WIP), !!(sr & SR_WEL), fsr, !!(fsr & FSR_READY));
  puts("------------------------------------------------------------");
  return 0;
}

static bool range_valid(uint32_t address, size_t length) {
  return address < MT25Q_SIZE_BYTES && length <= MT25Q_SIZE_BYTES &&
         (uint64_t)address + length <= MT25Q_SIZE_BYTES;
}

static void put_be32(uint8_t out[4], uint32_t value) {
  out[0] = (uint8_t)(value >> 24);
  out[1] = (uint8_t)(value >> 16);
  out[2] = (uint8_t)(value >> 8);
  out[3] = (uint8_t)value;
}

static int mt25q_read(struct mt25q *dev, uint32_t address, void *buffer,
                      size_t length) {
  if (!range_valid(address, length))
    return -ERANGE;
  if (length == 0)
    return 0;

  const size_t header_len = 5;
  uint8_t *tx = calloc(1, header_len + length);
  uint8_t *rx = calloc(1, header_len + length);
  if (!tx || !rx) {
    free(tx);
    free(rx);
    return -ENOMEM;
  }

  tx[0] = CMD_READ_4BYTE;
  put_be32(&tx[1], address);

  int rc = spi_transfer(dev, tx, rx, header_len + length);
  if (rc == 0)
    memcpy(buffer, rx + header_len, length);

  free(tx);
  free(rx);
  return rc;
}

static int mt25q_page_program(struct mt25q *dev, uint32_t address,
                              const uint8_t *data, size_t length) {
  if (length == 0 || length > MT25Q_PAGE_SIZE)
    return -EINVAL;
  if (!range_valid(address, length))
    return -ERANGE;
  if ((address / MT25Q_PAGE_SIZE) !=
      ((address + (uint32_t)length - 1u) / MT25Q_PAGE_SIZE))
    return -EINVAL;

  int rc = mt25q_write_enable(dev);
  if (rc < 0)
    return rc;

  const size_t header_len = 5;
  uint8_t *tx = malloc(header_len + length);
  if (!tx)
    return -ENOMEM;

  tx[0] = CMD_PAGE_PROGRAM_4BYTE;
  put_be32(&tx[1], address);
  memcpy(tx + header_len, data, length);

  rc = spi_transfer(dev, tx, NULL, header_len + length);
  free(tx);
  if (rc < 0)
    return rc;

  return mt25q_wait_ready(dev, 2500, NULL);
}

static int mt25q_program(struct mt25q *dev, uint32_t address,
                         const uint8_t *data, size_t length) {
  if (!range_valid(address, length))
    return -ERANGE;

  while (length > 0) {
    size_t page_offset = address % MT25Q_PAGE_SIZE;
    size_t chunk = MT25Q_PAGE_SIZE - page_offset;
    if (chunk > length)
      chunk = length;

    int rc = mt25q_page_program(dev, address, data, chunk);
    if (rc < 0)
      return rc;

    address += (uint32_t)chunk;
    data += chunk;
    length -= chunk;
  }

  return 0;
}

static int mt25q_erase(struct mt25q *dev, uint8_t command, uint32_t address,
                       uint32_t alignment, uint32_t timeout_ms) {
  if (address >= MT25Q_SIZE_BYTES || (address % alignment) != 0)
    return -EINVAL;

  int rc = mt25q_write_enable(dev);
  if (rc < 0)
    return rc;

  uint8_t tx[5] = {command, 0, 0, 0, 0};
  put_be32(&tx[1], address);

  rc = spi_transfer(dev, tx, NULL, sizeof(tx));
  if (rc < 0)
    return rc;

  return mt25q_wait_ready(dev, timeout_ms, NULL);
}

static int mt25q_erase_4k(struct mt25q *dev, uint32_t address) {
  return mt25q_erase(dev, CMD_ERASE_4K_4BYTE, address, MT25Q_SUBSECTOR_4K,
                     2000);
}

static int mt25q_erase_64k(struct mt25q *dev, uint32_t address) {
  return mt25q_erase(dev, CMD_ERASE_64K_4BYTE, address, MT25Q_SECTOR_64K, 3000);
}

static void fill_test_pattern(uint8_t *data, size_t length, uint64_t iteration) {
  uint32_t state = (uint32_t)iteration ^ (uint32_t)(iteration >> 32) ^
                   0xA5C31F27u;

  for (size_t i = 0; i < length; ++i) {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    data[i] = (uint8_t)(state ^ (uint32_t)i);
  }
}

static int sleep_ms(uint32_t delay_ms) {
  struct timespec request = {
      .tv_sec = (time_t)(delay_ms / 1000u),
      .tv_nsec = (long)(delay_ms % 1000u) * 1000000L,
  };

  while (!stop_requested && nanosleep(&request, &request) < 0) {
    if (errno != EINTR)
      return -errno;
  }
  return 0;
}

static int mt25q_read_write_loop(struct mt25q *dev, uint32_t address,
                                 size_t length, uint64_t iteration_limit,
                                 uint32_t delay_ms) {
  if ((address % MT25Q_SUBSECTOR_4K) != 0 || length == 0 ||
      length > MT25Q_SUBSECTOR_4K || !range_valid(address, length))
    return -EINVAL;

  uint8_t *expected = malloc(length);
  uint8_t *actual = malloc(length);
  if (!expected || !actual) {
    free(expected);
    free(actual);
    return -ENOMEM;
  }

  int rc = mt25q_reset(dev);
  if (rc < 0) {
    fprintf(stderr, "Loop oncesi flash reset/preflight basarisiz.\n");
    free(expected);
    free(actual);
    return rc;
  }

  printf("UYARI: 0x%08" PRIx32
         " adresindeki 4 KiB alan her turda silinecek.\n",
         address);
  puts("Gercek flash kullaniliyorsa erase omru tuketilir. Durdurmak icin Ctrl+C.");

  rc = 0;
  uint64_t iteration = 1;
  while (!stop_requested &&
         (iteration_limit == 0 || iteration <= iteration_limit)) {
    fill_test_pattern(expected, length, iteration);
    memset(actual, 0, length);

    const uint64_t started_ms = monotonic_ms();
    rc = mt25q_erase_4k(dev, address);
    if (rc == 0)
      rc = mt25q_program(dev, address, expected, length);
    if (rc == 0)
      rc = mt25q_read(dev, address, actual, length);
    if (rc < 0)
      break;

    if (memcmp(expected, actual, length) != 0) {
      size_t mismatch = 0;
      while (mismatch < length && expected[mismatch] == actual[mismatch])
        ++mismatch;
      fprintf(stderr,
              "DOGRULAMA HATASI: tur=%" PRIu64
              " adres=0x%08" PRIx32 " beklenen=%02X okunan=%02X\n",
              iteration, address + (uint32_t)mismatch, expected[mismatch],
              actual[mismatch]);
      rc = -EILSEQ;
      break;
    }

    printf("PASS tur=%" PRIu64 " adres=0x%08" PRIx32
           " uzunluk=%zu sure=%" PRIu64 " ms\n",
           iteration, address, length, monotonic_ms() - started_ms);
    fflush(stdout);

    ++iteration;
    if (!stop_requested && delay_ms > 0) {
      rc = sleep_ms(delay_ms);
      if (rc < 0)
        break;
    }
  }

  if (stop_requested)
    printf("\nLoop durduruldu. Tamamlanan tur: %" PRIu64 "\n", iteration - 1);

  free(expected);
  free(actual);
  return rc;
}

static uint32_t parse_u32(const char *s) {
  char *end = NULL;
  errno = 0;
  unsigned long value = strtoul(s, &end, 0);
  if (errno || end == s || *end != '\0' || value > UINT32_MAX)
    die_msg("gecersiz sayi/adres");
  return (uint32_t)value;
}

static size_t parse_size(const char *s) {
  char *end = NULL;
  errno = 0;
  unsigned long long value = strtoull(s, &end, 0);
  if (errno || end == s || *end != '\0' || value > SIZE_MAX)
    die_msg("gecersiz uzunluk");
  return (size_t)value;
}

static void print_hex(const uint8_t *data, size_t length, uint32_t base) {
  for (size_t i = 0; i < length; i += 16) {
    printf("%08" PRIx32 "  ", base + (uint32_t)i);
    for (size_t j = 0; j < 16; ++j) {
      if (i + j < length)
        printf("%02x ", data[i + j]);
      else
        printf("   ");
    }
    printf(" ");
    for (size_t j = 0; j < 16 && i + j < length; ++j) {
      uint8_t c = data[i + j];
      putchar((c >= 32 && c <= 126) ? c : '.');
    }
    putchar('\n');
  }
}

static uint8_t *read_entire_file(const char *path, size_t *size_out) {
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0)
    die_errno("girdi dosyasi acilamadi");

  struct stat st;
  if (fstat(fd, &st) < 0)
    die_errno("fstat");
  if (st.st_size < 0 || (uint64_t)st.st_size > SIZE_MAX)
    die_msg("dosya cok buyuk");

  size_t size = (size_t)st.st_size;
  uint8_t *data = malloc(size ? size : 1);
  if (!data)
    die_errno("malloc");

  size_t offset = 0;
  while (offset < size) {
    ssize_t n = read(fd, data + offset, size - offset);
    if (n < 0) {
      if (errno == EINTR)
        continue;
      die_errno("dosya okunamadi");
    }
    if (n == 0)
      die_msg("beklenmeyen EOF");
    offset += (size_t)n;
  }

  close(fd);
  *size_out = size;
  return data;
}

static void usage(const char *prog) {
  fprintf(stderr,
          "Kullanim:\n"
          "  %s [-d /dev/spidevX.Y] [-s hz] id\n"
          "  %s [-d /dev/spidevX.Y] [-s hz] status\n"
          "  %s [-d /dev/spidevX.Y] [-s hz] reset\n"
          "  %s [-d /dev/spidevX.Y] [-s hz] read <adres> <uzunluk>\n"
          "  %s [-d /dev/spidevX.Y] [-s hz] write <adres> <dosya>\n"
          "  %s [-d /dev/spidevX.Y] [-s hz] erase4k <adres>\n"
          "  %s [-d /dev/spidevX.Y] [-s hz] erase64k <adres>\n"
          "  %s [-d /dev/spidevX.Y] [-s hz] rw-loop <4k-adres> "
          "[uzunluk=256] [tur=0] [bekleme-ms=0]\n"
          "\n"
          "Adres ve sayilar decimal veya 0x... olabilir.\n"
          "rw-loop icin tur=0, Ctrl+C verilene kadar calisir.\n",
          prog, prog, prog, prog, prog, prog, prog, prog);
}

int main(int argc, char **argv) {
  const char *device = "/dev/spidev0.0";
  uint32_t speed_hz = 20000000u;

  int opt;
  while ((opt = getopt(argc, argv, "d:s:h")) != -1) {
    switch (opt) {
    case 'd':
      device = optarg;
      break;
    case 's':
      speed_hz = parse_u32(optarg);
      break;
    case 'h':
      usage(argv[0]);
      return EXIT_SUCCESS;
    default:
      usage(argv[0]);
      return EXIT_FAILURE;
    }
  }

  if (optind >= argc) {
    usage(argv[0]);
    return EXIT_FAILURE;
  }

  struct mt25q flash;
  int rc = mt25q_open(&flash, device, speed_hz);
  if (rc < 0) {
    errno = -rc;
    die_errno("SPI acilamadi/yapilandirilamadi");
  }

  const char *cmd = argv[optind++];

  rc = mt25q_print_device_info(&flash, device);
  if (rc < 0) {
    mt25q_close(&flash);
    errno = -rc;
    die_errno("cihaz bilgileri okunamadi");
  }

  if (strcmp(cmd, "id") == 0) {
    uint8_t id[3];
    rc = mt25q_read_id(&flash, id);
    if (rc == 0) {
      printf("JEDEC ID: %02X %02X %02X\n", id[0], id[1], id[2]);
      printf("Beklenen MT25QL256ABA: 20 BA 19\n");
      if (id[0] != 0x20 || id[1] != 0xBA || id[2] != 0x19)
        fprintf(stderr, "UYARI: Kimlik beklenen degerle eslesmedi.\n");
    }
  } else if (strcmp(cmd, "status") == 0) {
    uint8_t sr = 0, fsr = 0;
    rc = mt25q_read_status(&flash, &sr);
    if (rc == 0)
      rc = mt25q_read_flag_status(&flash, &fsr);
    if (rc == 0) {
      printf("SR = 0x%02X  WIP=%u WEL=%u\n", sr, !!(sr & SR_WIP),
             !!(sr & SR_WEL));
      printf("FSR= 0x%02X  READY=%u ERASE_ERR=%u PROGRAM_ERR=%u PROTECT_ERR=%u "
             "ADDR4=%u\n",
             fsr, !!(fsr & FSR_READY), !!(fsr & FSR_ERASE_ERROR),
             !!(fsr & FSR_PROGRAM_ERROR), !!(fsr & FSR_PROTECTION_ERROR),
             !!(fsr & FSR_ADDR_4BYTE));
    }
  } else if (strcmp(cmd, "reset") == 0) {
    rc = mt25q_reset(&flash);
    if (rc == 0)
      puts("Flash resetlendi.");
  } else if (strcmp(cmd, "read") == 0) {
    if (optind + 2 != argc) {
      usage(argv[0]);
      mt25q_close(&flash);
      return EXIT_FAILURE;
    }
    uint32_t address = parse_u32(argv[optind]);
    size_t length = parse_size(argv[optind + 1]);
    uint8_t *buffer = malloc(length ? length : 1);
    if (!buffer)
      die_errno("malloc");
    rc = mt25q_read(&flash, address, buffer, length);
    if (rc == 0)
      print_hex(buffer, length, address);
    free(buffer);
  } else if (strcmp(cmd, "write") == 0) {
    if (optind + 2 != argc) {
      usage(argv[0]);
      mt25q_close(&flash);
      return EXIT_FAILURE;
    }
    uint32_t address = parse_u32(argv[optind]);
    size_t size = 0;
    uint8_t *data = read_entire_file(argv[optind + 1], &size);
    rc = mt25q_program(&flash, address, data, size);
    if (rc == 0)
      printf("%zu byte 0x%08" PRIx32 " adresine programlandi.\n", size,
             address);
    free(data);
  } else if (strcmp(cmd, "erase4k") == 0) {
    if (optind + 1 != argc) {
      usage(argv[0]);
      mt25q_close(&flash);
      return EXIT_FAILURE;
    }
    uint32_t address = parse_u32(argv[optind]);
    rc = mt25q_erase_4k(&flash, address);
    if (rc == 0)
      printf("4 KiB erase tamam: 0x%08" PRIx32 "\n", address);
  } else if (strcmp(cmd, "erase64k") == 0) {
    if (optind + 1 != argc) {
      usage(argv[0]);
      mt25q_close(&flash);
      return EXIT_FAILURE;
    }
    uint32_t address = parse_u32(argv[optind]);
    rc = mt25q_erase_64k(&flash, address);
    if (rc == 0)
      printf("64 KiB erase tamam: 0x%08" PRIx32 "\n", address);
  } else if (strcmp(cmd, "rw-loop") == 0) {
    const int remaining = argc - optind;
    if (remaining < 1 || remaining > 4) {
      usage(argv[0]);
      mt25q_close(&flash);
      return EXIT_FAILURE;
    }

    uint32_t address = parse_u32(argv[optind]);
    size_t length = remaining >= 2 ? parse_size(argv[optind + 1]) : 256u;
    uint64_t iterations =
        remaining >= 3 ? (uint64_t)parse_size(argv[optind + 2]) : 0u;
    uint32_t delay_ms =
        remaining >= 4 ? parse_u32(argv[optind + 3]) : 0u;

    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_handler = request_stop;
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGINT, &action, NULL) < 0) {
      mt25q_close(&flash);
      die_errno("SIGINT handler ayarlanamadi");
    }

    rc = mt25q_read_write_loop(&flash, address, length, iterations, delay_ms);
  } else {
    usage(argv[0]);
    mt25q_close(&flash);
    return EXIT_FAILURE;
  }

  mt25q_close(&flash);

  if (rc < 0) {
    errno = -rc;
    die_errno("islem basarisiz");
  }

  return EXIT_SUCCESS;
}
