// ==========================================
// URJA 2026 - ADMIN CONTROL CENTER
// ==========================================

// --- 1. CONFIGURATION & CLIENTS ---

if (typeof CONFIG === 'undefined' || typeof CONFIG_REALTIME === 'undefined') {
    console.error("CRITICAL ERROR: Configuration files missing.");
    alert("System Error: Config missing. Check console.");
}

const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
const realtimeClient = window.supabase.createClient(CONFIG_REALTIME.url, CONFIG_REALTIME.serviceKey);

// --- 2. STATE MANAGEMENT ---
let currentUser = null;
let currentView = 'dashboard';
let tempSchedule = []; 
let currentMatchViewFilter = 'Scheduled'; 

// Data Caches
let allTeamsCache = []; 
let dataCache = []; 
let allRegistrationsCache = []; 
let allSportsCache = [];
let allUsersCache = [];

// Sorting
let currentSort = { key: 'created_at', asc: false };

const DEFAULT_AVATAR = "https://t4.ftcdn.net/jpg/05/89/93/27/360_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.jpg";

// --- 3. INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    if(window.lucide) lucide.createIcons();
    injectToastContainer();
    injectScheduleModal();
    injectWinnerModal(); 

    await checkAdminAuth();
    
    // Default View
    window.switchView('dashboard');
});

// --- 4. AUTHENTICATION ---
async function checkAdminAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    const { data: user } = await supabaseClient
        .from('users').select('role, email').eq('id', session.user.id).single();

    if (!user || user.role !== 'admin') {
        alert("Access Denied: Admins Only");
        window.location.href = 'login.html';
        return;
    }
    
    currentUser = { ...session.user, email: user.email };
    loadDashboardStats();
}

window.adminLogout = function() {
    supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

async function logAdminAction(action, details) {
    try {
        await supabaseClient.from('admin_logs').insert({
            admin_email: currentUser.email,
            action: action,
            details: details
        });
    } catch (err) { console.error("Logging failed:", err); }
}

// --- 5. REALTIME SYNC ---
async function syncToRealtime(matchId) {
    const { data: match } = await supabaseClient.from('matches').select('*, sports(name)').eq('id', matchId).single();
    if (!match) return;

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
        winners_data: match.winners_data,
        performance_data: match.performance_data,
        updated_at: new Date()
    };

    await realtimeClient.from('live_matches').upsert(payload);
}

// --- 6. VIEW NAVIGATION ---
window.switchView = function(viewId) {
    currentView = viewId;
    
    // Toggle Sections
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById('view-' + viewId);
    if(target) {
        target.classList.remove('hidden');
        target.classList.remove('animate-fade-in');
        void target.offsetWidth; // Trigger reflow
        target.classList.add('animate-fade-in');
    }

    // Toggle Nav State
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navBtn = document.getElementById('nav-' + viewId);
    if(navBtn) navBtn.classList.add('active');

    // Header Update
    const titleEl = document.getElementById('page-title');
    if(titleEl) titleEl.innerText = viewId.charAt(0).toUpperCase() + viewId.slice(1);

    // Global Actions (Export buttons)
    const globalActions = document.getElementById('global-actions');
    if(globalActions) {
        globalActions.classList.toggle('hidden', !['users', 'teams', 'matches', 'logs', 'registrations'].includes(viewId));
    }

    // Load Data based on view
    if(viewId === 'users') loadUsersList();
    if(viewId === 'sports') loadSportsList();
    if(viewId === 'matches') { setupMatchFilters(); loadMatches('Scheduled'); }
    if(viewId === 'teams') loadTeamsList();
    if(viewId === 'logs') loadActivityLogs();
    if(viewId === 'registrations') loadRegistrationsList();
}

