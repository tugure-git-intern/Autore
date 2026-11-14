//! Event log staging. Modul ini hanya menulis fakta mentah; status release
//! dihitung oleh fold TypeScript, bukan di sini.

use crate::jenkins;
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
    /// Picu job Jenkins rollback by digest (dipanggil API; kredensial tetap di CLI)
    TriggerRollback(TriggerRollbackArgs),
    /// Cetak id event rollback berikutnya untuk satu build
    RollbackId(RollbackIdArgs),
}

#[derive(Args)]
pub struct TriggerRollbackArgs {
    #[arg(long)]
    job: String,
    #[arg(long)]
    app: String,
    #[arg(long)]
    environment: String,
    #[arg(long)]
    digest: String,
    #[arg(long)]
    deployment_id: String,
    #[arg(long)]
    release_id: String,
    #[arg(long)]
    build: u64,
    #[arg(long)]
    actor: String,
    /// Daftarkan job dari `Jenkinsfile.rollback` kalau job-nya belum ada
    #[arg(long)]
    git_url: Option<String>,
    #[arg(long, default_value = "main")]
    branch: String,
}

#[derive(Args)]
pub struct RollbackIdArgs {
    #[arg(long)]
    app: String,
    #[arg(long)]
    build: u64,
}

/// Environment rollback tidak punya default: nilai asing ditolak di sini juga,
/// supaya job tidak pernah menerima environment yang tidak dikenal.
pub fn validasi_environment_rollback(environment: &str) -> Result<(), String> {
    match environment {
        "staging" | "production" => Ok(()),
        "" => Err("environment rollback wajib: \"staging\" atau \"production\"".into()),
        lain => Err(format!(
            "environment rollback tidak dikenal: {lain:?} (hanya \"staging\" atau \"production\")"
        )),
    }
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
    /// Id event eksplisit (rollback: `<app>-<build>-rollback-<n>`)
    #[arg(long)]
    id: Option<String>,
    /// Pelaku atas nama dashboard; dipakai event rollback
    #[arg(long)]
    actor: Option<String>,
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
        ReleaseAction::TriggerRollback(args) => match trigger_rollback(args) {
            Ok(url) => {
                println!("{url}");
                0
            }
            Err(e) => {
                eprintln!("ERROR: {e}");
                1
            }
        },
        ReleaseAction::RollbackId(args) => match rollback_id_at(&workspace::workspace_dir(), &args) {
            Ok(id) => {
                println!("{id}");
                0
            }
            Err(e) => {
                eprintln!("ERROR: {e}");
                1
            }
        },
    }
}

fn trigger_rollback(args: TriggerRollbackArgs) -> Result<String, String> {
    validasi_environment_rollback(&args.environment)?;
    if !args.digest.starts_with("sha256:") || args.digest.len() != 71 {
        return Err("digest rollback bukan sha256:64hex".into());
    }
    let conf_path = jenkins::default_config_path();
    let cfg = jenkins::load_config_from(&conf_path).ok_or_else(|| {
        format!(
            "konfigurasi Jenkins belum ada di {}",
            conf_path.display()
        )
    })?;
    let params = [
        ("ROLLBACK_APP", args.app.as_str()),
        ("ROLLBACK_ENVIRONMENT", args.environment.as_str()),
        ("ROLLBACK_DIGEST", args.digest.as_str()),
        ("ROLLBACK_DEPLOYMENT_ID", args.deployment_id.as_str()),
        ("ROLLBACK_RELEASE_ID", args.release_id.as_str()),
        ("ROLLBACK_ACTOR", args.actor.as_str()),
    ];
    match jenkins::trigger_parameterized(&cfg, &args.job, &params) {
        Ok(url) => Ok(url),
        Err(e) => {
            // Job belum ada: daftarkan dari Jenkinsfile.rollback lalu picu sekali lagi.
            let Some(ref git_url) = args.git_url else {
                return Err(e);
            };
            if !e.contains("404") {
                return Err(e);
            }
            jenkins::register_rollback_job(&cfg, &args.job, git_url, &args.branch)?;
            jenkins::trigger_parameterized(&cfg, &args.job, &params)
        }
    }
}

