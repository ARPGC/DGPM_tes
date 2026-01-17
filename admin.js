// ==========================================
// URJA 2026 - ADMIN CONTROL CENTER
// ==========================================

// --- 1. CONFIGURATION & CLIENTS ---

// Safety Check for Configs
if (typeof CONFIG === 'undefined' || typeof CONFIG_REALTIME === 'undefined') {
    console.error("CRITICAL ERROR: Configuration files missing. Ensure config.js and config2.js are loaded.");
    alert("System Error: Config missing. Check console.");
}

// A. MAIN PROJECT (Project A) - Read/Write for Admin, Auth, Official Records
const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// B. REALTIME PROJECT (Project B) - Relay for Live Student View
// We use the SERVICE KEY here because Admins need to WRITE to the live relay.
const realtimeClient = window.supabase.createClient(CONFIG_REALTIME.url, CONFIG_REALTIME.serviceKey);

// --- 2. STATE MANAGEMENT ---
let currentUser = null;
let currentView = 'dashboard';
let currentMatchViewFilter = 'Scheduled'; 

// Data Caches (for Search & Export)
let allTeamsCache = []; 
let dataCache = []; 
let allRegistrationsCache = []; 
let allUsersCache = [];

// Sorting State
let currentSort = { key: 'created_at', asc: false };

const DEFAULT_AVATAR = "https://t4.ftcdn.net/jpg/05/89/93/27/360_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.jpg";

// --- 3. INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize UI Libs
    if(window.lucide) lucide.createIcons();
    injectToastContainer();

    // Authenticate
    await checkAdminAuth();
    
    // Load Default View
    switchView('dashboard');
});

// --- 4. AUTHENTICATION & SECURITY ---

async function checkAdminAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    // Verify Admin Role
    const { data: user } = await supabaseClient
        .from('users')
        .select('role, email')
        .eq('id', session.user.id)
        .single();

    if (!user || user.role !== 'admin') {
        showToast("Access Denied: Admins Only", "error");
        setTimeout(() => window.location.href = 'login.html', 1500);
        return;
    }
    
    currentUser = { ...session.user, email: user.email };
    loadDashboardStats();
}

// FIXED: Signout Logic
async function adminLogout() {
    try {
        await logAdminAction('LOGOUT', 'Admin initiated sign out');
        await supabaseClient.auth.signOut();
        localStorage.clear(); // Clear any local artifacts
        window.location.href = 'login.html';
    } catch (error) {
        console.error("Logout Error:", error);
        window.location.href = 'login.html'; // Fallback redirect
    }
}

// --- 5. LOGGING SYSTEM ---
// Kept active for background recording
async function logAdminAction(action, details) {
    console.log(`[ADMIN LOG] ${action}: ${details}`);
    try {
        await supabaseClient.from('admin_logs').insert({
            admin_email: currentUser.email,
            action: action,
            details: details
        });
    } catch (err) {
        console.error("Logging failed:", err);
    }
}

// --- 6. REALTIME SYNC ENGINE (THE BRIDGE) ---
// This function copies data from Main DB -> Realtime DB
async function syncToRealtime(matchId) {
    console.log(`[SYNC] Syncing Match ${matchId}...`);
    
    // 1. Get Fresh Data from Main DB
    const { data: match, error } = await supabaseClient
        .from('matches')
        .select('*, sports(name)')
        .eq('id', matchId)
        .single();

    if (error || !match) {
        console.error("Sync Error: Data not found in Main DB", error);
        return;
    }

    // 2. Format Payload for Relay DB
    const payload = {
        id: match.id,
        sport_name: match.sports?.name || 'Unknown',
        team1_name: match.team1_name,
        team2_name: match.team2_name,
        score1: match.score1 || 0,
        score2: match.score2 || 0,
        round_number: match.round_number,
        match_type: match.match_type,
        status: match.status,
        is_live: match.is_live,
        location: match.location,
        start_time: match.start_time,
        winner_text: match.winner_text,
        winners_data: match.winners_data, // JSON: {gold, silver, bronze}
        updated_at: new Date()
    };

    // 3. Upsert to Realtime DB
    const { error: rtError } = await realtimeClient
        .from('live_matches')
        .upsert(payload);

    if (rtError) console.error("Sync Failed:", rtError);
    else console.log("[SYNC] Success!");
}

