//! Experimental, account-free primitives. No providers, transport or OS integration.
pub mod contract;
pub mod ingress;
pub mod isolation;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    TooLarge, TooDeep, InvalidJson, Version, Provider, Origin, Timestamp,
    Windows, Percentage, Reset, Status, Issue, Account, Replay, Generation,
    Cache, Directory, AlreadyRunning, Io,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // No payload, filesystem path, browser error or credential in diagnostics.
        write!(f, "gemini_experimental_{self:?}")
    }
}
impl std::error::Error for Error {}

pub(crate) fn bounded_json<T: serde::de::DeserializeOwned>(bytes: &[u8], max: usize) -> Result<T, Error> {
    if bytes.len() > max { return Err(Error::TooLarge); }
    let (mut depth, mut quoted, mut escaped) = (0u8, false, false);
    for b in bytes {
        if quoted {
            if escaped { escaped = false; }
            else if *b == b'\\' { escaped = true; }
            else if *b == b'"' { quoted = false; }
        } else {
            match *b {
                b'"' => quoted = true,
                b'{' | b'[' => { depth += 1; if depth > 8 { return Err(Error::TooDeep); } }
                b'}' | b']' => { depth = depth.checked_sub(1).ok_or(Error::InvalidJson)?; }
                _ => {}
            }
        }
    }
    // Parse directly into structs (not Value); serde rejects duplicate fields.
    serde_json::from_slice(bytes).map_err(|_| Error::InvalidJson)
}
