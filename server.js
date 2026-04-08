const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const CACHE_FILE = path.join(__dirname, 'public', 'lore-cache.json');
const CACHE_META_FILE = path.join(__dirname, 'public', 'lore-cache.meta.json');
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Load API key from .env.local
const envPath = path.join(__dirname, '.env.local');
let BUNGIE_API_KEY = 'YOUR_BUNGIE_API_KEY_HERE';
let BUNGIE_CLIENT_ID = '';
let BUNGIE_CLIENT_SECRET = '';
let BUNGIE_REDIRECT_URI = 'http://localhost:8000/auth/callback';
let HTTPS_PFX_PASSPHRASE = '';

if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;
        const [key, ...rest] = trimmed.split('=');
        const value = rest.join('=').trim();
        if (key === 'VITE_BUNGIE_API_KEY') BUNGIE_API_KEY = value;
        if (key === 'BUNGIE_CLIENT_ID') BUNGIE_CLIENT_ID = value;
        if (key === 'BUNGIE_CLIENT_SECRET') BUNGIE_CLIENT_SECRET = value;
        if (key === 'BUNGIE_REDIRECT_URI') BUNGIE_REDIRECT_URI = value;
        if (key === 'HTTPS_PFX_PASSPHRASE') HTTPS_PFX_PASSPHRASE = value;
    });
    console.log('✅ Environment loaded from .env.local');
}

BUNGIE_CLIENT_ID = BUNGIE_CLIENT_ID || process.env.BUNGIE_CLIENT_ID || '';
BUNGIE_CLIENT_SECRET = BUNGIE_CLIENT_SECRET || process.env.BUNGIE_CLIENT_SECRET || '';
BUNGIE_REDIRECT_URI = BUNGIE_REDIRECT_URI || process.env.BUNGIE_REDIRECT_URI || 'http://localhost:8000/auth/callback';
HTTPS_PFX_PASSPHRASE = HTTPS_PFX_PASSPHRASE || process.env.HTTPS_PFX_PASSPHRASE || '';

const sessions = new Map();

let inMemoryCache = null;
let inMemoryCacheTimestamp = 0;

function fetchJson(bungieUrl, headers = {}) {
    return new Promise((resolve, reject) => {
        https.get(bungieUrl, { headers }, (apiRes) => {
            let data = '';
            apiRes.on('data', (chunk) => { data += chunk; });
            apiRes.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (error) {
                    const parseErr = new Error(`Failed to parse Bungie response as JSON (HTTP ${apiRes.statusCode})`);
                    parseErr.statusCode = apiRes.statusCode;
                    parseErr.body = data;
                    reject(parseErr);
                    return;
                }

                if (!apiRes.statusCode || apiRes.statusCode < 200 || apiRes.statusCode >= 300) {
                    const httpErr = new Error(`Bungie HTTP ${apiRes.statusCode}`);
                    httpErr.statusCode = apiRes.statusCode;
                    httpErr.bungie = parsed;
                    reject(httpErr);
                    return;
                }

                // Bungie responses often return 200 with an ErrorCode.
                if (parsed && typeof parsed.ErrorCode === 'number' && parsed.ErrorCode !== 1) {
                    const bungieErr = new Error(`Bungie ErrorCode ${parsed.ErrorCode}: ${parsed.Message || parsed.ErrorStatus || 'Unknown error'}`);
                    bungieErr.statusCode = apiRes.statusCode;
                    bungieErr.bungie = parsed;
                    reject(bungieErr);
                    return;
                }

                resolve(parsed);
            });
        }).on('error', reject);
    });
}

async function fetchBungieWithAuthRetry(urlPath, session, { maxRetries = 3 } = {}) {
    // Bungie throttling can surface as HTTP 429/503 or ErrorCode/Status in a 200.
    const retryableStatusCodes = new Set([429, 503, 502, 504]);
    const isRetryableBungieError = (err) => {
        const bungie = err?.bungie;
        const errorStatus = bungie?.ErrorStatus;
        const errorCode = bungie?.ErrorCode;
        return errorStatus === 'ThrottleLimitExceeded' || errorCode === 36;
    };

    let attempt = 0;
    while (true) {
        try {
            return await fetchBungieWithAuth(urlPath, session);
        } catch (err) {
            attempt += 1;
            const statusCode = err?.statusCode;
            const canRetry = attempt <= maxRetries && (retryableStatusCodes.has(statusCode) || isRetryableBungieError(err));
            if (!canRetry) throw err;

            const delayMs = Math.min(4000, 500 * Math.pow(2, attempt - 1));
            console.warn(`⏳ Bungie request throttled/failed (attempt ${attempt}/${maxRetries}). Retrying in ${delayMs}ms...`);
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
}

function postForm(bungieUrl, formBody) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams(formBody).toString();
        const request = https.request(bungieUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.on('error', reject);
        request.write(body);
        request.end();
    });
}

