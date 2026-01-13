// ==========================================
// URJA 2026 - ADMIN CONTROL CENTER
// ==========================================

// --- 1. CONFIGURATION CHECKS ---
if (typeof CONFIG === 'undefined' || typeof CONFIG_REALTIME === 'undefined') {
    console.error("CRITICAL ERROR: Configuration missing. Ensure config.js and config2.js are loaded.");
    alert("System Error: Configuration files missing.");
}

// A. MAIN PROJECT (Read/Write for Admin, Auth, Official Records)
const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// B. REALTIME PROJECT (Relay for Live Student View - Write Access)
const realtimeClient = window.supabase.createClient(CONFIG_REALTIME.url, CONFIG_REALTIME.serviceKey);

// --- 2. STATE MANAGEMENT ---
let currentUser = null;
let currentView = 'dashboard';
let tempSchedule = []; 
let currentMatchViewFilter = 'Scheduled'; 
let currentScores = { s1: 0, s2: 0 }; // For Admin Scoring
let currentMatchId = null;

// Caches
let allTeamsCache = []; 
let dataCache = []; 
let allRegistrationsCache = []; 
let allSportsCache = [];

const DEFAULT_AVATAR = "https://t4.ftcdn.net/jpg/05/89/93/27/360_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.jpg";

// --- 3. INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    if(window.lucide) lucide.createIcons();
    injectToastContainer();
    injectScheduleModal();
    injectWinnerModal(); // Force Winner Modal
    injectScoringModal(); // Admin Scoring Modal

    await checkAdminAuth();
    switchView('dashboard');
});

// --- 4. AUTHENTICATION ---
async function checkAdminAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

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

// --- 5. LOGGING & SYNC ---
async function logAdminAction(action, details) {
    console.log(`[ADMIN] ${action}: ${details}`);
    try {
        await supabaseClient.from('admin_logs').insert({
            admin_email: currentUser.email,
            action: action,
            details: details
        });
    } catch (err) { console.error(err); }
}

async function syncToRealtime(matchId) {
    const { data: match } = await supabaseClient
        .from('matches')
        .select('*, sports(name)')
        .eq('id', matchId)
        .single();

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
        updated_at: new Date()
    };

    await realtimeClient.from('live_matches').upsert(payload);
}

// --- 6. VIEW NAVIGATION ---
window.switchView = function(viewId) {
    currentView = viewId;
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById('view-' + viewId);
    if(target) {
        target.classList.remove('hidden');
        target.classList.add('animate-fade-in');
    }

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navBtn = document.getElementById('nav-' + viewId);
    if(navBtn) navBtn.classList.add('active');

    const titleEl = document.getElementById('page-title');
    if(titleEl) titleEl.innerText = viewId.charAt(0).toUpperCase() + viewId.slice(1);

    const globalActions = document.getElementById('global-actions');
    if(globalActions) {
        ['users', 'teams', 'matches', 'logs', 'registrations'].includes(viewId) ? globalActions.classList.remove('hidden') : globalActions.classList.add('hidden');
    }

    dataCache = [];
    if(viewId === 'users') loadUsersList();
    if(viewId === 'sports') loadSportsList();
    if(viewId === 'matches') { setupMatchFilters(); loadMatches('Scheduled'); }
    if(viewId === 'teams') loadTeamsList();
    if(viewId === 'logs') loadActivityLogs();
    if(viewId === 'registrations') loadRegistrationsList();
}

// --- 7. EXPORT ---
window.exportCurrentPage = function(type) {
    if (!dataCache || dataCache.length === 0) return showToast("No data to export", "error");
    const filename = `urja_${currentView}_${new Date().toISOString().split('T')[0]}`;

    if (type === 'excel') {
        const ws = XLSX.utils.json_to_sheet(dataCache);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
        XLSX.writeFile(wb, `${filename}.xlsx`);
    } else {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l'); 
        const headers = Object.keys(dataCache[0]).map(k => k.toUpperCase());
        const rows = dataCache.map(obj => Object.values(obj).map(v => String(v)));
        doc.text(`URJA 2026 - ${currentView.toUpperCase()}`, 14, 22);
        doc.autoTable({ head: [headers], body: rows, startY: 30 });
        doc.save(`${filename}.pdf`);
    }
}

