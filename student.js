// ==========================================
// URJA 2026 - STUDENT PORTAL CONTROLLER
// ==========================================

// --- CONFIGURATION & CLIENTS ---

// Safety Check
if (typeof CONFIG === 'undefined' || typeof CONFIG_REALTIME === 'undefined') {
    console.error("CRITICAL: Config missing. Ensure config.js and config2.js are loaded.");
}

// 1. MAIN PROJECT (Auth, Teams, Registrations - Write Access)
const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// 2. REALTIME PROJECT (Live Scores & Results - Read Only)
const realtimeClient = window.supabase.createClient(CONFIG_REALTIME.url, CONFIG_REALTIME.anonKey);

// --- STATE MANAGEMENT ---
let currentUser = null;
let myRegistrations = []; 
let currentScheduleView = 'upcoming'; 
let allSportsList = [];
let liveSubscription = null;

const DEFAULT_TEAM_SIZE = 5;
const TOURNAMENT_CAP = 64; 
const DEFAULT_AVATAR = "https://t4.ftcdn.net/jpg/05/89/93/27/360_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.jpg";

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    if(window.lucide) lucide.createIcons();
    initTheme();
    injectToastContainer();
    setupImageUpload(); 
    setupTabSystem();
    setupConfirmModal(); 
    
    await checkAuth();
    
    // Start Realtime Listener
    setupRealtimeSubscription();
    
    // Default Tab
    window.switchTab('dashboard');
});

// --- 1. THEME LOGIC ---
function initTheme() {
    const savedTheme = localStorage.getItem('urja-theme');
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
        updateThemeIcon(true);
    } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('urja-theme', 'light'); 
        updateThemeIcon(false);
    }
}

window.toggleTheme = function() {
    const html = document.documentElement;
    const isDark = html.classList.toggle('dark');
    localStorage.setItem('urja-theme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
}

function updateThemeIcon(isDark) {
    const btn = document.getElementById('btn-theme-toggle');
    if(btn) {
        btn.innerHTML = isDark 
            ? '<i data-lucide="sun" class="w-5 h-5 text-yellow-400"></i>' 
            : '<i data-lucide="moon" class="w-5 h-5 text-gray-600 dark:text-gray-300"></i>';
        if(window.lucide) lucide.createIcons();
    }
}

// --- 2. AUTHENTICATION & PROFILE ---
async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (!session) {
        window.location.href = 'login.html';
        return;
    }
    
    const { data: profile, error } = await supabaseClient
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();

    if (error || !profile) {
        window.location.href = 'login.html';
        return;
    }

    currentUser = profile;
    updateProfileUI();
    await fetchMyRegistrations();
    loadUserStats();
}

function updateProfileUI() {
    const avatarUrl = currentUser.avatar_url || DEFAULT_AVATAR;
    
    const headerImg = document.getElementById('header-avatar');
    if(headerImg) headerImg.src = avatarUrl;

    const imgEl = document.getElementById('profile-img');
    const nameEl = document.getElementById('profile-name');
    const nameDisplay = document.getElementById('profile-name-display');
    const detailsEl = document.getElementById('profile-details');

    if(imgEl) imgEl.src = avatarUrl;
    if(nameEl) nameEl.innerText = `${currentUser.first_name} ${currentUser.last_name}`;
    if(nameDisplay) nameDisplay.innerText = `${currentUser.first_name} ${currentUser.last_name}`;
    if(detailsEl) detailsEl.innerText = `${currentUser.class_name || 'N/A'} • ${currentUser.student_id || 'N/A'}`;
}

// --- PROFILE IMAGE UPLOAD ---
function setupImageUpload() {
    const input = document.getElementById('file-upload-input');
    const trigger = document.getElementById('profile-img-container'); 
    
    if(trigger && input) {
        trigger.onclick = () => input.click();
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if(!file) return;
            
            showToast("Uploading...", "info");
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('upload_preset', CONFIG.cloudinaryUploadPreset); 
            
            try {
                const res = await fetch(`https://api.cloudinary.com/v1_1/${CONFIG.cloudinaryCloudName}/image/upload`, {
                    method: 'POST', body: formData
                });
                const data = await res.json();
                
                if(data.secure_url) {
                    await supabaseClient.from('users').update({ avatar_url: data.secure_url }).eq('id', currentUser.id);
                    currentUser.avatar_url = data.secure_url;
                    updateProfileUI();
                    showToast("Profile Photo Updated!", "success");
                }
            } catch(err) {
                showToast("Upload Failed", "error");
                console.error(err);
            }
        };
    }
}

async function fetchMyRegistrations() {
    const { data } = await supabaseClient.from('registrations').select('sport_id').eq('user_id', currentUser.id);
    if(data) {
        myRegistrations = data.map(r => r.sport_id);
    }
}

async function loadUserStats() {
    const { count: matches } = await supabaseClient.from('registrations')
        .select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);

    const { count: wins } = await supabaseClient.from('registrations')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', currentUser.id).eq('player_status', 'Won');

    const statEl = document.getElementById('stat-matches-played');
    if(statEl) statEl.innerText = matches || 0;
    
    const dashStats = document.getElementById('dashboard-stats-container');
    if(dashStats) {
        dashStats.innerHTML = `
            <div class="grid grid-cols-2 gap-4 mb-6">
                <div class="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center">
                    <div class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Events Joined</div>
                    <div class="text-2xl font-black text-brand-primary dark:text-indigo-400 mt-1">${matches || 0}</div>
                </div>
                <div class="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center">
                    <div class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Victories</div>
                    <div class="text-2xl font-black text-yellow-500 mt-1">${wins || 0}</div>
                </div>
            </div>
        `;
    }
}

window.logout = async function() {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

// --- 3. NAVIGATION ---
function setupTabSystem() {
    window.switchTab = function(tabId) {
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        
        const targetView = document.getElementById('view-' + tabId);
        if(targetView) {
            targetView.classList.remove('hidden');
            targetView.classList.remove('animate-fade-in');
            void targetView.offsetWidth; 
            targetView.classList.add('animate-fade-in');
        }
        
        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.remove('active', 'text-brand-primary');
            el.classList.add('text-gray-400', 'dark:text-gray-500');
        });
        
        const activeNav = document.getElementById('nav-' + tabId);
        if(activeNav) {
            activeNav.classList.add('active', 'text-brand-primary');
            activeNav.classList.remove('text-gray-400', 'dark:text-gray-500');
        }

        if(tabId === 'dashboard') loadDashboard();
        if(tabId === 'register') window.toggleRegisterView('new');
        if(tabId === 'teams') window.toggleTeamView('marketplace');
        if(tabId === 'schedule') window.filterSchedule('upcoming');
        if(tabId === 'profile') window.loadProfileGames();
    }
}

