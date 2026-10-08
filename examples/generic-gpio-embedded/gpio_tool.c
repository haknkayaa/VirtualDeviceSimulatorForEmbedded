#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <glob.h>
#include <gpiod.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define CONSUMER_NAME "vds4e-gpio-tool"

static volatile sig_atomic_t stop_requested = 0;

static void handle_sigint(int sig) {
  (void)sig;
  stop_requested = 1;
}

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
    die_message("Invalid number; use decimal or 0x... format.");
  return (uint32_t)value;
}

static char *detect_gpiochip(void) {
  glob_t globbuf;
  memset(&globbuf, 0, sizeof(globbuf));

  if (glob("/dev/gpiochip*", 0, NULL, &globbuf) == 0 && globbuf.gl_pathc > 0) {
    /* Check first for gpio-sim or VDS4E labeled controller */
    for (size_t i = 0; i < globbuf.gl_pathc; ++i) {
      struct gpiod_chip *chip = gpiod_chip_open(globbuf.gl_pathv[i]);
      if (chip != NULL) {
        const char *label = gpiod_chip_label(chip);
        if (label != NULL && (strstr(label, "gpio-sim") != NULL ||
                              strstr(label, "VDS4E") != NULL ||
                              strstr(label, "GPIO") != NULL)) {
          char *result = strdup(globbuf.gl_pathv[i]);
          gpiod_chip_close(chip);
          globfree(&globbuf);
          return result;
        }
        gpiod_chip_close(chip);
      }
    }
    /* Otherwise return the first candidate */
    char *result = strdup(globbuf.gl_pathv[0]);
    globfree(&globbuf);
    return result;
  }
  globfree(&globbuf);
  return strdup("/dev/gpiochip0");
}

static void usage(const char *prog) {
  fprintf(stderr,
          "VDS4E GPIO Test and Utility Tool (libgpiod)\n\n"
          "Usage:\n"
          "  %s [-c /dev/gpiochipN] info\n"
          "  %s [-c /dev/gpiochipN] get <line-offset>\n"
          "  %s [-c /dev/gpiochipN] set <line-offset> <0|1> [--hold]\n"
          "  %s [-c /dev/gpiochipN] monitor <line-offset> [count]\n"
          "\n"
          "Options:\n"
          "  -c <path>  Target GPIO controller (default: auto-detected)\n"
          "  -h         Show this help message\n"
          "\n"
          "Examples:\n"
          "  %s info\n"
          "  %s get 16           (read generic-gpio-bank output line)\n"
          "  %s set 0 1          (drive generic-gpio-bank input line)\n"
          "  %s monitor 16 1     (wait for output edge event)\n",
          prog, prog, prog, prog, prog, prog, prog, prog);
}

static int cmd_info(struct gpiod_chip *chip, const char *chip_path) {
  const char *name = gpiod_chip_name(chip);
  const char *label = gpiod_chip_label(chip);
  unsigned int num_lines = gpiod_chip_num_lines(chip);

  printf("GPIO Controller:  %s (%s)\n", chip_path, name ? name : "unknown");
  printf("Label:            %s\n", label ? label : "unlabeled");
  printf("Total Lines:      %u\n\n", num_lines);

  printf("%-6s %-16s %-10s %-12s %s\n", "Offset", "Name", "Direction", "Active State", "Consumer");
  printf("----------------------------------------------------------------\n");

  for (unsigned int i = 0; i < num_lines; ++i) {
    struct gpiod_line *line = gpiod_chip_get_line(chip, i);
    if (!line) continue;

    const char *line_name = gpiod_line_name(line);
    const char *consumer = gpiod_line_consumer(line);
    int dir = gpiod_line_direction(line);
    int active = gpiod_line_active_state(line);

    const char *dir_str = (dir == GPIOD_LINE_DIRECTION_INPUT) ? "input" :
                          (dir == GPIOD_LINE_DIRECTION_OUTPUT) ? "output" : "unknown";
    const char *act_str = (active == GPIOD_LINE_ACTIVE_STATE_LOW) ? "active-low" : "active-high";

    printf("%-6u %-16s %-10s %-12s %s\n",
           i,
           line_name ? line_name : "-",
           dir_str,
           act_str,
           consumer ? consumer : "-");
  }

  return 0;
}

static int cmd_get(struct gpiod_chip *chip, unsigned int offset) {
  struct gpiod_line *line = gpiod_chip_get_line(chip, offset);
  if (!line) {
    fprintf(stderr, "Failed to get line %u.\n", offset);
    return -EINVAL;
  }

  const char *name = gpiod_line_name(line);
  if (gpiod_line_request_input(line, CONSUMER_NAME) < 0) {
    die_errno("Failed to request line as input (request_input)");
  }

  int value = gpiod_line_get_value(line);
  if (value < 0) {
    gpiod_line_release(line);
    die_errno("Failed to read line value (get_value)");
  }

  gpiod_line_release(line);

  printf("Line %u (%s): %d\n", offset, name ? name : "unnamed", value);
  return 0;
}