// --- 8. DASHBOARD STATS ---
async function loadDashboardStats() {
    const { count: u } = await supabaseClient.from('users').select('*', { count: 'exact', head: true });
    const { count: r } = await supabaseClient.from('registrations').select('*', { count: 'exact', head: true });
    const { count: t } = await supabaseClient.from('teams').select('*', { count: 'exact', head: true });
    
    document.getElementById('dash-total-users').innerText = u || 0;
    document.getElementById('dash-total-regs').innerText = r || 0;
    document.getElementById('dash-total-teams').innerText = t || 0;
}

// --- 9. SPORTS MANAGEMENT ---
async function loadSportsList() {
    const tablePerf = document.getElementById('sports-table-performance');
    const tableTourn = document.getElementById('sports-table-tournament');
    
    if(tablePerf) tablePerf.innerHTML = '<tr><td colspan="3" class="p-4 text-center">Loading...</td></tr>';
    if(tableTourn) tableTourn.innerHTML = '<tr><td colspan="3" class="p-4 text-center">Loading...</td></tr>';

    const { data: sports } = await supabaseClient.from('sports').select('*').order('name');
    const { data: activeMatches } = await supabaseClient.from('matches').select('sport_id').neq('status', 'Completed');
    const activeIds = activeMatches ? activeMatches.map(m => m.sport_id) : [];

    let perfHtml = '', tourHtml = '';

    sports.forEach(s => {
        const isStarted = activeIds.includes(s.id);
        const actionBtn = isStarted 
            ? `<span class="text-xs font-bold text-green-600 bg-green-50 px-3 py-1 rounded-lg border border-green-100 flex items-center gap-1 w-max ml-auto"><i data-lucide="activity" class="w-3 h-3"></i> Active</span>`
            : `<div class="flex gap-2 justify-end">
                <button onclick="window.handleScheduleClick('${s.id}', '${s.name}', ${s.is_performance}, '${s.type}')" class="px-4 py-1.5 bg-black text-white rounded-lg text-xs font-bold shadow-sm hover:bg-gray-800">
                    ${s.is_performance ? 'Start Event' : 'Schedule Round'}
                </button>
                ${!s.is_performance ? `<button onclick="openForceWinnerModal('${s.id}', '${s.name}')" class="px-2 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100" title="Declare Podium"><i data-lucide="crown" class="w-4 h-4"></i></button>` : ''}
               </div>`;
        
        const rowHtml = `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="p-4 font-bold text-gray-800">${s.name}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold ${s.status === 'Open' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}">${s.status}</span></td>
            <td class="p-4 text-right">${actionBtn}</td>
        </tr>`;

        if (s.is_performance) perfHtml += rowHtml; else tourHtml += rowHtml;
    });

    if(tablePerf) tablePerf.innerHTML = perfHtml || '<tr><td colspan="3" class="text-center p-4 italic">No events.</td></tr>';
    if(tableTourn) tableTourn.innerHTML = tourHtml || '<tr><td colspan="3" class="text-center p-4 italic">No tournaments.</td></tr>';
    if(window.lucide) lucide.createIcons();
}

window.openAddSportModal = () => document.getElementById('modal-add-sport').classList.remove('hidden');

window.handleAddSport = async function(e) {
    e.preventDefault();
    const name = document.getElementById('new-sport-name').value;
    const type = document.getElementById('new-sport-type').value;
    const size = document.getElementById('new-sport-size').value;
    const isPerformance = name.toLowerCase().includes('race') || name.toLowerCase().includes('jump') || name.toLowerCase().includes('throw');
    const unit = isPerformance ? (name.toLowerCase().includes('race') ? 'Seconds' : 'Meters') : 'Points';

    const { error } = await supabaseClient.from('sports').insert({ name, type, team_size: size, icon: 'trophy', is_performance: isPerformance, unit: unit });

    if(error) showToast(error.message, "error");
    else {
        showToast("Sport Added!", "success");
        closeModal('modal-add-sport');
        loadSportsList();
    }
}