window.exportCurrentPage = function(type) {
    if (!dataCache || dataCache.length === 0) return showToast("No data to export", "error");
    const filename = `urja_${currentView}_${new Date().toISOString().split('T')[0]}`;

    if (type === 'excel') {
        const ws = XLSX.utils.json_to_sheet(dataCache);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
        XLSX.writeFile(wb, `${filename}.xlsx`);
    } else if (type === 'pdf') {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l');
        const headers = Object.keys(dataCache[0]).map(k => k.toUpperCase());
        const rows = dataCache.map(obj => Object.values(obj).map(v => String(v)));
        doc.text(`URJA 2026 - ${currentView.toUpperCase()}`, 14, 22);
        doc.autoTable({ head: [headers], body: rows, startY: 30, theme: 'grid', styles: { fontSize: 8 } });
        doc.save(`${filename}.pdf`);
    }
}

// --- 7. DASHBOARD STATS ---
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

// --- 8. SPORTS MANAGEMENT ---
window.loadSportsList = async function() {
    const tablePerf = document.getElementById('sports-table-performance');
    const tableTourn = document.getElementById('sports-table-tournament');
    
    if(tablePerf) tablePerf.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400">Loading...</td></tr>';
    if(tableTourn) tableTourn.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400">Loading...</td></tr>';

    const { data: sports } = await supabaseClient.from('sports').select('*').order('name');
    
    // Check active status
    const { data: activeMatches } = await supabaseClient.from('matches').select('sport_id, match_type, status').neq('status', 'Completed');

    // Helper to check if a specific category is active
    const isActive = (id, type) => activeMatches?.some(m => m.sport_id === id && m.match_type?.includes(type));

    if(!sports || sports.length === 0) return;

    let perfHtml = '';
    let tourHtml = '';

    sports.forEach(s => {
        let actionBtn = '';

        if (s.is_performance) {
            // Performance Buttons
            const jrActive = isActive(s.id, 'Junior') || isActive(s.id, 'Jr');
            const srActive = isActive(s.id, 'Senior') || isActive(s.id, 'Sr');

            const btnJr = jrActive 
                ? `<span class="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">Jr Active</span>`
                : `<button onclick="window.handleScheduleClick('${s.id}', '${s.name}', true, '${s.type}', 'Junior')" class="px-3 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold hover:bg-blue-700 shadow-sm">Start Jr</button>`;

            const btnSr = srActive
                ? `<span class="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">Sr Active</span>`
                : `<button onclick="window.handleScheduleClick('${s.id}', '${s.name}', true, '${s.type}', 'Senior')" class="px-3 py-1.5 bg-black text-white rounded text-[10px] font-bold hover:bg-gray-800 shadow-sm">Start Sr</button>`;
            
            actionBtn = `<div class="flex items-center gap-2 justify-end">${btnJr} ${btnSr}</div>`;

        } else {
            // Tournament Buttons
            const jrActive = isActive(s.id, 'Junior');
            const srActive = isActive(s.id, 'Senior');

            const btnJr = jrActive 
                ? `<span class="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">Jr Live</span>`
                : `<button onclick="window.handleScheduleClick('${s.id}', '${s.name}', false, '${s.type}', 'Junior')" class="px-3 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold hover:bg-blue-700 shadow-sm">Sched Jr</button>`;

            const btnSr = srActive
                ? `<span class="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">Sr Live</span>`
                : `<button onclick="window.handleScheduleClick('${s.id}', '${s.name}', false, '${s.type}', 'Senior')" class="px-3 py-1.5 bg-black text-white rounded text-[10px] font-bold hover:bg-gray-800 shadow-sm">Sched Sr</button>`;

            const btnPodium = `<button onclick="window.openForceWinnerModal('${s.id}', '${s.name}')" class="p-1.5 bg-yellow-50 text-yellow-600 rounded hover:bg-yellow-100 border border-yellow-200" title="Declare Medals"><i data-lucide="crown" class="w-3.5 h-3.5"></i></button>`;

            actionBtn = `<div class="flex items-center gap-2 justify-end">${btnJr} ${btnSr} ${btnPodium}</div>`;
        }
        
        const closeBtn = `<button onclick="window.toggleSportStatus('${s.id}', '${s.status}')" class="text-xs font-bold underline text-gray-400 hover:text-gray-600 ml-4">${s.status === 'Open' ? 'Close Reg' : 'Open Reg'}</button>`;

        const rowHtml = `
        <tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
            <td class="p-4 font-bold text-gray-800">${s.name}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold ${s.status === 'Open' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}">${s.status}</span></td>
            <td class="p-4 text-right flex items-center justify-end gap-2">
                ${actionBtn}
                ${closeBtn}
            </td>
        </tr>`;

        if (s.is_performance) perfHtml += rowHtml;
        else tourHtml += rowHtml;
    });

    if(tablePerf) tablePerf.innerHTML = perfHtml || '<tr><td colspan="3" class="p-4 text-center text-gray-400 italic">No events found.</td></tr>';
    if(tableTourn) tableTourn.innerHTML = tourHtml || '<tr><td colspan="3" class="p-4 text-center text-gray-400 italic">No tournaments found.</td></tr>';
    
    if(window.lucide) lucide.createIcons();
}

