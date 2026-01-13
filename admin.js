// --- CONFIGURATION ---
const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
let currentUser = null;
let currentView = 'dashboard';
let tempSchedule = []; 
let currentMatchViewFilter = 'Scheduled'; 
let allTeamsCache = []; // Search Cache
let dataCache = []; // Export Cache
let allRegistrationsCache = []; // Registration Cache
let allSportsCache = []; // Volunteer Assignment Cache
let currentSort = { key: 'date', asc: false };

const DEFAULT_AVATAR = "https://t4.ftcdn.net/jpg/05/89/93/27/360_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.jpg";

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    if(window.lucide) lucide.createIcons();
    injectToastContainer();
    injectScheduleModal();
    injectWinnerModal();
    await checkAdminAuth();
    switchView('dashboard');
});

// --- 1. AUTHENTICATION & LOGGING ---
async function checkAdminAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    const { data: user } = await supabaseClient.from('users').select('role, email').eq('id', session.user.id).single();

    if (!user || user.role !== 'admin') {
        showToast("Access Denied: Admins Only", "error");
        setTimeout(() => window.location.href = 'login.html', 1500);
        return;
    }
    currentUser = { ...session.user, email: user.email };
    loadDashboardStats();
}

async function logAdminAction(action, details) {
    try {
        await supabaseClient.from('admin_logs').insert({
            admin_email: currentUser.email,
            action: action,
            details: details
        });
    } catch (err) { console.error("Log failed:", err); }
}

function adminLogout() {
    supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

// --- 2. VIEW NAVIGATION ---
window.switchView = function(viewId) {
    currentView = viewId;
    
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById('view-' + viewId);
    if(target) {
        target.classList.remove('hidden');
        target.classList.remove('animate-fade-in');
        void target.offsetWidth; 
        target.classList.add('animate-fade-in');
    }

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navBtn = document.getElementById('nav-' + viewId);
    if(navBtn) navBtn.classList.add('active');

    const titleEl = document.getElementById('page-title');
    if(titleEl) titleEl.innerText = viewId.charAt(0).toUpperCase() + viewId.slice(1);

    // Export Buttons Toggle
    const globalActions = document.getElementById('global-actions');
    if(globalActions) {
        if (['users', 'teams', 'matches', 'logs', 'registrations'].includes(viewId)) globalActions.classList.remove('hidden');
        else globalActions.classList.add('hidden');
    }

    // Data Loaders
    dataCache = [];
    if(viewId === 'users') loadUsersList();
    if(viewId === 'sports') loadSportsList();
    if(viewId === 'matches') { setupMatchFilters(); loadMatches('Scheduled'); }
    if(viewId === 'teams') loadTeamsList();
    if(viewId === 'logs') loadActivityLogs();
    if(viewId === 'registrations') loadRegistrationsList();
}

// --- 3. EXPORT SYSTEM ---
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
        const doc = new jsPDF('l'); 
        const headers = Object.keys(dataCache[0]).map(k => k.toUpperCase());
        const rows = dataCache.map(obj => Object.values(obj).map(v => String(v)));

        doc.setFontSize(18);
        doc.text(`URJA 2026 - ${currentView.toUpperCase()}`, 14, 22);
        doc.autoTable({ head: [headers], body: rows, startY: 30, theme: 'grid', styles: { fontSize: 8 } });
        doc.save(`${filename}.pdf`);
        logAdminAction('EXPORT_PDF', `Exported ${currentView}`);
    }
}

// --- 4. DASHBOARD ---
async function loadDashboardStats() {
    const { count: userCount } = await supabaseClient.from('users').select('*', { count: 'exact', head: true });
    const { count: regCount } = await supabaseClient.from('registrations').select('*', { count: 'exact', head: true });
    const { count: teamCount } = await supabaseClient.from('teams').select('*', { count: 'exact', head: true });
    
    document.getElementById('dash-total-users').innerText = userCount || 0;
    document.getElementById('dash-total-regs').innerText = regCount || 0;
    document.getElementById('dash-total-teams').innerText = teamCount || 0;
}

