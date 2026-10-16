# Ethernet TAP adapter

The Ethernet adapter exposes a normal Linux TAP network interface. An unmodified
Linux program can send Ethernet traffic via that interface while VDS4E handles
the packet in a declarative virtual device runtime.

The first device driver is `generic-ethernet-host`. It replies to ARP queries
for its configured IPv4 address and to valid IPv4 ICMP Echo requests. It does
not implement UDP, TCP, IPv6, DHCP, switching, PHY registers, or link speed.

## Start

1. Start VDS4E with `./run.sh`. Creating a TAP requires `/dev/net/tun` and
   `CAP_NET_ADMIN`. The adapter manager uses its existing sudo/Polkit
   authorization path when necessary.
2. Ensure `device-models/examples/ethernet-icmp-host` is in
   `config/vds-server.yaml` under `device_packages` (included in the example).
3. Open **Adapters** in the Web UI, add an **Ethernet** adapter with bus number
   `0`, and bind the `ethernet-icmp-host` device. The endpoint is always `0`.
4. Load the adapter. Its Linux interface is `vds0`.

Configure the host-side IPv4 address and bring up the interface:

```sh
sudo ip address add 192.0.2.1/24 dev vds0
sudo ip link set vds0 up
ping -I vds0 -c 3 192.0.2.2
sudo tcpdump -eni vds0 'arp or icmp'
```

The virtual host address is `192.0.2.2` and its MAC address is
`02:56:44:53:00:01` in the bundled package. These are model attributes;
change the values in `model/device.yaml` to suit the scenario. The Linux TAP
interface is deleted when the helper exits or the adapter is unloaded.

The Ethernet layer transports complete untagged Ethernet II frames through the
same length-prefixed Protobuf Unix socket as the other buses. A packet exchange
returns zero or one Ethernet response frame in the first host model. No
Ethernet-specific protocol interpretation lives in the TAP helper.

## Limitations

Ethernet support is currently a functional protocol slice for Linux userspace
traffic. TAP carries L2 Ethernet frames and is not a simulated physical NIC;
real driver registers, interrupt hardware, MDIO, DMA and precise timing are
outside the current architecture. Privileged host-adapter conformance testing
remains a separate manual activity.