// --- 10. SCHEDULER & BYE ROUNDS ---
window.handleScheduleClick = async function(sportId, sportName, isPerformance, sportType) {
    if (isPerformance) {
        if (confirm(`Start ${sportName}?`)) await initPerformanceEvent(sportId, sportName);
    } else {
        await initTournamentRound(sportId, sportName, sportType);
    }
}

async function initPerformanceEvent(sportId, sportName) {
    const { data: regs } = await supabaseClient.from('registrations').select('user_id, users(first_name, last_name, student_id)').eq('sport_id', sportId);
    if (!regs || regs.length === 0) return showToast("No registrations found.", "error");

    const participants = regs.map(r => ({ id: r.user_id, name: `${r.users.first_name} ${r.users.last_name}`, result: '', rank: 0 }));

    const { data: newMatch, error } = await supabaseClient.from('matches').insert({
        sport_id: sportId, team1_name: sportName, team2_name: 'All Participants', status: 'Live', is_live: true, performance_data: participants
    }).select().single();

    if (!error) {
        showToast(`${sportName} started!`, "success");
        syncToRealtime(newMatch.id);
        loadSportsList();
    }
}

async function initTournamentRound(sportId, sportName, sportType) {
    showToast("Analyzing Bracket...", "info");
    const intSportId = parseInt(sportId); 
    const { data: latestMatches } = await supabaseClient.from('matches').select('round_number').eq('sport_id', intSportId).order('round_number', { ascending: false }).limit(1);

    let round = 1;
    let candidates = [];

    if (!latestMatches || latestMatches.length === 0) {
        if (sportType === 'Individual') await supabaseClient.rpc('prepare_individual_teams', { sport_id_input: intSportId });
        await supabaseClient.rpc('auto_lock_tournament_teams', { sport_id_input: intSportId });
        const { data: validTeams } = await supabaseClient.rpc('get_tournament_teams', { sport_id_input: intSportId });
        if (!validTeams || validTeams.length < 2) return showToast("Need at least 2 VALID TEAMS.", "error");
        candidates = validTeams.map(t => ({ id: t.team_id, name: t.team_name, category: t.category }));
    } else {
        round = latestMatches[0].round_number + 1;
        const { data: winners } = await supabaseClient.from('matches').select('winner_id').eq('sport_id', intSportId).eq('round_number', round - 1).not('winner_id', 'is', null);
        if (!winners || winners.length < 2) return showToast("Tournament Completed!", "success");
        const { data: teamDetails } = await supabaseClient.from('teams').select(`id, name, captain:users!captain_id(class_name)`).in('id', winners.map(w => w.winner_id));
        candidates = teamDetails.map(t => ({ id: t.id, name: t.name, category: (['FYJC', 'SYJC'].includes(t.captain?.class_name)) ? 'Junior' : 'Senior' }));
    }

    tempSchedule = [];
    let matchType = candidates.length === 2 ? 'Final' : candidates.length <= 4 ? 'Semi-Final' : 'Regular';

    // BYE LOGIC
    if (candidates.length <= 4) {
        candidates.sort(() => Math.random() - 0.5); 
        generatePairsFromList(candidates, round, matchType);
    } else {
        const juniors = candidates.filter(c => c.category === 'Junior').sort(() => Math.random() - 0.5);
        const seniors = candidates.filter(c => c.category === 'Senior').sort(() => Math.random() - 0.5);
        generatePairsFromList(juniors, round, matchType);
        generatePairsFromList(seniors, round, matchType);
    }

    openSchedulePreviewModal(sportName, round, tempSchedule, intSportId);
}

