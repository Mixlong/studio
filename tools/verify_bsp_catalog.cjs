const assert = require('node:assert/strict');
const { DigiwisePublicApi } = require('../packages/main/digiwise-auth-api.ts');
(async () => {
    const calls = [];
    let data = [{id: 42, modelCode:'MODEL-1', categoryCode:'MODEL-1', modelName:'Model', categoryName:'Model', chipFamily:null, externalId:null, productType:null}];
    const api = new DigiwisePublicApi('https://example.invalid/api/ide/v1', async (url, init) => {
        calls.push({url, init});
        return new Response(JSON.stringify({code:'OK', data}), {status:200});
    });
    assert.deepEqual(await api.listCategories('token'), data);
    assert.match(calls[0].url, /\/categories$/);
    const textOnly = new DigiwisePublicApi('https://example.invalid/api/ide/v1', async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({code:'OK', data: []})
    }));
    assert.deepEqual(await textOnly.listCategories('token'), []);
    const unreadable = new DigiwisePublicApi('https://example.invalid/api/ide/v1', async () => ({
        ok: true,
        status: 200,
        text: async () => { throw new Error('fixture read failure'); }
    }));
    await assert.rejects(unreadable.listCategories('token'), {
        code: 'PUBLIC_API_INVALID_RESPONSE',
        requestId: 'response-read-failed'
    });
    const unreadableStream = new DigiwisePublicApi('https://example.invalid/api/ide/v1', async () => ({
        ok: true,
        status: 200,
        body: {getReader: () => ({
            read: async () => { throw new Error('stream read failure'); },
            cancel: async () => {}
        })}
    }));
    await assert.rejects(unreadableStream.listCategories('token'), {
        code: 'PUBLIC_API_INVALID_RESPONSE',
        requestId: 'response-read-failed'
    });
    data = [];
    assert.deepEqual(await api.listBspVersions('token', 'AB-1'), []);
    assert.match(calls.at(-1).url, /bsp\?categoryCode=AB-1$/);
    const count = calls.length;
    for (const invalid of ['', 'A', 'AB&x=1', null, 4]) {
        await assert.rejects(api.listBspVersions('token', invalid), { code: 'INVALID_REQUEST' });
    }
    assert.equal(calls.length, count);
    data = [{id: 3, modelId: 42, modelCode:'AB', categoryCode:'AB', modelName:'Model', categoryName:'Model', version:'1', fileName:'x.zip', fileSize:12, sha256:'a'.repeat(64), publishedAt:null, secret:'do-not-expose'}];
    const bsp = await api.listBspVersions('token');
    assert.equal(bsp[0].modelId, 42);
    assert.equal(bsp[0].secret, undefined);
    data = [{id: Number.MAX_SAFE_INTEGER + 1}];
    await assert.rejects(api.listCategories('token'), { code:'PUBLIC_API_INVALID_RESPONSE' });
    data = {};
    await assert.rejects(api.listBspVersions('token'), { code:'PUBLIC_API_INVALID_RESPONSE' });
    const oversized = new DigiwisePublicApi('https://example.invalid', async () => new Response(JSON.stringify({code:'OK', data: [], padding:'x'.repeat(1024 * 1024 + 1)}), {status:200}));
    await assert.rejects(oversized.listCategories('token'), { code:'PUBLIC_API_INVALID_RESPONSE' });
    data = Array.from({length: 201}, (_, id) => ({id: id + 1, modelCode:'MODEL-1', categoryCode:'MODEL-1', modelName:'Model', categoryName:'Model', chipFamily:null, externalId:null, productType:null}));
    await assert.rejects(api.listCategories('token'), { code:'PUBLIC_API_INVALID_RESPONSE' });
    data = Array.from({length: 201}, (_, id) => ({id: id + 1, modelId:42, modelCode:'AB', categoryCode:'AB', modelName:'Model', categoryName:'Model', version:'1', fileName:'x.zip', fileSize:12, sha256:'a'.repeat(64), publishedAt:null}));
    await assert.rejects(api.listBspVersions('token'), { code:'PUBLIC_API_INVALID_RESPONSE' });
    data = [{id: 42, modelCode:'MODEL-1', categoryCode:'MODEL-1', modelName:'x'.repeat(257), categoryName:'Model', chipFamily:null, externalId:null, productType:null}];
    await assert.rejects(api.listCategories('token'), { code:'PUBLIC_API_INVALID_RESPONSE' });
    data = [{id: 42, modelCode:'MODEL-1', categoryCode:'MODEL-1', modelName:'Model', categoryName:'Model', chipFamily:null, externalId:null, productType:-1}];
    await assert.rejects(api.listCategories('token'), { code:'PUBLIC_API_INVALID_RESPONSE' });
    const invalidBsp = {id:3, modelId:42, modelCode:'AB', categoryCode:'AB', modelName:'Model', categoryName:'Model', version:'1', fileName:'x.zip', fileSize:12, sha256:'a'.repeat(64), publishedAt:null};
    for (const invalid of [
        {...invalidBsp, fileSize: 4 * 1024 * 1024 * 1024 + 1},
        {...invalidBsp, sha256:'abc'},
        {...invalidBsp, publishedAt:'not-a-date'},
        {...invalidBsp, fileName:'x'.repeat(513)}
    ]) {
        data = [invalid];
        await assert.rejects(api.listBspVersions('token'), { code:'PUBLIC_API_INVALID_RESPONSE' });
    }
    const unavailable = new DigiwisePublicApi('https://example.invalid', async () => { throw new Error('network'); });
    await assert.rejects(unavailable.listCategories('token'), { code:'PUBLIC_API_UNAVAILABLE' });
    const revoked = new DigiwisePublicApi('https://example.invalid', async () => new Response(JSON.stringify({code:'AUTH_REQUIRED', message:'revoked'}), {status:401}));
    await assert.rejects(revoked.listCategories('token'), { code:'AUTH_REQUIRED', status:401 });
    const Module = require('node:module');
    const load = Module._load;
    const handlers = new Map();
    let generation = 1;
    let signedIn = false;
    let mode = 'normal';
    const auth = {
        getDigiwiseAuthGuard: () => ({ authenticated: signedIn, generation }),
        callDigiwisePublicApiWithSession: operation => signedIn
            ? operation({ listCategories: () => {
                if (mode === 'expired') signedIn = false;
                if (mode === 'changed') generation++;
                return Promise.resolve([]);
            } }, 'private').then(data => ({ok:true, data}))
            : Promise.resolve({ok:false, error:{code:'AUTH_REQUIRED'}})
    };
    Module._load = function(request, ...args) {
        if (request === 'electron') return {ipcMain:{handle: (name, handler) => { assert(!handlers.has(name)); handlers.set(name, handler); }}};
        if (request === 'main/digiwise-auth') return auth;
        return load.call(this, request, ...args);
    };
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../packages/main/digiwise-bsp-catalog.ts'), 'utf8');
    const stripped = Module.stripTypeScriptTypes(source)
        .replace('import { ipcMain, BrowserWindow } from "electron";', 'const { ipcMain } = require("electron");')
        .replace('import { callDigiwisePublicApiWithSession, getDigiwiseAuthGuard } from "main/digiwise-auth";', 'const { callDigiwisePublicApiWithSession, getDigiwiseAuthGuard } = require("main/digiwise-auth");')
        .replace('export function registerDigiwiseBspCatalogIpc', 'function registerDigiwiseBspCatalogIpc') + '\nmodule.exports = {registerDigiwiseBspCatalogIpc};';
    const testModule = new Module('catalog-test', module);
    testModule._compile(stripped, 'catalog-test.js');
    const { registerDigiwiseBspCatalogIpc } = testModule.exports;
    Module._load = load;
    const sender = {mainFrame:{}, isDestroyed:() => false};
    let activeWindow = {webContents:sender, isDestroyed:() => false};
    registerDigiwiseBspCatalogIpc(() => activeWindow);
    registerDigiwiseBspCatalogIpc(() => activeWindow);
    assert.equal(handlers.size, 2);
    const handler = handlers.get('digistudio:bsp:categories');
    assert.throws(() => handler({sender, senderFrame:{}}), /Unauthorized/);
    assert.throws(() => handler({sender:{}, senderFrame:sender.mainFrame}), /Unauthorized/);
    const event = {sender, senderFrame:sender.mainFrame};
    assert.equal((await handler(event)).error.code, 'AUTH_REQUIRED');
    signedIn = true;
    mode = 'changed';
    assert.equal((await handler(event)).error.code, 'AUTH_REQUIRED');
    generation = 2;
    mode = 'expired';
    assert.equal((await handler(event)).error.code, 'AUTH_REQUIRED');
    signedIn = true;
    mode = 'normal';
    const replacementSender = {mainFrame:{}, isDestroyed:() => false};
    activeWindow = {webContents:replacementSender, isDestroyed:() => false};
    auth.callDigiwisePublicApiWithSession = operation => operation({ listCategories: () => Promise.resolve([]) }, 'private').then(data => ({ok:true, data}));
    assert.deepEqual((await handler({sender:replacementSender, senderFrame:replacementSender.mainFrame})).data, []);
    console.log('catalog API tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
