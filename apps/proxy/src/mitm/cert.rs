use dashmap::DashMap;
use rcgen::{
    CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, KeyPair,
    KeyUsagePurpose, PKCS_ECDSA_P256_SHA256, PKCS_RSA_SHA256,
};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use std::sync::Arc;
use std::time::Duration;
use tokio_rustls::rustls::ServerConfig;
use tracing::info;

pub struct CertAuthority {
    ca_cert_pem: String,
    ca_key: KeyPair,
    cache: DashMap<String, Arc<ServerConfig>>,
}

impl CertAuthority {
    pub fn new(ca_cert_pem: &str, ca_key_pem: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let ca_key = load_ca_key(ca_key_pem)?;
        info!("CA certificate loaded for MITM cert generation");
        Ok(CertAuthority {
            ca_cert_pem: ca_cert_pem.to_string(),
            ca_key,
            cache: DashMap::new(),
        })
    }

    pub fn get_tls_config(&self, domain: &str) -> Result<Arc<ServerConfig>, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(config) = self.cache.get(domain) {
            return Ok(config.clone());
        }

        let config = self.generate_tls_config(domain)?;
        self.cache.insert(domain.to_string(), config.clone());
        info!(domain = domain, "generated domain certificate");
        Ok(config)
    }

    fn generate_tls_config(&self, domain: &str) -> Result<Arc<ServerConfig>, Box<dyn std::error::Error + Send + Sync>> {
        let domain_key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256)?;

        let mut params = CertificateParams::new(vec![domain.to_string()])?;
        params.distinguished_name.push(DnType::CommonName, domain);
        params.is_ca = IsCa::NoCa;
        params.key_usages.push(KeyUsagePurpose::DigitalSignature);
        params.key_usages.push(KeyUsagePurpose::KeyEncipherment);
        params
            .extended_key_usages
            .push(ExtendedKeyUsagePurpose::ServerAuth);

        let now = time::OffsetDateTime::now_utc();
        params.not_before = now - Duration::from_secs(86400);
        params.not_after = now + Duration::from_secs(365 * 86400);

        let ca_params = CertificateParams::from_ca_cert_pem(&self.ca_cert_pem)?;
        let ca_cert = ca_params.self_signed(&self.ca_key)?;

        let domain_cert = params.signed_by(&domain_key, &ca_cert, &self.ca_key)?;

        let cert_der = CertificateDer::from(domain_cert.der().to_vec());
        let ca_der = CertificateDer::from(ca_cert.der().to_vec());
        let key_der = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(domain_key.serialized_der().to_vec()));

        let mut server_config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert_der, ca_der], key_der)?;
        server_config.alpn_protocols = vec![b"http/1.1".to_vec()];

        Ok(Arc::new(server_config))
    }
}

/// Load a CA private key from PEM. Supports both PKCS#1 (RSA PRIVATE KEY)
/// and PKCS#8 (PRIVATE KEY) formats. node-forge generates PKCS#1 which
/// must be converted to PKCS#8 DER for rcgen/ring.
fn load_ca_key(pem_str: &str) -> Result<KeyPair, Box<dyn std::error::Error>> {
    // Try parsing as PKCS#1 "RSA PRIVATE KEY" (node-forge format) and convert to PKCS#8
    if pem_str.contains("RSA PRIVATE KEY") {
        let mut reader = std::io::BufReader::new(pem_str.as_bytes());
        for item in rustls_pemfile::read_all(&mut reader).flatten() {
            if let rustls_pemfile::Item::Pkcs1Key(der) = item {
                let pkcs8_bytes = pkcs1_to_pkcs8(der.secret_pkcs1_der());
                let pkcs8_der = PrivatePkcs8KeyDer::from(pkcs8_bytes);
                let key_ref: PrivateKeyDer<'_> = PrivateKeyDer::Pkcs8(pkcs8_der);
                return KeyPair::from_der_and_sign_algo(&key_ref, &PKCS_RSA_SHA256)
                    .map_err(|e| e.into());
            }
        }
    }

    // Try PKCS#8 "PRIVATE KEY"
    if pem_str.contains("PRIVATE KEY") {
        let mut reader = std::io::BufReader::new(pem_str.as_bytes());
        for item in rustls_pemfile::read_all(&mut reader).flatten() {
            if let rustls_pemfile::Item::Pkcs8Key(der) = item {
                let key_ref: PrivateKeyDer<'_> = PrivateKeyDer::Pkcs8(der);
                return KeyPair::from_der_and_sign_algo(&key_ref, &PKCS_RSA_SHA256)
                    .map_err(|e| e.into());
            }
        }
    }

    Err("no RSA private key found in PEM".into())
}

/// Wrap a PKCS#1 RSA private key DER in a PKCS#8 envelope.
/// PKCS#8 = SEQUENCE { version INTEGER, algorithm AlgorithmIdentifier, privateKey OCTET STRING }
fn pkcs1_to_pkcs8(pkcs1_der: &[u8]) -> Vec<u8> {
    // OID for rsaEncryption: 1.2.840.113549.1.1.1
    let oid_bytes: &[u8] = &[
        0x30, 0x0d, // SEQUENCE, 13 bytes
        0x06, 0x09, // OID, 9 bytes
        0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // rsaEncryption
        0x05, 0x00, // NULL parameters
    ];

    let octet_string_len = der_length_bytes(pkcs1_der.len());
    let inner_len = 3 + oid_bytes.len() + 1 + octet_string_len.len() + pkcs1_der.len();
    let outer_len = der_length_bytes(inner_len);

    let mut out = Vec::with_capacity(1 + outer_len.len() + inner_len);
    out.push(0x30); // SEQUENCE
    out.extend_from_slice(&outer_len);
    // version INTEGER 0
    out.extend_from_slice(&[0x02, 0x01, 0x00]);
    // algorithm
    out.extend_from_slice(oid_bytes);
    // privateKey OCTET STRING
    out.push(0x04);
    out.extend_from_slice(&octet_string_len);
    out.extend_from_slice(pkcs1_der);

    out
}

fn der_length_bytes(len: usize) -> Vec<u8> {
    if len < 0x80 {
        vec![len as u8]
    } else if len < 0x100 {
        vec![0x81, len as u8]
    } else if len < 0x10000 {
        vec![0x82, (len >> 8) as u8, len as u8]
    } else {
        vec![0x83, (len >> 16) as u8, (len >> 8) as u8, len as u8]
    }
}
