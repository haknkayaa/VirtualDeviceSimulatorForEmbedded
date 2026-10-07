//! Lightweight XML parser for CMSIS-SVD documents.

use std::collections::HashMap;

use crate::error::{ImporterError, Result};

/// A node in an XML element tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct XmlElement {
    /// Tag name.
    pub name: String,
    /// Attribute key-value pairs.
    pub attributes: HashMap<String, String>,
    /// Accumulated direct text content (trimmed).
    pub text: String,
    /// Nested child elements.
    pub children: Vec<XmlElement>,
}

impl XmlElement {
    /// Parses an XML document into an `XmlElement` tree.
    ///
    /// # Errors
    /// Returns `ImporterError::XmlParse` on syntax errors or empty documents.
    pub fn parse(input: &str) -> Result<Self> {
        let mut parser = XmlParser::new(input);
        parser.parse_root()
    }

    /// Finds the first child element matching `name`.
    #[must_use]
    pub fn child(&self, name: &str) -> Option<&XmlElement> {
        self.children.iter().find(|child| child.name == name)
    }

    /// Returns an iterator over all child elements matching `name`.
    pub fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a XmlElement> {
        self.children.iter().filter(move |child| child.name == name)
    }

    /// Returns trimmed text of the first child matching `name`, if present and non-empty.
    #[must_use]
    pub fn child_text(&self, name: &str) -> Option<&str> {
        self.child(name).and_then(|c| {
            let t = c.text.trim();
            if t.is_empty() { None } else { Some(t) }
        })
    }

    /// Returns attribute value by key.
    #[must_use]
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attributes.get(name).map(String::as_str)
    }

    /// Parses integer value from child element text (supports decimal, hex `0x...`, `#...`, and binary `0b...`).
    ///
    /// # Errors
    /// Returns `ImporterError::InvalidSvd` if the child exists but cannot be parsed as `u64`.
    pub fn parse_child_u64(&self, name: &str) -> Result<Option<u64>> {
        match self.child_text(name) {
            Some(text) => parse_int_u64(text)
                .map(Some)
                .map_err(|err| ImporterError::InvalidSvd(format!("element <{name}>: {err}"))),
            None => Ok(None),
        }
    }

    /// Parses `u32` value from child element text.
    ///
    /// # Errors
    /// Returns `ImporterError::InvalidSvd` if the child exists but cannot be parsed as `u32`.
    pub fn parse_child_u32(&self, name: &str) -> Result<Option<u32>> {
        self.parse_child_u64(name)?
            .map(|val| {
                u32::try_from(val).map_err(|_| {
                    ImporterError::InvalidSvd(format!("element <{name}>: value {val} exceeds u32"))
                })
            })
            .transpose()
    }

    /// Parses `u8` value from child element text.
    ///
    /// # Errors
    /// Returns `ImporterError::InvalidSvd` if the child exists but cannot be parsed as `u8`.
    pub fn parse_child_u8(&self, name: &str) -> Result<Option<u8>> {
        self.parse_child_u64(name)?
            .map(|val| {
                u8::try_from(val).map_err(|_| {
                    ImporterError::InvalidSvd(format!("element <{name}>: value {val} exceeds u8"))
                })
            })
            .transpose()
    }
}

/// Parses an integer string that can be decimal, hex (`0x...` or `#...`), or binary (`0b...`).
/// Also strips underscores.
///
/// # Errors
/// Returns an error message if the string is empty or cannot be parsed as a valid integer.
pub fn parse_int_u64(raw: &str) -> std::result::Result<u64, String> {
    let clean = raw.trim().replace('_', "");
    if clean.is_empty() {
        return Err("empty integer string".to_string());
    }

    if let Some(hex) = clean.strip_prefix("0x").or_else(|| clean.strip_prefix("0X")) {
        u64::from_str_radix(hex, 16)
            .map_err(|err| format!("invalid hexadecimal number '{raw}': {err}"))
    } else if let Some(hex) = clean.strip_prefix('#') {
        u64::from_str_radix(hex, 16)
            .map_err(|err| format!("invalid hexadecimal number '{raw}': {err}"))
    } else if let Some(bin) = clean.strip_prefix("0b").or_else(|| clean.strip_prefix("0B")) {
        u64::from_str_radix(bin, 2).map_err(|err| format!("invalid binary number '{raw}': {err}"))
    } else {
        clean
            .parse::<u64>()
            .map_err(|err| format!("invalid decimal number '{raw}': {err}"))
    }
}

