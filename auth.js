// --- CONFIGURATION ---
const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Theme Check
    if (localStorage.getItem('urja-theme') === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('urja-theme', 'light');
    }

    // 2. Check Session (Only on login page)
    if (window.location.pathname.includes('login.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/')) {
        checkSession();
    }
});

// --- SESSION CHECK (ANTI-LOOP VERSION) ---
async function checkSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session) {
        // 1. Session exists, but does the PROFILE exist?
        const { data: user, error } = await supabaseClient
            .from('users')
            .select('role')
            .eq('id', session.user.id)
            .single();

        if (error || !user) {
            // CRITICAL FIX: Session exists, but Profile is missing.
            // This causes the loop. We must SIGN OUT to break it.
            console.warn("Session found but Profile missing. Signing out to fix loop.");
            await supabaseClient.auth.signOut();
            // Stay on login page, maybe show error
            showToast("Account error: Profile missing. Please Sign Up again.", "error");
        } else {
            // 2. Profile exists, safe to redirect
            if (user.role === 'admin') window.location.href = 'admin.html';
            else if (user.role === 'volunteer') window.location.href = 'volunteer.html';
            else window.location.href = 'student.html';
        }
    }
}

// --- 1. LOGIN LOGIC ---
async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-pass').value;

    toggleLoading(true);

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        toggleLoading(false);
        showToast(error.message, 'error');
    } else {
        // Check session again to handle redirect safely
        checkSession();
    }
}

// --- 2. SIGNUP LOGIC ---
async function handleSignup(e) {
    e.preventDefault();

    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-pass').value;
    const mobile = document.getElementById('reg-mobile').value;

    if(mobile.length < 10) {
        showToast("Please enter a valid 10-digit mobile number", 'error');
        return;
    }

    // These fields are crucial for the Trigger to work
    const metaData = {
        first_name: document.getElementById('reg-fname').value,
        last_name: document.getElementById('reg-lname').value,
        student_id: document.getElementById('reg-sid').value,
        course: document.getElementById('reg-course').value, 
        class_name: document.getElementById('reg-class').value,
        gender: document.getElementById('reg-gender').value,
        mobile: mobile,
        role: 'student'
    };

    toggleLoading(true);

    const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: { data: metaData }
    });

    toggleLoading(false);

    if (error) {
        showToast(error.message, 'error');
    } else {
        if (data.session) {
            showToast("Registration Successful! Redirecting...", 'success');
            setTimeout(() => {
                window.location.href = 'student.html';
            }, 1500);
        } else {
            showToast("Success! Please check your email to verify.", 'success');
            switchAuthView('login');
        }
    }
}

// --- 3. FORGOT PASSWORD ---
async function handleForgotPass(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;

    toggleLoading(true);

    const { data, error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/login.html'
    });

    toggleLoading(false);

    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast("Reset link sent! Check your inbox.", 'success');
        switchAuthView('login');
    }
}

// --- UTILITIES ---
function switchAuthView(viewId) {
    document.querySelectorAll('.auth-view').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById('view-' + viewId);
    target.classList.remove('hidden');
    target.classList.remove('animate-fade-in');
    void target.offsetWidth; 
    target.classList.add('animate-fade-in');
}

function togglePass(id) {
    const input = document.getElementById(id);
    const btn = input.nextElementSibling;
    if (input.type === 'password') {
        input.type = 'text';
        btn.classList.add('text-brand-primary');
    } else {
        input.type = 'password';
        btn.classList.remove('text-brand-primary');
    }
}

function toggleLoading(show) {
    const loader = document.getElementById('auth-loading');
    if (show) loader.classList.remove('hidden');
    else loader.classList.add('hidden');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const content = document.getElementById('toast-content');
    const iconSpan = document.getElementById('toast-icon');
    const textSpan = document.getElementById('toast-text');

    content.className = 'px-6 py-4 rounded-2xl shadow-2xl font-bold text-sm flex items-center gap-3 backdrop-blur-md border';

    if (type === 'success') {
        content.classList.add('bg-green-500/90', 'text-white', 'border-green-400/30');
        iconSpan.innerHTML = `<i data-lucide="check-circle-2" class="w-5 h-5"></i>`;
    } else if (type === 'error') {
        content.classList.add('bg-red-500/90', 'text-white', 'border-red-400/30');
        iconSpan.innerHTML = `<i data-lucide="alert-circle" class="w-5 h-5"></i>`;
    } else {
        content.classList.add('bg-gray-800/90', 'text-white', 'border-gray-700/30');
        iconSpan.innerHTML = `<i data-lucide="info" class="w-5 h-5"></i>`;
    }

    textSpan.innerText = message;
    if(window.lucide) lucide.createIcons();

    container.classList.remove('opacity-0', 'pointer-events-none');
    setTimeout(() => {
        container.classList.add('opacity-0', 'pointer-events-none');
    }, 3500);
}
