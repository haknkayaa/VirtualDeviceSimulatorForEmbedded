# Generic GPIO Embedded Linux Tool (`gpio_tool`)

This example application uses the standard Linux `libgpiod` API to inspect, read, drive, and monitor virtual GPIO lines over a `/dev/gpiochipN` character device.

It is designed to work with the VDS4E [`generic-gpio-bank-32`](../../device-models/examples/generic-gpio-bank/) model:
- **Lines 0–15 (`GPIO0`–`GPIO15`):** Device inputs from the virtual peripheral's perspective. The host drives these lines with `set`; the corresponding `GPIOx_STATE` register updates in VDS4E.
- **Lines 16–31 (`GPIO16`–`GPIO31`):** Device outputs from the virtual peripheral's perspective. The host reads these lines with `get` or monitors edge transitions with `monitor`.

---

## Build

```bash
make
```

To clean build artifacts:
```bash
make clean
```

---

## Usage

### 1. Show Controller Info & Line Table
```bash
./gpio_tool -c /dev/gpiochip0 info
```

### 2. Read Device Output Line
```bash
./gpio_tool -c /dev/gpiochip0 get 16
```

### 3. Drive Device Input Line
```bash
./gpio_tool -c /dev/gpiochip0 set 0 1
```

To keep the line held in state:
```bash
./gpio_tool -c /dev/gpiochip0 set 0 1 --hold
```

### 4. Monitor Edge Transitions (Interrupts / Events)
```bash
./gpio_tool -c /dev/gpiochip0 monitor 16
```
*(When `GPIO16_STATE` changes via Web UI or API, edge events appear in real time)*