// --- 4. DASHBOARD (REALTIME + MAIN DB) ---
async function loadDashboard() {
    // 1. Live Matches (Realtime DB - High Priority - Top of Dash)
    loadLiveMatches();
    
    // 2. Upcoming Matches (Main DB - Safe Fallback)
    loadUpcomingDashboard();
    
    // 3. Champions (Realtime DB - 3 Winners)
    loadLatestChampions();
}

// A. LIVE MATCHES
async function loadLiveMatches() {
    const container = document.getElementById('live-matches-container');
    const list = document.getElementById('live-matches-list');
    
    if(!container || !list) return;

    // Fetch from the Realtime DB table 'live_matches'
    const { data: matches } = await realtimeClient
        .from('live_matches')
        .select('*')
        .eq('status', 'Live')
        .order('updated_at', { ascending: false });

    // Show/Hide container based on data presence
    if (!matches || matches.length === 0) {
        container.classList.add('hidden'); 
        return;
    }

    container.classList.remove('hidden');
    
    list.innerHTML = matches.map(m => `
        <div onclick="openMatchDetails('${m.original_match_id}')" class="bg-white dark:bg-gray-800 p-5 rounded-3xl border border-red-100 dark:border-red-900/30 shadow-lg shadow-red-50/50 relative overflow-hidden mb-4 animate-fade-in cursor-pointer active:scale-[0.98] transition-transform">
            <div class="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl animate-pulse flex items-center gap-1 z-10">
                <span class="w-1.5 h-1.5 bg-white rounded-full"></span> LIVE
            </div>
            
            <div class="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-4 opacity-80">${m.sport_name}</div>
            
            <div class="flex items-center justify-between gap-2 relative z-0">
                <div class="text-left w-5/12">
                    <h3 class="font-black text-lg text-gray-900 dark:text-white leading-tight truncate">${m.team1_name}</h3>
                    <p class="text-3xl font-black text-gray-900 dark:text-white mt-1 tracking-tight">${m.score1 || 0}</p>
                </div>
                
                <div class="text-center w-2/12">
                    <div class="text-[10px] font-bold text-gray-300 bg-gray-50 dark:bg-gray-700 rounded-full w-8 h-8 flex items-center justify-center mx-auto">VS</div>
                </div>
                
                <div class="text-right w-5/12">
                    <h3 class="font-black text-lg text-gray-900 dark:text-white leading-tight truncate">${m.team2_name}</h3>
                    <p class="text-3xl font-black text-gray-900 dark:text-white mt-1 tracking-tight">${m.score2 || 0}</p>
                </div>
            </div>
            
            <div class="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center text-xs text-gray-400 font-bold">
                <span class="flex items-center gap-1.5"><i data-lucide="map-pin" class="w-3.5 h-3.5 text-gray-300"></i> ${m.location || 'Main Ground'}</span>
                <span class="bg-gray-50 dark:bg-gray-700/50 px-2 py-0.5 rounded text-[10px] uppercase">Round ${m.round_number || 1}</span>
            </div>
        </div>
    `).join('');
    
    if(window.lucide) lucide.createIcons();
}

// B. UPCOMING (MAIN DB)
async function loadUpcomingDashboard() {
    const list = document.getElementById('upcoming-matches-list');
    if(!list) return;

    const { data: matches } = await supabaseClient
        .from('matches')
        .select('*, sports(name, icon)')
        .eq('status', 'Scheduled')
        .order('start_time', { ascending: true })
        .limit(3);

    if(!matches || matches.length === 0) {
        list.innerHTML = '<div class="text-xs text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 text-center border border-dashed border-gray-200 dark:border-gray-700">No upcoming matches scheduled.</div>';
        return;
    }

    list.innerHTML = matches.map(m => `
        <div onclick="openMatchDetails('${m.id}')" class="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center justify-between cursor-pointer active:scale-[0.98] transition-transform">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-brand-primary dark:text-indigo-400 shrink-0">
                    <i data-lucide="${m.sports.icon || 'calendar'}" class="w-5 h-5"></i>
                </div>
                <div>
                    <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wide">${m.sports.name}</div>
                    <div class="font-bold text-sm text-gray-900 dark:text-white mt-0.5 leading-tight w-40 truncate">${m.team1_name} vs ${m.team2_name}</div>
                </div>
            </div>
            <div class="text-right">
                <div class="text-[10px] font-bold text-gray-400 uppercase">${new Date(m.start_time).toLocaleString('default', { weekday: 'short' })}</div>
                <div class="text-sm font-black text-gray-900 dark:text-white">${new Date(m.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
            </div>
        </div>
    `).join('');
    
    if(window.lucide) lucide.createIcons();
}

// C. CHAMPIONS (REALTIME DB)
async function loadLatestChampions() {
    let container = document.getElementById('home-champions-list'); 
    if (!container) return;

    const { data: matches } = await realtimeClient
        .from('live_matches')
        .select('*')
        .eq('status', 'Completed')
        .not('winners_data', 'is', null) 
        .order('updated_at', { ascending: false })
        .limit(5);

    if(!matches || matches.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-400 italic text-center py-4">No results declared yet.</p>';
        return;
    }

    container.innerHTML = matches.map(m => {
        const w = m.winners_data || {};
        return `
        <div class="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm relative overflow-hidden mb-3">
            <div class="flex justify-between items-center mb-2 border-b border-gray-50 dark:border-gray-700 pb-2">
                <span class="text-xs font-black text-gray-400 uppercase tracking-widest">${m.sport_name}</span>
                <span class="text-[9px] bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-2 py-0.5 rounded font-bold">Finished</span>
            </div>
            <div class="space-y-1">
                ${w.gold ? `<div class="flex items-center gap-2 text-xs font-bold"><span class="text-lg">🥇</span> <span class="text-gray-800 dark:text-gray-200">${w.gold}</span></div>` : ''}
                ${w.silver ? `<div class="flex items-center gap-2 text-xs font-bold"><span class="text-lg">🥈</span> <span class="text-gray-600 dark:text-gray-400">${w.silver}</span></div>` : ''}
                ${w.bronze ? `<div class="flex items-center gap-2 text-xs font-bold"><span class="text-lg">🥉</span> <span class="text-gray-500 dark:text-gray-500">${w.bronze}</span></div>` : ''}
            </div>
        </div>
    `}).join('');
}

