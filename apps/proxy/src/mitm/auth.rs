use crate::config::Secret;
use base64::Engine;

pub struct AuthHeader {
    pub name: String,
    pub value: String,
}

pub fn build_auth_header(secret: &Secret) -> AuthHeader {
    let auth_type = if secret.auth_type.is_empty() {
        "bearer"
    } else {
        &secret.auth_type
    };

    match auth_type {
        "bearer" => AuthHeader {
            name: "authorization".to_string(),
            value: format!("Bearer {}", secret.value),
        },
        "x-api-key" => AuthHeader {
            name: "x-api-key".to_string(),
            value: secret.value.clone(),
        },
        "basic" => {
            let encoded = base64::engine::general_purpose::STANDARD.encode(&secret.value);
            AuthHeader {
                name: "authorization".to_string(),
                value: format!("Basic {}", encoded),
            }
        }
        s if s.starts_with("header:") => {
            let header_name = s["header:".len()..].trim().to_lowercase();
            AuthHeader {
                name: header_name,
                value: secret.value.clone(),
            }
        }
        _ => AuthHeader {
            name: "authorization".to_string(),
            value: format!("Bearer {}", secret.value),
        },
    }
}
