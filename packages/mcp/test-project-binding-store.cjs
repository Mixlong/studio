/* Safe local project binding store — isolated temp files and authenticated AES-GCM test codec. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {McpProjectBindingStore} = require("../../build/mcp/project-binding-store.js");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "digi-mcp-file-binding-"));
const key = crypto.randomBytes(32);
let encryptionAvailable = true;
const codec = {
    isAvailable: () => encryptionAvailable,
    encrypt: message => {
        const iv=crypto.randomBytes(12);
        const cipher=crypto.createCipheriv("aes-256-gcm", key, iv);
        const payload=Buffer.concat([cipher.update(message,"utf8"),cipher.final()]);
        return Buffer.concat([iv,cipher.getAuthTag(),payload]);
    },
    decrypt: raw => {
        const decipher=crypto.createDecipheriv("aes-256-gcm",key,raw.subarray(0,12));
        decipher.setAuthTag(raw.subarray(12,28));
        return Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString("utf8");
    }
};
const store = new McpProjectBindingStore(home, codec);
const credential = {
    bindingId: crypto.randomUUID(),
    bindingSecret: "mcpb_" + crypto.randomBytes(32).toString("base64url"),
    modelId: 350
};
const fileA=path.join(home,"A.eez-project");
const fileB=path.join(home,"B.eez-project");
fs.writeFileSync(fileA,'{"settings":{"projectId":"FORGED_999"}}');
fs.copyFileSync(fileA,fileB);
try {
    assert.equal(store.find(fileA,"123"),null);
    store.bindNewProject(fileA,"123",credential);
    assert.equal(store.find(fileA,"123").bindingId,credential.bindingId);
    assert.equal(store.find(fileB,"123"),null,"Copied project has no binding");
    assert.equal(store.find(fileA,"456"),null,"Other IDE account cannot inherit mapping");
    assert.ok(!fs.readFileSync(path.join(home,"mcp-project-bindings.v1")).includes(
        credential.bindingSecret), "Binding secret never stored in plaintext");

    const tempPath = path.join(home,"replacement.eez-project");
    fs.writeFileSync(tempPath,'{"settings":{"projectId":"FORGED_350"}}');
    fs.renameSync(tempPath,fileA);
    assert.equal(store.find(fileA,"123"),null,
        "File replacement must invalidate a previous file-identity binding");
    assert.equal(store.refreshAfterAuthorizedSave(fileA,"123","unrelated-binding"),false);
    assert.equal(store.find(fileA,"123"),null);
    assert.equal(store.refreshAfterAuthorizedSave(fileA,"123",credential.bindingId),true,
        "Only Main should refresh an identity after an authorized project save");
    assert.equal(store.find(fileA,"123").bindingId,credential.bindingId);

    encryptionAvailable=false;
    assert.throws(()=>store.find(fileA,"123"),/OS encryption unavailable/);
    encryptionAvailable=true;
    const encrypted=path.join(home,"mcp-project-bindings.v1");
    const tampered=fs.readFileSync(encrypted);
    tampered[tampered.length-1]^=1;
    fs.writeFileSync(encrypted,tampered);
    assert.throws(()=>store.find(fileA,"123"),/Cannot decrypt/);
    assert.throws(()=>store.bindNewProject(fileA,"123",credential),
        /Cannot decrypt/,"Corrupted store must not be silently overwritten");
    fs.rmSync(encrypted,{force:true});
    store.bindNewProject(fileA,"123",credential);
    assert.equal(store.revokeLocal(fileA,"123"),true);
    assert.equal(store.find(fileA,"123"),null);
    assert.equal(store.revokeLocal(fileA,"123"),false);
    assert.throws(()=>store.bindNewProject(fileB,"123",{...credential,modelId:0}),
        /invalid/);
    console.log("PASS: encrypted MCP path+file identity store rejects copied, replaced, other-user, invalid/tampered files; encryption mandatory");
} finally {
    fs.rmSync(home,{recursive:true,force:true,maxRetries:5,retryDelay:150});
}
