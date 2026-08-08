const forge = require("node-forge");
const fs = require("fs");
const path = require("path");

const KEY_PATH = path.join(__dirname, "key.pem");
const CERT_PATH = path.join(__dirname, "cert.pem");

if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
  console.log("Certificates already exist, skipping generation.");
  process.exit(0);
}

const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = "01";
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

const attrs = [
  { name: "commonName", value: "localhost" },
  { name: "organizationName", value: "VideoCall" },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);

cert.setExtensions([
  { name: "basicConstraints", cA: false },
  {
    name: "subjectAltName",
    altNames: [
      { type: 2, value: "localhost" },
      { type: 7, ip: "127.0.0.1" },
      { type: 7, ip: "10.167.5.161" },
    ],
  },
]);

cert.sign(keys.privateKey, forge.md.sha256.create());

fs.writeFileSync(KEY_PATH, forge.pki.privateKeyToPem(keys.privateKey));
fs.writeFileSync(CERT_PATH, forge.pki.certificateToPem(cert));
console.log("Generated key.pem and cert.pem");
