(function () {
    "use strict";
    if (window.__nocSelectInit) return;
    window.__nocSelectInit = true;

    const CARET = '<svg class="noc-select-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

    let openRec = null;

    function closeOpen() {
        if (!openRec) return;
        openRec.wrap.classList.remove("open");
        openRec.menu.classList.remove("open");
        openRec.trigger.setAttribute("aria-expanded", "false");
        window.removeEventListener("scroll", onAnyScroll, true);
        window.removeEventListener("resize", onWinResize);
        openRec = null;
    }

    function onAnyScroll(e) {
        if (!openRec) return;
        const m = openRec.menu;

        if (e && e.target && e.target.nodeType === 1 && (e.target === m || m.contains(e.target))) return;
        const r = openRec.trigger.getBoundingClientRect();

        if (r.bottom <= 0 || r.top >= window.innerHeight) { closeOpen(); return; }
        if (openRec.place) openRec.place();
    }

    function onWinResize() {
        if (!openRec) return;
        if (openRec.place) openRec.place();
    }

    document.addEventListener("mousedown", (e) => {
        if (openRec && !openRec.wrap.contains(e.target) && !openRec.menu.contains(e.target)) closeOpen();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && openRec) { const t = openRec.trigger; closeOpen(); t.focus(); }
    });

    function buildMenu(select, menu) {
        menu.innerHTML = "";
        const frag = document.createDocumentFragment();
        const addOption = (opt, container) => {
            const item = document.createElement("div");
            item.className = "noc-select-opt";
            item.setAttribute("role", "option");
            item.dataset.value = opt.value;
            item.textContent = opt.textContent;
            if (opt.disabled) item.classList.add("disabled");
            if (opt.selected) { item.classList.add("selected"); item.setAttribute("aria-selected", "true"); }
            container.appendChild(item);
        };
        for (const node of select.children) {
            if (node.tagName === "OPTGROUP") {
                const group = document.createElement("div");
                group.className = "noc-select-group";
                const lbl = document.createElement("div");
                lbl.className = "noc-select-grouplabel";
                lbl.textContent = node.label || "";
                group.appendChild(lbl);
                for (const o of node.children) if (o.tagName === "OPTION") addOption(o, group);
                frag.appendChild(group);
            } else if (node.tagName === "OPTION") {
                addOption(node, frag);
            }
        }
        menu.appendChild(frag);
    }

    function syncLabel(select, label) {
        const opt = select.options[select.selectedIndex];
        label.textContent = opt ? opt.textContent : "";
    }

    function enhance(select) {
        if (!select || select._nocEnhanced) return;
        if (select.multiple) return;
        if (select.hasAttribute("data-noc-skip")) return;
        select._nocEnhanced = true;

        const wrap = document.createElement("div");
        wrap.className = "noc-select";

        const trigger = document.createElement("div");
        trigger.className = "noc-select-trigger" + (select.className ? " " + select.className : "");
        trigger.setAttribute("role", "button");
        trigger.tabIndex = select.disabled ? -1 : 0;
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        if (select.title) trigger.title = select.title;

        const label = document.createElement("span");
        label.className = "noc-select-label";
        trigger.appendChild(label);
        trigger.insertAdjacentHTML("beforeend", CARET);

        const menu = document.createElement("div");
        menu.className = "noc-select-menu";
        menu.setAttribute("role", "listbox");

        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(trigger);
        wrap.appendChild(select);
        select.classList.add("noc-select-native");
        document.body.appendChild(menu);

        buildMenu(select, menu);
        syncLabel(select, label);

        const refresh = () => {
            buildMenu(select, menu);
            syncLabel(select, label);
            // Mirror state that can be toggled after enhancement (e.g. a plan change
            // locking the AI model picker) onto the visible trigger.
            trigger.classList.toggle("noc-select-disabled", !!select.disabled);
            trigger.tabIndex = select.disabled ? -1 : 0;
            if (select.title) trigger.title = select.title;
            if (select.disabled && openRec && openRec.wrap === wrap) closeOpen();
        };
        select._nocRefresh = refresh;
        new MutationObserver(refresh).observe(select, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ["disabled", "title"]
        });
        select.addEventListener("change", () => syncLabel(select, label));

        const clearActive = () => menu.querySelectorAll(".noc-select-opt.active").forEach(x => x.classList.remove("active"));

        function place() {
            if (!trigger.isConnected) { closeOpen(); return; }
            const r = trigger.getBoundingClientRect();
            menu.style.minWidth = r.width + "px";
            const mw = menu.offsetWidth;
            const mh = menu.offsetHeight;
            let left = r.left;
            if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - mw);
            let top = r.bottom + 6;
            if (top + mh > window.innerHeight - 8 && r.top - 6 - mh > 8) top = r.top - 6 - mh;
            menu.style.left = left + "px";
            menu.style.top = top + "px";
        }

        function openIt() {
            if (select.disabled) return;   // a disabled <select> must not open the custom menu either
            if (openRec && openRec.wrap !== wrap) closeOpen();
            wrap.classList.add("open");
            menu.classList.add("open");
            trigger.setAttribute("aria-expanded", "true");
            place();
            openRec = { wrap, trigger, menu, place };
            window.addEventListener("scroll", onAnyScroll, true);
            window.addEventListener("resize", onWinResize);
            clearActive();
            const sel = menu.querySelector(".noc-select-opt.selected");
            if (sel) { sel.classList.add("active"); sel.scrollIntoView({ block: "nearest" }); }
        }

        function moveActive(dir) {
            const items = [...menu.querySelectorAll(".noc-select-opt:not(.disabled)")];
            if (!items.length) return;
            let i = items.findIndex(x => x.classList.contains("active"));
            i = i < 0 ? (dir > 0 ? 0 : items.length - 1) : i + dir;
            if (i < 0) i = items.length - 1;
            if (i >= items.length) i = 0;
            clearActive();
            items[i].classList.add("active");
            items[i].scrollIntoView({ block: "nearest" });
        }

        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            if (wrap.classList.contains("open")) closeOpen();
            else openIt();
        });

        trigger.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!wrap.classList.contains("open")) openIt();
                else moveActive(e.key === "ArrowDown" ? 1 : -1);
            } else if (e.key === "Enter" || e.key === " ") {
                if (wrap.classList.contains("open")) {
                    e.preventDefault();
                    const act = menu.querySelector(".noc-select-opt.active");
                    if (act) act.click();
                } else {
                    e.preventDefault();
                    openIt();
                }
            }
        });

        menu.addEventListener("click", (e) => {
            const item = e.target.closest(".noc-select-opt");
            if (!item || item.classList.contains("disabled")) return;
            const val = item.dataset.value;
            if (select.value !== val) {
                select.value = val;
                select.dispatchEvent(new Event("input", { bubbles: true }));
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }
            menu.querySelectorAll(".noc-select-opt.selected").forEach(x => { x.classList.remove("selected"); x.removeAttribute("aria-selected"); });
            item.classList.add("selected");
            item.setAttribute("aria-selected", "true");
            syncLabel(select, label);
            closeOpen();
            trigger.focus();
        });
    }

    function enhanceAll(root) {
        (root || document).querySelectorAll("select:not(.noc-select-native)").forEach(enhance);
    }

    function init() {
        enhanceAll(document);
        new MutationObserver((muts) => {
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (n.tagName === "SELECT") enhance(n);
                    else if (n.querySelectorAll) n.querySelectorAll("select:not(.noc-select-native)").forEach(enhance);
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();

    window.NocturneSelect = { enhance, enhanceAll };
})();