// --- 5. REALTIME SUBSCRIPTION ---
function setupRealtimeSubscription() {
    if (liveSubscription) return; 

    // Listening to changes on the 'live_matches' table in the Realtime Database
    liveSubscription = realtimeClient
        .channel('public:live_matches')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches' }, (payload) => {
            const newData = payload.new;
            const eventType = payload.eventType;

            console.log("Realtime Update:", eventType, newData);

            if (eventType === 'DELETE') {
                // If a live match is deleted, refresh dashboard to remove it
                loadLiveMatches();
            } else if (newData) {
                if (newData.status === 'Live') {
                    // Update the live card at the top immediately
                    loadLiveMatches();
                    showToast(`⚡ UPDATE: ${newData.sport_name} Score Changed!`, "info");
                } else if (newData.status === 'Completed') {
                    // Refresh both live (to remove) and champions (to add)
                    loadLiveMatches();
                    loadLatestChampions();
                    showToast(`🏆 RESULT: ${newData.sport_name} Finished!`, "success");
                }
            }
        })
        .subscribe();
}

// --- 6. SCHEDULE MODULE (Existing) ---
window.filterSchedule = function(view) {
    currentScheduleView = view;
    
    const btnUp = document.getElementById('btn-schedule-upcoming');
    const btnRes = document.getElementById('btn-schedule-results');
    
    if(btnUp && btnRes) {
        if(view === 'upcoming') {
            btnUp.className = "flex-1 py-2.5 rounded-lg text-xs font-bold transition-all bg-white dark:bg-gray-700 shadow-sm text-brand-primary dark:text-white";
            btnRes.className = "flex-1 py-2.5 rounded-lg text-xs font-bold transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200";
        } else {
            btnUp.className = "flex-1 py-2.5 rounded-lg text-xs font-bold transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200";
            btnRes.className = "flex-1 py-2.5 rounded-lg text-xs font-bold transition-all bg-white dark:bg-gray-700 shadow-sm text-brand-primary dark:text-white";
        }
    }
    loadSchedule();
}

async function loadSchedule() {
    const container = document.getElementById('schedule-list');
    container.innerHTML = '<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary mx-auto"></div>';

    const { data: matches } = await supabaseClient
        .from('matches')
        .select('*, sports(name, icon, type, is_performance)')
        .order('start_time', { ascending: false });

    if (!matches || matches.length === 0) {
        container.innerHTML = `
            <div class="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-3">
                <i data-lucide="calendar-off" class="w-8 h-8 text-gray-400"></i>
            </div>
            <p class="text-gray-400 font-medium">No matches found.</p>`;
        lucide.createIcons();
        return;
    }

    let filteredMatches = [];
    if(currentScheduleView === 'upcoming') {
        filteredMatches = matches.filter(m => ['Upcoming', 'Scheduled', 'Live'].includes(m.status));
    } else {
        filteredMatches = matches.filter(m => m.status === 'Completed');
    }

    if (filteredMatches.length === 0) {
        container.innerHTML = `<p class="text-gray-400 font-medium text-center py-6">No ${currentScheduleView} matches.</p>`;
        return;
    }

    container.innerHTML = filteredMatches.map(m => {
        const isLive = m.status === 'Live';
        const isPerf = m.sports.is_performance;
        
        const dateObj = new Date(m.start_time);
        const timeStr = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const dateStr = dateObj.toLocaleDateString([], {month: 'short', day: 'numeric'});

        let badgeHtml = isLive 
            ? `<span class="bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider animate-pulse flex items-center gap-1"><span class="w-1.5 h-1.5 bg-red-500 rounded-full"></span> LIVE</span>`
            : `<span class="bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">${dateStr} • ${timeStr}</span>`;

        let footerText = '';
        if(m.status === 'Completed') {
            if(m.winners_data && m.winners_data.gold) {
                footerText = `<span class="text-yellow-600 flex items-center gap-1">🥇 ${m.winners_data.gold}</span>`;
            } else {
                footerText = m.winner_text || `Winner: ${m.winner_id ? 'Determined' : 'TBA'}`;
            }
        } else {
            footerText = isPerf ? 'Entries Open' : `${m.score1 || 0} - ${m.score2 || 0}`;
        }

        return `
        <div 
            onclick="window.openMatchDetails('${m.id}')"
            class="w-full bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-5 shadow-sm relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
        >
            <div class="flex justify-between items-start mb-4">
                ${badgeHtml}
                <span class="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase">${m.sports.name}</span>
            </div>
            
            ${isPerf ? 
                `<div class="text-center py-2">
                    <h4 class="font-black text-lg text-gray-900 dark:text-white">${m.team1_name}</h4>
                    <p class="text-xs text-gray-400 mt-1">Event Details</p>
                 </div>`
            : 
                `<div class="flex items-center justify-between w-full mb-4">
                    <div class="flex-1 text-left">
                        <h4 class="font-bold text-base text-gray-900 dark:text-white leading-tight">${m.team1_name}</h4>
                    </div>
                    <div class="shrink-0 px-3">
                        <span class="text-[10px] font-bold text-gray-300">VS</span>
                    </div>
                    <div class="flex-1 text-right">
                        <h4 class="font-bold text-base text-gray-900 dark:text-white leading-tight">${m.team2_name}</h4>
                    </div>
                </div>`
            }

            <div class="border-t border-gray-50 dark:border-gray-700 pt-3 flex justify-between items-center">
                <span class="font-mono text-sm font-bold text-brand-primary dark:text-indigo-400">${footerText}</span>
                <span class="text-[10px] font-bold text-gray-400 flex items-center gap-1">Details <i data-lucide="chevron-right" class="w-3 h-3"></i></span>
            </div>
        </div>
        `;
    }).join('');
    
    lucide.createIcons();
}

