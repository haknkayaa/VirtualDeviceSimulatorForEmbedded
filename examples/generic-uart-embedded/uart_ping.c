#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>

static int configure_serial(int fd) {
	struct termios config;
	if (tcgetattr(fd, &config) != 0) return -1;
	config.c_iflag &= (tcflag_t) ~(IGNBRK | BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL | IXON);
	config.c_oflag &= (tcflag_t) ~OPOST;
	config.c_lflag &= (tcflag_t) ~(ECHO | ECHONL | ICANON | ISIG | IEXTEN);
	config.c_cflag &= (tcflag_t) ~(CSIZE | PARENB | CSTOPB);
	config.c_cflag |= CS8 | CLOCAL | CREAD;
	config.c_cc[VMIN] = 0;
	config.c_cc[VTIME] = 0;
	if (cfsetispeed(&config, B115200) != 0 || cfsetospeed(&config, B115200) != 0) return -1;
	return tcsetattr(fd, TCSANOW, &config);
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
	if (argc != 2) {
		fprintf(stderr, "usage: %s /dev/pts/N\n", argv[0]);
		return 2;
	}
	const int fd = open(argv[1], O_RDWR | O_NOCTTY);
	if (fd < 0 || configure_serial(fd) != 0) {
		perror("open/configure UART");
		if (fd >= 0) (void) close(fd);
		return 1;
	}
	static const uint8_t request[] = "PING\r\n";
	static const uint8_t expected[] = "PONG\r\n";
	if (write_all(fd, request, sizeof(request) - 1U) != 0) {
		perror("write UART");
		(void) close(fd);
		return 1;
	}
	uint8_t response[sizeof(expected) - 1U];
	size_t received = 0U;
	while (received < sizeof(response)) {
		struct pollfd descriptor = { .fd = fd, .events = POLLIN, .revents = 0 };
		const int ready = poll(&descriptor, 1, 1000);
		if (ready <= 0) {
			fprintf(stderr, "timed out waiting for UART response\n");
			(void) close(fd);
			return 1;
		}
		const ssize_t count = read(fd, response + received, sizeof(response) - received);
		if (count < 0 && errno == EINTR) continue;
		if (count <= 0) {
			perror("read UART");
			(void) close(fd);
			return 1;
		}
		received += (size_t) count;
	}
	(void) close(fd);
	if (memcmp(response, expected, sizeof(response)) != 0) {
		fprintf(stderr, "unexpected UART response\n");
		return 1;
	}
	(void) fwrite(response, 1U, sizeof(response), stdout);
	return 0;
}
