// Generate a self-signed SSL certificate for the Retro Board server
// Uses only Node.js built-in crypto (no third-party deps)
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const certDir = path.join(__dirname, 'certs');
if (!fs.existsSync(certDir)) fs.mkdirSync(certDir);

// Generate RSA key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

fs.writeFileSync(path.join(certDir, 'server.key'), privateKey);

// Use Node.js built-in to create a self-signed cert via createSign
// We need to construct a proper X.509 cert — use the forge approach via inline ASN.1
// Simplest: use node-forge which is already a dep of selfsigned
try {
    const forge = require('node-forge');
    const pki = forge.pki;
    
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
    
    const attrs = [
        { name: 'commonName', value: 'RetroBoard' },
        { name: 'organizationName', value: 'The Jump Vault' }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    
    cert.setExtensions([
        { name: 'subjectAltName', altNames: [
            { type: 7, ip: '192.168.1.48' },
            { type: 7, ip: '127.0.0.1' },
            { type: 2, value: 'localhost' }
        ]},
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true }
    ]);
    
    cert.sign(keys.privateKey, forge.md.sha256.create());
    
    const pemKey = pki.privateKeyToPem(keys.privateKey);
    const pemCert = pki.certificateToPem(cert);
    
    fs.writeFileSync(path.join(certDir, 'server.key'), pemKey);
    fs.writeFileSync(path.join(certDir, 'server.cert'), pemCert);
    
    console.log('SSL certificate generated in backend/certs/');
    console.log('  - server.key  (private key)');
    console.log('  - server.cert (certificate)');
    console.log('  - Valid for 10 years');
    console.log('  - SANs: 192.168.1.48, 127.0.0.1, localhost');
} catch (err) {
    console.error('Failed to generate certificate:', err.message);
    console.log('Please install node-forge: npm install node-forge');
    process.exit(1);
}
