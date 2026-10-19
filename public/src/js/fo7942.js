// Page-load progress: a thin line on the bottom edge of the address bar.
// The interface is the one the shell already calls (start / stage / finish / fail),
// so nothing upstream changes. Progress eases toward 90% while a page loads and
// completes when it renders; everything is a transform, so it never triggers layout.

export function pegtopHTML(text = "Loading") {
    return `<div class="pegtop-stack"><div class="ll-indet" aria-hidden="true"></div><div class="pegtop-text">${text}</div></div>`;
}

class LineLoader {
    constructor(el) {
        this.el = el;
        this.p = 0;
        this.timer = 0;
        this.hideTimer = 0;
        this.visible = false;
        if (el) {
            el.innerHTML = '<div class="ll-bar"></div>';
            el.setAttribute("aria-hidden", "true");
            this.bar = el.firstChild;
        }
    }

    _set(p) {
        this.p = p;
        this.bar.style.transform = "scaleX(" + p + ")";
    }

    _clear() {
        clearInterval(this.timer);
        clearTimeout(this.hideTimer);
        this.timer = 0;
        this.hideTimer = 0;
    }

    setText() {}

    start() {
        if (!this.el) return;
        this._clear();
        this.el.classList.remove("finishing");
        this.bar.style.transition = "none";
        this._set(0);
        void this.bar.offsetWidth;
        this.bar.style.transition = "";
        this.el.classList.add("visible");
        this.visible = true;
        requestAnimationFrame(() => this._set(0.12));
        this.timer = setInterval(() => {
            if (this.p < 0.9) this._set(this.p + (0.92 - this.p) * 0.08);
        }, 350);
    }

    stage(name) {
        if (!this.visible) return;
        if (name === "loading" && this.p < 0.35) this._set(0.35);
        else if (name === "rendering" && this.p < 0.75) this._set(0.75);
    }

    finish() {
        if (!this.el || !this.visible) return;
        this._clear();
        this._set(1);
        this.hideTimer = setTimeout(() => {
            this.el.classList.add("finishing");
            this.hideTimer = setTimeout(() => {
                this.el.classList.remove("visible", "finishing");
                this.visible = false;
            }, 220);
        }, 160);
    }

    fail() {
        if (!this.el) return;
        this._clear();
        this.el.classList.remove("visible", "finishing");
        this.visible = false;
    }
}

export function mountLoader(el) {
    return new LineLoader(el);
}