function generatePairsFromList(list, round, matchType) {
    if (list.length % 2 !== 0) {
        const luckyTeam = list.pop(); 
        // BYE: Auto-advance
        tempSchedule.push({ t1: luckyTeam, t2: { id: null, name: "BYE (Auto-Advance)" }, time: "10:00", location: "N/A", round: round, type: 'Bye Round' });
    }
    for (let i = 0; i < list.length; i += 2) {
        tempSchedule.push({ t1: list[i], t2: list[i+1], time: "10:00", location: "College Ground", round: round, type: matchType });
    }
}

function openSchedulePreviewModal(sportName, round, schedule, sportId) {
    const container = document.getElementById('schedule-preview-list');
    document.getElementById('preview-subtitle').innerText = `Generating Round ${round}`;
    
    container.innerHTML = schedule.map((m, idx) => `
        <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-center gap-4">
            <div class="flex-1">
                <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">${m.type}</span>
                <div class="font-bold text-gray-900">${m.t1.name} <span class="text-gray-400">VS</span> ${m.t2.name}</div>
            </div>
            ${m.t2.id ? `
            <div class="flex gap-2">
                <input type="time" class="input-field p-2 border rounded-lg text-sm" value="${m.time}" onchange="updateTempSchedule(${idx}, 'time', this.value)">
                <select class="input-field p-2 border rounded-lg text-sm" onchange="updateTempSchedule(${idx}, 'location', this.value)">
                    <option value="College Ground">College Ground</option><option value="Gymkhana">Gymkhana</option>
                </select>
            </div>` : `<span class="text-xs font-bold text-green-500 bg-green-50 px-2 py-1 rounded">Walkover</span>`}
        </div>`).join('');

    document.getElementById('btn-confirm-schedule').onclick = () => confirmSchedule(sportId);
    document.getElementById('modal-schedule-preview').classList.remove('hidden');
}

window.updateTempSchedule = (idx, field, value) => tempSchedule[idx][field] = value;

async function confirmSchedule(sportId) {
    const btn = document.getElementById('btn-confirm-schedule');
    btn.innerText = "Publishing...";
    btn.disabled = true;

    const inserts = tempSchedule.map(m => ({
        sport_id: sportId, team1_id: m.t1.id, team2_id: m.t2.id, team1_name: m.t1.name, team2_name: m.t2.name,
        start_time: new Date().toISOString().split('T')[0] + 'T' + m.time, location: m.location, round_number: m.round,
        status: m.t2.id ? 'Scheduled' : 'Completed', winner_id: m.t2.id ? null : m.t1.id, winner_text: m.t2.id ? null : `${m.t1.name} (Bye)`, match_type: m.type
    }));

    const { error } = await supabaseClient.from('matches').insert(inserts);
    if(error) showToast(error.message, "error");
    else {
        showToast("Round Published!", "success");
        closeModal('modal-schedule-preview');
        loadSportsList();
    }
}

// --- 11. WINNER SECTION (FORCE WINNER) ---
async function openForceWinnerModal(sportId, sportName) {
    const { data: teams } = await supabaseClient.from('teams').select('id, name').eq('sport_id', sportId);
    const opts = `<option value="">-- Select --</option>` + (teams || []).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    
    document.getElementById('fw-gold').innerHTML = opts;
    document.getElementById('fw-silver').innerHTML = opts;
    document.getElementById('fw-bronze').innerHTML = opts;
    document.getElementById('btn-confirm-winner').onclick = () => confirmForceWinner(sportId, sportName);
    document.getElementById('modal-force-winner').classList.remove('hidden');
}

