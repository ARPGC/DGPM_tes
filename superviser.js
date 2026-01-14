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
let tempSchedule = []; 
let currentMatchViewFilter = 'Scheduled'; 

// Data Caches (for Search & Export)
let allTeamsCache = []; 
let dataCache = []; 
let allRegistrationsCache = []; 
let allSportsCache = [];
let allUsersCache = [];

// Sorting State
let currentSort = { key: 'created_at', asc: false };

const DEFAULT_AVATAR = "https://t4.ftcdn.net/jpg/05/89/93/27/360_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.jpg";

// --- 3. INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize UI Libs
    if(window.lucide) lucide.createIcons();
    injectToastContainer();
    injectScheduleModal();
    injectWinnerModal(); // New Force Winner Modal

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

function adminLogout() {
    supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

// --- 5. LOGGING SYSTEM ---
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
        if (['users', 'teams', 'matches', 'logs', 'registrations'].includes(viewId)) {
            globalActions.classList.remove('hidden');
        } else {
            globalActions.classList.add('hidden');
        }
    }

    // 5. Data Loaders
    dataCache = []; // Clear export cache
    if(viewId === 'users') loadUsersList();
    if(viewId === 'sports') loadSportsList();
    if(viewId === 'matches') { setupMatchFilters(); loadMatches('Scheduled'); }
    if(viewId === 'teams') loadTeamsList();
    if(viewId === 'logs') loadActivityLogs();
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

