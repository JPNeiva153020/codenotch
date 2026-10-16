use crate::{bounded_json, Error};
use chrono::{FixedOffset, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const MAX_MESSAGE_BYTES: usize = 8 * 1024;
pub const MAX_TIMESTAMP: u64 = 9_007_199_254_740_991;
pub const RECENT_MS: u64 = 5 * 60 * 1000;
pub const TTL_MS: u64 = 24 * 60 * 60 * 1000;
pub const FUTURE_SKEW_MS: u64 = 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status { Observed, Partial, Historical, Unavailable, Error }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin { VisibleUi, ManualEntry }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Collection { DomOnAuthorizedUsage, DomOnUserAction, ManualEntry }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountScope { Unknown }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Scope { #[serde(rename = "Gemini Web")] GeminiWeb }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId { GeminiWeb }
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowId { Current, Weekly }
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Issue {
    MissingPercentage, InvalidPercentage, DuplicatePercentage, MissingReset,
    InvalidReset, DuplicateReset, MissingLabel, DuplicateLabel, MissingFields,
    CardTooLarge, LayoutChanged, ChannelUnavailable, ClockUncertain,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reset {
    pub day: Option<u8>, pub month: Option<u8>, pub year: Option<u16>,
    pub hour: Option<u8>, pub minute: Option<u8>, pub timezone: Option<String>,
    pub epoch_ms: Option<u64>, pub needs_confirmation: bool,
}
impl Reset {
    pub fn validate(&self) -> Result<(), Error> {
        if self.day.is_some() != self.month.is_some() || self.hour.is_some() != self.minute.is_some() {
            return Err(Error::Reset);
        }
        if self.hour.is_some_and(|x| x > 23) || self.minute.is_some_and(|x| x > 59) { return Err(Error::Reset); }
        if let Some(year) = self.year { if !(1970..=9999).contains(&year) || self.day.is_none() { return Err(Error::Reset); } }
        if let (Some(day), Some(month)) = (self.day, self.month) {
            // An absent year stays absent. Leap-day is possible, not confirmed.
            let year = self.year.unwrap_or(2000);
            if NaiveDate::from_ymd_opt(year as i32, month as u32, day as u32).is_none() { return Err(Error::Reset); }
        }
        let offset = self.timezone.as_deref().map(parse_offset).transpose()?;
        let complete = self.year.is_some() && self.day.is_some() && self.hour.is_some() && offset.is_some();
        if !complete && !self.needs_confirmation { return Err(Error::Reset); }
        if let Some(epoch) = self.epoch_ms {
            if !complete || epoch > MAX_TIMESTAMP { return Err(Error::Reset); }
            let date = NaiveDate::from_ymd_opt(self.year.unwrap() as i32, self.month.unwrap() as u32, self.day.unwrap() as u32).ok_or(Error::Reset)?;
            let local = date.and_hms_opt(self.hour.unwrap() as u32, self.minute.unwrap() as u32, 0).ok_or(Error::Reset)?;
            let actual = offset.unwrap().from_local_datetime(&local).single().ok_or(Error::Reset)?.timestamp_millis();
            if actual < 0 || actual as u64 != epoch { return Err(Error::Reset); }
        }
        Ok(())
    }
}
fn parse_offset(text: &str) -> Result<FixedOffset, Error> {
    if text == "UTC" { return FixedOffset::east_opt(0).ok_or(Error::Reset); }
    let b = text.as_bytes();
    if b.len() != 6 || !matches!(b[0], b'+' | b'-') || b[3] != b':' || ![b[1],b[2],b[4],b[5]].iter().all(u8::is_ascii_digit) { return Err(Error::Reset); }
    let h = ((b[1]-b'0') as i32)*10+(b[2]-b'0') as i32;
    let m = ((b[4]-b'0') as i32)*10+(b[5]-b'0') as i32;
    if h > 14 || m > 59 || (h == 14 && m != 0) { return Err(Error::Reset); }
    FixedOffset::east_opt((h*3600+m*60)*if b[0]==b'-' {-1} else {1}).ok_or(Error::Reset)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Window {
    pub id: WindowId, pub status: Status, pub used_percent: Option<f64>,
    pub remaining_percent: Option<f64>, pub reset: Option<Reset>, pub issues: Vec<Issue>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub schema_version: u8, pub provider_id: ProviderId, pub origin: Origin,
    pub collection: Collection, pub observed_at_ms: u64, pub model: Option<String>,
    pub scope: Scope, pub account_scope: AccountScope, pub status: Status,
    pub windows: Vec<Window>, pub issues: Vec<Issue>,
}
fn issues_valid(issues: &[Issue]) -> bool {
    issues.len() <= 8 && issues.iter().copied().collect::<BTreeSet<_>>().len() == issues.len()
}
impl Snapshot {
    pub fn from_bytes(bytes: &[u8], received_at_ms: u64) -> Result<Self, Error> {
        let mut snapshot: Self = bounded_json(bytes, MAX_MESSAGE_BYTES)?;
        snapshot.validate(received_at_ms)?; Ok(snapshot)
    }
    pub fn validate(&mut self, received_at_ms: u64) -> Result<(), Error> {
        if self.schema_version != 1 { return Err(Error::Version); }
        if self.model.is_some() { return Err(Error::Account); }
        if !matches!((self.origin,self.collection), (Origin::VisibleUi,Collection::DomOnAuthorizedUsage | Collection::DomOnUserAction) | (Origin::ManualEntry,Collection::ManualEntry)) { return Err(Error::Origin); }
        if self.observed_at_ms == 0 || received_at_ms == 0 || received_at_ms > MAX_TIMESTAMP || self.observed_at_ms > MAX_TIMESTAMP || self.observed_at_ms > received_at_ms.saturating_add(FUTURE_SKEW_MS) { return Err(Error::Timestamp); }
        if self.windows.len() != 2 || self.windows.iter().map(|w| w.id).collect::<BTreeSet<_>>().len() != 2 { return Err(Error::Windows); }
        if !issues_valid(&self.issues) { return Err(Error::Issue); }
        for w in &mut self.windows {
            if !issues_valid(&w.issues) { return Err(Error::Issue); }
            if let Some(used) = w.used_percent {
                if !used.is_finite() || !(0.0..=100.0).contains(&used) { return Err(Error::Percentage); }
                let left = ((100.0-used)*1_000_000.0).round()/1_000_000.0;
                if w.remaining_percent.is_some_and(|x| !x.is_finite() || !(0.0..=100.0).contains(&x) || (x-left).abs() > 0.000001) { return Err(Error::Percentage); }
                w.remaining_percent = Some(left);
            } else if w.remaining_percent.is_some() { return Err(Error::Percentage); }
            if let Some(reset) = &w.reset { reset.validate()?; }
            if w.status == Status::Observed && (w.used_percent.is_none() || w.reset.is_none() || !w.issues.is_empty()) { return Err(Error::Status); }
        }
        self.windows.sort_by_key(|w| w.id);
        if self.status == Status::Observed && (!self.issues.is_empty() || self.windows.iter().any(|w| w.status != Status::Observed)) { return Err(Error::Status); }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record { pub snapshot: Snapshot, pub received_at_ms: u64 }
impl Record {
    pub fn display_state(&self, now: u64) -> Status {
        if now < self.received_at_ms || now < self.snapshot.observed_at_ms || now-self.snapshot.observed_at_ms > TTL_MS { return Status::Unavailable; }
        if matches!(self.snapshot.status, Status::Error | Status::Unavailable | Status::Partial) { return self.snapshot.status; }
        // No account identity/confirmed session exists in 8A: never claim a current balance.
        Status::Historical
    }
    pub fn age_ms(&self, now: u64) -> Option<u64> { now.checked_sub(self.snapshot.observed_at_ms) }
    pub fn confirmed_countdown_ms(&self, _now: u64) -> Option<u64> { None }
}