window.openMatchDetails = async function(matchId) {
    const { data: match } = await supabaseClient.from('matches').select('*, sports(name, is_performance, unit)').eq('id', matchId).single();
    if(!match) return;

    const isPerf = match.sports.is_performance;

    document.getElementById('md-sport-name').innerText = match.sports.name;
    document.getElementById('md-match-status').innerText = match.status;

    document.getElementById('md-layout-team').classList.add('hidden');
    document.getElementById('md-layout-race').classList.add('hidden');

    if (!isPerf) {
        document.getElementById('md-layout-team').classList.remove('hidden');
        document.getElementById('md-t1-name').innerText = match.team1_name;
        document.getElementById('md-t2-name').innerText = match.team2_name;
        document.getElementById('md-t1-score').innerText = match.score1 || '0';
        document.getElementById('md-t2-score').innerText = match.score2 || '0';
        document.getElementById('md-list-t1-title').innerText = match.team1_name;
        document.getElementById('md-list-t2-title').innerText = match.team2_name;
        loadSquadList(match.team1_id, 'md-list-t1');
        loadSquadList(match.team2_id, 'md-list-t2');
    } else {
        document.getElementById('md-layout-race').classList.remove('hidden');
        document.getElementById('md-race-metric-header').innerText = match.sports.unit || 'Result';

        const tbody = document.getElementById('md-race-tbody');
        tbody.innerHTML = '';
        
        let results = match.performance_data || [];

        if (!results || results.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="px-4 py-8 text-center text-gray-400 italic">No results available yet.</td></tr>';
        } else {
            results.sort((a, b) => {
                if (a.rank && b.rank) return a.rank - b.rank;
                const valA = parseFloat(a.result) || 999999;
                const valB = parseFloat(b.result) || 999999;
                return valA - valB;
            });

            tbody.innerHTML = results.map((r, index) => {
                let displayRank = r.rank || (index + 1);
                let rankIcon = displayRank === 1 ? '🥇' : displayRank === 2 ? '🥈' : displayRank === 3 ? '🥉' : displayRank;

                return `
                <tr class="bg-white dark:bg-gray-800 border-b dark:border-gray-700">
                    <td class="px-4 py-3 font-medium text-gray-900 dark:text-white text-center">${rankIcon}</td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-300">${r.name || 'Unknown'}</td>
                    <td class="px-4 py-3 text-right font-mono font-bold text-brand-primary">${r.result || '-'}</td>
                </tr>
            `}).join('');
        }
    }

    document.getElementById('modal-match-details').classList.remove('hidden');
}

async function loadSquadList(teamId, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '<p class="text-[10px] text-gray-400 italic">Loading...</p>';

    if(!teamId) {
        container.innerHTML = '<p class="text-[10px] text-gray-400 italic">TBA</p>';
        return;
    }

    const { data: members } = await supabaseClient
        .from('team_members')
        .select('users(first_name, last_name, class_name)')
        .eq('team_id', teamId)
        .eq('status', 'Accepted'); 

    if (!members || members.length === 0) {
        container.innerHTML = '<p class="text-[10px] text-gray-400 italic">No members found.</p>';
        return;
    }

    container.innerHTML = members.map(m => `
        <div class="text-xs border-b border-gray-100 dark:border-gray-600 pb-1 mb-1 last:border-0 last:mb-0">
            <span class="text-gray-700 dark:text-gray-300 font-medium block">${m.users.first_name} ${m.users.last_name}</span>
        </div>
    `).join('');
}

// --- 7. TEAMS MODULE (Existing) ---
window.toggleTeamView = function(view) {
    document.getElementById('team-marketplace').classList.add('hidden');
    document.getElementById('team-locker').classList.add('hidden');
    
    const btnMarket = document.getElementById('btn-team-market');
    const btnLocker = document.getElementById('btn-team-locker');
    
    if(view === 'marketplace') {
        document.getElementById('team-marketplace').classList.remove('hidden');
        btnMarket.classList.add('bg-white', 'dark:bg-gray-700', 'shadow-sm', 'text-brand-primary', 'dark:text-white');
        btnLocker.classList.remove('bg-white', 'dark:bg-gray-700', 'shadow-sm', 'text-brand-primary', 'dark:text-white');
        loadTeamSportsFilter().then(() => window.loadTeamMarketplace());
    } else {
        document.getElementById('team-locker').classList.remove('hidden');
        btnLocker.classList.add('bg-white', 'dark:bg-gray-700', 'shadow-sm', 'text-brand-primary', 'dark:text-white');
        btnMarket.classList.remove('bg-white', 'dark:bg-gray-700', 'shadow-sm', 'text-brand-primary', 'dark:text-white');
        window.loadTeamLocker();
    }
}

async function loadTeamSportsFilter() {
    const select = document.getElementById('team-sport-filter');
    if (!select || select.children.length > 1) return;

    const { data: sports } = await supabaseClient.from('sports').select('id, name').eq('type', 'Team').eq('status', 'Open');
    if (sports && sports.length > 0) {
        select.innerHTML = `<option value="all">All Sports</option>`;
        sports.forEach(s => {
            select.innerHTML += `<option value="${s.id}">${s.name}</option>`;
        });
    }
}

window.loadTeamMarketplace = async function() {
    const container = document.getElementById('marketplace-list');
    container.innerHTML = '<p class="text-center text-gray-400 py-10">Scanning available squads...</p>';

    const filterVal = document.getElementById('team-sport-filter').value;

    let query = supabaseClient
        .from('teams')
        .select(`*, sports(name, team_size), captain:users!captain_id(first_name, gender, class_name)`)
        .eq('status', 'Open')
        .order('created_at', { ascending: false });

    if(filterVal !== 'all') query = query.eq('sport_id', filterVal);

    const { data: teams } = await query;

    if (!teams || teams.length === 0) {
         container.innerHTML = '<p class="text-center text-gray-400 py-10">No open teams available.</p>';
         return;
    }

    const validTeams = teams.filter(t => {
        const isEsports = ['BGMI', 'FREE FIRE'].includes(t.sports.name);
        if (!isEsports && t.captain?.gender !== currentUser.gender) return false;
        if (!isEsports) {
            const myCategory = (['FYJC', 'SYJC'].includes(currentUser.class_name)) ? 'Junior' : 'Senior';
            const teamCategory = (['FYJC', 'SYJC'].includes(t.captain.class_name)) ? 'Junior' : 'Senior';
            if (myCategory !== teamCategory) return false;
        }
        return true;
    });

    const teamPromises = validTeams.map(async (t) => {
        const { count } = await supabaseClient.from('team_members').select('*', { count: 'exact', head: true }).eq('team_id', t.id).eq('status', 'Accepted');
        const max = t.sports.team_size || DEFAULT_TEAM_SIZE;
        return { ...t, seatsLeft: Math.max(0, max - (count || 0)) };
    });

    const teamsWithCounts = await Promise.all(teamPromises);

    container.innerHTML = teamsWithCounts.map(t => {
        const isFull = t.seatsLeft <= 0;
        const btnText = isFull ? "Team Full" : "View Squad & Join";
        const btnClass = isFull 
            ? "w-full py-3 bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed text-xs font-bold rounded-xl"
            : "w-full py-3 bg-black dark:bg-white dark:text-black text-white text-xs font-bold rounded-xl shadow-lg active:scale-95 transition-transform hover:opacity-90";
        
        const action = isFull ? "" : `window.viewSquadAndJoin('${t.id}', '${t.sports.name}', ${t.seatsLeft}, '${t.sports.type}')`;

        return `
        <div class="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-3">
            <div class="flex justify-between items-start mb-3">
                <div>
                    <span class="text-[10px] font-bold bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-500 dark:text-gray-300 uppercase">${t.sports.name}</span>
                    <h4 class="font-bold text-lg text-gray-900 dark:text-white mt-1">${t.name}</h4>
                    <p class="text-xs text-gray-400">Capt: ${t.captain.first_name}</p>
                </div>
                <div class="text-center">
                    <span class="block text-xl font-black ${isFull ? 'text-gray-400' : 'text-brand-primary'}">${t.seatsLeft}</span>
                    <span class="text-[9px] text-gray-400 uppercase font-bold">Seats Left</span>
                </div>
            </div>
            <button onclick="${action}" class="${btnClass}" ${isFull ? 'disabled' : ''}>
                ${btnText}
            </button>
        </div>
    `}).join('');
}

