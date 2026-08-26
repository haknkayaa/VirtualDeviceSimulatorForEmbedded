#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <sys/stat.h>
#include <termios.h>
#include <unistd.h>

#include "adapter_bridge.h"

#define BUFFER_SIZE 2048U

static volatile sig_atomic_t running = 1;
static void stop(int signal_number) {
	(void) signal_number;
	running = 0;
}

static int write_all(int fd, const uint8_t *data, size_t length) {
	while (length > 0U) {
		const ssize_t written = write(fd, data, length);
		if (written < 0 && errno == EINTR) continue;
		if (written <= 0) return -1;
		data += (size_t) written;
		length -= (size_t) written;
	}
	return 0;
}

int main(int argc, char **argv) {
	const char *device_id = NULL;
	const char *socket_path = NULL;
	pid_t parent_pid = 0;
	for (int index = 1; index + 1 < argc; index += 2) {
		if (strcmp(argv[index], "--device-id") == 0)
			device_id = argv[index + 1];
		else if (strcmp(argv[index], "--socket") == 0)
			socket_path = argv[index + 1];
		else if (strcmp(argv[index], "--parent-pid") == 0)
			parent_pid = (pid_t) strtol(argv[index + 1], NULL, 10);
		else {
			fprintf(stderr, "unknown option: %s\n", argv[index]);
			return 2;
		}
	}
	if (device_id == NULL || socket_path == NULL) {
		fprintf(stderr, "usage: %s --device-id ID --socket PATH [--parent-pid PID]\n", argv[0]);
		return 2;
	}

	const int master = posix_openpt(O_RDWR | O_NOCTTY);
	if (master < 0 || grantpt(master) != 0 || unlockpt(master) != 0) {
		perror("create PTY");
		if (master >= 0) (void) close(master);
		return 1;
	}
	const char *slave_path = ptsname(master);
	if (slave_path == NULL) {
		perror("resolve PTY slave");
		(void) close(master);
		return 1;
	}
	struct termios terminal;
	if (tcgetattr(master, &terminal) == 0) {
		cfmakeraw(&terminal);
		(void) tcsetattr(master, TCSANOW, &terminal);
	}

	vds_adapter_bridge_t bridge = { .fd = -1, .next_request_id = 1U };
	if (vds_adapter_bridge_connect(&bridge, socket_path) != VDS_OK) {
		fprintf(stderr, "failed to connect to VDS4E data plane\n");
		(void) close(master);
		return 1;
	}
	(void) signal(SIGINT, stop);
	(void) signal(SIGTERM, stop);
	printf("%s\n", slave_path);
	(void) fflush(stdout);

	while (running) {
		if (parent_pid > 1 && kill(parent_pid, 0) != 0 && errno == ESRCH) break;
		fd_set readable;
		FD_ZERO(&readable);
		FD_SET(master, &readable);
		struct timeval timeout = { .tv_sec = 1, .tv_usec = 0 };
		const int selected = select(master + 1, &readable, NULL, NULL, &timeout);
		if (selected < 0 && errno == EINTR) continue;
		if (selected < 0) {
			perror("select PTY");
			break;
		}
		if (selected == 0) continue;

		uint8_t tx[BUFFER_SIZE];
		const ssize_t received = read(master, tx, sizeof(tx));
		if (received < 0 && (errno == EINTR || errno == EIO)) continue;
		if (received <= 0) continue;
		uint8_t rx[BUFFER_SIZE];
		size_t rx_length = 0U;
		vds_error_t error;
		const vds_status_t status = vds_uart_transfer(&bridge, device_id, tx, (size_t) received, rx, sizeof(rx), &rx_length, &error);
		if (status == VDS_ERR_SERVER) {
			fprintf(stderr, "UART runtime error %d: %s\n", error.code, error.message);
			continue;
		}
		if (status != VDS_OK) {
			fprintf(stderr, "UART bridge error: %d\n", status);
			break;
		}
		if (rx_length > 0U && write_all(master, rx, rx_length) != 0) {
			perror("write PTY");
			break;
		}
	}
	vds_adapter_bridge_close(&bridge);
	(void) close(master);
	return 0;
}
