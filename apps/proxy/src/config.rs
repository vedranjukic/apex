use arc_swap::ArcSwap;
use serde::Deserialize;
use std::collections::HashSet;
use std::env;
use std::sync::Arc;

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct Secret {
    pub id: String,
    pub name: String,
    pub value: String,
    pub domain: String,
    #[serde(rename = "authType", default = "default_auth_type")]
    pub auth_type: String,
    #[serde(rename = "repositoryId")]
    pub repository_id: Option<String>,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    #[serde(rename = "isSecret", default = "default_is_secret")]
    pub is_secret: bool,
}

fn default_auth_type() -> String {
    "bearer".to_string()
}

fn default_is_secret() -> bool {
    true
}

#[derive(Debug, Clone)]
pub struct Context {
    pub repository_id: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug)]
pub struct Config {
    pub mitm_port: u16,
    pub mitm_host: String,
    pub proxy_port: u16,
    pub port_relay_port: u16,
    pub secrets: ArcSwap<Vec<Secret>>,
    pub github_token: ArcSwap<String>,
    pub ca_cert_pem: String,
    pub ca_key_pem: String,
    pub proxy_auth_token: String,
    pub anthropic_key: String,
    pub openai_key: String,
    pub github_domains: HashSet<String>,
    pub context: ArcSwap<Context>,
}

impl Config {
    pub fn from_env() -> Self {
        let secrets_json = env::var("SECRETS_JSON").unwrap_or_else(|_| "[]".to_string());
        let secrets: Vec<Secret> = serde_json::from_str(&secrets_json).unwrap_or_default();

        let mut github_domains = HashSet::new();
        github_domains.insert("github.com".to_string());
        github_domains.insert("api.github.com".to_string());

        let context = Context {
            repository_id: env::var("PROXY_REPOSITORY_ID").ok(),
            project_id: env::var("PROXY_PROJECT_ID").ok(),
        };

        Config {
            mitm_port: env::var("MITM_PROXY_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(9350),
            mitm_host: env::var("MITM_LISTEN_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            proxy_port: env::var("PROXY_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(9300),
            port_relay_port: env::var("PORT_RELAY_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(9341),
            github_token: ArcSwap::from_pointee(env::var("GITHUB_TOKEN").unwrap_or_default()),
            ca_cert_pem: env::var("CA_CERT_PEM").unwrap_or_default(),
            ca_key_pem: env::var("CA_KEY_PEM").unwrap_or_default(),
            proxy_auth_token: env::var("PROXY_AUTH_TOKEN").unwrap_or_default(),
            anthropic_key: env::var("REAL_ANTHROPIC_API_KEY").unwrap_or_default(),
            openai_key: env::var("REAL_OPENAI_API_KEY").unwrap_or_default(),
            secrets: ArcSwap::from_pointee(secrets),
            github_domains,
            context: ArcSwap::from_pointee(context),
        }
    }

    /// Hot-reload secrets (and optionally the GitHub token) without restarting.
    pub fn reload_secrets(&self, new_secrets: Vec<Secret>, new_github_token: Option<String>) {
        self.secrets.store(Arc::new(new_secrets));
        if let Some(token) = new_github_token {
            self.github_token.store(Arc::new(token));
        }
    }

    /// Hot-reload secrets with context update.
    pub fn reload_secrets_with_context(
        &self,
        new_secrets: Vec<Secret>,
        new_github_token: Option<String>,
        repository_id: Option<String>,
        project_id: Option<String>,
    ) {
        self.reload_secrets(new_secrets, new_github_token);
        self.update_context(repository_id, project_id);
    }

    /// Update the repository and project context for secret resolution.
    pub fn update_context(&self, repository_id: Option<String>, project_id: Option<String>) {
        let new_context = Context {
            repository_id,
            project_id,
        };
        self.context.store(Arc::new(new_context));
    }

    /// Look up a secret for the domain with repository context.
    /// Priority: repository-scoped > project-scoped > global > GitHub fallback.
    /// Only returns secrets with is_secret=true (environment variables are ignored).
    pub fn resolve_secret(&self, host: &str) -> Option<Secret> {
        let context = self.context.load();
        self.resolve_secret_with_context(
            host,
            context.repository_id.as_deref(),
            context.project_id.as_deref(),
        )
    }

    /// Look up a secret for the domain with explicit context.
    /// Priority: repository-scoped > project-scoped > global > GitHub fallback.
    /// Only returns secrets with is_secret=true (environment variables are ignored).
    pub fn resolve_secret_with_context(
        &self,
        host: &str,
        repository_id: Option<&str>,
        project_id: Option<&str>,
    ) -> Option<Secret> {
        let secrets = self.secrets.load();
        let mut best_match: Option<&Secret> = None;
        let mut best_score = 0;

        // Find the best matching secret for this domain and context
        for s in secrets.iter() {
            // Skip if not matching domain or not a secret (is_secret=false means env var)
            if s.domain != host || !s.is_secret {
                continue;
            }

            // Calculate priority score: 3=repository, 2=project, 1=global, 0=no match
            let score = if s.repository_id.is_some() && s.repository_id.as_deref() == repository_id
            {
                3 // Repository-scoped exact match
            } else if s.project_id.is_some() && s.project_id.as_deref() == project_id {
                2 // Project-scoped exact match
            } else if s.repository_id.is_none() && s.project_id.is_none() {
                1 // Global secret (no scope restrictions)
            } else {
                0 // Scoped to different repository/project, skip
            };

            // Update best match if this has higher priority
            if score > best_score {
                best_match = Some(s);
                best_score = score;
            }
        }

        if let Some(secret) = best_match {
            return Some(secret.clone());
        }

        // GitHub token fallback - only if no user-defined secret found
        let token = self.github_token.load();
        if self.github_domains.contains(host) && !token.is_empty() {
            Some(Secret {
                id: "_github_token".to_string(),
                name: "GITHUB_TOKEN".to_string(),
                value: format!("x-access-token:{}", token),
                domain: host.to_string(),
                auth_type: "basic".to_string(),
                repository_id: None,
                project_id: None,
                is_secret: true,
            })
        } else {
            None
        }
    }

    /// Count only items marked as secrets (is_secret=true).
    /// Environment variables (is_secret=false) are not counted.
    pub fn secrets_count(&self) -> usize {
        self.secrets.load().iter().filter(|s| s.is_secret).count()
    }

    /// Count only environment variables (is_secret=false).
    pub fn env_vars_count(&self) -> usize {
        self.secrets.load().iter().filter(|s| !s.is_secret).count()
    }

    /// Get total count of all items (secrets + env vars).
    pub fn total_items_count(&self) -> usize {
        self.secrets.load().len()
    }
}

pub type SharedConfig = Arc<Config>;
