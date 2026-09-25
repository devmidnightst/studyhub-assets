const PRESETS = {
    classroom: { title: "Google Classroom", icon: "https://ssl.gstatic.com/classroom/favicon.ico" },
    khan:      { title: "Khan Academy",     icon: "https://www.khanacademy.org/favicon.ico" },
    docs:      { title: "Google Docs",      icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico" },
    sheets:    { title: "Google Sheets",    icon: "https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico" },
    slides:    { title: "Google Slides",    icon: "https://ssl.gstatic.com/docs/presentations/images/favicon-2023q4.ico" },
    gmail:     { title: "Inbox (1) - Gmail", icon: "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico" },
    drive:     { title: "My Drive - Google Drive", icon: "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png" },
    canvas:    { title: "Dashboard - Canvas", icon: "https://du11hjcvx0uqb.cloudfront.net/dist/images/favicon-e10d657a73.ico" },
    clever:    { title: "Clever | Log in",  icon: "https://assets.clever.com/launchpad/c64d85202/favicon.ico" },
    deltamath: { title: "DeltaMath",        icon: "https://deltamath.com/images/favicon.ico" }
};

const DEFAULT_TITLE = document.title;
const DEFAULT_ICON = document.querySelector("link[rel='icon']")?.href || "";

export function listCloaks() {
    return Object.entries(PRESETS).map(([k, v]) => ({ id: k, title: v.title }));
}

function iconEl() {
    let link = document.querySelector("link[rel='icon']");
    if (link) return link;
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
    return link;
}

export function applyCloak(id) {
    if (!id) { return reset(); }
    const p = PRESETS[id];
    if (!p) return;
    document.title = p.title;
    iconEl().href = p.icon;
    localStorage.setItem("nocturne-cloak", id);
}

export function reset() {
    document.title = DEFAULT_TITLE;
    if (DEFAULT_ICON) iconEl().href = DEFAULT_ICON;
    localStorage.removeItem("nocturne-cloak");
}

export function restoreCloak() {
    const saved = localStorage.getItem("nocturne-cloak");
    if (saved && PRESETS[saved]) applyCloak(saved);
}