static int cmd_set(struct gpiod_chip *chip, unsigned int offset, int value, bool hold) {
  struct gpiod_line *line = gpiod_chip_get_line(chip, offset);
  if (!line) {
    fprintf(stderr, "Failed to get line %u.\n", offset);
    return -EINVAL;
  }

  const char *name = gpiod_line_name(line);
  if (gpiod_line_request_output(line, CONSUMER_NAME, value) < 0) {
    die_errno("Failed to request line as output (request_output)");
  }

  printf("Line %u (%s) -> set to %d.\n", offset, name ? name : "unnamed", value);

  if (hold) {
    printf("Holding line state. Press Ctrl+C to release...\n");
    signal(SIGINT, handle_sigint);
    signal(SIGTERM, handle_sigint);
    while (!stop_requested) {
      sleep(1);
    }
    printf("\nReleasing line.\n");
  }

  gpiod_line_release(line);
  return 0;
}

static int cmd_monitor(struct gpiod_chip *chip, unsigned int offset, unsigned int max_events) {
  struct gpiod_line *line = gpiod_chip_get_line(chip, offset);
  if (!line) {
    fprintf(stderr, "Failed to get line %u.\n", offset);
    return -EINVAL;
  }

  const char *name = gpiod_line_name(line);
  if (gpiod_line_request_both_edges_events(line, CONSUMER_NAME) < 0) {
    die_errno("Failed to request edge event monitoring (request_both_edges_events)");
  }

  printf("Monitoring edge transitions on line %u (%s) (Press Ctrl+C to exit)...\n",
         offset, name ? name : "unnamed");

  signal(SIGINT, handle_sigint);
  signal(SIGTERM, handle_sigint);

  unsigned int count = 0;
  while (!stop_requested && (max_events == 0 || count < max_events)) {
    struct timespec ts = { .tv_sec = 1, .tv_nsec = 0 };
    int rc = gpiod_line_event_wait(line, &ts);
    if (rc < 0) {
      if (errno == EINTR) break;
      gpiod_line_release(line);
      die_errno("Error waiting for line event");
    }
    if (rc == 0) {
      /* Timeout - loop to check stop_requested */
      continue;
    }

    struct gpiod_line_event event;
    if (gpiod_line_event_read(line, &event) < 0) {
      if (errno == EINTR) break;
      gpiod_line_release(line);
      die_errno("Error reading line event");
    }

    count++;
    const char *ev_type = (event.event_type == GPIOD_LINE_EVENT_RISING_EDGE) ? "RISING EDGE (1)" :
                          (event.event_type == GPIOD_LINE_EVENT_FALLING_EDGE) ? "FALLING EDGE (0)" : "UNKNOWN";

    printf("[%u] Timestamp: %ld.%09ld s | Line: %u | Event: %s\n",
           count,
           (long)event.ts.tv_sec,
           event.ts.tv_nsec,
           offset,
           ev_type);
  }

  gpiod_line_release(line);
  return 0;
}

int main(int argc, char **argv) {
  const char *chip_path = NULL;
  int opt;

  while ((opt = getopt(argc, argv, "c:h")) != -1) {
    switch (opt) {
    case 'c':
      chip_path = optarg;
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

  char *detected_chip = NULL;
  if (!chip_path) {
    detected_chip = detect_gpiochip();
    chip_path = detected_chip;
  }

  struct gpiod_chip *chip = gpiod_chip_open(chip_path);
  if (!chip) {
    fprintf(stderr, "ERROR: Cannot open GPIO controller: %s\n", chip_path);
    if (errno == EACCES) {
      fprintf(stderr, "Permission denied: Try running with 'sudo'.\n");
    }
    free(detected_chip);
    return EXIT_FAILURE;
  }

  const char *cmd = argv[optind++];
  int rc = 0;

  if (strcmp(cmd, "info") == 0) {
    rc = cmd_info(chip, chip_path);
  } else if (strcmp(cmd, "get") == 0) {
    if (optind >= argc) die_message("Usage: get <line-offset>");
    unsigned int offset = parse_u32(argv[optind++]);
    rc = cmd_get(chip, offset);
  } else if (strcmp(cmd, "set") == 0) {
    if (optind + 1 >= argc) die_message("Usage: set <line-offset> <0|1> [--hold]");
    unsigned int offset = parse_u32(argv[optind++]);
    int val = (int)parse_u32(argv[optind++]);
    bool hold = false;
    if (optind < argc && strcmp(argv[optind], "--hold") == 0) {
      hold = true;
    }
    rc = cmd_set(chip, offset, val, hold);
  } else if (strcmp(cmd, "monitor") == 0) {
    if (optind >= argc) die_message("Usage: monitor <line-offset> [count]");
    unsigned int offset = parse_u32(argv[optind++]);
    unsigned int max_events = 0;
    if (optind < argc) {
      max_events = parse_u32(argv[optind++]);
    }
    rc = cmd_monitor(chip, offset, max_events);
  } else {
    fprintf(stderr, "Unknown command: %s\n\n", cmd);
    usage(argv[0]);
    rc = -EINVAL;
  }

  gpiod_chip_close(chip);
  free(detected_chip);

  return (rc == 0) ? EXIT_SUCCESS : EXIT_FAILURE;
}