function getSession(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/lorehub_session=([a-f0-9]+)/);
    if (!match) return null;
    return sessions.get(match[1]) || null;
}

function setSession(res, session) {
    const sessionId = crypto.randomBytes(16).toString('hex');
    sessions.set(sessionId, session);
    res.setHeader('Set-Cookie', `lorehub_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSession(req, res) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/lorehub_session=([a-f0-9]+)/);
    if (match) {
        sessions.delete(match[1]);
    }
    res.setHeader('Set-Cookie', 'lorehub_session=; Path=/; Max-Age=0');
}

async function fetchBungieWithAuth(urlPath, session) {
    const headers = {
        'X-API-Key': BUNGIE_API_KEY,
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json'
    };

    return await fetchJson(`https://www.bungie.net/Platform/${urlPath}`, headers);
}

async function refreshAccessToken(session) {
    const tokenResponse = await postForm('https://www.bungie.net/platform/app/oauth/token/', {
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
        client_id: BUNGIE_CLIENT_ID,
        client_secret: BUNGIE_CLIENT_SECRET
    });

    session.accessToken = tokenResponse.access_token;
    session.refreshToken = tokenResponse.refresh_token || session.refreshToken;
    session.expiresAt = Date.now() + (tokenResponse.expires_in * 1000);
}

function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function selectMembership(destinyMemberships, primaryId) {
    if (!Array.isArray(destinyMemberships) || destinyMemberships.length === 0) return null;

    let selected = null;
    if (primaryId) {
        selected = destinyMemberships.find((m) => m.membershipId === primaryId) || null;
    }

    if (!selected) {
        selected = destinyMemberships.find((m) => (m.crossSaveOverride || 0) !== 0) || null;
    }

    if (!selected) {
        selected = destinyMemberships.find((m) => m.isCrossSavePrimary) || null;
    }

    return selected || destinyMemberships[0];
}

function buildCategory(node, order, presentationNodes, recordDefinitions, loreDefinitions) {
    const books = [];
    const slug = slugify(node.displayProperties?.name || `category-${order}`);

    const traverse = (currentNode, path) => {
        const records = currentNode.children?.records || [];
        if (records.length) {
            const entries = records
                .map((recordRef, idx) => {
                    const record = recordDefinitions[recordRef.recordHash];
                    if (!record || !record.loreHash) return null;
                    const lore = loreDefinitions[record.loreHash] || {};
                    return {
                        order: idx,
                        recordHash: recordRef.recordHash,
                        hash: record.loreHash,
                        name: record.displayProperties?.name || lore.displayProperties?.name || 'Untitled',
                        description: lore.displayProperties?.description || '',
                        subtitle: lore.subtitle || ''
                    };
                })
                .filter(Boolean);

            books.push({
                hash: currentNode.hash,
                name: currentNode.displayProperties?.name || 'Untitled',
                icon: currentNode.displayProperties?.icon || '',
                group: path.join(' / '),
                order: books.length,
                entries
            });
        }

        const childNodes = currentNode.children?.presentationNodes || [];
        childNodes.forEach((child) => {
            const childNode = presentationNodes[child.presentationNodeHash];
            if (!childNode) return;
            const nextPath = currentNode !== node
                ? [...path, currentNode.displayProperties?.name || '']
                : [...path];
            traverse(childNode, nextPath.filter(Boolean));
        });
    };

    traverse(node, []);

    return {
        hash: node.hash,
        name: node.displayProperties?.name || 'Lore',
        slug,
        order,
        books
    };
}

function findLoreRootNode(presentationNodes) {
    const loreNodes = Object.values(presentationNodes).filter(
        (node) => (node.displayProperties?.name || '').toLowerCase() === 'lore' && node.children?.presentationNodes?.length
    );

    if (!loreNodes.length) return null;

    let root = loreNodes.find((node) => (node.parentNodeHashes || []).length === 0) || loreNodes[0];

    if (root.children?.presentationNodes?.length === 1) {
        const childHash = root.children.presentationNodes[0].presentationNodeHash;
        const child = presentationNodes[childHash];
        if (child && (child.displayProperties?.name || '').toLowerCase() === 'lore') {
            root = child;
        }
    }

    return root;
}

async function buildLoreCache() {
    console.log('🧩 Building lore cache...');
    const manifest = await fetchJson('https://www.bungie.net/Platform/Destiny2/Manifest/', {
        'X-API-Key': BUNGIE_API_KEY,
        'Content-Type': 'application/json'
    });

    const contentPaths = manifest.Response?.jsonWorldContentPaths || {};
    const contentPath = contentPaths.en || contentPaths['en-us'] || Object.values(contentPaths)[0];
    if (!contentPath) {
        throw new Error('No manifest content path found');
    }

    const worldContent = await fetchJson(`https://www.bungie.net${contentPath}`);

    const presentationNodes = worldContent.DestinyPresentationNodeDefinition || {};
    const recordDefinitions = worldContent.DestinyRecordDefinition || {};
    const loreDefinitions = worldContent.DestinyLoreDefinition || {};

    const loreRoot = findLoreRootNode(presentationNodes);
    if (!loreRoot) {
        throw new Error('Lore root node not found');
    }

    const categoryNodes = (loreRoot.children?.presentationNodes || [])
        .map((child) => presentationNodes[child.presentationNodeHash])
        .filter(Boolean);

    const categories = categoryNodes
        .map((node, index) => buildCategory(node, index, presentationNodes, recordDefinitions, loreDefinitions))
        .filter((category) => category.books.length > 0);

    const library = { categories };
    inMemoryCache = library;
    inMemoryCacheTimestamp = Date.now();

    try {
        fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(library));
        fs.writeFileSync(CACHE_META_FILE, JSON.stringify({ timestamp: inMemoryCacheTimestamp }));
        console.log('✅ Lore cache written');
    } catch (error) {
        console.warn('⚠️ Failed to write lore cache:', error.message);
    }

    return library;
}