function checkGenderEligibility(sportName, sportType) {
    if (sportType === 'Team') {
        const allowedFemales = ['Relay Race', 'BGMI', 'FREE FIRE'];
        if (currentUser.gender === 'Female' && !allowedFemales.includes(sportName)) {
            return false;
        }
    }
    return true;
}

window.viewSquadAndJoin = async function(teamId, sportName, seatsLeft, sportType) {
    if(seatsLeft <= 0) return showToast("❌ This team is full!", "error");

    if (!checkGenderEligibility(sportName, sportType)) {
        return showToast("⚠️ Females allowed only in Relay & eSports.", "error");
    }

    const sportId = await getSportIdByName(sportName);
    
    if(!myRegistrations.includes(sportId)) return showToast(`⚠️ You must Register for ${sportName} first!`, "error");

    const { data: existingTeam } = await supabaseClient.from('team_members')
        .select('team_id, teams!inner(sport_id)')
        .eq('user_id', currentUser.id)
        .eq('teams.sport_id', sportId);
    
    if(existingTeam && existingTeam.length > 0) return showToast(`❌ You already joined a ${sportName} team.`, "error");

    const { data: members } = await supabaseClient.from('team_members').select('status, users(first_name, last_name, class_name)').eq('team_id', teamId).eq('status', 'Accepted');

    const list = document.getElementById('view-squad-list');
    list.innerHTML = members.map(m => `
        <div class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-xl">
            <span class="text-sm font-bold text-gray-800 dark:text-white">${m.users.first_name} ${m.users.last_name}</span>
            <span class="text-xs text-gray-500 dark:text-gray-400 font-medium">${m.users.class_name || 'N/A'}</span>
        </div>
    `).join('');

    document.getElementById('btn-confirm-join').onclick = () => sendJoinRequest(teamId);
    document.getElementById('modal-view-squad').classList.remove('hidden');
}

async function sendJoinRequest(teamId) {
    const { error } = await supabaseClient.from('team_members').insert({ team_id: teamId, user_id: currentUser.id, status: 'Pending' });
    if(error) showToast("Error: " + error.message, "error");
    else {
        showToast("Request Sent to Captain!", "success");
        window.closeModal('modal-view-squad');
    }
}

