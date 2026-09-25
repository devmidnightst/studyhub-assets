async function barracuda(hostname) {
    const response = await fetch("https://www.barracudacentral.org/lookups/lookup-reputation", {
        headers: {
            "content-type": "application/x-www-form-urlencoded"
        },
        body: `lookup_entry=${hostname}&submit=Check+Reputation`,
        method: "POST"
    });
    const t = await response.text();
    if (t.includes("does not exist in our WebFilter content database.")) {
        return "Uncategorized";
    }
    const match = t.match(
        /was found under the following categories:\s*<strong>(.*?)<\/strong>/
    );
    if (!match) return "Unknown";
    return match[1]
        .split(",")
        .map(part =>
            part
                .trim()
                .split("-")
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ")
        )
        .join(", ");
}

module.exports = { barracuda };