function readCacheFromDisk() {
    try {
        if (!fs.existsSync(CACHE_FILE) || !fs.existsSync(CACHE_META_FILE)) return null;
        const meta = JSON.parse(fs.readFileSync(CACHE_META_FILE, 'utf8'));
        if (!meta.timestamp || Date.now() - meta.timestamp > CACHE_DURATION_MS) return null;
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        return { data, timestamp: meta.timestamp };
    } catch (error) {
        console.warn('⚠️ Cache read failed:', error.message);
        return null;
    }
}

async function serveLoreCache(res) {
    try {
        if (inMemoryCache && Date.now() - inMemoryCacheTimestamp < CACHE_DURATION_MS) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(inMemoryCache));
            return;
        }

        const diskCache = readCacheFromDisk();
        if (diskCache) {
            inMemoryCache = diskCache.data;
            inMemoryCacheTimestamp = diskCache.timestamp;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(inMemoryCache));
            return;
        }

        const library = await buildLoreCache();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(library));
    } catch (error) {
        console.error('❌ Lore cache error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to build lore cache' }));
    }
}

const requestHandler = async (req, res) => {
    console.log(`\n📨 Request: ${req.method} ${req.url}`);
    
    // Debug endpoint
    if (req.url === '/debug') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            'API_KEY_LOADED': !!BUNGIE_API_KEY && BUNGIE_API_KEY !== 'YOUR_BUNGIE_API_KEY_HERE',
            'API_KEY_PREVIEW': BUNGIE_API_KEY.substring(0, 10) + '...',
            'SERVER_TIME': new Date().toISOString()
        }, null, 2));
        return;
    }

    // OAuth: start login
    if (req.url.startsWith('/auth/login')) {
        if (!BUNGIE_CLIENT_ID || !BUNGIE_CLIENT_SECRET) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing Bungie OAuth credentials' }));
            return;
        }

        const redirect = `https://www.bungie.net/en/OAuth/Authorize?client_id=${BUNGIE_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(BUNGIE_REDIRECT_URI)}`;
        res.writeHead(302, { Location: redirect });
        res.end();
        return;
    }

    // OAuth: callback
    if (req.url.startsWith('/auth/callback')) {
        const query = url.parse(req.url, true).query;
        const code = query.code;
        if (!code) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing code' }));
            return;
        }

        try {
            const tokenResponse = await postForm('https://www.bungie.net/platform/app/oauth/token/', {
                grant_type: 'authorization_code',
                code,
                client_id: BUNGIE_CLIENT_ID,
                client_secret: BUNGIE_CLIENT_SECRET,
                redirect_uri: BUNGIE_REDIRECT_URI
            });

            const session = {
                accessToken: tokenResponse.access_token,
                refreshToken: tokenResponse.refresh_token,
                expiresAt: Date.now() + (tokenResponse.expires_in * 1000),
                membershipId: null,
                membershipType: null,
                displayName: null
            };

            const memberships = await fetchBungieWithAuth('User/GetMembershipsForCurrentUser/', session);
            const destinyMemberships = memberships.Response?.destinyMemberships || [];
            const primaryId = memberships.Response?.primaryMembershipId;
            const selected = selectMembership(destinyMemberships, primaryId);

            session.membershipId = selected?.membershipId || null;
            session.membershipType = selected?.membershipType || null;
            session.displayName = selected?.displayName || selected?.bungieGlobalDisplayName || 'Guardian';

            setSession(res, session);
            res.writeHead(302, { Location: '/' });
            res.end();
        } catch (error) {
            console.error('❌ OAuth callback error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'OAuth failed' }));
        }
        return;
    }

    // Auth status
    if (req.url.startsWith('/auth/status')) {
        const session = getSession(req);
        if (!session) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ authenticated: false }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            authenticated: true,
            profile: {
                membershipId: session.membershipId,
                membershipType: session.membershipType,
                displayName: session.displayName
            }
        }));
        return;
    }

    // Auth logout
    if (req.url.startsWith('/auth/logout')) {
        clearSession(req, res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // User lore status
    if (req.url.startsWith('/api/user/lore-status')) {
        const session = getSession(req);
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not authenticated' }));
            return;
        }

        try {
            if (session.expiresAt && session.expiresAt < Date.now()) {
                await refreshAccessToken(session);
            }

            if (!session.membershipId || !session.membershipType) {
                const memberships = await fetchBungieWithAuth('User/GetMembershipsForCurrentUser/', session);
                const destinyMemberships = memberships.Response?.destinyMemberships || [];
                const primaryId = memberships.Response?.primaryMembershipId;
                const selected = selectMembership(destinyMemberships, primaryId);
                session.membershipId = selected?.membershipId || null;
                session.membershipType = selected?.membershipType || null;
                session.displayName = selected?.displayName || selected?.bungieGlobalDisplayName || 'Guardian';
            }

            const profileUrl = `Destiny2/${session.membershipType}/Profile/${session.membershipId}/?components=100,900&t=${Date.now()}`;
            const profile = await fetchBungieWithAuthRetry(profileUrl, session);
            const records = profile.Response?.profileRecords?.data?.records || {};

            const ownedRecordHashes = Object.keys(records).filter((hash) => {
                const record = records[hash];
                const state = record?.state || 0;
                return (state & 1) === 1; // RecordRedeemed
            }).map((hash) => Number(hash));

            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ ownedRecordHashes }));
        } catch (error) {
            console.error('❌ Lore status error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to load lore status' }));
        }
        return;
    }

    // User exotic ownership status (Collections-only: Collectibles state)
    if (req.url.startsWith('/api/user/exotics-status')) {
        const session = getSession(req);
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not authenticated' }));
            return;
        }

        try {
            if (session.expiresAt && session.expiresAt < Date.now()) {
                await refreshAccessToken(session);
            }

            // For data-critical correctness, always refresh membership selection on this endpoint
            // to avoid stale membershipType/membershipId causing partial inventories.
            const memberships = await fetchBungieWithAuthRetry('User/GetMembershipsForCurrentUser/', session);
            const destinyMemberships = memberships.Response?.destinyMemberships || [];
            const primaryId = memberships.Response?.primaryMembershipId;
            const selected = selectMembership(destinyMemberships, primaryId);
            session.membershipId = selected?.membershipId || null;
            session.membershipType = selected?.membershipType || null;
            session.displayName = selected?.displayName || selected?.bungieGlobalDisplayName || 'Guardian';

            const components = [
                100, // Profiles
                200, // Characters
                700, // PresentationNodes (Collections hierarchy/state)
                800  // Collectibles (unlock state)
            ].join(',');

            const profileUrl = `Destiny2/${session.membershipType}/Profile/${session.membershipId}/?components=${components}&t=${Date.now()}`;
            const profile = await fetchBungieWithAuthRetry(profileUrl, session);

            const ownedCollectibleHashes = new Set();
            const addOwnedFromCollectibles = (collectibles) => {
                if (!collectibles) return;
                Object.keys(collectibles).forEach((hash) => {
                    const collectible = collectibles[hash];
                    const state = collectible?.state || 0;
                    if ((state & 1) === 0) {
                        ownedCollectibleHashes.add(Number(hash));
                    }
                });
            };

            const profileCollectibles = profile.Response?.profileCollectibles?.data?.collectibles || null;
            addOwnedFromCollectibles(profileCollectibles);

            const characterCollectibles = profile.Response?.characterCollectibles?.data || {};
            Object.values(characterCollectibles).forEach((characterData) => {
                addOwnedFromCollectibles(characterData?.collectibles || {});
            });

            const characterIds = Object.keys(profile.Response?.characters?.data || {});

            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({
                ownedCollectibleHashes: Array.from(ownedCollectibleHashes),
                debug: {
                    membershipType: session.membershipType,
                    membershipId: session.membershipId,
                    characterIds,
                    counts: {
                        profileCollectibles: profileCollectibles ? Object.keys(profileCollectibles).length : 0,
                        characterCollectibles: Object.keys(profile.Response?.characterCollectibles?.data || {}).length,
                        profilePresentationNodes: profile.Response?.profilePresentationNodes?.data?.nodes
                            ? Object.keys(profile.Response.profilePresentationNodes.data.nodes).length
                            : 0,
                        characterPresentationNodes: Object.keys(profile.Response?.characterPresentationNodes?.data || {}).length
                    }
                }
            }));
        } catch (error) {
            console.error('❌ Exotic status error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to load exotic status' }));
        }
        return;
    }

    // Inventory snapshot (audit): returns raw hashes + counts for vault + all characters
    if (req.url.startsWith('/api/user/inventory-snapshot')) {
        const session = getSession(req);
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not authenticated' }));
            return;
        }

        try {
            if (session.expiresAt && session.expiresAt < Date.now()) {
                await refreshAccessToken(session);
            }

            const memberships = await fetchBungieWithAuthRetry('User/GetMembershipsForCurrentUser/', session);
            const destinyMemberships = memberships.Response?.destinyMemberships || [];
            const primaryId = memberships.Response?.primaryMembershipId;
            const selected = selectMembership(destinyMemberships, primaryId);
            session.membershipId = selected?.membershipId || null;
            session.membershipType = selected?.membershipType || null;
            session.displayName = selected?.displayName || selected?.bungieGlobalDisplayName || 'Guardian';

            const components = [
                100, // Profiles
                200, // Characters
                102, // ProfileInventories (includes Vault)
                201, // CharacterInventories
                205  // CharacterEquipment
            ].join(',');

            const profileUrl = `Destiny2/${session.membershipType}/Profile/${session.membershipId}/?components=${components}&t=${Date.now()}`;
            const profile = await fetchBungieWithAuthRetry(profileUrl, session);

            const profileInventory = profile.Response?.profileInventory?.data?.items || [];
            const characterInventories = profile.Response?.characterInventories?.data || {};
            const characterEquipment = profile.Response?.characterEquipment?.data || {};
            const characterIds = Object.keys(profile.Response?.characters?.data || {});

            const hashCounts = new Map();
            const addItem = (it, ownerCharacterId = null, source = '') => {
                if (!it?.itemHash) return;
                const key = it.itemHash;
                hashCounts.set(key, (hashCounts.get(key) || 0) + 1);
                return {
                    itemHash: it.itemHash,
                    itemInstanceId: it.itemInstanceId || null,
                    bucketHash: it.bucketHash || null,
                    location: it.location || null,
                    ownerCharacterId,
                    source
                };
            };

            const sample = [];
            profileInventory.forEach((it) => {
                const row = addItem(it, null, 'profileInventory');
                if (row && sample.length < 120) sample.push(row);
            });

            Object.entries(characterInventories).forEach(([charId, data]) => {
                (data?.items || []).forEach((it) => {
                    const row = addItem(it, charId, 'characterInventory');
                    if (row && sample.length < 120) sample.push(row);
                });
            });

            Object.entries(characterEquipment).forEach(([charId, data]) => {
                (data?.items || []).forEach((it) => {
                    const row = addItem(it, charId, 'characterEquipment');
                    if (row && sample.length < 120) sample.push(row);
                });
            });

            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({
                membershipType: session.membershipType,
                membershipId: session.membershipId,
                displayName: session.displayName,
                characterIds,
                counts: {
                    profileInventory: profileInventory.length,
                    characterInventories: Object.keys(characterInventories).length,
                    characterEquipment: Object.keys(characterEquipment).length,
                    uniqueItemHashes: hashCounts.size
                },
                // Useful for diffs with UI filtering
                itemHashes: Array.from(hashCounts.keys()),
                sample
            }));
        } catch (error) {
            console.error('❌ Inventory snapshot error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to load inventory snapshot' }));
        }
        return;
    }

    // Serve cached lore library
    if (req.url === '/lore-cache.json') {
        serveLoreCache(res);
        return;
    }
    
    // Handle Bungie content proxy requests (manifest JSON files)
    if (req.url.startsWith('/content/')) {
        const contentPath = req.url.replace('/content', '');
        const bungieUrl = `https://www.bungie.net${contentPath}`;

        console.log(`📦 Proxying content: ${bungieUrl}`);

        https.get(bungieUrl, (contentRes) => {
            let data = '';

            contentRes.on('data', (chunk) => {
                data += chunk;
            });

            contentRes.on('end', () => {
                console.log(`✅ Content status: ${contentRes.statusCode}`);
                res.writeHead(contentRes.statusCode, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                });
                res.end(data);
            });
        }).on('error', (err) => {
            console.error('❌ Error calling Bungie content:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Error calling Bungie content' }));
        });

        return;
    }

    // Handle API proxy requests
    if (req.url.startsWith('/api/')) {
        const apiEndpoint = req.url.replace('/api/', '');
        const bungieUrl = `https://www.bungie.net/Platform/${apiEndpoint}`;
        
        console.log(`📡 Proxying to: ${bungieUrl}`);
        console.log(`🔑 Using API Key: ${BUNGIE_API_KEY.substring(0, 10)}...${BUNGIE_API_KEY.substring(BUNGIE_API_KEY.length - 5)}`);
        
        // Make request to Bungie API
        https.get(bungieUrl, {
            headers: {
                'X-API-Key': BUNGIE_API_KEY,
                'Content-Type': 'application/json'
            }
        }, (apiRes) => {
            let data = '';
            
            apiRes.on('data', (chunk) => {
                data += chunk;
            });
            
            apiRes.on('end', () => {
                console.log(`✅ API status: ${apiRes.statusCode}`);
                res.writeHead(apiRes.statusCode, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                });
                res.end(data);
            });
        }).on('error', (err) => {
            console.error('❌ Error calling Bungie API:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Error calling Bungie API' }));
        });
        
        return;
    }
    
    // Handle OPTIONS requests for CORS
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }
    
    // Serve static files
    // Get file path
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    
    // Get file extension
    const ext = path.extname(filePath);
    
    // Set content type
    let contentType = 'text/html';
    switch (ext) {
        case '.js':
            contentType = 'application/javascript';
            break;
        case '.css':
            contentType = 'text/css';
            break;
        case '.json':
            contentType = 'application/json';
            break;
        case '.png':
            contentType = 'image/png';
            break;
        case '.jpg':
        case '.jpeg':
            contentType = 'image/jpeg';
            break;
        case '.gif':
            contentType = 'image/gif';
            break;
        case '.svg':
            contentType = 'image/svg+xml';
            break;
    }
    
    // Read and serve file
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 - File not found</h1>', 'utf-8');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data, 'utf-8');
        }
    });
};