window.openAddSportModal = () => document.getElementById('modal-add-sport').classList.remove('hidden');

window.handleAddSport = async function(e) {
    e.preventDefault();
    const name = document.getElementById('new-sport-name').value;
    const type = document.getElementById('new-sport-type').value;
    const size = document.getElementById('new-sport-size').value;

    const isPerformance = name.toLowerCase().includes('race') || 
                          name.toLowerCase().includes('jump') || 
                          name.toLowerCase().includes('throw');

    const unit = isPerformance ? (name.toLowerCase().includes('race') ? 'Seconds' : 'Meters') : 'Points';

    const { error } = await supabaseClient.from('sports').insert({
        name, type, team_size: size, icon: 'trophy', 
        is_performance: isPerformance, 
        unit: unit
    });

    if(error) showToast(error.message, "error");
    else {
        showToast("Sport Added!", "success");
        window.closeModal('modal-add-sport');
        loadSportsList();
    }
}

window.toggleSportStatus = async function(id, currentStatus) {
    const newStatus = currentStatus === 'Open' ? 'Closed' : 'Open';
    await supabaseClient.from('sports').update({ status: newStatus }).eq('id', id);
    loadSportsList();
}

// --- 8. SCHEDULER LOGIC (FIXED) ---

window.handleScheduleClick = async function(sportId, sportName, isPerformance, sportType, category) {
    if (isPerformance) {
        if (confirm(`Start ${sportName} (${category})?`)) {
            await initPerformanceEvent(sportId, sportName, category);
        }
    } else {
        await initTournamentRound(sportId, sportName, sportType, category);
    }
}

async function initPerformanceEvent(sportId, sportName, category) {
    const { data: existing } = await supabaseClient.from('matches')
        .select('id')
        .eq('sport_id', sportId)
        .ilike('match_type', `%${category}%`)
        .neq('status', 'Completed');

    if (existing && existing.length > 0) return showToast(`${category} Event already active!`, "info");

    const { data: regs } = await supabaseClient.from('registrations')
        .select('user_id, users(first_name, last_name, student_id, class_name)')
        .eq('sport_id', sportId);

    if (!regs || regs.length === 0) return showToast("No registrations found.", "error");

    let participants = [];
    if (category === 'Junior') {
        participants = regs.filter(r => ['FYJC', 'SYJC'].includes(r.users.class_name));
    } else {
        participants = regs.filter(r => !['FYJC', 'SYJC'].includes(r.users.class_name));
    }

    if (participants.length === 0) return showToast(`No ${category} participants found.`, "error");

    const pData = participants.map(r => ({
        id: r.user_id,
        name: `${r.users.first_name} ${r.users.last_name} (${r.users.student_id})`,
        result: '',
        rank: 0
    }));

    const typeSuffix = category === 'Junior' ? '(Jr)' : '(Sr)';

    const { data: newMatch, error } = await supabaseClient.from('matches').insert({
        sport_id: sportId,
        team1_name: `${sportName} (${category})`,
        team2_name: 'Participants',
        status: 'Live',
        is_live: true,
        performance_data: pData,
        match_type: `Performance ${typeSuffix}`
    }).select().single();

    if (error) showToast(error.message, "error");
    else {
        showToast(`${category} Event Started!`, "success");
        syncToRealtime(newMatch.id);
        loadSportsList();
    }
}

