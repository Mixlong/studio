export interface DigiwiseDownloadUrlPolicyOptions {
    isPackaged: boolean;
    allowLocalHttp?: boolean;
    apiBaseUrl?: string;
}

export interface DigiwiseDownloadUrlPolicy {
    validate(value: string | URL): URL;
    validateRedirect(current: string | URL, location: string): URL;
    validateFinal(initial: string | URL, finalUrl: string): URL;
}

export const MAX_DIGIWISE_DOWNLOAD_REDIRECTS = 3;

export class DigiwiseDownloadUrlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DigiwiseDownloadUrlError";
    }
}

export class DigiwiseDownloadRedirectError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DigiwiseDownloadRedirectError";
    }
}

function isLoopbackHostname(hostname: string) {
    return hostname === "localhost" || hostname === "127.0.0.1";
}

function isLoopbackUrl(url: URL) {
    return isLoopbackHostname(url.hostname);
}

function isLocalHttpUrl(url: URL) {
    return url.protocol === "http:" &&
        isLoopbackUrl(url) &&
        !url.username &&
        !url.password;
}

function parseUrl(value: string | URL) {
    try {
        return value instanceof URL ? new URL(value.href) : new URL(value);
    } catch (_error) {
        throw new DigiwiseDownloadUrlError("Invalid download URL");
    }
}

function localHttpEnabled(options: DigiwiseDownloadUrlPolicyOptions) {
    if (options.isPackaged) {
        return false;
    }
    if (options.allowLocalHttp === true) {
        return true;
    }
    if (!options.apiBaseUrl) {
        return false;
    }
    try {
        return isLocalHttpUrl(new URL(options.apiBaseUrl));
    } catch (_error) {
        return false;
    }
}

function redirectError(error: unknown) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    return new DigiwiseDownloadRedirectError(
        `Download redirect is invalid${detail}`
    );
}

export function createDigiwiseDownloadUrlPolicy(
    options: DigiwiseDownloadUrlPolicyOptions
): DigiwiseDownloadUrlPolicy {
    const allowLocalHttp = localHttpEnabled(options);

    function validate(value: string | URL) {
        const url = parseUrl(value);
        if (url.username || url.password) {
            throw new DigiwiseDownloadUrlError(
                "Download URL must not contain credentials"
            );
        }
        if (url.protocol === "https:") {
            return url;
        }
        if (allowLocalHttp && isLocalHttpUrl(url)) {
            return url;
        }
        throw new DigiwiseDownloadUrlError(
            "Download URL must use HTTPS or an explicitly allowed local HTTP URL"
        );
    }

    function validateRedirect(current: string | URL, location: string) {
        const currentUrl = validate(current);
        let nextUrl: URL;
        try {
            nextUrl = new URL(location, currentUrl);
        } catch (_error) {
            throw redirectError(_error);
        }

        try {
            nextUrl = validate(nextUrl);
        } catch (error) {
            throw redirectError(error);
        }

        if (allowLocalHttp &&
            isLoopbackUrl(currentUrl) !== isLoopbackUrl(nextUrl)) {
            throw new DigiwiseDownloadRedirectError(
                "Download redirect must remain within the same loopback or external host class"
            );
        }
        if (allowLocalHttp && isLoopbackUrl(currentUrl) &&
            currentUrl.hostname !== nextUrl.hostname) {
            throw new DigiwiseDownloadRedirectError(
                "Download redirect must remain on the same loopback host"
            );
        }
        return nextUrl;
    }

    function validateFinal(initial: string | URL, finalUrl: string) {
        try {
            return validateRedirect(initial, finalUrl);
        } catch (error) {
            if (error instanceof DigiwiseDownloadRedirectError) {
                throw new DigiwiseDownloadRedirectError(
                    `Download final URL is invalid: ${error.message}`
                );
            }
            throw error;
        }
    }

    return { validate, validateRedirect, validateFinal };
}

export type DigiwiseDownloadFetch = (
    input: string | URL,
    init?: RequestInit
) => Promise<Response>;

export async function fetchDigiwiseDownload(
    initialUrl: string | URL,
    policy: DigiwiseDownloadUrlPolicy,
    fetchImpl: DigiwiseDownloadFetch = fetch,
    init: RequestInit = {}
) {
    const originalUrl = policy.validate(initialUrl);
    let currentUrl = originalUrl;
    let response: Response | undefined;

    for (let redirectCount = 0; redirectCount <= MAX_DIGIWISE_DOWNLOAD_REDIRECTS; redirectCount++) {
        response = await fetchImpl(currentUrl, { ...init, redirect: "manual" });
        if (response.status < 300 || response.status >= 400) {
            break;
        }

        const location = response.headers.get("location");
        if (!location) {
            throw new DigiwiseDownloadRedirectError(
                "Download redirect is invalid"
            );
        }
        if (redirectCount === MAX_DIGIWISE_DOWNLOAD_REDIRECTS) {
            throw new DigiwiseDownloadRedirectError(
                "Download has too many redirects"
            );
        }
        currentUrl = policy.validateRedirect(currentUrl, location);
    }

    if (!response) {
        throw new DigiwiseDownloadRedirectError(
            "Download redirect is invalid"
        );
    }
    try {
        policy.validateFinal(originalUrl, response.url || currentUrl.href);
    } catch (error) {
        if (error instanceof DigiwiseDownloadRedirectError) {
            throw error;
        }
        throw new DigiwiseDownloadRedirectError(
            `Download final URL is invalid: ${error instanceof Error ? error.message : "unknown error"}`
        );
    }
    return response;
}