// --- 7. VIEW NAVIGATION & ROUTING ---
window.switchView = function(viewId) {
    currentView = viewId;
    
    // 1. UI Toggling
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById('view-' + viewId);
    if(target) {
        target.classList.remove('hidden');
        target.classList.remove('animate-fade-in');
        void target.offsetWidth; // Trigger Reflow
        target.classList.add('animate-fade-in');
    }

    // 2. Sidebar State
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navBtn = document.getElementById('nav-' + viewId);
    if(navBtn) navBtn.classList.add('active');

    // 3. Header Title
    const titleEl = document.getElementById('page-title');
    if(titleEl) titleEl.innerText = viewId.charAt(0).toUpperCase() + viewId.slice(1);

    // 4. Export Buttons Toggle
    const globalActions = document.getElementById('global-actions');
    if(globalActions) {
        if (['users', 'teams', 'matches', 'registrations'].includes(viewId)) {
            globalActions.classList.remove('hidden');
        } else {
            globalActions.classList.add('hidden');
        }
    }

    // 5. Data Loaders
    dataCache = []; // Clear export cache
    if(viewId === 'users') loadUsersList();
    if(viewId === 'matches') { setupMatchFilters(); loadMatches('Scheduled'); }
    if(viewId === 'teams') loadTeamsList();
    if(viewId === 'registrations') loadRegistrationsList();
}

// --- 8. EXPORT SYSTEM ---
window.exportCurrentPage = function(type) {
    if (!dataCache || dataCache.length === 0) return showToast("No data to export", "error");
    
    const filename = `urja_${currentView}_${new Date().toISOString().split('T')[0]}`;

    if (type === 'excel') {
        const ws = XLSX.utils.json_to_sheet(dataCache);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
        XLSX.writeFile(wb, `${filename}.xlsx`);
        logAdminAction('EXPORT_EXCEL', `Exported ${currentView}`);
    } 
    else if (type === 'pdf') {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l'); // Landscape
        
        // Extract headers dynamically
        const headers = Object.keys(dataCache[0]).map(k => k.toUpperCase());
        const rows = dataCache.map(obj => Object.values(obj).map(v => String(v)));

        doc.setFontSize(18);
        doc.text(`URJA 2026 - ${currentView.toUpperCase()}`, 14, 22);
        
        doc.autoTable({
            head: [headers],
            body: rows,
            startY: 30,
            theme: 'grid',
            styles: { fontSize: 8 }
        });

        doc.save(`${filename}.pdf`);
        logAdminAction('EXPORT_PDF', `Exported ${currentView}`);
    }
}

// --- 9. DASHBOARD STATS ---
async function loadDashboardStats() {
    const { count: userCount } = await supabaseClient.from('users').select('*', { count: 'exact', head: true });
    const { count: regCount } = await supabaseClient.from('registrations').select('*', { count: 'exact', head: true });
    const { count: teamCount } = await supabaseClient.from('teams').select('*', { count: 'exact', head: true });
    
    const uEl = document.getElementById('dash-total-users');
    const rEl = document.getElementById('dash-total-regs');
    const tEl = document.getElementById('dash-total-teams');

    if(uEl) uEl.innerText = userCount || 0;
    if(rEl) rEl.innerText = regCount || 0;
    if(tEl) tEl.innerText = teamCount || 0;
}

// --- 10. MATCH ACTIONS (End Performance & Start Match) ---

