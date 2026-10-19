

(function () {
    const VERSION = 'v2-prebeta';
    const TOAST_KEY = 'updateDismissed_' + VERSION;
    const ONBOARDED_KEY = 'nocturne-onboarded';

    function showToast() {
        if (localStorage.getItem(TOAST_KEY) === '1') return;
        const toast = document.getElementById('updateToast');
        if (!toast) return;
        const dismiss = () => {
            toast.classList.add('dismissing');
            setTimeout(() => {
                toast.classList.remove('visible', 'dismissing');
                localStorage.setItem(TOAST_KEY, '1');
            }, 300);
        };
        toast.querySelector('.ut-close').addEventListener('click', dismiss);
        setTimeout(() => toast.classList.add('visible'), 800);
    }

    if (localStorage.getItem(ONBOARDED_KEY) === '1') {
        showToast();
    } else {
        window.addEventListener('nocturne:onboarded', () => setTimeout(showToast, 250), { once: true });
    }
})();