/// Id event rollback `<app>-<build>-rollback-<n>`. `n` dihitung dari ledger,
/// jadi dua job paralel bisa memakai `n` yang sama; append idempoten di
/// `append_event_at` menahan duplikatnya (hanya satu yang tercatat).
fn rollback_id_at(dir: &Path, args: &RollbackIdArgs) -> Result<String, String> {
    let ledger = read_ledger_at(dir)?;
    let awalan = format!("{}-{}-rollback-", args.app, args.build);
    let terpakai = ledger
        .events
        .iter()
        .filter(|event| event.id.starts_with(&awalan))
        .count();
    Ok(format!("{awalan}{}", terpakai + 1))
}

fn record(args: RecordArgs) -> Result<Event, String> {
    let event = if let Some(ref path) = args.from_deploy_result {
        from_result(path, &args)?
    } else if args.event.as_deref() == Some("build_failed") {
        Event {
            id: args
                .id
                .clone()
                .unwrap_or_else(|| format!("{}-{}-build_failed", args.app, args.build)),
            ts: now(),
            kind: "build_failed".into(),
            app: args.app,
            environment: args.environment,
            request_id: args.request_id,
            commit: args.commit,
            build_number: args.build,
            actor: args.actor.clone(),
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
        id: args
            .id
            .clone()
            .unwrap_or_else(|| format!("{}-{}-deploy_result", args.app, args.build)),
        ts: now(),
        kind: "deploy_result".into(),
        app: args.app.clone(),
        environment: args.environment.clone(),
        request_id: args.request_id.clone(),
        commit: args.commit.clone(),
        build_number: args.build,
        actor: args.actor.clone(),
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
    fn id_rollback_berurutan_per_build() {
        let tmp = TempDir::new().unwrap();
        let args = RollbackIdArgs {
            app: "tes-testing".into(),
            build: 7,
        };
        assert_eq!(rollback_id_at(tmp.path(), &args).unwrap(), "tes-testing-7-rollback-1");

        append_event_at(tmp.path(), event("tes-testing-7-rollback-1")).unwrap();
        append_event_at(tmp.path(), event("tes-testing-7-deploy_result")).unwrap();
        assert_eq!(rollback_id_at(tmp.path(), &args).unwrap(), "tes-testing-7-rollback-2");

        // Build lain punya deret sendiri.
        let lain = RollbackIdArgs {
            app: "tes-testing".into(),
            build: 8,
        };
        assert_eq!(rollback_id_at(tmp.path(), &lain).unwrap(), "tes-testing-8-rollback-1");
    }

    #[test]
    fn environment_rollback_tanpa_default() {
        assert!(validasi_environment_rollback("staging").is_ok());
        assert!(validasi_environment_rollback("production").is_ok());
        for asing in ["", "Prod", "PRODUCTION", "prod", "staging "] {
            assert!(
                validasi_environment_rollback(asing).is_err(),
                "{asing:?} seharusnya ditolak"
            );
        }
    }

    #[test]
    fn record_rollback_memakai_id_dan_actor_eksplisit() {
        let tmp = TempDir::new().unwrap();
        let hasil = tmp.path().join("result.json");
        fs::write(
            &hasil,
            serde_json::json!({
                "requested_digest": "sha256:".to_string() + &"a".repeat(64),
                "outcome": "rolled_back",
                "deployment_id": "dep-lama",
                "health": "ok",
                "active_before": { "deployment_id": "dep-baru", "digest": "sha256:".to_string() + &"b".repeat(64) },
            })
            .to_string(),
        )
        .unwrap();
        let args = RecordArgs {
            from_deploy_result: Some(hasil),
            event: None,
            app: "tes-testing".into(),
            environment: "staging".into(),
            build: 7,
            commit: "a".repeat(40),
            request_id: "pipeline".into(),
            error: None,
            id: Some("tes-testing-7-rollback-1".into()),
            actor: Some("budi".into()),
        };

        let event = record(args).unwrap();
        assert_eq!(event.id, "tes-testing-7-rollback-1");
        assert_eq!(event.actor.as_deref(), Some("budi"));
        assert_eq!(event.environment, "staging");
        assert_eq!(event.outcome.as_deref(), Some("rolled_back"));
        assert_eq!(event.health.as_deref(), Some("ok"));
    }

    #[test]
    fn ledger_kosong_dibaca_sebagai_event_kosong() {
        let tmp = TempDir::new().unwrap();
        assert!(read_ledger_at(tmp.path()).unwrap().events.is_empty());
    }
}