struct XmlParser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> XmlParser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, pos: 0 }
    }

    fn remaining(&self) -> &'a str {
        &self.input[self.pos..]
    }

    fn parse_root(&mut self) -> Result<XmlElement> {
        self.skip_whitespace_and_misc();
        if self.pos >= self.input.len() {
            return Err(ImporterError::XmlParse("empty XML document".to_string()));
        }

        let root = self.parse_element()?;
        self.skip_whitespace_and_misc();
        Ok(root)
    }

    fn skip_whitespace_and_misc(&mut self) {
        loop {
            self.skip_whitespace();
            let rem = self.remaining();
            if rem.starts_with("<!--") {
                if let Some(end) = rem.find("-->") {
                    self.pos += end + 3;
                } else {
                    self.pos = self.input.len();
                    return;
                }
            } else if rem.starts_with("<?") {
                if let Some(end) = rem.find("?>") {
                    self.pos += end + 2;
                } else {
                    self.pos = self.input.len();
                    return;
                }
            } else if rem.starts_with("<!DOCTYPE") {
                if let Some(end) = rem.find('>') {
                    self.pos += end + 1;
                } else {
                    self.pos = self.input.len();
                    return;
                }
            } else {
                break;
            }
        }
    }

    fn skip_whitespace(&mut self) {
        while self.pos < self.input.len() {
            let ch = self.input[self.pos..].chars().next().unwrap();
            if ch.is_whitespace() {
                self.pos += ch.len_utf8();
            } else {
                break;
            }
        }
    }

    fn parse_element(&mut self) -> Result<XmlElement> {
        if !self.remaining().starts_with('<') {
            return Err(ImporterError::XmlParse(format!(
                "expected '<' at position {}",
                self.pos
            )));
        }
        self.pos += 1; // consume '<'

        // Read tag name
        let tag_name = self.read_tag_name()?;
        let mut attributes = HashMap::new();

        // Read attributes until '>' or '/>'
        loop {
            self.skip_whitespace();
            let rem = self.remaining();
            if rem.starts_with("/>") {
                self.pos += 2;
                return Ok(XmlElement {
                    name: tag_name,
                    attributes,
                    text: String::new(),
                    children: Vec::new(),
                });
            } else if rem.starts_with('>') {
                self.pos += 1;
                break;
            } else if rem.is_empty() {
                return Err(ImporterError::XmlParse(format!(
                    "unclosed tag <{tag_name}> at EOF"
                )));
            }

            // Read attribute key
            let attr_key = self.read_tag_name()?;
            self.skip_whitespace();
            if !self.remaining().starts_with('=') {
                // Boolean or valueless attribute
                attributes.insert(attr_key, String::new());
                continue;
            }
            self.pos += 1; // consume '='
            self.skip_whitespace();

            // Read attribute value
            let attr_val = self.read_attribute_value()?;
            attributes.insert(attr_key, unescape_xml(&attr_val));
        }

        // Now parse body (children or text) until </tag_name>
        let mut text_acc = String::new();
        let mut children = Vec::new();

        loop {
            // Check for closing tag or child element
            let rem = self.remaining();
            if rem.is_empty() {
                return Err(ImporterError::XmlParse(format!(
                    "unexpected EOF while looking for closing </{tag_name}>"
                )));
            }

            if rem.starts_with("</") {
                // Closing tag
                self.pos += 2;
                let close_name = self.read_tag_name()?;
                self.skip_whitespace();
                if !self.remaining().starts_with('>') {
                    return Err(ImporterError::XmlParse(format!(
                        "expected '>' closing </{close_name}> at position {}",
                        self.pos
                    )));
                }
                self.pos += 1;

                if close_name != tag_name {
                    return Err(ImporterError::XmlParse(format!(
                        "mismatched closing tag: expected </{tag_name}>, found </{close_name}>"
                    )));
                }

                break;
            } else if rem.starts_with("<!--") {
                if let Some(end) = rem.find("-->") {
                    self.pos += end + 3;
                } else {
                    return Err(ImporterError::XmlParse(
                        "unclosed comment in element".to_string(),
                    ));
                }
            } else if rem.starts_with("<![CDATA[") {
                if let Some(end) = rem.find("]]>") {
                    let cdata = &rem[9..end];
                    text_acc.push_str(cdata);
                    self.pos += end + 3;
                } else {
                    return Err(ImporterError::XmlParse(
                        "unclosed CDATA block in element".to_string(),
                    ));
                }
            } else if rem.starts_with('<') {
                // Child element
                let child = self.parse_element()?;
                children.push(child);
            } else {
                // Text content up to next '<'
                let next_angle = rem.find('<').unwrap_or(rem.len());
                let raw_text = &rem[..next_angle];
                text_acc.push_str(&unescape_xml(raw_text));
                self.pos += next_angle;
            }
        }

        Ok(XmlElement {
            name: tag_name,
            attributes,
            text: text_acc.trim().to_string(),
            children,
        })
    }

    fn read_tag_name(&mut self) -> Result<String> {
        let start = self.pos;
        while self.pos < self.input.len() {
            let ch = self.input[self.pos..].chars().next().unwrap();
            if ch.is_alphanumeric() || ch == '_' || ch == '-' || ch == ':' || ch == '.' {
                self.pos += ch.len_utf8();
            } else {
                break;
            }
        }

        if self.pos == start {
            return Err(ImporterError::XmlParse(format!(
                "expected identifier at position {start}"
            )));
        }

        Ok(self.input[start..self.pos].to_string())
    }

    fn read_attribute_value(&mut self) -> Result<String> {
        let quote = self
            .remaining()
            .chars()
            .next()
            .filter(|&c| c == '"' || c == '\'')
            .ok_or_else(|| {
                ImporterError::XmlParse(format!("expected quote at position {}", self.pos))
            })?;

        self.pos += quote.len_utf8();
        let start = self.pos;
        while self.pos < self.input.len() {
            let ch = self.input[self.pos..].chars().next().unwrap();
            if ch == quote {
                let val = self.input[start..self.pos].to_string();
                self.pos += quote.len_utf8();
                return Ok(val);
            }
            self.pos += ch.len_utf8();
        }

        Err(ImporterError::XmlParse(format!(
            "unterminated attribute string started at position {start}"
        )))
    }
}

