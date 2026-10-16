mod common;
use common::*;
use codenotch_gemini_experimental::contract::*;
use codenotch_gemini_experimental::Error;
fn parse(value: serde_json::Value) -> Result<Snapshot,Error> { Snapshot::from_bytes(&serde_json::to_vec(&value).unwrap(),NOW) }

#[test] fn valid_and_account_unknown() { let s=snapshot();assert_eq!(s.account_scope,AccountScope::Unknown);assert_eq!(s.model,None);assert_eq!(s.windows[0].remaining_percent,Some(75.0)); }
#[test] fn real_zero_is_not_missing() { let mut v=fixture();v["windows"][0]["used_percent"]=0.into();v["windows"][0]["remaining_percent"]=100.into();assert_eq!(parse(v).unwrap().windows[0].used_percent,Some(0.0)); }
#[test] fn full_use_has_zero_remaining() { let mut v=fixture();v["windows"][0]["used_percent"]=100.into();v["windows"][0]["remaining_percent"]=0.into();assert_eq!(parse(v).unwrap().windows[0].remaining_percent,Some(0.0)); }
#[test] fn missing_is_null_not_zero() { let mut v=fixture();v["status"]="partial".into();v["windows"][0]["status"]="partial".into();v["windows"][0]["used_percent"]=serde_json::Value::Null;v["windows"][0]["remaining_percent"]=serde_json::Value::Null;assert_eq!(parse(v).unwrap().windows[0].used_percent,None); }
#[test] fn out_of_range_rejected() { for p in [-1,101] {let mut v=fixture();v["windows"][0]["used_percent"]=p.into();assert_eq!(parse(v),Err(Error::Percentage));} }
#[test] fn remaining_is_derived_and_mismatch_rejected() {let mut v=fixture();v["windows"][0]["remaining_percent"]=serde_json::Value::Null;assert_eq!(parse(v.clone()).unwrap().windows[0].remaining_percent,Some(75.0));v["windows"][0]["remaining_percent"]=24.into();assert_eq!(parse(v),Err(Error::Percentage));}
#[test] fn duplicate_window_rejected() {let mut v=fixture();v["windows"][1]["id"]="current".into();assert_eq!(parse(v),Err(Error::Windows));}
#[test] fn version_rejected() {let mut v=fixture();v["schema_version"]=2.into();assert_eq!(parse(v),Err(Error::Version));}
#[test] fn extra_personal_fields_rejected() {for key in ["email","url","token","account_id","profile"] {let mut v=fixture();v[key]="fictional-extra".into();assert_eq!(parse(v),Err(Error::InvalidJson));}}
#[test] fn arbitrary_errors_rejected() {let mut v=fixture();v["issues"]=serde_json::json!(["raw_private_text"]);assert_eq!(parse(v),Err(Error::InvalidJson));}
#[test] fn duplicate_struct_fields_rejected() {let text=include_str!("fixtures/snapshot.json").replacen("\"schema_version\": 1","\"schema_version\": 1, \"schema_version\": 1",1);assert_eq!(Snapshot::from_bytes(text.as_bytes(),NOW),Err(Error::InvalidJson));}
#[test] fn missing_required_field_rejected() {let mut v=fixture();v.as_object_mut().unwrap().remove("observed_at_ms");assert_eq!(parse(v),Err(Error::InvalidJson));}
#[test] fn unknown_provider_rejected() {let mut v=fixture();v["provider_id"]="opencode".into();assert_eq!(parse(v),Err(Error::InvalidJson));}
#[test] fn invented_model_rejected() {let mut v=fixture();v["model"]="fictional-model".into();assert_eq!(parse(v),Err(Error::Account));}
#[test] fn invalid_hour_and_calendar_rejected() {let mut v=fixture();v["windows"][0]["reset"]["hour"]=24.into();assert_eq!(parse(v),Err(Error::Reset));let mut v=fixture();v["windows"][1]["reset"]["day"]=31.into();assert_eq!(parse(v),Err(Error::Reset));}
#[test] fn partial_reset_never_becomes_countdown() {let r=Record {snapshot:snapshot(),received_at_ms:NOW};assert_eq!(r.confirmed_countdown_ms(NOW),None);let reset=r.snapshot.windows[0].reset.as_ref().unwrap();assert_eq!(reset.year,None);assert_eq!(reset.epoch_ms,None);}
#[test] fn partial_reset_cannot_claim_confirmation() {let mut v=fixture();v["windows"][0]["reset"]["needs_confirmation"]=false.into();assert_eq!(parse(v),Err(Error::Reset));}
#[test] fn origin_method_must_agree() {let mut v=fixture();v["collection"]="manual_entry".into();assert_eq!(parse(v),Err(Error::Origin));}
#[test] fn observed_requires_present_fields() {let mut v=fixture();v["windows"][0]["reset"]=serde_json::Value::Null;assert_eq!(parse(v),Err(Error::Status));}
#[test] fn duplicate_issue_rejected() {let mut v=fixture();v["issues"]=serde_json::json!(["clock_uncertain","clock_uncertain"]);assert_eq!(parse(v),Err(Error::Issue));}
#[test] fn future_observation_rejected() {let mut v=fixture();v["observed_at_ms"]=(NOW+FUTURE_SKEW_MS+1).into();assert_eq!(parse(v),Err(Error::Timestamp));}
#[test] fn size_and_depth_limited() {assert_eq!(Snapshot::from_bytes(&vec![b' ';MAX_MESSAGE_BYTES+1],NOW),Err(Error::TooLarge));assert_eq!(Snapshot::from_bytes(b"[[[[[[[[[]]]]]]]]]",NOW),Err(Error::TooDeep));}
#[test] fn old_observation_and_regressing_clock() {let r=Record {snapshot:snapshot(),received_at_ms:NOW+100};assert_eq!(r.display_state(NOW),Status::Unavailable);assert_eq!(r.display_state(NOW+200),Status::Historical);assert_eq!(r.display_state(NOW+TTL_MS+1),Status::Unavailable);assert_eq!(r.age_ms(NOW+200),Some(200));}
#[test] fn error_diagnostic_has_no_payload() {assert_eq!(Error::InvalidJson.to_string(),"gemini_experimental_InvalidJson");}
#[test] fn nonfinite_number_rejected_without_serialization() {let mut s=snapshot();s.windows[0].used_percent=Some(f64::NAN);assert_eq!(s.validate(NOW),Err(Error::Percentage));}
#[test] fn partial_reset_rejects_invented_epoch() {let mut v=fixture();v["windows"][0]["reset"]["epoch_ms"]=NOW.into();assert_eq!(parse(v),Err(Error::Reset));}
#[test] fn manual_origin_is_distinct() {let mut v=fixture();v["origin"]="manual_entry".into();v["collection"]="manual_entry".into();assert_eq!(parse(v).unwrap().origin,Origin::ManualEntry);}