// *** CRITICAL FIX FOR TOURNAMENT ROUNDS ***
async function initTournamentRound(sportId, sportName, sportType, category) {
    showToast(`Analyzing ${category} Bracket...`, "info");
    const intSportId = parseInt(sportId); 

    // 1. Get ALL matches for this category to determine current state
    const { data: catMatches } = await supabaseClient.from('matches')
        .select('round_number, status, match_type')
        .eq('sport_id', intSportId)
        .ilike('match_type', `%${category}%`) // Strictly filter by category
        .order('round_number', { ascending: false });

    // Check if any match in this category is still unfinished
    const pending = catMatches?.filter(m => m.status !== 'Completed');
    if (pending && pending.length > 0) return showToast(`Finish active ${category} matches first!`, "error");

    let nextRound = 1;
    let candidates = [];

    // --- CASE 1: NO MATCHES YET (ROUND 1) ---
    if (!catMatches || catMatches.length === 0) {
        if (sportType === 'Individual') {
            await supabaseClient.rpc('prepare_individual_teams', { sport_id_input: intSportId });
        }
        await supabaseClient.rpc('auto_lock_tournament_teams', { sport_id_input: intSportId });

        const { data: allTeams } = await supabaseClient.rpc('get_tournament_teams', { sport_id_input: intSportId });
        
        if (allTeams) {
            candidates = allTeams.filter(t => t.category === category).map(t => ({ id: t.team_id, name: t.team_name }));
        }

        if (!candidates || candidates.length < 2) return showToast(`Need at least 2 ${category} teams.`, "error");
    } 
    // --- CASE 2: GENERATE NEXT ROUND ---
    else {
        const lastRound = catMatches[0].round_number;
        nextRound = lastRound + 1;

        // 1. Fetch Winners from Previous Round
        const { data: winners } = await supabaseClient.from('matches')
            .select('winner_id')
            .eq('sport_id', intSportId)
            .eq('round_number', lastRound)
            .ilike('match_type', `%${category}%`) // Filter by category
            .not('winner_id', 'is', null);

        if (!winners || winners.length < 2) return showToast(`${category} Tournament Completed! Winner Declared.`, "success");

        const winnerIds = winners.map(w => w.winner_id);

        // 2. EXCLUDE teams that are ALREADY in the Next Round (This fixes the duplicate bug)
        const { data: alreadyScheduled } = await supabaseClient.from('matches')
            .select('team1_id, team2_id')
            .eq('sport_id', intSportId)
            .eq('round_number', nextRound)
            .ilike('match_type', `%${category}%`);

        const scheduledIds = [];
        if(alreadyScheduled) {
            alreadyScheduled.forEach(m => {
                if(m.team1_id) scheduledIds.push(m.team1_id);
                if(m.team2_id) scheduledIds.push(m.team2_id);
            });
        }

        // Filter valid winners
        const validWinnerIds = winnerIds.filter(id => !scheduledIds.includes(id));

        if (validWinnerIds.length < 2) return showToast("Not enough pending winners for next round.", "info");

        const { data: teamDetails } = await supabaseClient.from('teams').select('id, name').in('id', validWinnerIds);
        candidates = teamDetails.map(t => ({ id: t.id, name: t.name }));
    }

    // --- PAIRING ---
    tempSchedule = [];
    
    let matchType = 'Regular';
    if (candidates.length === 2) matchType = 'Final';
    else if (candidates.length <= 4) matchType = 'Semi-Final';
    else if (candidates.length <= 8) matchType = 'Quarter-Final';

    matchType += ` (${category})`;

    candidates.sort(() => Math.random() - 0.5); 
    generatePairsFromList(candidates, nextRound, matchType);

    if(tempSchedule.length > 0) {
        openSchedulePreviewModal(sportName, `${nextRound} (${category})`, tempSchedule, intSportId);
    } else {
        showToast("No matches to schedule.", "info");
    }
}