/// Unescapes standard XML entities.
fn unescape_xml(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    let bytes = raw.as_bytes();

    while i < bytes.len() {
        if bytes[i] == b'&' {
            if let Some(end_rel) = raw[i..].find(';') {
                let entity = &raw[i + 1..i + end_rel];
                match entity {
                    "lt" => out.push('<'),
                    "gt" => out.push('>'),
                    "amp" => out.push('&'),
                    "apos" => out.push('\''),
                    "quot" => out.push('"'),
                    _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                        if let Ok(cp) = u32::from_str_radix(&entity[2..], 16) {
                            if let Some(ch) = char::from_u32(cp) {
                                out.push(ch);
                            }
                        }
                    }
                    _ if entity.starts_with('#') => {
                        if let Ok(cp) = entity[1..].parse::<u32>() {
                            if let Some(ch) = char::from_u32(cp) {
                                out.push(ch);
                            }
                        }
                    }
                    _ => {
                        out.push('&');
                        out.push_str(entity);
                        out.push(';');
                    }
                }
                i += end_rel + 1;
                continue;
            }
        }
        out.push(raw[i..].chars().next().unwrap());
        i += raw[i..].chars().next().unwrap().len_utf8();
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_xml_structure() {
        let xml = r#"
            <?xml version="1.0" encoding="utf-8"?>
            <!-- This is a comment -->
            <device schemaVersion="1.3">
                <name>STM32F4</name>
                <size>32</size>
                <peripherals>
                    <peripheral derivedFrom="I2C1">
                        <name>I2C2</name>
                        <baseAddress>0x40005800</baseAddress>
                    </peripheral>
                </peripherals>
            </device>
        "#;
        let root = XmlElement::parse(xml).expect("XML parsing should succeed");
        assert_eq!(root.name, "device");
        assert_eq!(root.attr("schemaVersion"), Some("1.3"));
        assert_eq!(root.child_text("name"), Some("STM32F4"));
        assert_eq!(root.parse_child_u32("size").unwrap(), Some(32));

        let periphs = root.child("peripherals").expect("peripherals element");
        let periph = periphs.child("peripheral").expect("peripheral element");
        assert_eq!(periph.attr("derivedFrom"), Some("I2C1"));
        assert_eq!(periph.child_text("name"), Some("I2C2"));
        assert_eq!(
            periph.parse_child_u64("baseAddress").unwrap(),
            Some(0x4000_5800)
        );
    }

    #[test]
    fn parses_number_notations() {
        assert_eq!(parse_int_u64("0").unwrap(), 0);
        assert_eq!(parse_int_u64("42").unwrap(), 42);
        assert_eq!(parse_int_u64("0x10").unwrap(), 16);
        assert_eq!(parse_int_u64("0XFF").unwrap(), 255);
        assert_eq!(parse_int_u64("#4000").unwrap(), 0x4000);
        assert_eq!(parse_int_u64("0b1010").unwrap(), 10);
        assert_eq!(parse_int_u64("0x12_34").unwrap(), 0x1234);
    }
}
