use std::fmt;

use serde::{Deserialize, Serialize};

/// Register access rules supported by Register Engine v1.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AccessType {
    Ro,
    Wo,
    Rw,
}

impl fmt::Display for AccessType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Ro => formatter.write_str("ro"),
            Self::Wo => formatter.write_str("wo"),
            Self::Rw => formatter.write_str("rw"),
        }
    }
}

/// Named bit range within a register definition.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BitFieldDefinition {
    pub name: String,
    pub lsb: u8,
    pub width: u8,
    pub access: AccessType,
    #[serde(default)]
    pub description: String,
}

/// Declarative definition used to construct one runtime register.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterDefinition {
    pub name: String,
    pub address: u64,
    pub width_bits: u8,
    pub reset_value: u64,
    pub access: AccessType,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub bitfields: Vec<BitFieldDefinition>,
}