window.endPerformanceEvent = async function(matchId) {
    if (!confirm("Are you sure? This will Calculate Winners (1,2,3) and END the event.")) return;

    const { data: match } = await supabaseClient.from('matches').select('performance_data, sports(unit)').eq('id', matchId).single();
    let arr = match.performance_data;
    const unit = match.sports.unit;

    let validEntries = arr.filter(p => p.result && p.result.trim() !== '');
    
    // Sort Logic
    const isDistance = unit === 'Meters' || unit === 'Points';
    validEntries.sort((a, b) => {
        const valA = parseFloat(a.result) || 0;
        const valB = parseFloat(b.result) || 0;
        return isDistance ? (valB - valA) : (valA - valB);
    });

    let winners = { gold: null, silver: null, bronze: null };
    validEntries.forEach((p, i) => {
        p.rank = i + 1;
        if(i === 0) winners.gold = p.name;
        if(i === 1) winners.silver = p.name;
        if(i === 2) winners.bronze = p.name;
    });

    const finalData = [...validEntries, ...arr.filter(p => !p.result || p.result.trim() === '')];
    const winnerText = `Gold: ${winners.gold || '-'}, Silver: ${winners.silver || '-'}, Bronze: ${winners.bronze || '-'}`;

    const { error } = await supabaseClient.from('matches').update({ 
        performance_data: finalData,
        status: 'Completed',
        winner_text: winnerText,
        winners_data: winners,
        is_live: false 
    }).eq('id', matchId);

    if(error) showToast("Error: " + error.message, "error");
    else {
        showToast("Event Ended!", "success");
        logAdminAction('END_EVENT', `Ended Match ID ${matchId}`);
        // Sync Final State
        syncToRealtime(matchId);
        loadMatches(currentMatchViewFilter); 
    }
}

