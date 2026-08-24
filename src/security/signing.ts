// skill 签名验证（DESIGN Q8 L4 / v3 路线图）：Ed25519 公钥签名。
// 签名对象 = skill 包的内容哈希（与 registry 内容寻址同一 sha256），发布者用私钥签名，
// 服务器用信任锚（config.trust.keys）或发布者绑定（TOFU：首次注册绑定，之后必须同钥）验证。
// 联邦 catalog：发布者构建 { publisher, signature, skills: [{ manifest, files }] }，
// signature 覆盖 skills 数组的规范化 JSON（canonicalCatalogPayload）。
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

export function generateSigningKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

export function signHash(privateKeyB64: string, hash: string): string {
  const key = createPrivateKey({ key: Buffer.from(privateKeyB64, "base64"), format: "der", type: "pkcs8" });
  return sign(null, Buffer.from(hash, "utf8"), key).toString("base64");
}

export function verifyHash(publicKeyB64: string, hash: string, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
    return verify(null, Buffer.from(hash, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

// 联邦 catalog 的规范化载荷：签名与验签共用
export function canonicalCatalogPayload(skills: unknown[]): string {
  return JSON.stringify(skills);
}
