// Packs a .pkpass: the pass files, manifest.json (each file's SHA-1, as
// Apple's format requires) and `signature`, a detached PKCS #7 signature of
// the manifest made with the Pass Type ID certificate and carrying Apple's
// WWDR intermediate certificate.
import { zipSync } from 'fflate'
import forge from 'node-forge'

export type Signer = {
  certificatePem: string // the Pass Type ID certificate
  privateKeyPem: string // its key, unencrypted
  wwdrPem: string // Apple Worldwide Developer Relations intermediate
}

const encoder = new TextEncoder()

// forge.pki.oids is a loose record; these are the fixed values it holds.
const OID = {
  sha256: '2.16.840.1.101.3.4.2.1',
  data: '1.2.840.113549.1.7.1',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function signManifest(manifest: Uint8Array, signer: Signer): Uint8Array {
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(forge.util.binary.raw.encode(manifest))
  const certificate = forge.pki.certificateFromPem(signer.certificatePem)
  p7.addCertificate(certificate)
  p7.addCertificate(forge.pki.certificateFromPem(signer.wwdrPem))
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(signer.privateKeyPem),
    certificate,
    digestAlgorithm: OID.sha256,
    authenticatedAttributes: [
      { type: OID.contentType, value: OID.data },
      { type: OID.messageDigest },
      { type: OID.signingTime, value: new Date().toISOString() },
    ],
  })
  p7.sign({ detached: true })
  return forge.util.binary.raw.decode(forge.asn1.toDer(p7.toAsn1()).getBytes())
}

export async function packPass(
  pass: Record<string, unknown>,
  images: Record<string, Uint8Array>,
  signer: Signer,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'pass.json': encoder.encode(JSON.stringify(pass)),
    ...images,
  }
  const manifest: Record<string, string> = {}
  for (const [name, bytes] of Object.entries(files))
    manifest[name] = await sha1Hex(bytes)
  const manifestBytes = encoder.encode(JSON.stringify(manifest))
  return zipSync({
    ...files,
    'manifest.json': manifestBytes,
    signature: signManifest(manifestBytes, signer),
  })
}
