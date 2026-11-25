# IDE authorization catalog contract

This slice exposes the existing Java Public API catalog through Main-process IPC. It does not download BSP files or expose an access token to the Renderer.

## Routes and fields

- `GET /api/ide/v1/categories` -> `DigiwiseCategory[]`
  - `id`, `productType`: positive/safe integer when present
  - `modelCode`, `categoryCode`, `modelName`, `categoryName`: non-empty strings, maximum 256 UTF-16 code units
  - `chipFamily`, `externalId`: string or `null`, maximum 256 UTF-16 code units
  - maximum 200 records
- `GET /api/ide/v1/bsp?categoryCode=<encoded>` -> `DigiwiseBspVersion[]`
  - `id`, `modelId`, `fileSize`: safe integers; ids are positive and file size is non-negative
  - `fileSize`: at most 4 GiB
  - `modelCode`, `categoryCode`, `modelName`, `categoryName`, `version`: non-empty strings, maximum 256 UTF-16 code units
  - `fileName`: non-empty string, maximum 512 UTF-16 code units
  - `sha256`: exactly 64 lowercase hexadecimal characters
  - `publishedAt`: `null` or a parseable `YYYY-MM-DD HH:mm:ss`/ISO-8601 timestamp with optional fractional seconds and timezone
  - maximum 200 records

The Main-process HTTP reader caps every Public API response at 1 MiB. A declared or observed response above that limit is rejected as `PUBLIC_API_INVALID_RESPONSE`; response content is not included in errors.

`modelId` and `modelCode` are retained independently. Numeric identifiers are not converted to strings or accepted when they exceed JavaScript's safe-integer range. BSP `categoryCode` is validated and URL-encoded independently from template categories.

## Error mapping

The Main API preserves Public API errors as `DigiwiseIpcResult.error` without returning the access token:

- HTTP 401 / revoked or missing session -> `AUTH_REQUIRED`
- HTTP 403 -> `ACCESS_DENIED`
- HTTP 400, 422, or local category-code validation -> `INVALID_REQUEST`
- HTTP 404 -> `NOT_FOUND`
- HTTP 429 -> `RATE_LIMITED`
- network/transport failure -> `PUBLIC_API_UNAVAILABLE`
- malformed catalog payload or unsafe numeric field -> `PUBLIC_API_INVALID_RESPONSE` (HTTP 502)
- session expiration/account switch while a request is in flight -> `AUTH_REQUIRED`

The IPC handlers validate the sender against the current home window resolver and reject unauthorized frames. Handlers are registered once.
