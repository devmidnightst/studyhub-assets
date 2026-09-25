const DEFAULT_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function fetchURL(url, options = {}) {
    const headers = Object.assign(
        { "User-Agent": DEFAULT_UA, "Accept": "*/*" },
        options.headers || {}
    );
    const init = Object.assign({}, options, { headers });
    return fetch(url, init);
}

module.exports = { fetchURL };