async function confirmForceWinner(sportId, sportName) {
    const gId = document.getElementById('fw-gold').value;
    const sId = document.getElementById('fw-silver').value;
    const bId = document.getElementById('fw-bronze').value;
    
    const gName = document.getElementById('fw-gold').selectedOptions[0].text;
    const sName = document.getElementById('fw-silver').selectedOptions[0].text;
    const bName = document.getElementById('fw-bronze').selectedOptions[0].text;

    if(!gId) return showToast("Gold winner required.", "error");
    if(!confirm(`Confirm Podium?\n🥇 ${gName}\n🥈 ${sName}\n🥉 ${bName}`)) return;

    const winnersData = { gold: gName, silver: sName, bronze: bName };
    const { data: existing } = await supabaseClient.from('matches').select('id').eq('sport_id', sportId).eq('team1_name', 'Tournament Result').single();

    let mId;
    if (existing) {
        await supabaseClient.from('matches').update({ winner_id: gId, winner_text: `Gold: ${gName}`, winners_data: winnersData }).eq('id', existing.id);
        mId = existing.id;
    } else {
        const { data: n } = await supabaseClient.from('matches').insert({
            sport_id: sportId, team1_name: "Tournament Result", team2_name: "Official Declaration", start_time: new Date().toISOString(),
            status: 'Completed', match_type: 'Final', winner_id: gId, winner_text: `Gold: ${gName}`, winners_data: winnersData
        }).select().single();
        mId = n.id;
    }

    showToast("Podium Updated!", "success");
    syncToRealtime(mId);
    closeModal('modal-force-winner');
}

// --- 12. MATCH MANAGEMENT & ADMIN SCORING ---
window.loadMatches = async function(statusFilter = 'Scheduled') {
    currentMatchViewFilter = statusFilter;
    document.querySelectorAll('#match-filter-tabs button').forEach(btn => {
        btn.className = btn.innerText.includes(statusFilter) ? "px-4 py-2 text-sm font-bold text-black border-b-2 border-black" : "px-4 py-2 text-sm font-bold text-gray-500 hover:text-black";
    });

    const container = document.getElementById('matches-grid');
    container.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading...</p>';

    const { data: matches } = await supabaseClient.from('matches').select('*, sports(name, is_performance)').eq('status', statusFilter).order('start_time', { ascending: true });

    if (!matches || matches.length === 0) {
        container.innerHTML = `<p class="col-span-3 text-center text-gray-400 py-10">No ${statusFilter} matches.</p>`;
        return;
    }

    // LIVE ON TOP SORTING
    matches.sort((a, b) => (a.status === 'Live' ? -1 : 1));

    container.innerHTML = matches.map(m => `
        <div class="bg-white p-5 rounded-3xl border ${m.status === 'Live' ? 'border-red-100 shadow-lg shadow-red-50' : 'border-gray-200'} relative overflow-hidden">
            ${m.status === 'Live' ? `<div class="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl animate-pulse">LIVE</div>` : ''}
            <div class="flex justify-between items-start mb-4">
                 <span class="text-xs text-gray-500 font-bold uppercase tracking-wider">${m.sports.name}</span>
                 <span class="text-xs font-mono font-bold text-gray-400">${new Date(m.start_time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
            </div>
            
            ${m.sports.is_performance ? 
                `<div class="text-center py-2"><h4 class="font-black text-xl text-gray-900">${m.team1_name}</h4></div>`
            : 
                `<div class="flex items-center justify-between w-full mb-4 px-2">
                    <h4 class="font-bold text-lg text-gray-900 leading-tight w-1/3 truncate text-left">${m.team1_name}</h4>
                    <span class="text-[10px] font-bold text-gray-300">VS</span>
                    <h4 class="font-bold text-lg text-gray-900 leading-tight w-1/3 truncate text-right">${m.team2_name}</h4>
                </div>`
            }

            <div class="border-t border-gray-100 pt-4 flex justify-between items-center">
                 <span class="text-xs font-bold text-gray-400">${m.location || 'N/A'}</span>
                 ${m.status === 'Live' && !m.sports.is_performance ? 
                    `<button onclick="window.openAdminScoring('${m.id}')" class="px-3 py-1.5 bg-brand-primary text-white text-xs font-bold rounded-lg shadow-md flex items-center gap-1"><i data-lucide="edit-3" class="w-3 h-3"></i> Score</button>` 
                 : 
                    m.status === 'Scheduled' ? `<button onclick="window.startMatch('${m.id}')" class="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg shadow-md hover:bg-green-600">Start Match</button>` : ''
                 }
            </div>
        </div>`).join('');
    lucide.createIcons();
}