// --- 5. SPORTS MANAGEMENT ---
async function loadSportsList() {
    const tablePerf = document.getElementById('sports-table-performance');
    const tableTourn = document.getElementById('sports-table-tournament');
    
    if(tablePerf) tablePerf.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400">Loading...</td></tr>';
    if(tableTourn) tableTourn.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400">Loading...</td></tr>';

    const { data: sports } = await supabaseClient.from('sports').select('*').order('name');
    const { data: activeMatches } = await supabaseClient.from('matches').select('sport_id').neq('status', 'Completed');
    const activeSportIds = activeMatches ? activeMatches.map(m => m.sport_id) : [];

    allSportsCache = sports || [];

    if(!sports || sports.length === 0) return;

    let perfHtml = '';
    let tourHtml = '';

    sports.forEach(s => {
        const isStarted = activeSportIds.includes(s.id);
        
        let actionBtn = '';
        if (isStarted) {
             actionBtn = `<span class="text-xs font-bold text-green-600 bg-green-50 px-3 py-1 rounded-lg border border-green-100 flex items-center gap-1 w-max ml-auto"><i data-lucide="activity" class="w-3 h-3"></i> Active</span>`;
        } else {
             actionBtn = `
                <div class="flex gap-2 justify-end">
                    <button onclick="window.handleScheduleClick('${s.id}', '${s.name}', ${s.is_performance}, '${s.type}')" class="px-4 py-1.5 bg-black text-white rounded-lg text-xs font-bold hover:bg-gray-800 shadow-sm transition-transform active:scale-95">
                        ${s.is_performance ? 'Start Event' : 'Schedule Round'}
                    </button>
                    ${!s.is_performance ? `<button onclick="openForceWinnerModal('${s.id}', '${s.name}')" class="px-2 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100" title="Declare Podium"><i data-lucide="crown" class="w-4 h-4"></i></button>` : ''}
                </div>`;
        }
        
        const closeBtn = `<button onclick="toggleSportStatus('${s.id}', '${s.status}')" class="text-xs font-bold underline text-gray-400 hover:text-gray-600 transition-colors">${s.status === 'Open' ? 'Close Reg' : 'Open Reg'}</button>`;

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
    const isPerformance = name.toLowerCase().includes('race') || name.toLowerCase().includes('jump') || name.toLowerCase().includes('throw');
    const unit = isPerformance ? (name.toLowerCase().includes('race') ? 'Seconds' : 'Meters') : 'Points';

    const { error } = await supabaseClient.from('sports').insert({ name, type, team_size: size, icon: 'trophy', is_performance: isPerformance, unit: unit });

    if(error) showToast(error.message, "error");
    else {
        showToast("Sport Added!", "success");
        logAdminAction('ADD_SPORT', `Added sport: ${name}`);
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

// --- 6. SCHEDULER ---

window.handleScheduleClick = async function(sportId, sportName, isPerformance, sportType) {
    if (isPerformance) {
        if (confirm(`Start ${sportName}? This will initiate the event for volunteers.`)) await initPerformanceEvent(sportId, sportName);
    } else {
        await initTournamentRound(sportId, sportName, sportType);
    }
}

async function initPerformanceEvent(sportId, sportName) {
    const { data: existing } = await supabaseClient.from('matches').select('id').eq('sport_id', sportId).neq('status', 'Completed');
    if (existing && existing.length > 0) return showToast("Event is already active!", "info");

    const { data: regs } = await supabaseClient.from('registrations').select('user_id, users(first_name, last_name, student_id)').eq('sport_id', sportId);
    if (!regs || regs.length === 0) return showToast("No registrations found.", "error");

    const participants = regs.map(r => ({ id: r.user_id, name: `${r.users.first_name} ${r.users.last_name} (${r.users.student_id})`, result: '', rank: 0 }));

    const { error } = await supabaseClient.from('matches').insert({ sport_id: sportId, team1_name: sportName, team2_name: 'All Participants', status: 'Live', is_live: true, performance_data: participants });

    if (error) showToast(error.message, "error");
    else {
        showToast(`${sportName} started!`, "success");
        logAdminAction('START_EVENT', `Started Performance Event: ${sportName}`);
        loadSportsList();
    }
}

window.endPerformanceEvent = async function(matchId) {
    if (!confirm("Are you sure? This will Calculate Winners (1,2,3) and END the event.")) return;

    const { data: match } = await supabaseClient.from('matches').select('performance_data, sports(unit)').eq('id', matchId).single();
    let arr = match.performance_data;
    const unit = match.sports.unit;

    let validEntries = arr.filter(p => p.result && p.result.trim() !== '');
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
        showToast("Event Ended! Winners Declared.", "success");
        logAdminAction('END_EVENT', `Ended Match ID ${matchId}`);
        loadMatches(currentMatchViewFilter); 
        loadSportsList(); 
    }
}

async function initTournamentRound(sportId, sportName, sportType) {
    showToast("Analyzing Bracket...", "info");
    const intSportId = parseInt(sportId); 

    const { data: latestMatches } = await supabaseClient.from('matches').select('round_number, status').eq('sport_id', intSportId).order('round_number', { ascending: false }).limit(1);

    let round = 1;
    let candidates = [];

    if (!latestMatches || latestMatches.length === 0) {
        if (sportType === 'Individual') await supabaseClient.rpc('prepare_individual_teams', { sport_id_input: intSportId });
        await supabaseClient.rpc('auto_lock_tournament_teams', { sport_id_input: intSportId });

        const { data: validTeams } = await supabaseClient.rpc('get_tournament_teams', { sport_id_input: intSportId });
        if (!validTeams || validTeams.length < 2) return showToast("Need at least 2 VALID TEAMS to start.", "error");

        candidates = validTeams.map(t => ({ id: t.team_id, name: t.team_name, category: t.category }));
    } else {
        const lastRound = latestMatches[0].round_number;
        const { count: pendingCount } = await supabaseClient.from('matches').select('*', { count: 'exact', head: true }).eq('sport_id', intSportId).eq('round_number', lastRound).neq('status', 'Completed');

        if (pendingCount > 0) return showToast(`Round ${lastRound} unfinished! (${pendingCount} matches left)`, "error");

        round = lastRound + 1;
        const { data: winners } = await supabaseClient.from('matches').select('winner_id').eq('sport_id', intSportId).eq('round_number', lastRound).not('winner_id', 'is', null);

        if (!winners || winners.length < 2) {
            showToast("Tournament Completed! (Winner Declared)", "success");
            return;
        }

        const winnerIds = winners.map(w => w.winner_id);
        const { data: teamDetails } = await supabaseClient.from('teams').select(`id, name, captain:users!captain_id(class_name)`).in('id', winnerIds);

        candidates = teamDetails.map(t => ({
            id: t.id, name: t.name, category: (['FYJC', 'SYJC'].includes(t.captain?.class_name)) ? 'Junior' : 'Senior'
        }));
    }

    tempSchedule = [];
    
    let matchType = 'Regular';
    if (candidates.length === 2) matchType = 'Final';
    else if (candidates.length <= 4) matchType = 'Semi-Final';
    else if (candidates.length <= 8) matchType = 'Quarter-Final';

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
        tempSchedule.push({ t1: luckyTeam, t2: { id: null, name: "BYE (Auto-Advance)" }, time: "10:00", location: "N/A", round: round, type: 'Bye Round' });
    }
    for (let i = 0; i < list.length; i += 2) {
        tempSchedule.push({ t1: list[i], t2: list[i+1], time: "10:00", location: "College Ground", round: round, type: matchType });
    }
}

function openSchedulePreviewModal(sportName, round, schedule, sportId) {
    const titleEl = document.getElementById('preview-subtitle');
    const container = document.getElementById('schedule-preview-list');
    
    if(!titleEl || !container) {
        console.error("DOM missing. Re-injecting modal.");
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
                <select class="input-field p-2 w-full md:w-40 bg-gray-50 border rounded-lg text-sm font-bold" onchange="updateTempSchedule(${idx}, 'location', this.value)">
                    ${venueOptions}
                </select>
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

    if(error) { showToast(error.message, "error"); btn.innerText = "Confirm & Publish"; btn.disabled = false; } 
    else {
        showToast("Round Generated Successfully!", "success");
        logAdminAction('SCHEDULE_ROUND', `Created round for sport ID ${sportId}`);
        closeModal('modal-schedule-preview');
        loadSportsList();
    }
}

// --- 7. FORCE WINNER (FIXED DUPLICATES) ---
async function openForceWinnerModal(sportId, sportName) {
    const { data: teams } = await supabaseClient.from('teams').select('id, name').eq('sport_id', sportId);
    if(!teams || teams.length === 0) return showToast("No teams found.", "error");

    const opts = `<option value="">-- None / TBD --</option>` + teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    
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
    
    const gName = gId ? document.getElementById('fw-gold').options[document.getElementById('fw-gold').selectedIndex].text : '-';
    const sName = sId ? document.getElementById('fw-silver').options[document.getElementById('fw-silver').selectedIndex].text : '-';
    const bName = bId ? document.getElementById('fw-bronze').options[document.getElementById('fw-bronze').selectedIndex].text : '-';

    if(!gId) return showToast("Must select at least GOLD winner.", "error");
    if(!confirm(`Confirm Podium for ${sportName}?\n1. ${gName}\n2. ${sName}\n3. ${bName}`)) return;

    const winnersData = { gold: gName, silver: sName, bronze: bName };
    const winnerText = `Gold: ${gName}, Silver: ${sName}, Bronze: ${bName}`;

    // FIX: CHECK IF FINAL ALREADY EXISTS TO PREVENT DUPLICATES
    const { data: existing } = await supabaseClient
        .from('matches')
        .select('id')
        .eq('sport_id', sportId)
        .eq('team1_name', 'Tournament Result')
        .single();

    let error;
    if (existing) {
        // UPDATE EXISTING
        const { error: updErr } = await supabaseClient.from('matches').update({
            winner_id: gId,
            winner_text: winnerText,
            winners_data: winnersData
        }).eq('id', existing.id);
        error = updErr;
    } else {
        // INSERT NEW
        const { error: insErr } = await supabaseClient.from('matches').insert({
            sport_id: sportId,
            team1_name: "Tournament Result",
            team2_name: "Official Declaration",
            start_time: new Date().toISOString(),
            location: "Admin Panel",
            round_number: 100,
            status: 'Completed',
            match_type: 'Final',
            winner_id: gId,
            winner_text: winnerText,
            winners_data: winnersData
        });
        error = insErr;
    }

    if(error) showToast("Error: " + error.message, "error");
    else {
        showToast("Podium Updated Successfully!", "success");
        logAdminAction('FORCE_WINNER', `Updated winners for ${sportName}`);
        closeModal('modal-force-winner');
    }
}

// --- 8. REGISTRATIONS LIST (NEW VIEW) ---
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

// --- 9. MATCH MANAGEMENT ---

window.loadMatches = async function(statusFilter = 'Scheduled') {
    currentMatchViewFilter = statusFilter;
    
    document.querySelectorAll('#match-filter-tabs button').forEach(btn => {
        if(btn.innerText === statusFilter) btn.className = "px-4 py-2 text-sm font-bold text-black border-b-2 border-black";
        else btn.className = "px-4 py-2 text-sm font-bold text-gray-500 hover:text-black";
    });

    const container = document.getElementById('matches-grid');
    if(!container) return;
    container.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading matches...</p>';

    const { data: matches } = await supabaseClient.from('matches').select('*, sports(name, is_performance, unit)').eq('status', statusFilter).order('start_time', { ascending: true });

    if(matches) {
        dataCache = matches.map(m => ({ Round: m.round_number, Sport: m.sports.name, Team1: m.team1_name, Team2: m.team2_name, Status: m.status }));
    }

    if (!matches || matches.length === 0) {
        container.innerHTML = `<p class="col-span-3 text-center text-gray-400 py-10">No ${statusFilter} matches found.</p>`;
        return;
    }

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
    loadMatches('Live');
    loadSportsList();
}

// --- 10. USERS (PROMOTION & RESET) ---
async function loadUsersList() {
    const tbody = document.getElementById('users-table-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center">Loading...</td></tr>';
    
    const { data: users } = await supabaseClient.from('users').select('*').order('created_at', { ascending: false });
    const { data: sports } = await supabaseClient.from('sports').select('id, name');

    dataCache = users.map(u => ({ Name: `${u.first_name} ${u.last_name}`, Email: u.email, Role: u.role, Class: u.class_name, Mobile: u.mobile }));

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
            <td class="p-4">
                ${u.role === 'volunteer' ? `<select onchange="assignVolunteerSport('${u.id}', this.value)" class="p-1 text-xs border rounded bg-white w-full"><option value="">-- Assign Sport --</option>${sportOptions}</select>` : '-'}
            </td>
            <td class="p-4 text-right flex justify-end gap-2">
                ${u.role !== 'admin' && u.role !== 'volunteer' ? `<button onclick="promoteUser('${u.id}')" class="text-xs bg-indigo-50 text-indigo-600 px-3 py-1 rounded-lg font-bold hover:bg-indigo-100">Make Vol</button>` : ''}
                <button onclick="resetUserPassword('${u.id}', '${u.first_name}')" class="text-xs bg-red-50 text-red-600 px-3 py-1 rounded-lg font-bold hover:bg-red-100 border border-red-100">Reset</button>
            </td>
        </tr>
    `}).join('');
}

window.promoteUser = async function(userId) {
    if(!confirm("Promote this user to Volunteer?")) return;
    await supabaseClient.from('users').update({ role: 'volunteer' }).eq('id', userId);
    showToast("User promoted!", "success");
    logAdminAction('PROMOTE_USER', `Promoted user ${userId}`);
    loadUsersList();
}

window.assignVolunteerSport = async function(userId, sportId) {
    const val = sportId === "" ? null : sportId;
    await supabaseClient.from('users').update({ assigned_sport_id: val }).eq('id', userId);
    showToast("Volunteer Sport Assigned", "success");
    logAdminAction('ASSIGN_SPORT', `Assigned sport ${sportId} to user ${userId}`);
}

window.resetUserPassword = async function(userId, name) {
    if(!confirm(`Reset password for ${name} to "student"?`)) return;
    const { error } = await supabaseClient.rpc('admin_reset_password', { target_user_id: userId });
    if(error) showToast("DB Error (Check pgcrypto)", "error");
    else {
        showToast("Password reset to 'student'", "success");
        logAdminAction('RESET_PASSWORD', `User: ${name}`);
    }
}

window.filterUsers = function() {
    const q = document.getElementById('user-search').value.toLowerCase();
    document.querySelectorAll('#users-table-body tr').forEach(r => {
        r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
}

// --- 11. ACTIVITY LOGS ---
async function loadActivityLogs() {
    const tbody = document.getElementById('logs-table-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center">Loading...</td></tr>';
    
    const { data: logs } = await supabaseClient.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(100);
    
    if(logs) {
        dataCache = logs.map(l => ({ Time: new Date(l.created_at).toLocaleString(), Admin: l.admin_email, Action: l.action, Details: l.details }));
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

// --- 12. TEAMS ---
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
    dataCache = teams.map(t => ({ Team: t.name, Sport: t.sports.name, Captain: `${t.captain?.first_name} ${t.captain?.last_name}`, Status: t.status }));
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

// --- UTILS & INJECTORS ---
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