// --- 10. SPORTS MANAGEMENT (UPDATED: SPLIT BUTTONS) ---
async function loadSportsList() {
    const tablePerf = document.getElementById('sports-table-performance');
    const tableTourn = document.getElementById('sports-table-tournament');
    
    if(tablePerf) tablePerf.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400">Loading...</td></tr>';
    if(tableTourn) tableTourn.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400">Loading...</td></tr>';

    const { data: sports } = await supabaseClient.from('sports').select('*').order('name');
    
    // Fetch Active Matches to Determine Status
    const { data: activeMatches } = await supabaseClient.from('matches')
        .select('sport_id, match_type')
        .neq('status', 'Completed');

    // Categorize Active Matches
    const activeJr = activeMatches?.filter(m => m.match_type?.includes('(Jr)') || m.match_type?.includes('(Junior)')).map(m => m.sport_id) || [];
    const activeSr = activeMatches?.filter(m => m.match_type?.includes('(Sr)') || m.match_type?.includes('(Senior)')).map(m => m.sport_id) || [];

    allSportsCache = sports || [];

    if(!sports || sports.length === 0) return;

    let perfHtml = '';
    let tourHtml = '';

    sports.forEach(s => {
        const isJrActive = activeJr.includes(s.id);
        const isSrActive = activeSr.includes(s.id);

        let actionBtn = '';

        if (s.is_performance) {
            // PERFORMANCE: Two distinct start buttons
            const btnJr = isJrActive 
                ? `<span class="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">Jr Active</span>`
                : `<button onclick="window.handleScheduleClick('${s.id}', '${s.name}', true, '${s.type}', 'Junior')" class="px-3 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold hover:bg-blue-700 shadow-sm">Start Jr</button>`;

            const btnSr = isSrActive
                ? `<span class="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">Sr Active</span>`
                : `<button onclick="window.handleScheduleClick('${s.id}', '${s.name}', true, '${s.type}', 'Senior')" class="px-3 py-1.5 bg-black text-white rounded text-[10px] font-bold hover:bg-gray-800 shadow-sm">Start Sr</button>`;
            
            actionBtn = `<div class="flex items-center gap-2 justify-end">${btnJr} ${btnSr}</div>`;

        } else {
            // TOURNAMENT: Two distinct schedule buttons
            const btnJr = isJrActive 
                ? `<span class="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">Jr Live</span>`
                : `<button onclick="window.handleScheduleClick('${s.id}', '${s.name}', false, '${s.type}', 'Junior')" class="px-3 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold hover:bg-blue-700 shadow-sm">Sched Jr</button>`;

            const btnSr = isSrActive
                ? `<span class="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">Sr Live</span>`
                : `<button onclick="window.handleScheduleClick('${s.id}', '${s.name}', false, '${s.type}', 'Senior')" class="px-3 py-1.5 bg-black text-white rounded text-[10px] font-bold hover:bg-gray-800 shadow-sm">Sched Sr</button>`;

            const btnPodium = `<button onclick="openForceWinnerModal('${s.id}', '${s.name}')" class="p-1.5 bg-yellow-50 text-yellow-600 rounded hover:bg-yellow-100 border border-yellow-200" title="Declare Medals"><i data-lucide="crown" class="w-3.5 h-3.5"></i></button>`;

            actionBtn = `<div class="flex items-center gap-2 justify-end">${btnJr} ${btnSr} ${btnPodium}</div>`;
        }
        
        const closeBtn = `<button onclick="toggleSportStatus('${s.id}', '${s.status}')" class="text-xs font-bold underline text-gray-400 hover:text-gray-600 ml-4">${s.status === 'Open' ? 'Close Reg' : 'Open Reg'}</button>`;

        const rowHtml = `
        <tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
            <td class="p-4 font-bold text-gray-800">${s.name}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold ${s.status === 'Open' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}">${s.status}</span></td>
            <td class="p-4 text-right flex items-center justify-end gap-4">
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
        logAdminAction('ADD_SPORT', `Added ${name}`);
        closeModal('modal-add-sport');
        loadSportsList();
    }
}

window.toggleSportStatus = async function(id, currentStatus) {
    const newStatus = currentStatus === 'Open' ? 'Closed' : 'Open';
    await supabaseClient.from('sports').update({ status: newStatus }).eq('id', id);
    logAdminAction('TOGGLE_SPORT', `Changed sport status to ${newStatus}`);
    loadSportsList();
}

// --- 11. SCHEDULER & EVENT ENGINE ---

window.handleScheduleClick = async function(sportId, sportName, isPerformance, sportType, category) {
    if (isPerformance) {
        if (confirm(`Start ${sportName} (${category})?`)) {
            await initPerformanceEvent(sportId, sportName, category);
        }
    } else {
        await initTournamentRound(sportId, sportName, sportType, category);
    }
}

// A. PERFORMANCE EVENTS (Now Category Aware)
async function initPerformanceEvent(sportId, sportName, category) {
    // Check for existing active match of this category
    const { data: existing } = await supabaseClient.from('matches')
        .select('id')
        .eq('sport_id', sportId)
        .ilike('match_type', `%(${category})%`)
        .neq('status', 'Completed');

    if (existing && existing.length > 0) return showToast(`${category} Event is already active!`, "info");

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
        logAdminAction('START_EVENT', `${sportName} ${category}`);
        // Sync Initial State
        syncToRealtime(newMatch.id);
        loadSportsList();
    }
}

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
        loadSportsList(); 
    }
}

// B. TOURNAMENT SCHEDULER (Smart Category)
async function initTournamentRound(sportId, sportName, sportType, category) {
    showToast(`Analyzing ${category} Bracket...`, "info");
    const intSportId = parseInt(sportId); 

    // Get Matches for THIS category
    const { data: matches } = await supabaseClient.from('matches').select('round_number, match_type, status').eq('sport_id', intSportId);
    
    const catMatches = matches?.filter(m => m.match_type.includes(category)) || [];

    // Check pending
    if (catMatches.some(m => m.status !== 'Completed')) return showToast(`Finish active ${category} matches first!`, "error");

    let round = 1;
    if (catMatches.length > 0) {
        round = Math.max(...catMatches.map(m => m.round_number)) + 1;
    }

    let candidates = [];

    // --- ROUND 1 ---
    if (round === 1) {
        if (sportType === 'Individual') {
            await supabaseClient.rpc('prepare_individual_teams', { sport_id_input: intSportId });
        }
        await supabaseClient.rpc('auto_lock_tournament_teams', { sport_id_input: intSportId });

        const { data: validTeams } = await supabaseClient.rpc('get_tournament_teams', { sport_id_input: intSportId });
        if (!validTeams || validTeams.length < 2) return showToast("Need at least 2 VALID TEAMS.", "error");

        // Filter by Category
        candidates = validTeams.filter(t => t.category === category).map(t => ({ id: t.team_id, name: t.team_name }));
    } 
    // --- NEXT ROUNDS ---
    else {
        const { data: winners } = await supabaseClient.from('matches')
            .select('winner_id, match_type')
            .eq('sport_id', intSportId)
            .ilike('match_type', `%${category}%`)
            .not('winner_id', 'is', null);

        // Simple progression logic: All winners are candidates (In production, filter strictly by prev round)
        const winnerIds = winners.map(w => w.winner_id);
        const { data: teamDetails } = await supabaseClient.from('teams').select('id, name').in('id', winnerIds);
        
        candidates = teamDetails.map(t => ({id: t.id, name: t.name}));
    }

    if (!candidates || candidates.length < 2) return showToast(`Not enough ${category} teams to schedule.`, "info");

    // --- PAIRING LOGIC ---
    tempSchedule = [];
    
    let matchType = 'Regular';
    if (candidates.length === 2) matchType = 'Final';
    else if (candidates.length <= 4) matchType = 'Semi-Final';
    else if (candidates.length <= 8) matchType = 'Quarter-Final';

    matchType += ` (${category})`;

    candidates.sort(() => Math.random() - 0.5); 
    generatePairsFromList(candidates, round, matchType);

    openSchedulePreviewModal(sportName, `${round} (${category})`, tempSchedule, intSportId);
}

function generatePairsFromList(list, round, matchType) {
    if (list.length % 2 !== 0) {
        const luckyTeam = list.pop(); 
        tempSchedule.push({
            t1: luckyTeam,
            t2: { id: null, name: "BYE (Auto-Advance)" },
            time: "10:00",
            location: "N/A",
            round: round,
            type: `Bye Round`
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

function openSchedulePreviewModal(sportName, round, schedule, sportId) {
    const titleEl = document.getElementById('preview-subtitle');
    const container = document.getElementById('schedule-preview-list');
    
    if(!titleEl || !container) {
        injectScheduleModal();
        setTimeout(() => openSchedulePreviewModal(sportName, round, schedule, sportId), 100);
        return;
    }

    titleEl.innerText = `Generating Round ${round}`;
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
        logAdminAction('PUBLISH_ROUND', `Published round for Sport ID ${sportId}`);
        closeModal('modal-schedule-preview');
        loadSportsList();
        loadMatches('Scheduled');
    }
}

// --- 12. FORCE WINNER (Category Enabled) ---
async function openForceWinnerModal(sportId, sportName) {
    const { data: teams } = await supabaseClient.from('teams').select('id, name').eq('sport_id', sportId);
    if(!teams || teams.length === 0) return showToast("No teams found.", "error");

    const opts = `<option value="">-- None / TBD --</option>` + teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    
    document.getElementById('fw-gold').innerHTML = opts;
    document.getElementById('fw-silver').innerHTML = opts;
    document.getElementById('fw-bronze').innerHTML = opts;
    
    // Inject Category Selector dynamically
    const catDiv = document.getElementById('fw-category-container');
    if (!catDiv) {
        const div = document.createElement('div');
        div.id = 'fw-category-container';
        div.className = "mb-4";
        div.innerHTML = `
            <label class="text-xs font-bold text-gray-400 uppercase">Category</label>
            <div class="flex gap-4 mt-2">
                <label class="flex items-center gap-2 text-sm font-bold"><input type="radio" name="fw-cat" value="Junior" checked class="accent-black"> Junior</label>
                <label class="flex items-center gap-2 text-sm font-bold"><input type="radio" name="fw-cat" value="Senior" class="accent-black"> Senior</label>
            </div>`;
        document.querySelector('#modal-force-winner .space-y-2').before(div);
    }

    document.getElementById('btn-confirm-winner').onclick = () => confirmForceWinner(sportId, sportName);
    document.getElementById('modal-force-winner').classList.remove('hidden');
}

async function confirmForceWinner(sportId, sportName) {
    const gId = document.getElementById('fw-gold').value;
    const sId = document.getElementById('fw-silver').value;
    const bId = document.getElementById('fw-bronze').value;
    const cat = document.querySelector('input[name="fw-cat"]:checked').value;
    
    const gName = gId ? document.getElementById('fw-gold').options[document.getElementById('fw-gold').selectedIndex].text : '-';
    const sName = sId ? document.getElementById('fw-silver').options[document.getElementById('fw-silver').selectedIndex].text : '-';
    const bName = bId ? document.getElementById('fw-bronze').options[document.getElementById('fw-bronze').selectedIndex].text : '-';

    if(!gId) return showToast("Must select at least GOLD winner.", "error");
    if(!confirm(`Confirm Podium for ${sportName} (${cat})?\n1. ${gName}\n2. ${sName}\n3. ${bName}`)) return;

    const winnersData = { gold: gName, silver: sName, bronze: bName };
    const winnerText = `Gold: ${gName}, Silver: ${sName}, Bronze: ${bName}`;
    const resultName = `Tournament Result (${cat})`;

    // Check if result exists for this category
    const { data: existing } = await supabaseClient
        .from('matches')
        .select('id')
        .eq('sport_id', sportId)
        .eq('team1_name', resultName)
        .single();

    let matchIdToSync;

    if (existing) {
        // UPDATE Existing
        const { error } = await supabaseClient.from('matches').update({
            winner_id: gId,
            winner_text: winnerText,
            winners_data: winnersData
        }).eq('id', existing.id);
        if(error) return showToast(error.message, "error");
        matchIdToSync = existing.id;
    } else {
        // INSERT New
        const { data: newMatch, error } = await supabaseClient.from('matches').insert({
            sport_id: sportId,
            team1_name: resultName,
            team2_name: "Official Declaration",
            start_time: new Date().toISOString(),
            location: "Admin Panel",
            round_number: 100,
            status: 'Completed',
            match_type: `Final (${cat})`, // Separate Final Type
            winner_id: gId,
            winner_text: winnerText,
            winners_data: winnersData
        }).select().single();
        if(error) return showToast(error.message, "error");
        matchIdToSync = newMatch.id;
    }

    showToast(`Podium Updated (${cat})!`, "success");
    logAdminAction('FORCE_WINNER', `Updated winners for ${sportName} (${cat})`);
    syncToRealtime(matchIdToSync); // Sync to Student View
    closeModal('modal-force-winner');
}

// --- 13. REGISTRATIONS LIST VIEW (FIXED: REMOVED STATUS) ---
async function loadRegistrationsList() {
    const tbody = document.getElementById('registrations-table-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center">Loading registrations...</td></tr>';

    // FIXED QUERY: Removed 'status'
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

// --- 14. MATCH LIST & FILTER ---
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
    loadSportsList();
}

// --- 15. USERS & TEAMS MANAGEMENT ---
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
    showToast("Promoted!", "success");
    loadUsersList();
}

window.assignVolunteerSport = async function(userId, sportId) {
    await supabaseClient.from('users').update({ assigned_sport_id: sportId || null }).eq('id', userId);
    showToast("Assigned!", "success");
}

window.resetUserPassword = async function(userId, name) {
    if(!confirm(`Reset ${name}'s password to 'student'?`)) return;
    const { error } = await supabaseClient.rpc('admin_reset_password', { target_user_id: userId });
    if(error) showToast("Error resetting password", "error"); else showToast("Password Reset", "success");
}

window.filterUsers = function() {
    const q = document.getElementById('user-search').value.toLowerCase();
    document.querySelectorAll('#users-table-body tr').forEach(r => {
        r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
}

// --- 16. TEAMS ---
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

// --- 17. ACTIVITY LOGS ---
async function loadActivityLogs() {
    const tbody = document.getElementById('logs-table-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center">Loading...</td></tr>';
    
    const { data: logs } = await supabaseClient.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(100);
    
    if(logs) {
        dataCache = logs;
        tbody.innerHTML = logs.map(l => `
            <tr class="border-b border-gray-50">
                <td class="p-4 text-xs text-gray-500 font-mono">${new Date(l.created_at).toLocaleString()}</td>
                <td class="p-4 font-bold text-gray-800">${l.admin_email}</td>
                <td class="p-4"><span class="bg-gray-100 px-2 py-1 rounded text-xs font-bold">${l.action}</span></td>
                <td class="p-4 text-gray-600 text-sm">${l.details}</td>
            </tr>
        `).join('');
    }
}

// --- 18. UTILS (MODALS & TOASTS) ---
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

function injectScheduleModal() {
    if(document.getElementById('modal-schedule-preview')) return;
    const div = document.createElement('div');
    div.id = 'modal-schedule-preview';
    div.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
    div.innerHTML = `
        <div class="bg-white p-6 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto m-4">
            <div class="flex justify-between items-center mb-6">
                <div><h3 class="font-bold text-xl">Schedule Preview</h3><p id="preview-subtitle" class="text-sm text-gray-500">Generating...</p></div>
                <button onclick="closeModal('modal-schedule-preview')" class="p-2 bg-gray-100 rounded-full"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div id="schedule-preview-list" class="space-y-3 mb-6"></div>
            <button id="btn-confirm-schedule" class="w-full py-3 bg-black text-white font-bold rounded-xl shadow-lg">Confirm & Publish</button>
        </div>`;
    document.body.appendChild(div);
}

function injectWinnerModal() {
    if(document.getElementById('modal-force-winner')) return;
    const div = document.createElement('div');
    div.id = 'modal-force-winner';
    div.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
    div.innerHTML = `
        <div class="bg-white p-6 rounded-2xl w-96">
            <h3 class="font-bold text-lg mb-4">Declare Manual Winners</h3>
            <p class="text-xs text-gray-500 mb-4">Select the Top 3 to display on Student Portal.</p>
            <div class="space-y-2 mb-4">
                <label class="text-xs font-bold text-yellow-500">GOLD (Winner)</label>
                <select id="fw-gold" class="w-full p-2 border rounded-lg text-sm font-bold"></select>
                <label class="text-xs font-bold text-gray-400">SILVER (Runner-up)</label>
                <select id="fw-silver" class="w-full p-2 border rounded-lg text-sm font-bold"></select>
                <label class="text-xs font-bold text-orange-400">BRONZE (3rd Place)</label>
                <select id="fw-bronze" class="w-full p-2 border rounded-lg text-sm font-bold"></select>
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
