const https = require('https');
const { URLSearchParams } = require('url');

async function qustodio(hostname) {
  const CLIENT_ID = '264ca1d226906aa08b03';
  const CLIENT_SECRET = '3e8826cbed3b996f8b206c7d6a4b2321529bc6bd';
  const QUSTODIO_USERNAME = 'zinko@catsy.org';
  const QUSTODIO_PASSWORD = 'iLOVEqustodio!123';
  
  const CATEGORIES = {
    1: 'Alcohol', 2: 'Chat', 3: 'Drugs', 4: 'Educational', 5: 'Employment',
    6: 'Entertainment', 7: 'Gambling', 8: 'Games', 9: 'Government', 10: 'Health',
    12: 'Mature Content', 13: 'News', 14: 'Pornography', 15: 'Profanity',
    16: 'Religion', 17: 'Search Portals', 18: 'Shopping', 19: 'Social Network',
    20: 'Sports', 21: 'Tobacco', 22: 'Travel', 23: 'Violence', 24: 'Weapons',
    25: 'Webmail', 26: 'Business', 27: 'Technology', 28: 'File Sharing',
    29: 'Proxies/Loopholes', 30: 'Forums', 31: 'AI', 40: 'Safety Net'
  };
  
  const RISKY_CATEGORIES = [1, 2, 3, 6, 7, 8, 12, 14, 15, 19, 21, 23, 24, 29, 30, 31];

  const makeRequest = (url, options = {}) => new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });

    if (!QUSTODIO_USERNAME || !QUSTODIO_PASSWORD) {
      throw new Error('Set QUSTODIO_USERNAME and QUSTODIO_PASSWORD environment variables');
    }

    const params = new URLSearchParams({
      grant_type: 'password',
      username: QUSTODIO_USERNAME,
      password: QUSTODIO_PASSWORD,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    });

    const authResponse = await makeRequest('https://api.qustodio.com/v1/oauth2/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params.toString())
      },
      body: params.toString()
    });

    if (authResponse.status !== 200) {
      throw new Error(`Authentication failed: ${JSON.stringify(authResponse.data)}`);
    }

  const url = `https://api.qustodio.com/v1/sites/classification?hostname=${encodeURIComponent(hostname)}`;
  const response = await makeRequest(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${authResponse.data.access_token}`,
      'Content-Type': 'application/json'
    }
  });

  if (response.status === 404 && response.data && response.data.detail === 'Not found.') {
    return {
      hostname,
      category: 'Uncategorized',
      id: null,
      blocked: false
    };
  }

  if (response.status !== 200) {
    throw new Error(`Classification check failed: ${JSON.stringify(response.data)}`);
  }

  const rawData = response.data;
  const categoryId = rawData.categories && rawData.categories.length > 0 ? rawData.categories[0] : null;
  const categoryName = categoryId ? (CATEGORIES[categoryId] || 'Unknown') : 'Uncategorized';
  const isBlocked = categoryId ? RISKY_CATEGORIES.includes(categoryId) : false;

  return {
    hostname: rawData.hostname,
    category: categoryName,
    id: categoryId,
    blocked: isBlocked
  };
}
module.exports = { qustodio };
