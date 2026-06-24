use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

const ENDED_RETAIN_MS: u64 = 5 * 60 * 1000;
const IDLE_TIMEOUT_MS: u64 = 30 * 60 * 1000;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentSession {
    pub session_id: String,
    pub agent_type: String,
    pub agent_label: String,
    pub cwd: String,
    pub inject_url: Option<String>,
    pub source: SessionSource,
    pub connected_at: u64,
    pub last_event_at: u64,
    pub status: SessionStatus,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionSource {
    Hook,
    Pty,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Active,
    Idle,
    Ended,
}

fn friendly_label(agent_type: &str) -> String {
    match agent_type {
        "claude-code" | "claude" => "Claude Code".into(),
        "codex" => "Codex".into(),
        "opencode" => "opencode".into(),
        "aider" => "Aider".into(),
        "gemini" => "Gemini".into(),
        other => other.into(),
    }
}

pub struct SessionRegistry(pub Mutex<SessionRegistryInner>);

pub struct SessionRegistryInner {
    sessions: HashMap<String, AgentSession>,
}

impl SessionRegistryInner {
    pub fn new() -> Self {
        Self { sessions: HashMap::new() }
    }

    pub fn register_pty(
        &mut self,
        session_id: &str,
        agent_type: &str,
        cwd: &str,
        inject_url: &str,
        now: u64,
    ) -> &AgentSession {
        let session = AgentSession {
            session_id: session_id.into(),
            agent_type: agent_type.into(),
            agent_label: friendly_label(agent_type),
            cwd: cwd.into(),
            inject_url: Some(inject_url.into()),
            source: SessionSource::Pty,
            connected_at: now,
            last_event_at: now,
            status: SessionStatus::Active,
        };
        self.sessions.insert(session_id.into(), session);
        self.sessions.get(session_id).unwrap()
    }

    pub fn register_or_touch_hook(
        &mut self,
        session_id: &str,
        agent_type: &str,
        cwd: &str,
        now: u64,
    ) -> &AgentSession {
        let entry = self.sessions.entry(session_id.into());
        entry
            .and_modify(|s| {
                s.last_event_at = now;
                if s.status == SessionStatus::Ended {
                    s.status = SessionStatus::Active;
                }
            })
            .or_insert_with(|| AgentSession {
                session_id: session_id.into(),
                agent_type: agent_type.into(),
                agent_label: friendly_label(agent_type),
                cwd: cwd.into(),
                inject_url: None,
                source: SessionSource::Hook,
                connected_at: now,
                last_event_at: now,
                status: SessionStatus::Active,
            })
    }

    pub fn touch(&mut self, session_id: &str, now: u64) {
        if let Some(s) = self.sessions.get_mut(session_id) {
            s.last_event_at = now;
            if s.status == SessionStatus::Idle {
                s.status = SessionStatus::Active;
            }
        }
    }

    pub fn mark_ended(&mut self, session_id: &str, now: u64) {
        if let Some(s) = self.sessions.get_mut(session_id) {
            s.status = SessionStatus::Ended;
            s.last_event_at = now;
        }
    }

    pub fn gc(&mut self, now: u64) {
        self.sessions.retain(|_, s| {
            let age = now.saturating_sub(s.last_event_at);
            match s.status {
                SessionStatus::Ended => age < ENDED_RETAIN_MS,
                _ => age < IDLE_TIMEOUT_MS,
            }
        });
    }

    pub fn active_sessions(&self) -> Vec<&AgentSession> {
        let mut list: Vec<_> = self
            .sessions
            .values()
            .filter(|s| s.status != SessionStatus::Ended)
            .collect();
        list.sort_by(|a, b| b.last_event_at.cmp(&a.last_event_at));
        list
    }

    pub fn get(&self, session_id: &str) -> Option<&AgentSession> {
        self.sessions.get(session_id)
    }

    pub fn inject_url(&self, session_id: &str) -> Option<String> {
        self.sessions
            .get(session_id)
            .and_then(|s| s.inject_url.clone())
    }

    pub fn remove(&mut self, session_id: &str) -> Option<AgentSession> {
        self.sessions.remove(session_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ss01_register_pty() {
        let mut reg = SessionRegistryInner::new();
        let s = reg.register_pty("s1", "claude-code", "/proj", "http://localhost:1234/inject", 1000);
        assert_eq!(s.agent_label, "Claude Code");
        assert_eq!(s.source, SessionSource::Pty);
        assert!(s.inject_url.is_some());
    }

    #[test]
    fn ss02_register_hook_creates_new() {
        let mut reg = SessionRegistryInner::new();
        reg.register_or_touch_hook("h1", "claude-code", "/proj", 1000);
        let s = reg.get("h1").unwrap();
        assert_eq!(s.source, SessionSource::Hook);
        assert!(s.inject_url.is_none());
    }

    #[test]
    fn ss03_hook_touch_updates_time() {
        let mut reg = SessionRegistryInner::new();
        reg.register_or_touch_hook("h1", "claude-code", "/proj", 1000);
        reg.register_or_touch_hook("h1", "claude-code", "/proj", 2000);
        assert_eq!(reg.get("h1").unwrap().last_event_at, 2000);
    }

    #[test]
    fn ss04_ended_session_revives_on_hook() {
        let mut reg = SessionRegistryInner::new();
        reg.register_or_touch_hook("h1", "claude-code", "/proj", 1000);
        reg.mark_ended("h1", 2000);
        assert_eq!(reg.get("h1").unwrap().status, SessionStatus::Ended);
        reg.register_or_touch_hook("h1", "claude-code", "/proj", 3000);
        assert_eq!(reg.get("h1").unwrap().status, SessionStatus::Active);
    }

    #[test]
    fn ss05_gc_removes_old_ended() {
        let mut reg = SessionRegistryInner::new();
        reg.register_pty("s1", "codex", "/proj", "http://x/inject", 1000);
        reg.mark_ended("s1", 1000);
        reg.gc(1000 + ENDED_RETAIN_MS + 1);
        assert!(reg.get("s1").is_none());
    }

    #[test]
    fn ss06_gc_keeps_recent_ended() {
        let mut reg = SessionRegistryInner::new();
        reg.register_pty("s1", "codex", "/proj", "http://x/inject", 1000);
        reg.mark_ended("s1", 1000);
        reg.gc(1000 + ENDED_RETAIN_MS - 1);
        assert!(reg.get("s1").is_some());
    }

    #[test]
    fn ss07_gc_removes_idle_timeout() {
        let mut reg = SessionRegistryInner::new();
        reg.register_or_touch_hook("h1", "claude-code", "/proj", 1000);
        reg.gc(1000 + IDLE_TIMEOUT_MS + 1);
        assert!(reg.get("h1").is_none());
    }

    #[test]
    fn ss08_active_sessions_sorted() {
        let mut reg = SessionRegistryInner::new();
        reg.register_pty("s1", "codex", "/a", "http://x/inject", 1000);
        reg.register_or_touch_hook("s2", "claude-code", "/b", 3000);
        reg.register_pty("s3", "opencode", "/c", "http://y/inject", 2000);
        let active = reg.active_sessions();
        assert_eq!(active[0].session_id, "s2");
        assert_eq!(active[1].session_id, "s3");
        assert_eq!(active[2].session_id, "s1");
    }

    #[test]
    fn ss09_inject_url_returns_none_for_hook() {
        let mut reg = SessionRegistryInner::new();
        reg.register_or_touch_hook("h1", "claude-code", "/proj", 1000);
        assert!(reg.inject_url("h1").is_none());
    }

    #[test]
    fn ss10_friendly_labels() {
        assert_eq!(friendly_label("claude-code"), "Claude Code");
        assert_eq!(friendly_label("codex"), "Codex");
        assert_eq!(friendly_label("unknown-agent"), "unknown-agent");
    }
}