function generatePairsFromList(list, round, matchType) {
    // Handle odd number with a BYE
    if (list.length % 2 !== 0) {
        const luckyTeam = list.pop(); 
        tempSchedule.push({
            t1: luckyTeam,
            t2: { id: null, name: "BYE (Auto-Advance)" },
            time: "10:00",
            location: "N/A",
            round: round,
            type: 'Bye Round'
        });
    }
    for (let i = 0; i < list.length; i += 2) {
        tempSchedule.push({
            t1: list[i],
            t2: list[i+1],
            time: "10:00",
            location: "College Ground",
            round: round,
            type: matchType
        });
    }
}

function openSchedulePreviewModal(sportName, roundLabel, schedule, sportId) {
    const titleEl = document.getElementById('preview-subtitle');
    const container = document.getElementById('schedule-preview-list');
    
    if(!titleEl || !container) {
        injectScheduleModal();
        // Retry quickly if modal wasn't injected yet
        setTimeout(() => openSchedulePreviewModal(sportName, roundLabel, schedule, sportId), 50);
        return;
    }

    titleEl.innerText = `Generating: Round ${roundLabel}`;
    const venueOptions = `<option value="College Ground">College Ground</option><option value="Badminton Hall">Badminton Hall</option><option value="Old Gymkhana">Old Gymkhana</option>`;

    container.innerHTML = schedule.map((m, idx) => `
        <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-center gap-4">
            <div class="flex-1 text-center md:text-left">
                <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">${m.type}</span>
                <div class="font-bold text-gray-900 text-lg">${m.t1.name}</div>
                <div class="text-xs text-gray-400 font-bold my-1">VS</div>
                <div class="font-bold text-gray-900 text-lg ${m.t2.id ? '' : 'text-gray-400 italic'}">${m.t2.name}</div>
            </div>
            ${m.t2.id ? `
            <div class="flex gap-2 w-full md:w-auto">
                <input type="time" class="input-field p-2 w-full md:w-24 bg-gray-50 border rounded-lg text-sm font-bold" value="${m.time}" onchange="updateTempSchedule(${idx}, 'time', this.value)">
                <select class="input-field p-2 w-full md:w-40 bg-gray-50 border rounded-lg text-sm font-bold" onchange="updateTempSchedule(${idx}, 'location', this.value)">${venueOptions}</select>
            </div>` : `<span class="text-xs font-bold text-green-500 bg-green-50 px-2 py-1 rounded">Walkover</span>`}
        </div>
    `).join('');

    document.getElementById('btn-confirm-schedule').onclick = () => confirmSchedule(sportId);
    document.getElementById('modal-schedule-preview').classList.remove('hidden');
}

window.updateTempSchedule = (idx, field, value) => tempSchedule[idx][field] = value;

async function confirmSchedule(sportId) {
    const btn = document.getElementById('btn-confirm-schedule');
    btn.innerText = "Publishing...";
    btn.disabled = true;

    const inserts = tempSchedule.map(m => ({
        sport_id: sportId,
        team1_id: m.t1.id,
        team2_id: m.t2.id,
        team1_name: m.t1.name,
        team2_name: m.t2.name,
        start_time: new Date().toISOString().split('T')[0] + 'T' + m.time,
        location: m.location,
        round_number: m.round,
        status: m.t2.id ? 'Scheduled' : 'Completed', 
        winner_id: m.t2.id ? null : m.t1.id,         
        winner_text: m.t2.id ? null : `${m.t1.name} (Bye)`,
        match_type: m.type
    }));

    const { error } = await supabaseClient.from('matches').insert(inserts);

    if(error) {
        showToast(error.message, "error");
        btn.innerText = "Confirm & Publish";
        btn.disabled = false;
    } else {
        showToast("Round Generated Successfully!", "success");
        window.closeModal('modal-schedule-preview');
        loadSportsList();
        loadMatches('Scheduled');
    }
}

