const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

function encodeVarint(value) {
    const bytes = [];
    while (value >= 0x80) {
        bytes.push((value & 0x7f) | 0x80);
        value >>>= 7;
    }
    bytes.push(value & 0x7f);
    return Buffer.from(bytes);
}

function encodeTag(fieldNum, wireType) {
    return encodeVarint((fieldNum << 3) | wireType);
}

function encodeBytesField(fieldNum, data) {
    return Buffer.concat([encodeTag(fieldNum, 2), encodeVarint(data.length), data]);
}

function encodeStringField(fieldNum, str) {
    return encodeBytesField(fieldNum, Buffer.from(str, 'utf8'));
}

function encodeVarintField(fieldNum, value) {
    return Buffer.concat([encodeTag(fieldNum, 0), encodeVarint(value)]);
}

function encodeMessageField(fieldNum, messageBuffer) {
    return Buffer.concat([encodeTag(fieldNum, 2), encodeVarint(messageBuffer.length), messageBuffer]);
}

class ProtobufReader {
    constructor(buf) {
        this.buf = buf;
        this.pos = 0;
        this.length = buf.length;
    }

    readVarint() {
        let val = 0;
        let shift = 0;
        let b;
        do {
            if (this.pos >= this.length) throw new Error('Unexpected end');
            b = this.buf[this.pos++];
            val |= (b & 0x7f) << shift;
            shift += 7;
        } while (b >= 0x80);
        return val;
    }

    readTag() {
        const tag = this.readVarint();
        return { fieldNum: tag >> 3, wireType: tag & 0x7 };
    }

    readBytes() {
        const len = this.readVarint();
        const end = this.pos + len;
        const bytes = this.buf.slice(this.pos, end);
        this.pos = end;
        return bytes;
    }

    readString() {
        return this.readBytes().toString('utf8');
    }

    skip(wireType) {
        if (wireType === 0) {
            this.readVarint();
        } else if (wireType === 2) {
            const len = this.readVarint();
            this.pos += len;
        } else if (wireType === 1) {
            this.pos += 8;
        } else if (wireType === 5) {
            this.pos += 4;
        }
    }
}

function readCategory(reader, end) {
    const category = { 
        universal_category: 0,
        detailed_category: 0,
        risk_level: 0, 
        security_category: 0, 
        productivity_category: 0 
    };
    while (reader.pos < end) {
        const tag = reader.readTag();
        if (tag.fieldNum === 1) category.universal_category = reader.readVarint();
        else if (tag.fieldNum === 2) category.detailed_category = reader.readVarint();
        else if (tag.fieldNum === 3) category.risk_level = reader.readVarint();
        else if (tag.fieldNum === 4) category.security_category = reader.readVarint();
        else if (tag.fieldNum === 5) category.productivity_category = reader.readVarint();
        else reader.skip(tag.wireType);
    }
    return category;
}

function readURLResult(reader, end) {
    const result = { status_code: 0, category: null, threat_name: '', labs_uri_id: 0, ttl: 0 };
    while (reader.pos < end) {
        const tag = reader.readTag();
        if (tag.fieldNum === 1) result.status_code = reader.readVarint();
        else if (tag.fieldNum === 2) {
            const msgEnd = reader.pos + reader.readVarint();
            result.category = readCategory(reader, msgEnd);
        }
        else if (tag.fieldNum === 3) result.threat_name = reader.readString();
        else if (tag.fieldNum === 4) result.labs_uri_id = reader.readVarint();
        else if (tag.fieldNum === 6) result.ttl = reader.readVarint();
        else reader.skip(tag.wireType);
    }
    return result;
}

function readLookupResponse(reader, end) {
    const lookup = { url_results: [] };
    while (reader.pos < end) {
        const tag = reader.readTag();
        if (tag.fieldNum === 2) {
            const msgEnd = reader.pos + reader.readVarint();
            lookup.url_results.push(readURLResult(reader, msgEnd));
        } else {
            reader.skip(tag.wireType);
        }
    }
    return lookup;
}

function readSXL4Response(buf) {
    const reader = new ProtobufReader(buf);
    const response = { id: 0, lookup: null };
    
    while (reader.pos < reader.length) {
        const tag = reader.readTag();
        if (tag.fieldNum === 1) response.id = reader.readVarint();
        else if (tag.fieldNum === 3) {
            const msgEnd = reader.pos + reader.readVarint();
            response.lookup = readLookupResponse(reader, msgEnd);
        }
        else reader.skip(tag.wireType);
    }
    
    return response;
}

