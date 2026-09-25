async function dnsfilter(url) {
    const apiKey = String(process.env.DNSFILTER_API_KEY || "").trim();
    if (!apiKey) {
        throw new Error("Missing DNSFILTER_API_KEY");
    }

    let categoriesList = [{"text":"Abortion","value":1},{"text":"Adult Content","value":2},{"text":"Alcohol & Tobacco","value":4},{"text":"Blogs & Personal Sites","value":5},{"text":"Business","value":6},{"text":"Contentious & Misinformation","value":73},{"text":"Dating & Personals","value":8},{"text":"Drugs","value":9},{"text":"Economy & Finance","value":10},{"text":"Education & Self Help","value":11},{"text":"Entertainment","value":12},{"text":"Food & Recipes","value":13},{"text":"Gambling","value":14},{"text":"Games","value":15},{"text":"Generative AI Tools","value":77},{"text":"Government","value":70},{"text":"Hacking & Cracking","value":16},{"text":"Health","value":17},{"text":"Humor","value":18},{"text":"Information Technology","value":19},{"text":"Jobs & Careers","value":20},{"text":"Media Sharing","value":21},{"text":"Message Boards & Forums","value":22},{"text":"News & Media","value":23},{"text":"P2P & Illegal","value":39},{"text":"Real Estate","value":26},{"text":"Religion","value":27},{"text":"Search Engines & Portals","value":28},{"text":"Self Harm","value":81},{"text":"Shopping","value":29},{"text":"Social Networking","value":30},{"text":"Sports","value":31},{"text":"Streaming Media","value":32},{"text":"Terrorism & Hate","value":68},{"text":"Travel","value":34},{"text":"Vehicles","value":36},{"text":"Virtual Reality","value":37},{"text":"Weapons","value":38},{"text":"Webmail & Chat","value":7}]
    let blockedList = [2,16,25,33,39,52,54,55,56,66,67,68,69,72,74,75,76,84,37,38,7,30,81,29,27,22,21,18,14,15,77,12,8,9,73,4,5]
    return fetch("https://api.dnsfilter.com/v1/domains/user_lookup?fqdn="+url, {
        "headers": {
            "accept": "application/json, text/plain, */*",
            "authorization": "Bearer " + apiKey,
        },
        "referrer": "https://app.dnsfilter.com/",
        "method": "GET",
    }).then(res => res.json()).then(json => {
        let blocked = false;
        let categories = [];
        for (const jsobj of json.data.relationships.categories.data) {
            if (jsobj.type === "categories") {
                if (jsobj.id.includes("-")) {
                    return {
                        category: "Uncategorized",
                        blocked: true
                    }
                }
                const categoryId = Number(jsobj.id);
                categories.push((categoriesList.find(item => item.value === categoryId) ?? { text: "Unknown", value: null }).text);
                if (blockedList.includes(categoryId)) {
                    blocked = true;
                }
            }
        }
        return {
            category: categories.join(", "),
            blocked: blocked
        }
    });
}

module.exports = {dnsfilter};