// --- 9. MATCH LIST ---
window.loadMatches = async function(statusFilter) {
    currentMatchViewFilter = statusFilter;
    
    // Tab Styling
    const tabIds = { 'Scheduled': 'btn-filter-scheduled', 'Live': 'btn-filter-live', 'Completed': 'btn-filter-completed' };
    Object.keys(tabIds).forEach(key => {
        const el = document.getElementById(tabIds[key]);
        if(el) {
            el.className = key === statusFilter 
                ? "px-4 py-2 text-sm font-bold text-black border-b-2 border-black" 
                : "px-4 py-2 text-sm font-bold text-gray-500 hover:text-black";
        }
    });

    const container = document.getElementById('matches-grid');
    if(!container) return;
    container.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading...</p>';

    const { data: matches } = await supabaseClient
        .from('matches')
        .select('*, sports(name, is_performance)')
        .eq('status', statusFilter)
        .order('start_time', { ascending: true });

    if (!matches || matches.length === 0) {
        container.innerHTML = `<p class="col-span-3 text-center text-gray-400 py-10">No ${statusFilter} matches.</p>`;
        return;
    }

    dataCache = matches;
    container.innerHTML = matches.map(m => `
        <div class="bg-white p-5 rounded-3xl border border-gray-200 shadow-sm relative overflow-hidden">
            <div class="flex justify-between mb-4">
                 <span class="text-[10px] font-bold bg-gray-100 px-2 py-1 rounded text-gray-500 uppercase">${m.sports.name}</span>
                 ${m.status === 'Live' ? '<span class="text-red-600 font-bold text-xs animate-pulse">● LIVE</span>' : ''}
            </div>
            ${m.sports.is_performance ? 
                `<div class="text-center py-2"><h4 class="font-black text-xl">${m.team1_name}</h4></div>` : 
                `<div class="flex justify-between items-center mb-4"><h4 class="font-bold w-1/3 truncate">${m.team1_name}</h4><span class="text-gray-300 text-xs">VS</span><h4 class="font-bold w-1/3 truncate text-right">${m.team2_name}</h4></div>`
            }
            <div class="border-t pt-3 flex justify-between items-center text-xs text-gray-500">
                 <span>${m.match_type || '-'}</span>
                 ${m.status === 'Scheduled' ? `<button onclick="window.startMatch('${m.id}')" class="text-green-600 font-bold hover:underline">Start</button>` : ''}
                 ${m.status === 'Live' && m.sports.is_performance ? `<button onclick="window.endPerformanceEvent('${m.id}')" class="text-red-600 font-bold hover:underline">End</button>` : ''}
            </div>
        </div>`).join('');
}

window.startMatch = async function(matchId) {
    if(!confirm("Start match?")) return;
    await supabaseClient.from('matches').update({ status: 'Live', is_live: true }).eq('id', matchId);
    showToast("Match LIVE!", "success");
    syncToRealtime(matchId);
    loadMatches('Live');
}

// --- 10. REALTIME SYNC (Data Sender) ---
async function syncToRealtime(matchId) {
    const { data: match } = await supabaseClient.from('matches').select('*, sports(name)').eq('id', matchId).single();
    if (!match) return;

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
        winners_data: match.winners_data,
        performance_data: match.performance_data, // IMPORTANT for races
        updated_at: new Date()
    };

    await realtimeClient.from('live_matches').upsert(payload);
}

// --- 11. WINNER DECLARATION ---
window.openForceWinnerModal = async function(sportId, sportName) {
    const { data: teams } = await supabaseClient.from('teams').select('id, name').eq('sport_id', sportId);
    const opts = `<option value="">-- None --</option>` + (teams||[]).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    
    ['fw-gold','fw-silver','fw-bronze'].forEach(id => document.getElementById(id).innerHTML = opts);
    
    document.getElementById('btn-confirm-winner').onclick = () => confirmForceWinner(sportId, sportName);
    document.getElementById('modal-force-winner').classList.remove('hidden');
}

