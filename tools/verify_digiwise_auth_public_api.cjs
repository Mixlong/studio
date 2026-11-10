const assert = require("node:assert/strict");

const {
    DigiwisePublicApi,
    DigiwisePublicApiError
} = require("../build/main/digiwise-auth-api.js");

const calls = [];
const api = new DigiwisePublicApi(
    "https://public.example.test/v1/",
    async (url, init) => {
        calls.push({
            url,
            method: init.method,
            headers: init.headers,
            body: init.body
        });

        if (url.endsWith("/auth/email/send-code")) {
            return new Response(
                JSON.stringify({ requestId: "request-1", accepted: true }),
                { status: 202 }
            );
        }
        if (url.endsWith("/auth/login")) {
            return new Response(
                JSON.stringify({
                    accessToken: "token-1",
                    tokenType: "Bearer",
                    expiresIn: 900
                }),
                { status: 200 }
            );
        }
        if (url.endsWith("/me/entitlements")) {
            return new Response(
                JSON.stringify({
                    serverTime: "2026-11-10T00:00:00.000Z",
                    accountStatus: "active",
                    trial: { status: "active" },
                    license: { source: "trial", status: "active" },
                    capabilities: []
                }),
                { status: 200 }
            );
        }
        return new Response(
            JSON.stringify({
                error: {
                    code: "LICENSE_INVALID",
                    message: "The license code is invalid",
                    requestId: "request-error"
                }
            }),
            { status: 409 }
        );
    }
);

(async () => {
    await api.sendCode("person@example.com");
    await api.login("person@example.com", "password-123");
    await api.getEntitlements("token-1");

    assert.equal(calls[0].url, "https://public.example.test/v1/auth/email/send-code");
    assert.deepEqual(JSON.parse(calls[0].body), {
        email: "person@example.com",
        purpose: "register"
    });
    assert.equal(calls[1].url, "https://public.example.test/v1/auth/login");
    assert.equal(calls[2].headers.Authorization, "Bearer token-1");
    assert.equal(calls[2].url, "https://public.example.test/v1/me/entitlements");

    await assert.rejects(
        () => api.redeem("token-1", "INVALID", "idempotency-key-001"),
        error =>
            error instanceof DigiwisePublicApiError &&
            error.status === 409 &&
            error.code === "LICENSE_INVALID" &&
            error.requestId === "request-error"
    );

    console.log("Digiwise CLIENT-001 Public API adapter checks passed.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