window.startMatch = async function(matchId) {
    if(!confirm("Start Match? It goes live immediately.")) return;
    await supabaseClient.from('matches').update({ status: 'Live', is_live: true, score1: 0, score2: 0 }).eq('id', matchId);
    showToast("Match LIVE!", "success");
    syncToRealtime(matchId);
    loadMatches('Live');
    
    // Auto-open scoring for convenience
    setTimeout(() => window.openAdminScoring(matchId), 500);
}

// ADMIN SCORING (New Feature)
window.openAdminScoring = async function(matchId) {
    currentMatchId = matchId;
    const { data: match } = await supabaseClient.from('matches').select('team1_name, team2_name, score1, score2').eq('id', matchId).single();
    if(!match) return;

    currentScores.s1 = match.score1 || 0;
    currentScores.s2 = match.score2 || 0;
    document.getElementById('adm-t1-name').innerText = match.team1_name;
    document.getElementById('adm-t2-name').innerText = match.team2_name;
    updateAdminScoreUI();
    document.getElementById('modal-admin-scoring').classList.remove('hidden');
}

function updateAdminScoreUI() {
    document.getElementById('adm-s1').innerText = currentScores.s1;
    document.getElementById('adm-s2').innerText = currentScores.s2;
}

window.adjustAdminScore = function(team, delta) {
    if(team === 1) currentScores.s1 = Math.max(0, currentScores.s1 + delta);
    else currentScores.s2 = Math.max(0, currentScores.s2 + delta);
    updateAdminScoreUI();
}

window.saveAdminScore = async function() {
    await supabaseClient.from('matches').update({ score1: currentScores.s1, score2: currentScores.s2 }).eq('id', currentMatchId);
    await syncToRealtime(currentMatchId);
    showToast("Score Updated & Synced", "success");
}

window.endAdminMatch = async function() {
    if(!confirm("End Match?")) return;
    let winnerText = currentScores.s1 > currentScores.s2 ? `${document.getElementById('adm-t1-name').innerText} Won` : 
                     currentScores.s2 > currentScores.s1 ? `${document.getElementById('adm-t2-name').innerText} Won` : "Draw";
    
    await supabaseClient.from('matches').update({ status: 'Completed', is_live: false, score1: currentScores.s1, score2: currentScores.s2, winner_text: winnerText }).eq('id', currentMatchId);
    await syncToRealtime(currentMatchId);
    showToast("Match Ended", "success");
    closeModal('modal-admin-scoring');
    loadMatches('Completed');
}

// --- 13. UTILS ---
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

function setupMatchFilters() {
    const container = document.getElementById('view-matches');
    if(!document.getElementById('match-filter-tabs')) {
        const div = document.createElement('div');
        div.id = 'match-filter-tabs';
        div.className = "flex gap-2 mb-6 border-b border-gray-200 pb-2";
        div.innerHTML = `
            <button onclick="loadMatches('Scheduled')" id="btn-filter-scheduled" class="px-4 py-2 text-sm font-bold text-gray-500 hover:text-black">Scheduled</button>
            <button onclick="loadMatches('Live')" id="btn-filter-live" class="px-4 py-2 text-sm font-bold text-gray-500 hover:text-black">Live</button>
            <button onclick="loadMatches('Completed')" id="btn-filter-completed" class="px-4 py-2 text-sm font-bold text-gray-500 hover:text-black">Completed</button>
        `;
        container.insertBefore(div, document.getElementById('matches-grid'));
    }
}