window.confirmForceWinner = async function(sportId, sportName) {
    const gId = document.getElementById('fw-gold').value;
    const sId = document.getElementById('fw-silver').value;
    const bId = document.getElementById('fw-bronze').value;
    const cat = document.querySelector('input[name="fw-cat"]:checked').value;

    if(!gId) return showToast("Select a Gold winner.", "error");

    const getTxt = (id) => { const el = document.getElementById(id); return el.selectedIndex > 0 ? el.options[el.selectedIndex].text : '-'; };
    const winnersData = { gold: getTxt('fw-gold'), silver: getTxt('fw-silver'), bronze: getTxt('fw-bronze') };
    const winnerText = `Gold: ${winnersData.gold}, Silver: ${winnersData.silver}, Bronze: ${winnersData.bronze}`;
    const resultName = `Tournament Result (${cat})`;

    const { data: existing } = await supabaseClient.from('matches').select('id').eq('sport_id', sportId).eq('team1_name', resultName).single();

    let mId;
    const payload = { winner_id: gId, winner_text: winnerText, winners_data: winnersData, status: 'Completed', match_type: `Final (${cat})`, is_live: false };

    if (existing) {
        await supabaseClient.from('matches').update(payload).eq('id', existing.id);
        mId = existing.id;
    } else {
        const { data: nm } = await supabaseClient.from('matches').insert({
            sport_id: sportId, team1_name: resultName, team2_name: "Official Declaration",
            start_time: new Date().toISOString(), location: "Admin Panel", round_number: 100, ...payload
        }).select().single();
        mId = nm.id;
    }

    syncToRealtime(mId);
    showToast(`Podium Declared (${cat})!`, "success");
    window.closeModal('modal-force-winner');
}

// --- 12. UTILS ---
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

function setupMatchFilters() {
    if(document.getElementById('match-filter-tabs')) return;
    const div = document.createElement('div');
    div.id = 'match-filter-tabs';
    div.className = "flex gap-2 mb-6 border-b pb-2";
    div.innerHTML = `<button id="btn-filter-scheduled" onclick="loadMatches('Scheduled')">Scheduled</button><button id="btn-filter-live" onclick="loadMatches('Live')">Live</button><button id="btn-filter-completed" onclick="loadMatches('Completed')">Completed</button>`;
    document.getElementById('view-matches').insertBefore(div, document.getElementById('matches-grid'));
}

function injectScheduleModal() {
    if(document.getElementById('modal-schedule-preview')) return;
    const div = document.createElement('div');
    div.id = 'modal-schedule-preview';
    div.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
    div.innerHTML = `<div class="bg-white p-6 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto m-4"><div class="flex justify-between items-center mb-6"><div><h3 class="font-bold text-xl">Schedule</h3><p id="preview-subtitle" class="text-sm text-gray-500">Generating...</p></div><button onclick="closeModal('modal-schedule-preview')" class="p-2 bg-gray-100 rounded-full"><i data-lucide="x" class="w-5 h-5"></i></button></div><div id="schedule-preview-list" class="space-y-3 mb-6"></div><button id="btn-confirm-schedule" class="w-full py-3 bg-black text-white font-bold rounded-xl shadow-lg">Confirm & Publish</button></div>`;
    document.body.appendChild(div);
}

