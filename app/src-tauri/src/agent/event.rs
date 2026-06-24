use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEvent {
    ApprovalNeeded {
        agent: String,
        session_id: String,
        cwd: String,
        tool: String,
        prompt_text: String,
        ts: u64,
    },
    IdlePrompt {
        agent: String,
        session_id: String,
        cwd: String,
        prompt_text: String,
        ts: u64,
    },
    TaskCompleted {
        agent: String,
        session_id: String,
        cwd: String,
        summary: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_tail: Option<String>,
        ts: u64,
    },
    AgentError {
        agent: String,
        session_id: String,
        message: String,
        ts: u64,
    },
}

impl AgentEvent {
    pub fn session_id(&self) -> &str {
        match self {
            AgentEvent::ApprovalNeeded { session_id, .. }
            | AgentEvent::IdlePrompt { session_id, .. }
            | AgentEvent::TaskCompleted { session_id, .. }
            | AgentEvent::AgentError { session_id, .. } => session_id,
        }
    }

    /// 去重键：kind + agent + session + 内容（不含 ts）
    pub fn dedup_key(&self) -> String {
        match self {
            AgentEvent::ApprovalNeeded { agent, session_id, tool, prompt_text, .. } => {
                format!("approval|{agent}|{session_id}|{tool}|{prompt_text}")
            }
            AgentEvent::IdlePrompt { agent, session_id, prompt_text, .. } => {
                format!("idle|{agent}|{session_id}|{prompt_text}")
            }
            AgentEvent::TaskCompleted { agent, session_id, summary, .. } => {
                format!("done|{agent}|{session_id}|{}", &summary[..summary.len().min(50)])
            }
            AgentEvent::AgentError { agent, session_id, message, .. } => {
                format!("error|{agent}|{session_id}|{message}")
            }
        }
    }
}