const PORT = 8000;
let server;

if (fs.existsSync(path.join(__dirname, 'server.pfx'))) {
    const sslOptions = {
        pfx: fs.readFileSync(path.join(__dirname, 'server.pfx')),
        passphrase: HTTPS_PFX_PASSPHRASE || undefined,
    };
    server = https.createServer(sslOptions, requestHandler);
    server.listen(PORT, () => {
        console.log(`✅ HTTPS server running at https://localhost:${PORT}/`);
        console.log(`Press Ctrl+C to stop`);
    });
} else if (fs.existsSync(path.join(__dirname, 'server.key')) && fs.existsSync(path.join(__dirname, 'server.crt'))) {
    const sslOptions = {
        key: fs.readFileSync(path.join(__dirname, 'server.key')),
        cert: fs.readFileSync(path.join(__dirname, 'server.crt')),
    };
    server = https.createServer(sslOptions, requestHandler);
    server.listen(PORT, () => {
        console.log(`✅ HTTPS server running at https://localhost:${PORT}/`);
        console.log(`Press Ctrl+C to stop`);
    });
} else {
    server = http.createServer(requestHandler);
    server.listen(PORT, () => {
        console.log(`✅ HTTP server running at http://localhost:${PORT}/`);
        console.log('⚠️ Bungie OAuth requires HTTPS. Create server.pfx and restart.');
        console.log(`Press Ctrl+C to stop`);
    });
}