async function sophos(url) {
    const API_ENDPOINT = 'https://4.sophosxl.net/lookup';
    const UNIQUE_ID_FILE = path.join(os.homedir(), '.sophos-sxl4-id');

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    let uniqueId = fs.existsSync(UNIQUE_ID_FILE) 
        ? fs.readFileSync(UNIQUE_ID_FILE, 'utf8').trim() 
        : null;

    if (!uniqueId || uniqueId.length !== 64) {
        const randomBytes = crypto.randomBytes(32);
        uniqueId = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        fs.writeFileSync(UNIQUE_ID_FILE, uniqueId, 'utf8');
    }

    const customerIdBytes = Buffer.from('CHROME_EXTENSION', 'utf8');
    const machineIdBytes = Buffer.from(uniqueId, 'hex').slice(0, 16);
    const credentials = Buffer.concat([
        encodeBytesField(1, customerIdBytes),
        encodeBytesField(2, machineIdBytes)
    ]);

    const productInfo = Buffer.concat([
        encodeVarintField(1, 26),
        encodeStringField(4, '1.0.0')
    ]);

    const urlKey = encodeStringField(1, url);
    const urlQuery = encodeMessageField(1, urlKey);
    const lookup = Buffer.concat([
        encodeVarintField(1, 2),
        encodeMessageField(3, urlQuery)
    ]);

    const buffer = Buffer.concat([
        encodeVarintField(1, 503307768),
        encodeVarintField(2, 2),
        encodeMessageField(3, credentials),
        encodeMessageField(4, productInfo),
        encodeMessageField(5, lookup)
    ]);

    const responseBuffer = await new Promise((resolve, reject) => {
        const req = https.request(new URL(API_ENDPOINT), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': buffer.length
            },
            timeout: 10000
        }, (res) => {
            const data = [];
            res.on('data', chunk => data.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(data);
                if (res.statusCode === 200) {
                    resolve(body);
                } else {
                    console.error('HTTP', res.statusCode);
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

        req.write(buffer);
        req.end();
    });

    const response = readSXL4Response(responseBuffer);
    const urlResponse = response.lookup?.url_results?.[0];

    if (!urlResponse || !urlResponse.category) {
        return { url, found: false };
    }

    const riskLevels = { 
        0: 'UNCLASSIFIED', 1: 'TRUSTED', 2: 'LOW', 3: 'MEDIUM', 4: 'HIGH' 
    };
    
    const securityCategories = {
        0: 'UNCATEGORIZED',
        5: 'ILLEGAL_PHISHING',
        7: 'MALWARE_DIALER_REPOSITORY',
        8: 'MALWARE_HACKING',
        9: 'MALWARE_INFECTED',
        10: 'MALWARE_RAT_REPOSITORY',
        11: 'MALWARE_REFERENCE',
        12: 'MALWARE_REPOSITORY',
        13: 'MALWARE_SPYWARE_INSTALL',
        14: 'MALWARE_SPYWARE_REPOSITORY',
        15: 'MALWARE_CALLHOME',
        40: 'PUA_DIALER',
        42: 'SPAM_CHINESE',
        43: 'SPAM_DRUGS',
        44: 'SPAM_MORTGAGE',
        45: 'SPAM_OTHER',
        46: 'SPAM_PRODUCT',
        47: 'SPAM_RUSSIAN',
        48: 'SPAM_STOCK',
        49: 'SPAM_SURVEY',
        50: 'SPAM_THAI',
        52: 'TRUSTED_UPDATE_SITE',
        53: 'PUA_ADWARE',
        54: 'PUA_SYSTEM_MONITOR',
        55: 'PUA_REMOTE_ADMIN_TOOL',
        56: 'PUA_HACKING_TOOL',
        57: 'PUA_OTHER'
    };
    
    const productivityCategories = {
        0: 'UNCATEGORIZED',
        1: 'ADVERTISEMENTS',
        2: 'ALCOHOL_AND_TOBACCO',
        3: 'ANONYMIZERS',
        4: 'AUCTIONS_AND_CLASSIFIED_ADS',
        5: 'BLOGS_AND_FORUMS',
        6: 'GENERAL_BUSINESS',
        7: 'BUSINESS_CLOUD_APPS',
        8: 'BUSINESS_NETWORKING',
        9: 'COMMAND_AND_CONTROL',
        10: 'CONTENT_DELIVERY',
        11: 'CONTROLLED_SUBSTANCES',
        12: 'CRIMINAL_ACTIVITY',
        13: 'CRL_AND_OCSP',
        14: 'DOWNLOAD_FREEWARE_AND_SHAREWARE',
        15: 'DYNAMIC_DNS_AND_ISP_SITES',
        16: 'EDUCATIONAL_INSTITUTIONS',
        17: 'ENTERTAINMENT',
        18: 'EXTREME',
        19: 'FASHION_AND_BEAUTY',
        20: 'FINANCIAL_SERVICES',
        21: 'GAMBLING',
        22: 'GAMES',
        23: 'GOVERNMENT',
        24: 'HACKING',
        25: 'HEALTH_AND_MEDICINES',
        26: 'HOBBIES',
        27: 'HUNTING_AND_FISHING',
        28: 'IMAGE_SEARCH',
        29: 'INFORMATION_TECHNOLOGY',
        30: 'INTELLECTUAL_PIRACY',
        31: 'INTOLERANCE_AND_HATE',
        32: 'JOB_SEARCH',
        33: 'KIDS_SITES',
        34: 'LEGAL_HIGHS',
        35: 'LIVE_AUDIO',
        36: 'LIVE_VIDEO',
        37: 'MARIJUANA',
        38: 'MILITANCY_AND_EXTREMIST',
        39: 'MILITARY',
        40: 'NEWLY_REGISTERED_WEBSITES',
        41: 'NEWS',
        42: 'NGOS_AND_NON_PROFITS',
        43: 'NUDITY',
        44: 'ONLINE_CHAT',
        45: 'ONLINE_SHOPPING',
        46: 'PARKED_DOMAINS',
        47: 'PEER_TO_PEER_AND_TORRENTS',
        48: 'PERSONAL_CLOUD_APPS',
        49: 'PERSONAL_NETWORK_STORAGE',
        50: 'PERSONALS_AND_DATING',
        51: 'PERSONAL_SITES',
        52: 'PHISHING_AND_FRAUD',
        53: 'PHOTO_GALLERIES',
        54: 'PLAGIARISM',
        55: 'POLITICAL_ORGANIZATION',
        56: 'PORTAL_SITES',
        57: 'PROFESSIONAL_AND_WORKERS_ORGANIZATIONS',
        58: 'PRO_SUICIDE_AND_SELF_HARM',
        59: 'RADIO_AND_AUDIO_HOSTING',
        60: 'REAL_ESTATE',
        61: 'REFERENCE',
        62: 'RELIGION_AND_SPIRITUALITY',
        63: 'RESTAURANTS_AND_DINING',
        64: 'SEARCH_ENGINES',
        65: 'SEX_EDUCATION',
        66: 'SEXUALLY_EXPLICIT',
        67: 'SOCIAL_NETWORKS',
        68: 'SOFTWARE_UPDATES',
        69: 'SPAM_URLS',
        70: 'SPORTS',
        71: 'STREAMING_AND_MEDIA_DOWNLOADS',
        72: 'SUSPICIOUS',
        73: 'TASTELESS',
        74: 'TRANSLATORS',
        75: 'TRAVEL',
        76: 'VEHICLES',
        77: 'VIDEO_SHARING',
        78: 'VIOLENCE',
        79: 'WEAPONS',
        80: 'WEBMAIL'
    };

    return {
        url,
        found: true,
        riskLevel: riskLevels[urlResponse.category.risk_level] || 'UNKNOWN',
        riskLevelNum: urlResponse.category.risk_level,
        threat: urlResponse.threat_name || null,
        securityCategory: securityCategories[urlResponse.category.security_category] || 'UNCATEGORIZED',
        securityCategoryNum: urlResponse.category.security_category,
        productivityCategory: productivityCategories[urlResponse.category.productivity_category] || 'UNCATEGORIZED',
        productivityCategoryNum: urlResponse.category.productivity_category,
        isThreat: !!urlResponse.threat_name,
        isHighRisk: urlResponse.category.risk_level === 4,
        isTrusted: urlResponse.category.risk_level === 1,
        ttl: urlResponse.ttl,
        labsUriId: urlResponse.labs_uri_id,
        statusCode: urlResponse.status_code
    };
}

module.exports = { sophos };