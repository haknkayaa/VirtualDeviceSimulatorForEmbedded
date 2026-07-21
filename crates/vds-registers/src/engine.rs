use std::collections::BTreeMap;

use crate::{AccessType, RegisterDefinition, RegisterError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegisterMetadata {
    pub name: String,
    pub address: u64,
    pub width_bits: u8,
    pub reset_value: u64,
    pub access: AccessType,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegisterRead {
    pub register: RegisterMetadata,
    pub value: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegisterWrite {
    pub register: RegisterMetadata,
    pub old_value: u64,
    pub new_value: u64,
}

#[derive(Debug)]
struct RegisterState {
    definition: RegisterDefinition,
    current_value: u64,
}

/// Validated register definitions and their mutable runtime values.
#[derive(Debug)]
pub struct RegisterEngine {
    registers: BTreeMap<u64, RegisterState>,
}

impl RegisterEngine {
    /// Builds an engine from declarative definitions.
    ///
    /// # Errors
    ///
    /// Returns a structured error for duplicate addresses, invalid widths, or
    /// reset values that do not fit their register width.
    pub fn new(
        definitions: impl IntoIterator<Item = RegisterDefinition>,
    ) -> Result<Self, RegisterError> {
        let mut registers: BTreeMap<u64, RegisterState> = BTreeMap::new();
        for definition in definitions {
            validate_definition(&definition)?;
            let address = definition.address;
            if let Some(previous) = registers.get(&address) {
                return Err(RegisterError::DuplicateAddress {
                    address,
                    first_name: previous.definition.name.clone(),
                    second_name: definition.name,
                });
            }
            registers.insert(
                address,
                RegisterState {
                    current_value: definition.reset_value,
                    definition,
                },
            );
        }
        Ok(Self { registers })
    }

    /// Reads the current value of a readable register.
    ///
    /// # Errors
    ///
    /// Returns a structured error for an unknown address or a write-only
    /// register.
    pub fn read(&self, address: u64) -> Result<RegisterRead, RegisterError> {
        let state = self
            .registers
            .get(&address)
            .ok_or(RegisterError::UnknownAddress { address })?;
        if state.definition.access == AccessType::Wo {
            return Err(RegisterError::ReadNotAllowed {
                name: state.definition.name.clone(),
                address,
                access: state.definition.access,
                current_value: state.current_value,
            });
        }
        Ok(RegisterRead {
            register: metadata(&state.definition),
            value: state.current_value,
        })
    }

    /// Writes a new value to a writable register.
    ///
    /// # Errors
    ///
    /// Returns a structured error for an unknown address, a read-only register,
    /// or a value that does not fit the register width.
    pub fn write(&mut self, address: u64, value: u64) -> Result<RegisterWrite, RegisterError> {
        self.validate_write(address, value)?;
        let state = self
            .registers
            .get_mut(&address)
            .ok_or(RegisterError::UnknownAddress { address })?;

        let old_value = state.current_value;
        state.current_value = value;
        Ok(RegisterWrite {
            register: metadata(&state.definition),
            old_value,
            new_value: value,
        })
    }

    /// Validates a client-visible write without changing runtime state.
    ///
    /// # Errors
    ///
    /// Returns the same structured access, address, and width errors as
    /// [`Self::write`].
    pub fn validate_write(
        &self,
        address: u64,
        value: u64,
    ) -> Result<RegisterMetadata, RegisterError> {
        let state = self
            .registers
            .get(&address)
            .ok_or(RegisterError::UnknownAddress { address })?;
        if state.definition.access == AccessType::Ro {
            return Err(RegisterError::WriteNotAllowed {
                name: state.definition.name.clone(),
                address,
                access: state.definition.access,
                current_value: state.current_value,
                requested_value: value,
            });
        }
        if !fits_width(value, state.definition.width_bits) {
            return Err(RegisterError::ValueOverflow {
                name: state.definition.name.clone(),
                address,
                width_bits: state.definition.width_bits,
                value,
                current_value: state.current_value,
                access: state.definition.access,
            });
        }
        Ok(metadata(&state.definition))
    }

    /// Applies a device-internal value change while retaining address and width
    /// validation. This is used for hardware-owned status bits such as BUSY and
    /// intentionally bypasses client access permissions.
    ///
    /// # Errors
    ///
    /// Returns a structured error for an unknown address or width overflow.
    pub fn write_internal(
        &mut self,
        address: u64,
        value: u64,
    ) -> Result<RegisterWrite, RegisterError> {
        let state = self
            .registers
            .get_mut(&address)
            .ok_or(RegisterError::UnknownAddress { address })?;
        if !fits_width(value, state.definition.width_bits) {
            return Err(RegisterError::ValueOverflow {
                name: state.definition.name.clone(),
                address,
                width_bits: state.definition.width_bits,
                value,
                current_value: state.current_value,
                access: state.definition.access,
            });
        }
        let old_value = state.current_value;
        state.current_value = value;
        Ok(RegisterWrite {
            register: metadata(&state.definition),
            old_value,
            new_value: value,
        })
    }

    /// Returns metadata for one address without applying access rules.
    ///
    /// # Errors
    ///
    /// Returns a structured error when the address is unknown.
    pub fn metadata(&self, address: u64) -> Result<RegisterMetadata, RegisterError> {
        self.registers
            .get(&address)
            .map(|state| metadata(&state.definition))
            .ok_or(RegisterError::UnknownAddress { address })
    }

    /// Restores every runtime value to its declarative reset value.
    pub fn reset(&mut self) {
        for state in self.registers.values_mut() {
            state.current_value = state.definition.reset_value;
        }
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.registers.is_empty()
    }
}

fn validate_definition(definition: &RegisterDefinition) -> Result<(), RegisterError> {
    if !(1..=64).contains(&definition.width_bits) {
        return Err(RegisterError::InvalidWidth {
            name: definition.name.clone(),
            address: definition.address,
            width_bits: definition.width_bits,
        });
    }
    if !fits_width(definition.reset_value, definition.width_bits) {
        return Err(RegisterError::ResetValueOverflow {
            name: definition.name.clone(),
            address: definition.address,
            width_bits: definition.width_bits,
            reset_value: definition.reset_value,
        });
    }
    Ok(())
}

fn fits_width(value: u64, width_bits: u8) -> bool {
    width_bits == 64 || value < (1_u64 << width_bits)
}

fn metadata(definition: &RegisterDefinition) -> RegisterMetadata {
    RegisterMetadata {
        name: definition.name.clone(),
        address: definition.address,
        width_bits: definition.width_bits,
        reset_value: definition.reset_value,
        access: definition.access,
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::RegisterEngine;
    use crate::{AccessType, RegisterDefinition, RegisterError};

    fn register(name: &str, address: u64, access: AccessType) -> RegisterDefinition {
        RegisterDefinition {
            name: name.to_owned(),
            address,
            width_bits: 8,
            reset_value: 0x12,
            access,
        }
    }

    #[test]
    fn parses_declarative_yaml() {
        #[derive(Deserialize)]
        struct Document {
            registers: Vec<RegisterDefinition>,
        }

        let document: Document = serde_yaml::from_str(
            "registers:\n  - name: CONTROL\n    address: 0x01\n    width_bits: 8\n    reset_value: 0x12\n    access: rw\n",
        )
        .expect("register YAML should parse");
        let engine = RegisterEngine::new(document.registers).expect("definitions should validate");

        assert_eq!(engine.read(0x01).expect("register should read").value, 0x12);
    }

    #[test]
    fn rejects_duplicate_addresses() {
        let error = RegisterEngine::new([
            register("FIRST", 1, AccessType::Rw),
            register("SECOND", 1, AccessType::Rw),
        ])
        .expect_err("duplicate should fail");

        assert!(matches!(
            error,
            RegisterError::DuplicateAddress { address: 1, .. }
        ));
    }

    #[test]
    fn rejects_invalid_width() {
        let mut definition = register("INVALID", 1, AccessType::Rw);
        definition.width_bits = 0;

        assert!(matches!(
            RegisterEngine::new([definition]),
            Err(RegisterError::InvalidWidth { width_bits: 0, .. })
        ));
    }

    #[test]
    fn rejects_reset_value_overflow() {
        let mut definition = register("OVERFLOW", 1, AccessType::Rw);
        definition.width_bits = 8;
        definition.reset_value = 0x100;

        assert!(matches!(
            RegisterEngine::new([definition]),
            Err(RegisterError::ResetValueOverflow { .. })
        ));
    }

    #[test]
    fn rejects_write_to_read_only_register() {
        let mut engine = RegisterEngine::new([register("STATUS", 1, AccessType::Ro)])
            .expect("definition should validate");

        assert!(matches!(
            engine.write(1, 0x34),
            Err(RegisterError::WriteNotAllowed { .. })
        ));
    }

    #[test]
    fn rejects_read_from_write_only_register() {
        let engine = RegisterEngine::new([register("COMMAND", 1, AccessType::Wo)])
            .expect("definition should validate");

        assert!(matches!(
            engine.read(1),
            Err(RegisterError::ReadNotAllowed { .. })
        ));
    }

    #[test]
    fn round_trips_read_write_register() {
        let mut engine = RegisterEngine::new([register("CONTROL", 1, AccessType::Rw)])
            .expect("definition should validate");

        let write = engine.write(1, 0x5a).expect("write should succeed");

        assert_eq!(write.old_value, 0x12);
        assert_eq!(write.new_value, 0x5a);
        assert_eq!(engine.read(1).expect("read should succeed").value, 0x5a);
    }

    #[test]
    fn reset_restores_reset_value() {
        let mut engine = RegisterEngine::new([register("CONTROL", 1, AccessType::Rw)])
            .expect("definition should validate");
        engine.write(1, 0x5a).expect("write should succeed");

        engine.reset();

        assert_eq!(engine.read(1).expect("read should succeed").value, 0x12);
    }

    #[test]
    fn internal_write_can_update_read_only_status() {
        let mut engine = RegisterEngine::new([register("STATUS", 1, AccessType::Ro)])
            .expect("definition should validate");

        let write = engine
            .write_internal(1, 0x01)
            .expect("device-owned update should succeed");

        assert_eq!(write.old_value, 0x12);
        assert_eq!(write.new_value, 0x01);
        assert_eq!(engine.read(1).expect("status should read").value, 0x01);
    }

    #[test]
    fn rejects_unknown_address() {
        let engine = RegisterEngine::new([]).expect("empty engine should be valid");

        assert_eq!(
            engine.read(0x77),
            Err(RegisterError::UnknownAddress { address: 0x77 })
        );
    }
}
