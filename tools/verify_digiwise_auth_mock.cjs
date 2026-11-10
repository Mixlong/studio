const assert = require("node:assert/strict");

const {
    MockDigiwiseApiError,
    MockDigiwisePublicApi
} = require("../build/main/digiwise-auth-mock.js");

async function main() {
    const api = new MockDigiwisePublicApi({
        trialDurationMs: 60 * 1000,
        verificationCodeLifetimeMs: 60 * 1000,
        verificationCode: "000000",
        licenseCode: "MOCK-LICENSE-001",
        trialCapabilities: ["desktop.editor"],
        licensedCapabilities: ["desktop.editor", "cloud.storage.read"]
    });

    const codeResponse = await api.sendCode("client@example.com");
    assert.equal(codeResponse.accepted, true);
    assert.match(codeResponse.requestId, /^[0-9a-f-]{36}$/);

    const registered = await api.register(
        "client@example.com",
        "000000",
        "password-123"
    );
    assert.equal(registered.accountStatus, "active");
    assert.equal(registered.trial.status, "active");
    assert.ok(registered.trial.expiresAt);

    await assert.rejects(
        api.register("client@example.com", "000000", "password-123"),
        error =>
            error instanceof MockDigiwiseApiError &&
            error.status === 409 &&
            error.code === "AUTH_EMAIL_EXISTS"
    );

    const login = await api.login("client@example.com", "password-123");
    const trialEntitlements = await api.getEntitlements(login.accessToken);
    assert.equal(trialEntitlements.trial.status, "active");
    assert.deepEqual(trialEntitlements.license.source, "none");

    const firstRedemption = await api.redeem(
        login.accessToken,
        "MOCK-LICENSE-001",
        "mock-idempotency-001"
    );
    const retryRedemption = await api.redeem(
        login.accessToken,
        "MOCK-LICENSE-001",
        "mock-idempotency-001"
    );
    assert.deepEqual(retryRedemption, firstRedemption);
    assert.equal(firstRedemption.entitlements.license.source, "code");
    assert.equal(firstRedemption.entitlements.license.status, "active");

    await assert.rejects(
        api.redeem(login.accessToken, "INVALID-CODE", "mock-idempotency-002"),
        error =>
            error instanceof MockDigiwiseApiError &&
            error.status === 409 &&
            error.code === "LICENSE_INVALID"
    );

    console.log("Digiwise CLIENT-001 Mock API contract checks passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
