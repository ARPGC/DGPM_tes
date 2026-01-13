// --- CONFIGURATION ---
const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    checkSession();
});

// --- TOGGLE TABS ---
window.toggleForm = function(view) {
    const loginForm = document.getElementById('form-login');
    const signupForm = document.getElementById('form-signup');
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');

    if(view === 'login') {
        loginForm.classList.remove('hidden');
        signupForm.classList.add('hidden');
        
        tabLogin.className = "flex-1 py-2.5 rounded-lg text-sm font-bold transition-all bg-white shadow text-brand-primary";
        tabSignup.className = "flex-1 py-2.5 rounded-lg text-sm font-bold transition-all text-gray-500 hover:text-gray-700";
    } else {
        loginForm.classList.add('hidden');
        signupForm.classList.remove('hidden');
        
        tabSignup.className = "flex-1 py-2.5 rounded-lg text-sm font-bold transition-all bg-white shadow text-brand-primary";
        tabLogin.className = "flex-1 py-2.5 rounded-lg text-sm font-bold transition-all text-gray-500 hover:text-gray-700";
    }
}

// --- AUTH HANDLERS ---

// 1. SIGN UP
window.handleSignup = async function(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-signup');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Creating Account...";

    const fname = document.getElementById('reg-fname').value;
    const lname = document.getElementById('reg-lname').value;
    const email = document.getElementById('reg-email').value;
    const mobile = document.getElementById('reg-mobile').value;
    const gender = document.getElementById('reg-gender').value;
    const className = document.getElementById('reg-class').value;
    const studentId = document.getElementById('reg-sid').value;
    const password = document.getElementById('reg-pass').value;

    // 1. Sign up auth user
    const { data: authData, error: authError } = await supabaseClient.auth.signUp({
        email: email,
        password: password
    });

    if (authError) {
        showToast(authError.message, "error");
        btn.disabled = false;
        btn.innerText = originalText;
        return;
    }

    // 2. Insert into users table (Manual Insert for Reliability)
    if (authData.user) {
        const { error: dbError } = await supabaseClient.from('users').insert({
            id: authData.user.id,
            email: email,
            first_name: fname,
            last_name: lname,
            mobile: mobile,
            gender: gender,
            class_name: className,
            student_id: studentId,
            role: 'student' // Default role
        });

        if (dbError) {
            console.error("Database Insert Error:", dbError);
            showToast("Profile Error: " + dbError.message, "error");
            // If DB insert fails, the auth user still exists. 
            // Ideally, we'd delete the auth user here to cleanup, but simple error toast is safer for now.
        } else {
            showToast("Account Created! Signing in...", "success");
            setTimeout(() => {
                window.location.href = 'student.html';
            }, 1500);
        }
    }
    
    btn.disabled = false;
    btn.innerText = originalText;
}

// 2. LOG IN
window.handleLogin = async function(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-login');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Verifying...";

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-pass').value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        showToast(error.message, "error");
        btn.disabled = false;
        btn.innerText = originalText;
    } else {
        // Check Role & Redirect
        const { data: user, error: roleError } = await supabaseClient
            .from('users')
            .select('role')
            .eq('id', data.user.id)
            .single();
        
        if (roleError || !user) {
            // Profile missing fix
            console.warn("Profile missing for logged in user");
            await supabaseClient.auth.signOut();
            showToast("Account error: Profile not found. Please Sign Up again.", "error");
            btn.disabled = false;
            btn.innerText = originalText;
            return;
        }

        showToast("Welcome Back!", "success");
        setTimeout(() => {
            if (user.role === 'admin') window.location.href = 'admin.html';
            else if (user.role === 'volunteer') window.location.href = 'volunteer.html';
            else window.location.href = 'student.html';
        }, 1000);
    }
}

// --- UTILS ---
async function checkSession() {
    // Only check if we are already logged in to redirect away from login page
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        const { data: user } = await supabaseClient.from('users').select('role').eq('id', session.user.id).single();
        if (user) {
            if (user.role === 'admin') window.location.href = 'admin.html';
            else if (user.role === 'volunteer') window.location.href = 'volunteer.html';
            else window.location.href = 'student.html';
        }
    }
}

function showToast(msg, type) {
    const t = document.getElementById('toast-container');
    const txt = document.getElementById('toast-msg');
    const icon = document.getElementById('toast-icon');
    
    txt.innerText = msg;
    if (type === 'error') {
        icon.innerHTML = '<i data-lucide="alert-circle" class="w-5 h-5 text-red-400"></i>';
    } else {
        icon.innerHTML = '<i data-lucide="check-circle" class="w-5 h-5 text-green-400"></i>';
    }
    
    lucide.createIcons();
    t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
    setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10'), 3000);
}