// FULL SQUAD VIEW IN LOCKER
window.loadTeamLocker = async function() {
    const container = document.getElementById('locker-list');
    container.innerHTML = '<p class="text-center text-gray-400 py-10">Loading your teams...</p>';

    const { data: memberships } = await supabaseClient
        .from('team_members')
        .select(`id, status, teams (id, name, status, captain_id, sport_id, sports(name))`)
        .eq('user_id', currentUser.id);

    if(!memberships || memberships.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 py-10">You are not in any teams.</p>';
        return;
    }

    const htmlPromises = memberships.map(async (m) => {
        const t = m.teams;
        const isCaptain = t.captain_id === currentUser.id;
        const isLocked = t.status === 'Locked';
        
        const { data: squad } = await supabaseClient
            .from('team_members')
            .select('users(first_name)')
            .eq('team_id', t.id)
            .eq('status', 'Accepted');
            
        const squadHtml = squad.map(s => `<span class="text-[10px] bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded inline-block mr-1 mb-1 border border-gray-200 dark:border-gray-600">${s.users.first_name}</span>`).join('');

        let disableLock = false;
        if (!isLocked && isCaptain) {
            const { count: lockedCount } = await supabaseClient.from('teams')
                .select('*', { count: 'exact', head: true })
                .eq('sport_id', t.sport_id).eq('status', 'Locked');
            if (lockedCount >= TOURNAMENT_CAP) disableLock = true;
        }

        return `
        <div class="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-3 transition-colors">
            <div class="flex justify-between items-start mb-3">
                <div>
                    <h4 class="font-bold text-lg text-gray-900 dark:text-white">${t.name}</h4>
                    <p class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase">${t.sports.name} • ${t.status}</p>
                </div>
                ${isCaptain ? '<span class="text-[10px] bg-indigo-50 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded border border-indigo-100 dark:border-indigo-700 font-bold">CAPTAIN</span>' : ''}
            </div>
            
            <div class="mb-4">
                <p class="text-[9px] text-gray-400 uppercase font-bold mb-1">Squad Members</p>
                <div class="flex flex-wrap">${squadHtml}</div>
            </div>
            
            <div class="flex gap-2">
                ${isCaptain ? 
                    `<button onclick="window.openManageTeamModal('${t.id}', '${t.name}', ${isLocked}, ${disableLock})" class="flex-1 py-2 bg-brand-primary text-white text-xs font-bold rounded-lg shadow-md">Manage Team</button>
                     ${!isLocked ? `<button onclick="window.promptDeleteTeam('${t.id}')" class="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-red-500 rounded-lg"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}`
                : 
                    !isLocked ? `<button onclick="window.leaveTeam('${m.id}', '${t.name}')" class="flex-1 py-2 bg-white dark:bg-gray-700 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg">Leave Team</button>` 
                    : `<div class="w-full py-2 bg-gray-100 dark:bg-gray-700 text-center rounded-lg text-xs font-bold text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1"><i data-lucide="lock" class="w-3 h-3"></i> Locked</div>`
                }
            </div>
        </div>`;
    });

    const htmlItems = await Promise.all(htmlPromises);
    container.innerHTML = htmlItems.join('');
    lucide.createIcons();
}

window.leaveTeam = function(memberId, teamName) {
    showConfirmDialog("Leave Team?", `Are you sure you want to leave ${teamName}?`, async () => {
        const { error } = await supabaseClient.from('team_members').delete().eq('id', memberId);
        if(error) showToast("Error leaving team", "error");
        else {
            showToast("Left team successfully", "success");
            window.loadTeamLocker();
            window.closeModal('modal-confirm');
        }
    });
}

// --- 8. REGISTRATION MODULE ---
window.toggleRegisterView = function(view) {
    document.getElementById('reg-section-new').classList.add('hidden');
    document.getElementById('reg-section-history').classList.add('hidden');
    
    const btnNew = document.getElementById('btn-reg-new');
    const btnHist = document.getElementById('btn-reg-history');
    
    if(view === 'new') {
        document.getElementById('reg-section-new').classList.remove('hidden');
        btnNew.classList.add('bg-white', 'dark:bg-gray-700', 'shadow-sm', 'text-brand-primary', 'dark:text-white');
        btnHist.classList.remove('bg-white', 'dark:bg-gray-700', 'shadow-sm', 'text-brand-primary', 'dark:text-white');
        window.loadSportsDirectory();
    } else {
        document.getElementById('reg-section-history').classList.remove('hidden');
        btnHist.classList.add('bg-white', 'dark:bg-gray-700', 'shadow-sm', 'text-brand-primary', 'dark:text-white');
        btnNew.classList.remove('bg-white', 'dark:bg-gray-700', 'shadow-sm', 'text-brand-primary', 'dark:text-white');
        window.loadRegistrationHistory('history-list');
    }
}

window.loadSportsDirectory = async function() {
    const container = document.getElementById('sports-list');
    if(container.children.length > 0 && allSportsList.length > 0) return;

    container.innerHTML = '<div class="col-span-2 text-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary mx-auto"></div></div>';

    const { data: sports } = await supabaseClient.from('sports').select('*').eq('status', 'Open').order('name');
    allSportsList = sports || [];
    renderSportsList(allSportsList);
}

function renderSportsList(list) {
    const container = document.getElementById('sports-list');
    
    if(!list || list.length === 0) {
        container.innerHTML = '<p class="col-span-2 text-center text-gray-400">No sports found.</p>';
        return;
    }

    container.innerHTML = list.map(s => {
        const isReg = myRegistrations.includes(s.id);
        const btnClass = isReg 
            ? "bg-green-100 dark:bg-green-900/30 text-green-600 border border-green-200 dark:border-green-800 cursor-not-allowed" 
            : "bg-black dark:bg-white text-white dark:text-black shadow-lg hover:opacity-90";
        
        return `
        <div class="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-between h-36 relative overflow-hidden group">
            <div class="absolute -right-4 -top-4 w-20 h-20 bg-gray-50 dark:bg-gray-700 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
            
            <div class="relative z-10">
                <div class="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center mb-2 text-brand-primary dark:text-white">
                    <i data-lucide="${s.icon || 'trophy'}" class="w-4 h-4"></i>
                </div>
                <h4 class="font-bold text-md leading-tight text-gray-900 dark:text-white">${s.name}</h4>
                <p class="text-[10px] uppercase font-bold text-gray-400 mt-1">${s.type} Sport</p>
            </div>

            <button onclick="${isReg ? '' : `window.openRegistrationModal('${s.id}')`}" class="relative z-10 w-full py-2 rounded-lg text-xs font-bold transition-all ${btnClass}" ${isReg ? 'disabled' : ''}>
                ${isReg ? '<i data-lucide="check" class="w-3 h-3 inline mr-1"></i> Registered' : 'Register Now'}
            </button>
        </div>`;
    }).join('');
    lucide.createIcons();
}

window.filterSports = function() {
    const query = document.getElementById('search-input').value.toLowerCase();
    const filtered = allSportsList.filter(s => s.name.toLowerCase().includes(query));
    renderSportsList(filtered);
}

window.loadRegistrationHistory = async function(containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '<p class="text-center text-gray-400 py-10">Loading history...</p>';

    const { data: regs } = await supabaseClient
        .from('registrations')
        .select(`id, created_at, player_status, sports (id, name, icon, type)`)
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

    if(!regs || regs.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 py-6">You haven\'t registered for any events yet.</p>';
        return;
    }

    container.innerHTML = regs.map(r => {
        return `
        <div class="flex items-center gap-4 bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm mb-2 group relative">
            <div class="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-brand-primary dark:text-white shrink-0">
                <i data-lucide="${r.sports.icon || 'trophy'}" class="w-5 h-5"></i>
            </div>
            <div class="flex-1">
                <h4 class="font-bold text-sm text-gray-900 dark:text-white">${r.sports.name}</h4>
                <p class="text-xs text-gray-400 font-medium">${r.sports.type} • ${new Date(r.created_at).toLocaleDateString()}</p>
            </div>
            <button onclick="window.withdrawRegistration('${r.id}', '${r.sports.id}', '${r.sports.type}', '${r.sports.name}')" class="text-[10px] text-red-500 font-bold border border-red-100 dark:border-red-900 px-3 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 hover:bg-red-100 transition-colors">
                Withdraw
            </button>
        </div>
    `}).join('');
    lucide.createIcons();
}

window.loadProfileGames = function() {
    window.loadRegistrationHistory('my-registrations-list');
}

window.withdrawRegistration = async function(regId, sportId, sportType, sportName) {
    showConfirmDialog("Withdraw?", `Withdraw from ${sportName}?`, async () => {
        
        if (sportType === 'Team') {
            const { data: membership } = await supabaseClient.from('team_members')
                .select('id, teams!inner(status)')
                .eq('user_id', currentUser.id)
                .eq('teams.sport_id', sportId)
                .single();

            if (membership) {
                if (membership.teams.status === 'Locked') {
                    window.closeModal('modal-confirm');
                    return showToast("Cannot withdraw! Team is LOCKED.", "error");
                }
                await supabaseClient.from('team_members').delete().eq('id', membership.id);
            }
        }

        const { error } = await supabaseClient.from('registrations').delete().eq('id', regId);
        
        if (error) {
            showToast(error.message, "error");
        } else {
            showToast("Withdrawn Successfully", "success");
            myRegistrations = myRegistrations.filter(id => id != sportId);
            window.loadRegistrationHistory('history-list'); 
            window.loadRegistrationHistory('my-registrations-list');
            window.closeModal('modal-confirm');
        }
    });
}

// --- PROFILE SETTINGS ---
window.openSettingsModal = function() {
    document.getElementById('edit-fname').value = currentUser.first_name || '';
    document.getElementById('edit-lname').value = currentUser.last_name || '';
    document.getElementById('edit-email').value = currentUser.email || '';
    document.getElementById('edit-mobile').value = currentUser.mobile || '';
    document.getElementById('edit-class').value = currentUser.class_name || 'FY';
    document.getElementById('edit-gender').value = currentUser.gender || 'Male';
    document.getElementById('edit-sid').value = currentUser.student_id || '';
    document.getElementById('modal-settings').classList.remove('hidden');
}

window.updateProfile = async function() {
    const updates = {
        first_name: document.getElementById('edit-fname').value,
        last_name: document.getElementById('edit-lname').value,
        mobile: document.getElementById('edit-mobile').value,
        class_name: document.getElementById('edit-class').value,
        student_id: document.getElementById('edit-sid').value,
        gender: document.getElementById('edit-gender').value
    };

    if(!updates.first_name || !updates.last_name) return showToast("Name is required", "error");

    const { error } = await supabaseClient.from('users').update(updates).eq('id', currentUser.id);

    if(error) showToast("Error updating profile", "error");
    else {
        Object.assign(currentUser, updates);
        updateProfileUI();
        window.closeModal('modal-settings');
        showToast("Profile Updated!", "success");
    }
}

// --- UTILS ---
async function getSportIdByName(name) {
    const { data } = await supabaseClient.from('sports').select('id').eq('name', name).single();
    return data?.id;
}

window.closeModal = id => document.getElementById(id).classList.add('hidden');

window.showToast = function(msg, type='info') {
    const t = document.getElementById('toast-container');
    const msgEl = document.getElementById('toast-msg');
    const iconEl = document.getElementById('toast-icon');
    
    msgEl.innerText = msg;
    
    if (type === 'error') {
        iconEl.innerHTML = '<i data-lucide="alert-triangle" class="w-5 h-5 text-red-400"></i>';
    } else if (type === 'success') {
        iconEl.innerHTML = '<i data-lucide="check-circle" class="w-5 h-5 text-green-400"></i>';
    } else {
        iconEl.innerHTML = '<i data-lucide="info" class="w-5 h-5 text-blue-400"></i>';
    }
    
    lucide.createIcons();
    t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
    
    setTimeout(() => {
        t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10');
    }, 3000);
}

let confirmCallback = null;
function setupConfirmModal() {
    document.getElementById('btn-confirm-yes').onclick = () => confirmCallback && confirmCallback();
    document.getElementById('btn-confirm-cancel').onclick = () => { window.closeModal('modal-confirm'); confirmCallback = null; };
}

function showConfirmDialog(title, msg, onConfirm) {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-msg').innerText = msg;
    confirmCallback = onConfirm;
    document.getElementById('modal-confirm').classList.remove('hidden');
}

window.openRegistrationModal = async function(id) {
    const { data: sport } = await supabaseClient.from('sports').select('*').eq('id', id).single();
    selectedSportForReg = sport;
    
    document.getElementById('reg-modal-sport-name').innerText = sport.name;
    document.getElementById('reg-modal-user-name').innerText = `${currentUser.first_name} ${currentUser.last_name}`;
    document.getElementById('reg-modal-user-details').innerText = `${currentUser.class_name || 'N/A'} • ${currentUser.student_id || 'N/A'}`;
    document.getElementById('reg-mobile').value = currentUser.mobile || ''; 
    document.getElementById('modal-register').classList.remove('hidden');
}

window.confirmRegistration = async function() {
    const btn = document.querySelector('#modal-register button[onclick="confirmRegistration()"]');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Registering...";

    if(!currentUser.mobile) {
        const phone = prompt("⚠️ Mobile number is required. Please enter yours:");
        if(!phone || phone.length < 10) {
            btn.disabled = false;
            btn.innerText = originalText;
            return showToast("Invalid Mobile Number", "error");
        }
        await supabaseClient.from('users').update({mobile: phone}).eq('id', currentUser.id);
        currentUser.mobile = phone; 
    }

    const { error } = await supabaseClient.from('registrations').insert({
        user_id: currentUser.id,
        sport_id: selectedSportForReg.id
    });

    if(error) {
        btn.disabled = false;
        btn.innerText = originalText;
        showToast("Error: " + error.message, "error");
    }
    else {
        if (!myRegistrations.includes(selectedSportForReg.id)) {
            myRegistrations.push(selectedSportForReg.id);
        }

        showToast("Registration Successful!", "success");
        window.closeModal('modal-register');
        
        btn.disabled = false;
        btn.innerText = originalText;

        renderSportsList(allSportsList);
    }
}

// --- TEAM MANAGEMENT ---
window.openCreateTeamModal = async function() {
    const { data } = await supabaseClient.from('sports').select('*').eq('type', 'Team').eq('status', 'Open');
    document.getElementById('new-team-sport').innerHTML = data.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    document.getElementById('modal-create-team').classList.remove('hidden');
}

window.createTeam = async function() {
    const name = document.getElementById('new-team-name').value;
    const sportId = document.getElementById('new-team-sport').value;
    const sportName = document.getElementById('new-team-sport').options[document.getElementById('new-team-sport').selectedIndex].text;
    
    if (!checkGenderEligibility(sportName, 'Team')) return showToast("⚠️ Females allowed only in Relay & eSports.", "error");

    if(!name) return showToast("Enter Team Name", "error");
    if(!myRegistrations.includes(parseInt(sportId)) && !myRegistrations.includes(sportId)) return showToast("⚠️ Register for this sport first!", "error");
    
    const { data: existing } = await supabaseClient.from('team_members').select('team_id, teams!inner(sport_id)').eq('user_id', currentUser.id).eq('teams.sport_id', sportId);
    if(existing && existing.length > 0) return showToast("❌ You already have a team for this sport.", "error");

    const { data: team, error } = await supabaseClient.from('teams').insert({ name: name, sport_id: sportId, captain_id: currentUser.id, status: 'Open' }).select().single();

    if(error) showToast(error.message, "error");
    else {
        await supabaseClient.from('team_members').insert({ team_id: team.id, user_id: currentUser.id, status: 'Accepted' });
        showToast("Team Created!", "success");
        window.closeModal('modal-create-team');
        window.toggleTeamView('locker');
    }
}

window.openManageTeamModal = async function(teamId, teamName, isLocked, isTournamentFull) {
    document.getElementById('manage-team-title').innerText = "Manage: " + teamName;
    
    const { data: pending } = await supabaseClient.from('team_members').select('id, users(first_name, last_name)').eq('team_id', teamId).eq('status', 'Pending');
    const reqList = document.getElementById('manage-requests-list');
    reqList.innerHTML = (!pending || pending.length === 0) ? '<p class="text-xs text-gray-400 italic">No pending requests.</p>' : pending.map(p => `
        <div class="flex justify-between items-center p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-100 dark:border-yellow-800 mb-1">
            <span class="text-xs font-bold text-gray-800 dark:text-white">${p.users.first_name} ${p.users.last_name}</span>
            <div class="flex gap-1">
                <button onclick="window.handleRequest('${p.id}', 'Accepted', '${teamId}')" class="p-1 bg-green-500 text-white rounded"><i data-lucide="check" class="w-3 h-3"></i></button>
                <button onclick="window.handleRequest('${p.id}', 'Rejected', '${teamId}')" class="p-1 bg-red-500 text-white rounded"><i data-lucide="x" class="w-3 h-3"></i></button>
            </div>
        </div>`).join('');

    const { data: members } = await supabaseClient.from('team_members').select('id, user_id, users(first_name, last_name)').eq('team_id', teamId).eq('status', 'Accepted');
    const memList = document.getElementById('manage-members-list');
    memList.innerHTML = members.map(m => `
        <div class="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-700 rounded-lg mb-1">
            <span class="text-xs font-bold text-gray-800 dark:text-white ${m.user_id === currentUser.id ? 'text-brand-primary' : ''}">
                ${m.users.first_name} ${m.users.last_name} ${m.user_id === currentUser.id ? '(You)' : ''}
            </span>
            ${m.user_id !== currentUser.id && !isLocked ? `<button onclick="window.removeMember('${m.id}', '${teamId}')" class="text-red-500"><i data-lucide="trash" class="w-3 h-3"></i></button>` : ''}
        </div>`).join('');

    const oldLock = document.getElementById('btn-lock-dynamic');
    if(oldLock) oldLock.remove();
    if (!isLocked) {
         const lockBtn = document.createElement('button');
         lockBtn.id = 'btn-lock-dynamic';
         
         if (isTournamentFull) {
             lockBtn.className = "w-full py-3 mt-4 mb-2 bg-gray-200 dark:bg-gray-700 text-gray-500 font-bold rounded-xl text-xs cursor-not-allowed";
             lockBtn.innerHTML = 'TOURNAMENT FULL (64/64)';
             lockBtn.disabled = true;
         } else {
             lockBtn.className = "w-full py-3 mt-4 mb-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-bold rounded-xl text-xs border border-red-100 dark:border-red-900 flex items-center justify-center gap-2";
             lockBtn.innerHTML = '<i data-lucide="lock" class="w-3 h-3"></i> LOCK TEAM PERMANENTLY';
             lockBtn.onclick = () => window.promptLockTeam(teamId);
         }
         
         memList.parentElement.parentElement.insertBefore(lockBtn, memList.parentElement.nextElementSibling);
    }
    
    lucide.createIcons();
    document.getElementById('modal-manage-team').classList.remove('hidden');
}

window.handleRequest = async function(memberId, status, teamId) {
    if(status === 'Rejected') await supabaseClient.from('team_members').delete().eq('id', memberId);
    else await supabaseClient.from('team_members').update({ status: 'Accepted' }).eq('id', memberId);
    window.closeModal('modal-manage-team');
    window.loadTeamLocker();
}

window.promptLockTeam = async function(teamId) {
    const { count } = await supabaseClient.from('team_members').select('*', { count: 'exact', head: true }).eq('team_id', teamId).eq('status', 'Accepted');
    const { data } = await supabaseClient.from('teams').select('sports(team_size, name)').eq('id', teamId).single();
    const required = data?.sports?.team_size || DEFAULT_TEAM_SIZE;
    if(count < required) return showToast(`⚠️ Squad incomplete! Need ${required} players.`, "error");
    showConfirmDialog("Lock Team?", "⚠️ This is FINAL. No members can be added/removed.", async () => {
        await supabaseClient.from('teams').update({ status: 'Locked' }).eq('id', teamId);
        showToast("Team Locked!", "success");
        window.closeModal('modal-manage-team');
        window.closeModal('modal-confirm');
        window.loadTeamLocker();
    });
}

window.promptDeleteTeam = function(teamId) {
    showConfirmDialog("Delete Team?", "Are you sure? This cannot be undone.", async () => {
        await supabaseClient.from('team_members').delete().eq('team_id', teamId);
        await supabaseClient.from('teams').delete().eq('id', teamId);
        showToast("Team Deleted", "success");
        window.closeModal('modal-confirm');
        window.loadTeamLocker();
    });
}

window.removeMember = function(memberId, teamId) {
    showConfirmDialog("Remove Player?", "Are you sure?", async () => {
        await supabaseClient.from('team_members').delete().eq('id', memberId);
        window.closeModal('modal-confirm');
        window.loadTeamLocker();
    });
}

// --- UTILS: TOAST INJECTOR ---
function injectToastContainer() {
    if(!document.getElementById('toast-container')) {
        const div = document.createElement('div');
        div.id = 'toast-container';
        div.className = 'fixed bottom-10 left-1/2 transform -translate-x-1/2 z-[70] transition-all duration-300 opacity-0 pointer-events-none translate-y-10 w-11/12 max-w-sm';
        div.innerHTML = `<div id="toast-content" class="bg-gray-900 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-md border border-gray-700/50"><div id="toast-icon"></div><p id="toast-msg" class="text-sm font-bold tracking-wide"></p></div>`;
        document.body.appendChild(div);
    }
}
