import forge from 'node-forge';
import { settingsService } from '../settings/settings.service';

const CA_CERT_KEY = 'PROXY_CA_CERT';
const CA_KEY_KEY = 'PROXY_CA_KEY';

let caCert: forge.pki.Certificate | null = null;
let caKey: forge.pki.rsa.PrivateKey | null = null;

const domainCertCache = new Map<string, { cert: string; key: string }>();

/**
 * Initialize the CA: load from DB or generate a fresh keypair.
 * Must be called once during API server bootstrap.
 */
export async function initCA(): Promise<void> {
  const storedCert = await settingsService.get(CA_CERT_KEY);
  const storedKey = await settingsService.get(CA_KEY_KEY);

  if (storedCert && storedKey) {
    caCert = forge.pki.certificateFromPem(storedCert);
    caKey = forge.pki.privateKeyFromPem(storedKey);
    console.log('[secrets-proxy] Loaded CA certificate from database');
    return;
  }

  console.log('[secrets-proxy] Generating new CA keypair...');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 10);

  const attrs = [
    { name: 'commonName', value: 'Apex Secrets Proxy CA' },
    { name: 'organizationName', value: 'Apex' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    {
      name: 'keyUsage',
      keyCertSign: true,
      cRLSign: true,
      critical: true,
    },
    {
      name: 'subjectKeyIdentifier',
    },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  caCert = cert;
  caKey = keys.privateKey;

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  await settingsService.setAll({
    [CA_CERT_KEY]: certPem,
    [CA_KEY_KEY]: keyPem,
  });

  console.log('[secrets-proxy] CA keypair generated and persisted');
}

/** Get the CA certificate in PEM format (for uploading to containers). */
export function getCACertPem(): string {
  if (!caCert) throw new Error('CA not initialized — call initCA() first');
  return forge.pki.certificateToPem(caCert);
}

/**
 * Generate a TLS certificate for a specific domain, signed by the CA.
 * Certificates are cached in memory for the process lifetime.
 */
export function generateDomainCert(domain: string): { cert: string; key: string } {
  const cached = domainCertCache.get(domain);
  if (cached) return cached;

  if (!caCert || !caKey) {
    throw new Error('CA not initialized — call initCA() first');
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

  cert.setSubject([{ name: 'commonName', value: domain }]);
  cert.setIssuer(caCert.subject.attributes);

  cert.setExtensions([
    {
      name: 'subjectAltName',
      altNames: [{ type: 2, value: domain }],
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
    },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  const result = {
    cert: forge.pki.certificateToPem(cert),
    key: forge.pki.privateKeyToPem(keys.privateKey),
  };

  domainCertCache.set(domain, result);
  return result;
}
