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
}

fn default_auth_type() -> String {
    "bearer".to_string()
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
}

impl Config {
    pub fn from_env() -> Self {
        let secrets_json = env::var("SECRETS_JSON").unwrap_or_else(|_| "[]".to_string());
        let secrets: Vec<Secret> = serde_json::from_str(&secrets_json).unwrap_or_default();

        let mut github_domains = HashSet::new();
        github_domains.insert("github.com".to_string());
        github_domains.insert("api.github.com".to_string());

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
        }
    }

    /// Hot-reload secrets (and optionally the GitHub token) without restarting.
    pub fn reload_secrets(&self, new_secrets: Vec<Secret>, new_github_token: Option<String>) {
        self.secrets.store(Arc::new(new_secrets));
        if let Some(token) = new_github_token {
            self.github_token.store(Arc::new(token));
        }
    }

    /// Look up a secret for the domain: user-defined first, then GitHub fallback.
    pub fn resolve_secret(&self, host: &str) -> Option<Secret> {
        let secrets = self.secrets.load();
        for s in secrets.iter() {
            if s.domain == host {
                return Some(s.clone());
            }
        }
        let token = self.github_token.load();
        if self.github_domains.contains(host) && !token.is_empty() {
            Some(Secret {
                id: "_github_token".to_string(),
                name: "GITHUB_TOKEN".to_string(),
                value: format!("x-access-token:{}", token),
                domain: host.to_string(),
                auth_type: "basic".to_string(),
            })
        } else {
            None
        }
    }

    pub fn secrets_count(&self) -> usize {
        self.secrets.load().len()
    }
}

pub type SharedConfig = Arc<Config>;
