//! Transport-neutral ingress. It does not register or implement a native host.
use crate::contract::{Record, Snapshot, MAX_MESSAGE_BYTES, MAX_TIMESTAMP};
use crate::isolation::{plain_path, Paths};
use crate::{bounded_json, Error};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};

pub const MAX_CACHE_BYTES: usize = 16 * 1024;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub transport_version: u8, pub pairing_generation: String, pub sequence: u64,
    pub nonce: String, pub sent_at_ms: u64, pub payload: Snapshot,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checkpoint {
    pub pairing_generation: String, pub last_sequence: u64, pub recent_nonces: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CacheState { pub cache_version: u8, pub checkpoint: Checkpoint, pub latest: Option<Record> }
pub trait CacheStore {
    fn load(&self) -> Result<Option<CacheState>, Error>;
    fn commit(&mut self, state: &CacheState) -> Result<(), Error>;
}
fn opaque(value: &str) -> bool { value.len()==32 && value.bytes().all(|b| b.is_ascii_hexdigit()) }
#[derive(Debug)]
pub struct Ingress { state: CacheState }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ack { pub sequence: u64 }
impl Ingress {
    pub fn new(generation: &str, store: &impl CacheStore) -> Result<Self, Error> {
        if !opaque(generation) { return Err(Error::Generation); }
        let mut state = store.load()?.unwrap_or_else(|| CacheState {
            cache_version:1, checkpoint:Checkpoint { pairing_generation:generation.into(), last_sequence:0, recent_nonces:Vec::new() }, latest:None,
        });
        if state.cache_version!=1 { return Err(Error::Version); }
        if state.checkpoint.pairing_generation!=generation { return Err(Error::Generation); }
        if state.checkpoint.last_sequence>MAX_TIMESTAMP || state.checkpoint.recent_nonces.len()>64 || state.checkpoint.recent_nonces.iter().any(|s| !opaque(s)) { return Err(Error::Cache); }
        let unique=state.checkpoint.recent_nonces.iter().collect::<std::collections::BTreeSet<_>>();
        if unique.len()!=state.checkpoint.recent_nonces.len() { return Err(Error::Cache); }
        if (state.checkpoint.last_sequence==0) != state.checkpoint.recent_nonces.is_empty() { return Err(Error::Cache); }
        if state.latest.is_some() && state.checkpoint.last_sequence==0 { return Err(Error::Cache); }
        if let Some(record)=&mut state.latest { record.snapshot.validate(record.received_at_ms)?; }
        Ok(Self { state })
    }
    pub fn submit(&mut self, bytes: &[u8], received_at_ms: u64, store: &mut impl CacheStore) -> Result<Ack, Error> {
        let mut message: Envelope = bounded_json(bytes, MAX_MESSAGE_BYTES)?;
        if message.transport_version!=1 { return Err(Error::Version); }
        if message.pairing_generation!=self.state.checkpoint.pairing_generation { return Err(Error::Generation); }
        if !opaque(&message.nonce) || message.sequence==0 || message.sequence>MAX_TIMESTAMP || message.sequence<=self.state.checkpoint.last_sequence || self.state.checkpoint.recent_nonces.contains(&message.nonce) { return Err(Error::Replay); }
        if message.sent_at_ms==0 || message.sent_at_ms<message.payload.observed_at_ms || message.sent_at_ms>MAX_TIMESTAMP || message.sent_at_ms>received_at_ms.saturating_add(60_000) || message.sent_at_ms.saturating_add(60_000)<received_at_ms { return Err(Error::Timestamp); }
        message.payload.validate(received_at_ms)?;
        let mut next=self.state.clone();
        next.checkpoint.last_sequence=message.sequence;
        next.checkpoint.recent_nonces.push(message.nonce);
        if next.checkpoint.recent_nonces.len()>64 { next.checkpoint.recent_nonces.remove(0); }
        next.latest=Some(Record {snapshot:message.payload, received_at_ms});
        store.commit(&next)?; // checkpoint and snapshot commit together; failure cannot advance memory
        self.state=next;
        Ok(Ack {sequence:message.sequence})
    }
    pub fn latest(&self) -> Option<&Record> { self.state.latest.as_ref() }
    pub fn expire(&mut self, now: u64, store: &mut impl CacheStore) -> Result<bool, Error> {
        if self.state.latest.as_ref().is_some_and(|r| r.display_state(now)==crate::contract::Status::Unavailable) {
            let mut next=self.state.clone(); next.latest=None; store.commit(&next)?; self.state=next; return Ok(true);
        }
        Ok(false)
    }
}

pub struct FileStore { paths: Paths }
impl FileStore { pub fn new(paths: Paths) -> Result<Self, Error> { paths.verify()?; Ok(Self {paths}) } }
impl CacheStore for FileStore {
    fn load(&self) -> Result<Option<CacheState>, Error> {
        self.paths.verify()?;
        let dest=self.paths.cache_file();
        match fs::symlink_metadata(&dest) {
            Ok(metadata) if metadata.is_file() => {},
            Ok(_) => return Err(Error::Cache),
            Err(e) if e.kind()==std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(Error::Io),
        }
        plain_path(&dest)?;
        let file=std::fs::File::open(&dest).map_err(|_| Error::Io)?;
        let mut bytes=Vec::new();
        file.take((MAX_CACHE_BYTES+1) as u64).read_to_end(&mut bytes).map_err(|_| Error::Io)?;
        bounded_json(&bytes, MAX_CACHE_BYTES).map(Some)
    }
    fn commit(&mut self, state: &CacheState) -> Result<(), Error> {
        self.paths.verify()?;
        let bytes=serde_json::to_vec(state).map_err(|_| Error::Cache)?;
        if bytes.len()>MAX_CACHE_BYTES { return Err(Error::TooLarge); }
        let dest=self.paths.cache_file(); if dest.exists() { plain_path(&dest)?; }
        let tmp=self.paths.cache().join("gemini-state.pending");
        let mut file=OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|_| Error::Io)?;
        if file.write_all(&bytes).and_then(|_| file.sync_all()).is_err() { drop(file); let _=fs::remove_file(&tmp); return Err(Error::Io); }
        drop(file);
        self.paths.verify()?;
        // Same-directory rename; Windows replace/durability must be exercised in 8B.
        fs::rename(&tmp,&dest).map_err(|_| Error::Io)
    }
}
