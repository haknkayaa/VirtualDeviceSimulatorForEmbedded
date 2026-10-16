//! Minimal declarative Ethernet host: ARP and IPv4 ICMP Echo at Ethernet L2.
use std::net::Ipv4Addr;
use vds_core::device::{BusType, Device, DeviceError, DeviceTransfer, SpiWireConfig};

pub struct GenericEthernetHost {
    id: String,
    mac: [u8; 6],
    ip: [u8; 4],
}

impl GenericEthernetHost {
    pub fn new(id: String, mac: &str, ipv4: &str) -> Result<Self, String> {
        let parts = mac.split(':').collect::<Vec<_>>();
        if parts.len() != 6 {
            return Err("Ethernet MAC requires six colon-separated octets".to_owned());
        }
        let mut address = [0u8; 6];
        for (index, part) in parts.iter().enumerate() {
            if part.len() != 2 {
                return Err("MAC octets must have two hex digits".to_owned());
            }
            address[index] = u8::from_str_radix(part, 16)
                .map_err(|_| "MAC contains invalid hex digits".to_owned())?;
        }
        if address[0] & 1 != 0 || address == [0; 6] {
            return Err("MAC must be a nonzero unicast address".to_owned());
        }
        let ip = ipv4.parse::<Ipv4Addr>()
            .map_err(|_| "invalid Ethernet IPv4 address".to_owned())?.octets();
        Ok(Self { id, mac: address, ip })
    }
}

fn checksum(data: &[u8]) -> u16 {
    let mut sum = 0u32;
    for pair in data.chunks(2) {
        sum += u32::from(u16::from_be_bytes([pair[0], *pair.get(1).unwrap_or(&0)]));
    }
    while sum >> 16 != 0 {
        sum = (sum & 0xffff) + (sum >> 16);
    }
    !(sum as u16)
}

impl Device for GenericEthernetHost {
    fn id(&self) -> &str { &self.id }
    fn bus_type(&self) -> BusType { BusType::Ethernet }
    fn transfer(&self, _request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
        Err(DeviceError::InvalidRequest("use Ethernet frame transfer".to_owned()))
    }
    fn transfer_spi(&self, _request: &[u8], _len: usize, _wire: SpiWireConfig) -> Result<DeviceTransfer, DeviceError> {
        Err(DeviceError::InvalidRequest("Ethernet host does not support SPI".to_owned()))
    }
    fn transfer_ethernet(&self, frame: &[u8]) -> Result<Vec<Vec<u8>>, DeviceError> {
        if frame.len() > 1518 {
            return Err(DeviceError::InvalidRequest("Ethernet frame exceeds 1518 bytes".to_owned()));
        }
        if frame.len() < 14 { return Ok(vec![]); }
        let ethertype = u16::from_be_bytes([frame[12], frame[13]]);
        if ethertype == 0x0806 && frame.len() >= 42 {
            let arp = &frame[14..42];
            if arp[0..8] != [0, 1, 8, 0, 6, 4, 0, 1] || arp[24..28] != self.ip {
                return Ok(vec![]);
            }
            let mut reply = vec![0u8; 42];
            reply[..6].copy_from_slice(&frame[6..12]);
            reply[6..12].copy_from_slice(&self.mac);
            reply[12..14].copy_from_slice(&[0x08, 0x06]);
            reply[14..22].copy_from_slice(&[0, 1, 8, 0, 6, 4, 0, 2]);
            reply[22..28].copy_from_slice(&self.mac);
            reply[28..32].copy_from_slice(&self.ip);
            reply[32..38].copy_from_slice(&arp[8..14]);
            reply[38..42].copy_from_slice(&arp[14..18]);
            return Ok(vec![reply]);
        }
        if ethertype != 0x0800 || frame.len() < 14 + 20 { return Ok(vec![]); }
        let packet = &frame[14..];
        if packet[0] != 0x45 || packet[9] != 1 || packet[16..20] != self.ip {
            return Ok(vec![]);
        }
        let length = usize::from(u16::from_be_bytes([packet[2], packet[3]]));
        if length < 28 || length > packet.len() || checksum(&packet[..20]) != 0 ||
            (u16::from_be_bytes([packet[6], packet[7]]) & 0x3fff) != 0 {
            return Ok(vec![]);
        }
        if packet[20] != 8 || packet[21] != 0 || checksum(&packet[20..length]) != 0 {
            return Ok(vec![]);
        }
        let mut reply = vec![0u8; 14 + length];
        reply[..6].copy_from_slice(&frame[6..12]);
        reply[6..12].copy_from_slice(&self.mac);
        reply[12..14].copy_from_slice(&[8, 0]);
        reply[14..].copy_from_slice(&packet[..length]);
        let ip = &mut reply[14..];
        ip[12..16].copy_from_slice(&self.ip);
        ip[16..20].copy_from_slice(&packet[12..16]);
        ip[10..12].fill(0);
        let ip_sum = checksum(&ip[..20]);
        ip[10..12].copy_from_slice(&ip_sum.to_be_bytes());
        ip[20] = 0;
        ip[22..24].fill(0);
        let icmp_sum = checksum(&ip[20..length]);
        ip[22..24].copy_from_slice(&icmp_sum.to_be_bytes());
        Ok(vec![reply])
    }
}
