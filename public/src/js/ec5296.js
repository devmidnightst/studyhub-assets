const form = document.getElementById("supportForm");
const subjectIn = document.getElementById("supportSubject");
const bodyIn = document.getElementById("supportBody");
const errEl = document.getElementById("supportErr");
const submitBtn = document.getElementById("supportSubmit");

form.addEventListener("submit", async e => {
    e.preventDefault();
    errEl.classList.remove("ok");
    errEl.textContent = "";

    const subject = subjectIn.value.trim();
    const body = bodyIn.value.trim();
    if (!body) { errEl.textContent = "Message body required."; return; }

    submitBtn.disabled = true;
    submitBtn.classList.add("is-sending");
    setTimeout(() => submitBtn.classList.add("is-sent"), 600);

    try {
        const r = await fetch("/api/support/message", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject, body })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        errEl.classList.add("ok");
        errEl.textContent = "Message sent.";
        subjectIn.value = "";
        bodyIn.value = "";
        setTimeout(() => {
            submitBtn.classList.remove("is-sending", "is-sent");
            submitBtn.disabled = false;
        }, 3500);
    } catch (e) {
        errEl.textContent = e.message;
        submitBtn.classList.remove("is-sending", "is-sent");
        submitBtn.disabled = false;
    }
});