// --- 11. REGISTRATIONS LIST VIEW ---
async function loadRegistrationsList() {
    const tbody = document.getElementById('registrations-table-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center">Loading registrations...</td></tr>';

    const { data: regs, error } = await supabaseClient
        .from('registrations')
        .select(`
            id, created_at,
            users (first_name, last_name, student_id, class_name, gender, mobile, email),
            sports (name)
        `)
        .order('created_at', { ascending: false });

    if(error) {
        console.error(error);
        return showToast("Failed to load registrations", "error");
    }

    // Flatten Data
    allRegistrationsCache = regs.map(r => ({
        name: `${r.users.first_name} ${r.users.last_name}`,
        student_id: r.users.student_id,
        class: r.users.class_name,
        category: (['FYJC', 'SYJC'].includes(r.users.class_name)) ? 'Junior' : 'Senior',
        gender: r.users.gender,
        sport: r.sports.name,
        mobile: r.users.mobile,
        email: r.users.email,
        date: new Date(r.created_at).toLocaleDateString()
    }));

    // Populate Filters
    const sports = [...new Set(allRegistrationsCache.map(r => r.sport))].sort();
    const sportSelect = document.getElementById('filter-reg-sport');
    if(sportSelect && sportSelect.children.length <= 1) {
        sportSelect.innerHTML = `<option value="">All Sports</option>` + sports.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    renderRegistrations(allRegistrationsCache);
}

function renderRegistrations(data) {
    const tbody = document.getElementById('registrations-table-body');
    const countEl = document.getElementById('reg-count');
    if(!tbody) return;

    if(countEl) countEl.innerText = data.length;
    dataCache = data;

    if(data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-400 font-bold">No records found.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(r => `
        <tr class="border-b border-gray-50 hover:bg-indigo-50/30 transition-colors">
            <td class="p-4">
                <div class="font-bold text-gray-900">${r.name}</div>
                <div class="text-xs text-gray-500">${r.email}</div>
            </td>
            <td class="p-4"><span class="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold uppercase">${r.sport}</span></td>
            <td class="p-4 text-sm text-gray-600 font-medium">${r.class} <span class="text-xs text-gray-400">(${r.student_id})</span></td>
            <td class="p-4 text-sm text-gray-600">${r.gender}</td>
            <td class="p-4 text-sm font-mono text-gray-600">${r.mobile}</td>
            <td class="p-4 text-right text-xs text-gray-400 font-bold">${r.date}</td>
        </tr>
    `).join('');
}

window.filterRegistrations = function() {
    const search = document.getElementById('reg-search').value.toLowerCase();
    const sport = document.getElementById('filter-reg-sport').value;
    const gender = document.getElementById('filter-reg-gender').value;
    const cls = document.getElementById('filter-reg-class').value;

    const filtered = allRegistrationsCache.filter(r => {
        const matchesSearch = r.name.toLowerCase().includes(search) || r.student_id.toLowerCase().includes(search);
        const matchesSport = sport === "" || r.sport === sport;
        const matchesGender = gender === "" || r.gender === gender;
        const matchesClass = cls === "" || r.category === cls;
        return matchesSearch && matchesSport && matchesGender && matchesClass;
    });

    renderRegistrations(filtered);
}

window.sortRegistrations = function(key) {
    currentSort.asc = (currentSort.key === key) ? !currentSort.asc : true;
    currentSort.key = key;

    const sorted = [...dataCache].sort((a, b) => {
        const valA = a[key].toString().toLowerCase();
        const valB = b[key].toString().toLowerCase();
        if(valA < valB) return currentSort.asc ? -1 : 1;
        if(valA > valB) return currentSort.asc ? 1 : -1;
        return 0;
    });

    renderRegistrations(sorted);
}

window.resetRegFilters = function() {
    document.getElementById('reg-search').value = '';
    document.getElementById('filter-reg-sport').value = '';
    document.getElementById('filter-reg-gender').value = '';
    document.getElementById('filter-reg-class').value = '';
    renderRegistrations(allRegistrationsCache);
}

// --- 12. MATCH LIST & FILTER ---
window.loadMatches = async function(statusFilter = 'Scheduled') {
    currentMatchViewFilter = statusFilter;
    
    // Update Tab Styles
    document.querySelectorAll('#match-filter-tabs button').forEach(btn => {
        if(btn.innerText.includes(statusFilter)) btn.className = "px-4 py-2 text-sm font-bold text-black border-b-2 border-black";
        else btn.className = "px-4 py-2 text-sm font-bold text-gray-500 hover:text-black";
    });

    const container = document.getElementById('matches-grid');
    if(!container) return;
    container.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading matches...</p>';

    const { data: matches } = await supabaseClient
        .from('matches')
        .select('*, sports(name, is_performance, unit)')
        .eq('status', statusFilter)
        .order('start_time', { ascending: true });

    if (!matches || matches.length === 0) {
        container.innerHTML = `<p class="col-span-3 text-center text-gray-400 py-10">No ${statusFilter} matches found.</p>`;
        return;
    }

    dataCache = matches.map(m => ({ Round: m.round_number, Sport: m.sports.name, Team1: m.team1_name, Team2: m.team2_name, Status: m.status }));

    container.innerHTML = matches.map(m => `
        <div class="w-full bg-white p-5 rounded-3xl border border-gray-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
            <div class="flex justify-between items-start mb-4">
                 <div class="flex items-center">
                    ${m.status==='Live' ? `<span class="bg-red-50 text-red-600 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider animate-pulse">LIVE</span>` : `<span class="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">${new Date(m.start_time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>`}
                 </div>
                 <span class="text-xs text-gray-500 font-bold uppercase tracking-wider">${m.sports.name}</span>
            </div>
            
            ${m.sports.is_performance ? 
                `<div class="text-center py-2"><h4 class="font-black text-xl text-gray-900">${m.team1_name}</h4><p class="text-xs text-gray-400 font-bold uppercase">Performance Event</p></div>`
            : 
                `<div class="flex items-center justify-between w-full mb-4 px-2">
                    <h4 class="font-bold text-lg text-gray-900 leading-tight text-left w-1/3 truncate">${m.team1_name}</h4>
                    <span class="text-[10px] font-bold text-gray-300 px-2">VS</span>
                    <h4 class="font-bold text-lg text-gray-900 leading-tight text-right w-1/3 truncate">${m.team2_name}</h4>
                </div>`
            }

            <div class="border-t border-gray-100 pt-4 flex items-center justify-between gap-3">
                 <div class="text-xs font-bold text-gray-400 flex items-center gap-1"><i data-lucide="map-pin" class="w-3 h-3"></i> ${m.location || 'N/A'}</div>
                 <div>
                    ${m.sports.is_performance && m.status === 'Live' ? 
                        `<button onclick="endPerformanceEvent('${m.id}')" class="px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-lg hover:bg-red-600 shadow-sm transition-colors">End Event</button>`
                    : 
                        m.status === 'Scheduled' ? 
                            `<button onclick="startMatch('${m.id}')" class="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 shadow-sm transition-colors">Start Match</button>` 
                        : `<span class="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded border border-gray-200">${m.winner_text || 'Completed'}</span>`
                    }
                 </div>
            </div>
        </div>
    `).join('');
    if(window.lucide) lucide.createIcons();
}

window.startMatch = async function(matchId) {
    if(!confirm("Start this match now? It will appear as LIVE.")) return;
    await supabaseClient.from('matches').update({ status: 'Live', is_live: true }).eq('id', matchId);
    showToast("Match is now LIVE!", "success");
    logAdminAction('MATCH_START', `Started match ID ${matchId}`);
    syncToRealtime(matchId);
    loadMatches('Live');
}

// --- 13. USERS & TEAMS MANAGEMENT ---
async function loadUsersList() {
    const tbody = document.getElementById('users-table-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center">Loading...</td></tr>';
    const { data: users } = await supabaseClient.from('users').select('*').order('created_at', { ascending: false });
    const { data: sports } = await supabaseClient.from('sports').select('id, name');
    dataCache = users;
    
    tbody.innerHTML = users.map(u => {
        const sportOptions = sports.map(s => `<option value="${s.id}" ${u.assigned_sport_id === s.id ? 'selected' : ''}>${s.name}</option>`).join('');
        return `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="p-4 flex items-center gap-3">
                <img src="${u.avatar_url || DEFAULT_AVATAR}" class="w-8 h-8 rounded-full object-cover bg-gray-200">
                <div><div class="font-bold text-gray-900">${u.first_name} ${u.last_name}</div><div class="text-xs text-gray-500">${u.email}</div></div>
            </td>
            <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold ${u.role==='admin'?'bg-purple-50 text-purple-600': u.role==='volunteer'?'bg-indigo-50 text-indigo-600':'bg-gray-100 text-gray-600'} uppercase">${u.role}</span></td>
            <td class="p-4 text-gray-600">${u.class_name || '-'} <span class="text-xs text-gray-400">(${u.student_id})</span></td>
            <td class="p-4">${u.role === 'volunteer' ? `<select onchange="assignVolunteerSport('${u.id}', this.value)" class="p-1 text-xs border rounded bg-white w-full"><option value="">-- Assign --</option>${sportOptions}</select>` : '-'}</td>
            <td class="p-4 text-right flex justify-end gap-2">
                ${u.role !== 'admin' && u.role !== 'volunteer' ? `<button onclick="promoteUser('${u.id}')" class="text-xs bg-indigo-50 text-indigo-600 px-3 py-1 rounded-lg font-bold hover:bg-indigo-100">Make Vol</button>` : ''}
                <button onclick="resetUserPassword('${u.id}', '${u.first_name}')" class="text-xs bg-red-50 text-red-600 px-3 py-1 rounded-lg font-bold hover:bg-red-100 border border-red-100">Reset</button>
            </td>
        </tr>`;
    }).join('');
}

window.promoteUser = async function(userId) {
    if(!confirm("Promote to Volunteer?")) return;
    await supabaseClient.from('users').update({ role: 'volunteer' }).eq('id', userId);
    logAdminAction('USER_PROMOTE', `Promoted user ${userId} to Volunteer`);
    showToast("Promoted!", "success");
    loadUsersList();
}

window.assignVolunteerSport = async function(userId, sportId) {
    await supabaseClient.from('users').update({ assigned_sport_id: sportId || null }).eq('id', userId);
    logAdminAction('USER_ASSIGN_SPORT', `Assigned sport ${sportId} to user ${userId}`);
    showToast("Assigned!", "success");
}

window.resetUserPassword = async function(userId, name) {
    if(!confirm(`Reset ${name}'s password to 'student'?`)) return;
    const { error } = await supabaseClient.rpc('admin_reset_password', { target_user_id: userId });
    
    if(error) {
        showToast("Error resetting password", "error");
    } else {
        logAdminAction('USER_PASS_RESET', `Reset password for user ${userId}`);
        showToast("Password Reset", "success");
    }
}

window.filterUsers = function() {
    const q = document.getElementById('user-search').value.toLowerCase();
    document.querySelectorAll('#users-table-body tr').forEach(r => {
        r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
}

// --- 14. TEAMS ---
async function loadTeamsList() {
    const grid = document.getElementById('teams-grid');
    if(!grid) return;
    grid.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading teams...</p>';

    if(!document.getElementById('teams-search-container')) {
        const div = document.createElement('div');
        div.id = 'teams-search-container';
        div.className = "col-span-3 mb-4 flex gap-2";
        div.innerHTML = `<input type="text" id="team-search-input" onkeyup="filterTeamsList()" placeholder="Search Teams..." class="flex-1 p-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-black">`;
        grid.parentElement.insertBefore(div, grid);
    }

    const { data: teams } = await supabaseClient.from('teams').select('*, sports(name), captain:users!captain_id(first_name, last_name)').order('created_at', { ascending: false });
    allTeamsCache = teams || [];
    dataCache = teams;
    renderTeams(allTeamsCache);
}

window.filterTeamsList = function() {
    const q = document.getElementById('team-search-input').value.toLowerCase();
    renderTeams(allTeamsCache.filter(t => t.name.toLowerCase().includes(q)));
}

function renderTeams(teams) {
    const grid = document.getElementById('teams-grid');
    if(teams.length === 0) { grid.innerHTML = '<p class="col-span-3 text-center text-gray-400">No teams found.</p>'; return; }
    grid.innerHTML = teams.map(t => `
        <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
            <div class="flex justify-between items-start mb-3">
                <span class="text-[10px] font-bold uppercase bg-gray-100 px-2 py-1 rounded text-gray-500">${t.sports.name}</span>
                <span class="text-[10px] font-bold uppercase ${t.status === 'Locked' ? 'text-red-500' : 'text-green-500'}">${t.status}</span>
            </div>
            <h4 class="font-bold text-lg text-gray-900">${t.name}</h4>
            <p class="text-xs text-gray-500 mb-4">Capt: ${t.captain?.first_name || 'Unknown'}</p>
            <button onclick="viewTeamSquad('${t.id}', '${t.name}')" class="w-full py-2 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-lg hover:bg-indigo-100 transition-colors">View Squad</button>
        </div>`).join('');
}

window.viewTeamSquad = async function(teamId, teamName) {
    const { data: members } = await supabaseClient.from('team_members').select('users(first_name, last_name)').eq('team_id', teamId).eq('status', 'Accepted');
    let msg = `Squad for ${teamName}:\n\n`;
    if(members) members.forEach((m, i) => msg += `${i+1}. ${m.users.first_name} ${m.users.last_name}\n`);
    alert(msg);
}

// --- 15. UTILS (MODALS & TOASTS) ---
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

function setupMatchFilters() {
    const container = document.getElementById('view-matches');
    if(!document.getElementById('match-filter-tabs')) {
        const div = document.createElement('div');
        div.id = 'match-filter-tabs';
        div.className = "flex gap-2 mb-6 border-b border-gray-200 pb-2";
        div.innerHTML = `
            <button onclick="loadMatches('Scheduled')" id="btn-filter-scheduled" class="px-4 py-2 text-sm font-bold text-gray-500 hover:text-black transition-colors">Scheduled</button>
            <button onclick="loadMatches('Live')" id="btn-filter-live" class="px-4 py-2 text-sm font-bold text-gray-500 hover:text-black transition-colors">Live</button>
            <button onclick="loadMatches('Completed')" id="btn-filter-completed" class="px-4 py-2 text-sm font-bold text-gray-500 hover:text-black transition-colors">Completed</button>
        `;
        container.insertBefore(div, document.getElementById('matches-grid'));
    }
}

function injectToastContainer() {
    if(!document.getElementById('toast-container')) {
        const div = document.createElement('div');
        div.id = 'toast-container';
        div.className = 'fixed bottom-10 left-1/2 transform -translate-x-1/2 z-[70] transition-all duration-300 opacity-0 pointer-events-none translate-y-10';
        div.innerHTML = `<div id="toast-content" class="bg-gray-900 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3"><div id="toast-icon"></div><p id="toast-msg" class="text-sm font-bold"></p></div>`;
        document.body.appendChild(div);
    }
}

function showToast(msg, type) {
    const t = document.getElementById('toast-container');
    const txt = document.getElementById('toast-msg');
    const icon = document.getElementById('toast-icon');
    if(txt) txt.innerText = msg;
    if(icon) icon.innerHTML = type === 'error' ? '<i data-lucide="alert-circle" class="w-5 h-5 text-red-400"></i>' : '<i data-lucide="check-circle" class="w-5 h-5 text-green-400"></i>';
    if(window.lucide) lucide.createIcons();
    if(t) {
        t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
        setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10'), 3000);
    }
}