function injectWinnerModal() {
    if(document.getElementById('modal-force-winner')) return;
    const div = document.createElement('div');
    div.id = 'modal-force-winner';
    div.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
    div.innerHTML = `
        <div class="bg-white p-6 rounded-2xl w-96">
            <h3 class="font-bold text-lg mb-4">Declare Winners</h3>
            <div id="fw-category-container" class="mb-4">
                <label class="text-xs font-bold text-gray-400 uppercase">Category</label>
                <div class="flex gap-4 mt-2">
                    <label class="flex items-center gap-2 text-sm font-bold"><input type="radio" name="fw-cat" value="Junior" checked class="accent-black"> Junior</label>
                    <label class="flex items-center gap-2 text-sm font-bold"><input type="radio" name="fw-cat" value="Senior" class="accent-black"> Senior</label>
                </div>
            </div>
            <div class="space-y-2 mb-4">
                <label class="text-xs font-bold text-yellow-500">GOLD</label><select id="fw-gold" class="w-full p-2 border rounded-lg text-sm"></select>
                <label class="text-xs font-bold text-gray-400">SILVER</label><select id="fw-silver" class="w-full p-2 border rounded-lg text-sm"></select>
                <label class="text-xs font-bold text-orange-400">BRONZE</label><select id="fw-bronze" class="w-full p-2 border rounded-lg text-sm"></select>
            </div>
            <div class="flex gap-2">
                <button onclick="closeModal('modal-force-winner')" class="flex-1 py-2 bg-gray-100 rounded-lg text-sm font-bold">Cancel</button>
                <button id="btn-confirm-winner" class="flex-1 py-2 bg-black text-white rounded-lg text-sm font-bold">Confirm</button>
            </div>
        </div>`;
    document.body.appendChild(div);
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

// --- 13. REGISTRATIONS & USERS ---
// (Minimal implementations to keep file complete but concise for critical logic)
window.loadRegistrationsList = async function() {
    const tbody = document.getElementById('registrations-table-body');
    if(tbody) {
        const { data } = await supabaseClient.from('registrations').select(`id, created_at, users (first_name, last_name, student_id, class_name, gender, mobile, email), sports (name)`).order('created_at', { ascending: false });
        allRegistrationsCache = data || [];
        renderRegistrations(allRegistrationsCache);
    }
}
function renderRegistrations(data) {
    const tbody = document.getElementById('registrations-table-body');
    if(!tbody) return;
    document.getElementById('reg-count').innerText = data.length;
    tbody.innerHTML = data.map(r => `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="p-4"><div class="font-bold">${r.users.first_name} ${r.users.last_name}</div><div class="text-xs text-gray-500">${r.users.email}</div></td>
            <td class="p-4"><span class="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold uppercase">${r.sports.name}</span></td>
            <td class="p-4 text-sm">${r.users.class_name} (${r.users.student_id})</td>
            <td class="p-4 text-sm">${r.users.gender}</td>
            <td class="p-4 text-sm font-mono">${r.users.mobile}</td>
            <td class="p-4 text-right text-xs text-gray-400 font-bold">${new Date(r.created_at).toLocaleDateString()}</td>
        </tr>`).join('');
}
window.filterRegistrations = function() {
    const s = document.getElementById('reg-search').value.toLowerCase();
    renderRegistrations(allRegistrationsCache.filter(r => (r.users.first_name.toLowerCase().includes(s) || r.users.student_id.toLowerCase().includes(s))));
}
window.loadUsersList = async function() {
    const tbody = document.getElementById('users-table-body');
    if(!tbody) return;
    const { data } = await supabaseClient.from('users').select('*').order('created_at', { ascending: false });
    tbody.innerHTML = data.map(u => `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="p-4 font-bold">${u.first_name} ${u.last_name}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold bg-gray-100">${u.role}</span></td>
            <td class="p-4">${u.class_name}</td>
            <td class="p-4 text-center">-</td>
            <td class="p-4 text-right"><button onclick="alert('Manage User')" class="text-xs bg-gray-100 px-2 py-1 rounded">Edit</button></td>
        </tr>`).join('');
}
window.loadTeamsList = async function() {
    const grid = document.getElementById('teams-grid');
    if(!grid) return;
    const { data } = await supabaseClient.from('teams').select('*, sports(name)').order('created_at', { ascending: false });
    grid.innerHTML = data.map(t => `<div class="bg-white p-4 rounded shadow-sm border border-gray-100"><h4 class="font-bold">${t.name}</h4><p class="text-xs text-gray-500">${t.sports.name} • ${t.status}</p></div>`).join('');
}
