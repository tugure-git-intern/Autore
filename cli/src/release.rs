//! Event log staging. Modul ini hanya menulis fakta mentah; status release
//! dihitung oleh fold TypeScript, bukan di sini.

use crate::workspace;
use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

const EVENTS: &str = "release-state.json";
const APPEND_LOCK: &str = "release-state.append.lock";
const MAX_EVENTS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub id: String,
    pub ts: String,
    pub kind: String,
    pub app: String,
    pub environment: String,
    pub request_id: String,
    pub commit: String,
    pub build_number: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_before: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_after: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Ledger {
    pub version: u32,
    pub events: Vec<Event>,
}

#[derive(Subcommand)]
pub enum ReleaseAction {
    /// Catat event mentah dari hasil deploy atau kegagalan pipeline
    Record(RecordArgs),
    /// Tampilkan event mentah dan lock append
    Status {
        #[arg(long)]
        json: bool,
    },
}

#[derive(Args)]
pub struct RecordArgs {
    #[arg(long)]
    from_deploy_result: Option<PathBuf>,
    #[arg(long)]
    event: Option<String>,
    #[arg(long)]
    app: String,
    #[arg(long, default_value = "staging")]
    environment: String,
    #[arg(long)]
    build: u64,
    #[arg(long)]
    commit: String,
    #[arg(long, default_value = "pipeline")]
    request_id: String,
    #[arg(long)]
    error: Option<String>,
}

pub fn run(action: ReleaseAction) -> i32 {
    match action {
        ReleaseAction::Record(args) => match record(args) {
            Ok(event) => {
                println!("{}", serde_json::to_string(&event).unwrap_or_default());
                0
            }
            Err(e) => {
                eprintln!("ERROR: {e}");
                1
            }
        },
        ReleaseAction::Status { json } => match status(json) {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("ERROR: {e}");
                1
            }
        },
    }
}

fn record(args: RecordArgs) -> Result<Event, String> {
    let event = if let Some(ref path) = args.from_deploy_result {
        from_result(path, &args)?
    } else if args.event.as_deref() == Some("build_failed") {
        Event {
            id: format!("{}-{}-build_failed", args.app, args.build),
            ts: now(),
            kind: "build_failed".into(),
            app: args.app,
            environment: args.environment,
            request_id: args.request_id,
            commit: args.commit,
            build_number: args.build,
            actor: None,
            digest: None,
            image_ref: None,
            deployment_id: None,
            outcome: None,
            active_before: None,
            active_after: None,
            health: None,
            health_url: None,
            error: Some(args.error.unwrap_or_else(|| "pipeline gagal".into())),
        }
    } else {
        return Err("pakai --from-deploy-result atau --event build_failed".into());
    };
    append_event_at(&workspace::workspace_dir(), event.clone())?;
    Ok(event)
}

fn from_result(path: &Path, args: &RecordArgs) -> Result<Event, String> {
    let raw =
        fs::read_to_string(path).map_err(|e| format!("gagal baca {}: {e}", path.display()))?;
    let value: Value = serde_json::from_str(&raw).map_err(|e| format!("result bukan JSON: {e}"))?;
    let digest = value
        .get("requested_digest")
        .and_then(Value::as_str)
        .ok_or("result tanpa requested_digest")?;
    if !digest.starts_with("sha256:") || digest.len() != 71 {
        return Err("requested_digest bukan sha256:64hex".into());
    }
    let outcome = value
        .get("outcome")
        .and_then(Value::as_str)
        .ok_or("result tanpa outcome")?;
    let deployment_id = value
        .get("deployment_id")
        .and_then(Value::as_str)
        .ok_or("result tanpa deployment_id")?;
    Ok(Event {
        id: format!("{}-{}-deploy_result", args.app, args.build),
        ts: now(),
        kind: "deploy_result".into(),
        app: args.app.clone(),
        environment: args.environment.clone(),
        request_id: args.request_id.clone(),
        commit: args.commit.clone(),
        build_number: args.build,
        actor: None,
        digest: Some(digest.into()),
        image_ref: value
            .get("image_ref")
            .and_then(Value::as_str)
            .map(str::to_string),
        deployment_id: Some(deployment_id.into()),
        outcome: Some(outcome.into()),
        active_before: value.get("active_before").cloned(),
        active_after: value.get("active_after").cloned(),
        health: value
            .get("health")
            .and_then(Value::as_str)
            .map(str::to_string),
        health_url: value
            .get("health_url")
            .and_then(Value::as_str)
            .map(str::to_string),
        error: value
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn status(json: bool) -> Result<(), String> {
    let ledger = read_ledger_at(&workspace::workspace_dir())?;
    if json {
        println!(
            "{}",
            serde_json::to_string(&ledger).map_err(|e| e.to_string())?
        );
    } else {
        println!("{} event", ledger.events.len());
        for event in ledger.events.iter().rev().take(10) {
            println!(
                "{} {} {}#{}",
                event.ts, event.kind, event.app, event.build_number
            );
        }
    }
    Ok(())
}

pub(crate) fn read_ledger_at(dir: &Path) -> Result<Ledger, String> {
    let path = dir.join(EVENTS);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Ledger {
                version: 1,
                events: Vec::new(),
            });
        }
        Err(e) => return Err(format!("gagal baca {}: {e}", path.display())),
    };
    let mut ledger: Ledger =
        serde_json::from_str(&raw).map_err(|e| format!("ledger rusak: {e}"))?;
    if ledger.version != 1 {
        return Err(format!("versi ledger tidak dikenal: {}", ledger.version));
    }
    if ledger.events.len() > MAX_EVENTS {
        let keep = ledger.events.len() - MAX_EVENTS;
        ledger.events.drain(..keep);
    }
    Ok(ledger)
}