function injectScoringModal() {
    if(document.getElementById('modal-admin-scoring')) return;
    const div = document.createElement('div');
    div.id = 'modal-admin-scoring';
    div.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
    div.innerHTML = `
        <div class="bg-white p-6 rounded-3xl w-96 shadow-2xl">
            <h3 class="font-black text-xl text-center mb-6">Admin Scoring</h3>
            <div class="flex justify-between items-center mb-4">
                <div class="text-center w-1/3"><div class="font-bold text-sm truncate" id="adm-t1-name">T1</div><div class="text-3xl font-black" id="adm-s1">0</div><div class="flex gap-1 justify-center mt-2"><button onclick="adjustAdminScore(1,-1)" class="w-6 h-6 bg-gray-200 rounded">-</button><button onclick="adjustAdminScore(1,1)" class="w-6 h-6 bg-black text-white rounded">+</button></div></div>
                <div class="text-gray-300 font-bold">VS</div>
                <div class="text-center w-1/3"><div class="font-bold text-sm truncate" id="adm-t2-name">T2</div><div class="text-3xl font-black" id="adm-s2">0</div><div class="flex gap-1 justify-center mt-2"><button onclick="adjustAdminScore(2,-1)" class="w-6 h-6 bg-gray-200 rounded">-</button><button onclick="adjustAdminScore(2,1)" class="w-6 h-6 bg-black text-white rounded">+</button></div></div>
            </div>
            <div class="flex gap-2">
                <button onclick="endAdminMatch()" class="flex-1 py-2 bg-red-100 text-red-600 font-bold rounded-lg">End</button>
                <button onclick="saveAdminScore()" class="flex-1 py-2 bg-black text-white font-bold rounded-lg">Sync</button>
            </div>
            <button onclick="closeModal('modal-admin-scoring')" class="w-full mt-3 text-xs text-gray-400 font-bold">Close</button>
        </div>`;
    document.body.appendChild(div);
}

function injectScheduleModal() {
    if(document.getElementById('modal-schedule-preview')) return;
    const div = document.createElement('div');
    div.id = 'modal-schedule-preview';
    div.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
    div.innerHTML = `
        <div class="bg-white p-6 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto m-4">
            <div class="flex justify-between items-center mb-6"><div><h3 class="font-bold text-xl">Schedule Preview</h3><p id="preview-subtitle" class="text-sm text-gray-500">Generating...</p></div><button onclick="closeModal('modal-schedule-preview')" class="p-2 bg-gray-100 rounded-full"><i data-lucide="x" class="w-5 h-5"></i></button></div>
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
            <p class="text-xs text-gray-500 mb-4">Select the Top 3.</p>
            <div class="space-y-2 mb-4">
                <label class="text-xs font-bold text-yellow-500">GOLD</label><select id="fw-gold" class="w-full p-2 border rounded-lg text-sm font-bold"></select>
                <label class="text-xs font-bold text-gray-400">SILVER</label><select id="fw-silver" class="w-full p-2 border rounded-lg text-sm font-bold"></select>
                <label class="text-xs font-bold text-orange-400">BRONZE</label><select id="fw-bronze" class="w-full p-2 border rounded-lg text-sm font-bold"></select>
            </div>
            <div class="flex gap-2"><button onclick="closeModal('modal-force-winner')" class="flex-1 py-2 bg-gray-100 rounded-lg text-sm font-bold">Cancel</button><button id="btn-confirm-winner" class="flex-1 py-2 bg-black text-white rounded-lg text-sm font-bold">Confirm</button></div>
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
    const t = document.getElementById('toast-container'), txt = document.getElementById('toast-msg'), icon = document.getElementById('toast-icon');
    if(txt) txt.innerText = msg;
    if(icon) icon.innerHTML = type === 'error' ? '<i data-lucide="alert-circle" class="w-5 h-5 text-red-400"></i>' : '<i data-lucide="check-circle" class="w-5 h-5 text-green-400"></i>';
    if(window.lucide) lucide.createIcons();
    if(t) { t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10'); setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10'), 3000); }
}
