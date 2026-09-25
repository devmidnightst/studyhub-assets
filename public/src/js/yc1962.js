(function () {
    const KEY = 'cherriCreditDismissed';

    function show() {
        if (localStorage.getItem(KEY) === '1') return;
        const toast = document.getElementById('cherriCreditToast');
        if (!toast) return;
        const dismiss = () => {
            toast.classList.add('dismissing');
            setTimeout(() => {
                toast.classList.remove('visible', 'dismissing');
                localStorage.setItem(KEY, '1');
            }, 300);
        };
        toast.querySelector('.ut-close')?.addEventListener('click', dismiss);
        setTimeout(() => toast.classList.add('visible'), 1200);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
})();