pub(crate) fn append_event_at(dir: &Path, event: Event) -> Result<(), String> {
    let lock = dir.join(APPEND_LOCK);
    let _guard = acquire_append_lock(&lock)?;
    let mut ledger = read_ledger_at(dir)?;
    ledger.version = 1;
    if !ledger.events.iter().any(|item| item.id == event.id) {
        ledger.events.push(event);
    }
    if ledger.events.len() > MAX_EVENTS {
        let keep = ledger.events.len() - MAX_EVENTS;
        ledger.events.drain(..keep);
    }
    fs::create_dir_all(dir).map_err(|e| format!("gagal buat workspace: {e}"))?;
    let tmp = dir.join(format!("{EVENTS}.tmp-{}", std::process::id()));
    let mut file = fs::File::create(&tmp).map_err(|e| format!("gagal buat tmp: {e}"))?;
    serde_json::to_writer_pretty(&mut file, &ledger).map_err(|e| e.to_string())?;
    file.write_all(b"\n").map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(EVENTS)).map_err(|e| format!("gagal rename ledger: {e}"))?;
    Ok(())
}

struct LockGuard(PathBuf);

impl Drop for LockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn acquire_append_lock(path: &Path) -> Result<LockGuard, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("gagal buat lock dir: {e}"))?;
    }
    for _ in 0..100 {
        match OpenOptions::new().write(true).create_new(true).open(path) {
            Ok(mut file) => {
                let _ = writeln!(file, "{}", std::process::id());
                return Ok(LockGuard(path.to_path_buf()));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(format!("gagal acquire append lock: {e}")),
        }
    }
    Err(format!("append lock sibuk: {}", path.display()))
}

fn now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}Z")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn event(id: &str) -> Event {
        Event {
            id: id.into(),
            ts: "2026-11-13T04:00:00Z".into(),
            kind: "requested".into(),
            app: "tes-testing".into(),
            environment: "staging".into(),
            request_id: "req".into(),
            commit: "a".repeat(40),
            build_number: 1,
            actor: Some("operator".into()),
            digest: None,
            image_ref: None,
            deployment_id: None,
            outcome: None,
            active_before: None,
            active_after: None,
            health: None,
            health_url: None,
            error: None,
        }
    }

    #[test]
    fn append_paralel_tidak_kehilangan_event() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().to_path_buf();
        let mut handles = Vec::new();
        for i in 0..8 {
            let dir = dir.clone();
            handles.push(std::thread::spawn(move || {
                append_event_at(&dir, event(&format!("evt-{i}"))).unwrap();
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }
        let ledger = read_ledger_at(&dir).unwrap();
        assert_eq!(ledger.events.len(), 8);
        assert!(!dir.join(APPEND_LOCK).exists(), "lock append harus dilepas");
    }

    #[test]
    fn append_idempoten_untuk_id_sama() {
        let tmp = TempDir::new().unwrap();
        append_event_at(tmp.path(), event("sama")).unwrap();
        append_event_at(tmp.path(), event("sama")).unwrap();
        assert_eq!(read_ledger_at(tmp.path()).unwrap().events.len(), 1);
    }

    #[test]
    fn ledger_kosong_dibaca_sebagai_event_kosong() {
        let tmp = TempDir::new().unwrap();
        assert!(read_ledger_at(tmp.path()).unwrap().events.is_empty());
    }
}
