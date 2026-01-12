// --- CONFIGURATION ---
const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
let currentUser = null;
let tempSchedule = []; // Holds preview data for tournament generation

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    await checkAdminAuth();
    
    // Default View
    switchView('dashboard');
});

// --- 1. AUTH CHECK ---
async function checkAdminAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    // Verify Admin Role
    const { data: user } = await supabaseClient
        .from('users')
        .select('role')
        .eq('id', session.user.id)
        .single();

    if (!user || user.role !== 'admin') {
        alert("Access Denied: Admins Only");
        window.location.href = 'login.html';
        return;
    }
    
    currentUser = session.user;
    loadDashboardStats();
}

function adminLogout() {
    supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

// --- 2. VIEW SWITCHING ---
window.switchView = function(viewId) {
    // Hide all views
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    
    // Show target view
    const target = document.getElementById('view-' + viewId);
    if(target) {
        target.classList.remove('hidden');
        target.classList.remove('animate-fade-in');
        void target.offsetWidth; // Trigger reflow
        target.classList.add('animate-fade-in');
    }

    // Update Sidebar
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('bg-brand-primary', 'text-white');
        el.classList.add('text-gray-500', 'hover:bg-gray-50');
    });

    const navBtn = document.getElementById('nav-' + viewId);
    if(navBtn) {
        navBtn.classList.remove('text-gray-500', 'hover:bg-gray-50');
        navBtn.classList.add('bg-brand-primary', 'text-white', 'shadow-lg', 'shadow-indigo-200');
    }

    // Update Header Title
    document.getElementById('page-title').innerText = viewId.charAt(0).toUpperCase() + viewId.slice(1);

    // Load Data based on view
    if(viewId === 'sports') loadSportsList();
    if(viewId === 'users') loadUsersList();
    if(viewId === 'matches') loadMatches('Scheduled');
    if(viewId === 'teams') loadTeamsList();
}

// --- 3. DASHBOARD STATS ---
async function loadDashboardStats() {
    const { count: userCount } = await supabaseClient.from('users').select('*', { count: 'exact', head: true });
    const { count: regCount } = await supabaseClient.from('registrations').select('*', { count: 'exact', head: true });
    const { count: teamCount } = await supabaseClient.from('teams').select('*', { count: 'exact', head: true });
    const { count: matchCount } = await supabaseClient.from('matches').select('*', { count: 'exact', head: true }).eq('status', 'Live');

    document.getElementById('dash-total-users').innerText = userCount || 0;
    document.getElementById('dash-total-regs').innerText = regCount || 0;
    document.getElementById('dash-total-teams').innerText = teamCount || 0;
    document.getElementById('dash-live-matches').innerText = matchCount || 0;
}

// --- 4. SPORTS MANAGEMENT ---
async function loadSportsList() {
    const tbody = document.getElementById('sports-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-400">Loading...</td></tr>';

    const { data: sports } = await supabaseClient.from('sports').select('*').order('name');

    if(!sports || sports.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-400">No sports added.</td></tr>';
        return;
    }

    tbody.innerHTML = sports.map(s => `
        <tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
            <td class="p-4 font-bold text-gray-800">${s.name}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold ${s.type === 'Team' ? 'bg-indigo-50 text-indigo-600' : 'bg-pink-50 text-pink-600'}">${s.type}</span></td>
            <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold ${s.status === 'Open' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}">${s.status}</span></td>
            <td class="p-4 text-right">
                <button onclick="window.handleScheduleClick('${s.id}', '${s.name}', ${s.is_performance})" class="px-3 py-1 bg-black text-white rounded-lg text-xs font-bold hover:bg-gray-800 mr-2">
                    ${s.is_performance ? 'Start Event' : 'Schedule Round'}
                </button>
                <button onclick="toggleSportStatus('${s.id}', '${s.status}')" class="text-xs font-bold underline text-gray-400 hover:text-gray-600">
                    ${s.status === 'Open' ? 'Close' : 'Open'}
                </button>
            </td>
        </tr>
    `).join('');
}

window.openAddSportModal = () => document.getElementById('modal-add-sport').classList.remove('hidden');

window.handleAddSport = async function(e) {
    e.preventDefault();
    const name = document.getElementById('new-sport-name').value;
    const type = document.getElementById('new-sport-type').value;
    const size = document.getElementById('new-sport-size').value;

    // Auto-detect performance type based on keywords
    const isPerformance = name.toLowerCase().includes('race') || 
                          name.toLowerCase().includes('jump') || 
                          name.toLowerCase().includes('throw') || 
                          name.toLowerCase().includes('put'); 

    const unit = isPerformance ? (name.toLowerCase().includes('race') ? 'Seconds' : 'Meters') : 'Points';

    const { error } = await supabaseClient.from('sports').insert({
        name, type, team_size: size, icon: 'trophy', 
        is_performance: isPerformance, 
        unit: unit
    });

    if(error) showToast(error.message, "error");
    else {
        showToast("Sport Added!", "success");
        closeModal('modal-add-sport');
        loadSportsList();
    }
}

window.toggleSportStatus = async function(id, currentStatus) {
    const newStatus = currentStatus === 'Open' ? 'Closed' : 'Open';
    await supabaseClient.from('sports').update({ status: newStatus }).eq('id', id);
    loadSportsList();
}

// --- 5. SCHEDULING ENGINE ---

window.handleScheduleClick = async function(sportId, sportName, isPerformance) {
    if (isPerformance) {
        // FLOW A: Performance Event (Single Big Match Entry)
        if (confirm(`Start ${sportName}? This will initiate the event for volunteers to enter data.`)) {
            await initPerformanceEvent(sportId, sportName);
        }
    } else {
        // FLOW B: Tournament Round (Pairing Logic)
        await initTournamentRound(sportId, sportName);
    }
}

// A. Initialize Race/Throw
async function initPerformanceEvent(sportId, sportName) {
    // Check if exists
    const { data: existing } = await supabaseClient.from('matches').select('id').eq('sport_id', sportId).neq('status', 'Completed');
    if (existing.length > 0) return showToast("Event is already active!", "info");

    // Fetch Participants
    const { data: regs } = await supabaseClient.from('registrations')
        .select('user_id, users(first_name, last_name, student_id)')
        .eq('sport_id', sportId);

    if (!regs || regs.length === 0) return showToast("No registrations found.", "error");

    const participants = regs.map(r => ({
        id: r.user_id,
        name: `${r.users.first_name} ${r.users.last_name} (${r.users.student_id})`,
        result: '',
        rank: 0
    }));

    const { error } = await supabaseClient.from('matches').insert({
        sport_id: sportId,
        team1_name: sportName,
        team2_name: 'All Participants',
        status: 'Live', // Ready immediately for volunteer input
        is_live: true,
        performance_data: participants
    });

    if (error) showToast(error.message, "error");
    else showToast(`${sportName} started! Volunteers can now enter data.`, "success");
}

// B. End Performance Event (CALCULATE WINNERS)
window.endPerformanceEvent = async function(matchId) {
    if (!confirm("Are you sure? This will Calculate Ranks (Gold/Silver/Bronze) and Close the event.")) return;

    const { data: match } = await supabaseClient.from('matches').select('performance_data, sports(unit)').eq('id', matchId).single();
    let arr = match.performance_data;
    const unit = match.sports.unit;

    // Filter valid entries
    let validEntries = arr.filter(p => p.result && p.result.trim() !== '');
    
    // Sort Logic
    // Time (Seconds) -> Lower is better
    // Distance (Meters) -> Higher is better
    const isDistance = unit === 'Meters' || unit === 'Points';
    
    validEntries.sort((a, b) => {
        const valA = parseFloat(a.result) || 0;
        const valB = parseFloat(b.result) || 0;
        return isDistance ? (valB - valA) : (valA - valB);
    });

    // Assign Ranks & Winners
    let winners = { gold: null, silver: null, bronze: null };
    
    validEntries.forEach((p, i) => {
        p.rank = i + 1;
        if(i === 0) winners.gold = p.name;
        if(i === 1) winners.silver = p.name;
        if(i === 2) winners.bronze = p.name;
    });

    // Update DB
    const { error } = await supabaseClient.from('matches').update({ 
        performance_data: arr, // Save sorted ranks
        status: 'Completed',
        winner_text: `Gold: ${winners.gold || '-'}`,
        winners_data: winners, // Save explicit winners
        is_live: false 
    }).eq('id', matchId);

    if(error) showToast("Error ending event: " + error.message, "error");
    else {
        showToast("Event Ended & Winners Declared!", "success");
        loadMatches('Completed');
    }
}

// C. Initialize Tournament Round (Matches)
async function initTournamentRound(sportId, sportName) {
    showToast("Analyzing Bracket...", "info");

    const { data: matches } = await supabaseClient.from('matches')
        .select('round_number, status')
        .eq('sport_id', sportId)
        .order('round_number', { ascending: false })
        .limit(1);

    let round = 1;
    let candidates = [];

    if (!matches || matches.length === 0) {
        // ROUND 1: Fetch locked teams
        const { data: teams } = await supabaseClient.from('teams').select('id, name').eq('sport_id', sportId).eq('status', 'Locked');
        candidates = teams || [];
    } else {
        if (matches[0].status !== 'Completed') return showToast("Current round not finished!", "error");
        
        round = matches[0].round_number + 1;
        const { data: winners } = await supabaseClient.rpc('get_round_winners', { sport_id_input: sportId, round_num: round - 1 });
        candidates = winners.map(w => ({ id: w.team_id, name: w.team_name }));
    }

    if (!candidates || candidates.length < 2) return showToast(`Not enough teams for Round ${round}.`, "error");

    candidates.sort(() => Math.random() - 0.5);
    tempSchedule = [];

    for (let i = 0; i < candidates.length; i += 2) {
        if (i + 1 < candidates.length) {
            tempSchedule.push({
                t1: candidates[i],
                t2: candidates[i+1],
                time: "10:00",
                location: "Main Ground",
                round: round
            });
        } else {
             showToast(`${candidates[i].name} gets a Bye.`, "info");
        }
    }

    openSchedulePreviewModal(sportName, round, tempSchedule, sportId);
}

function openSchedulePreviewModal(sportName, round, schedule, sportId) {
    document.getElementById('preview-subtitle').innerText = `Generating Round ${round}`;
    const container = document.getElementById('schedule-preview-list');
    
    container.innerHTML = schedule.map((m, idx) => `
        <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-center gap-4">
            <div class="flex-1 text-center md:text-left">
                <div class="font-bold text-gray-900">${m.t1.name}</div>
                <div class="text-xs text-gray-400 font-bold">VS</div>
                <div class="font-bold text-gray-900">${m.t2.name}</div>
            </div>
            <div class="flex gap-2 w-full md:w-auto">
                <input type="time" class="input-field p-2 w-full md:w-24 bg-gray-50 border rounded-lg text-sm font-bold" value="${m.time}" onchange="updateTempSchedule(${idx}, 'time', this.value)">
                <select class="input-field p-2 w-full md:w-32 bg-gray-50 border rounded-lg text-sm font-bold" onchange="updateTempSchedule(${idx}, 'location', this.value)">
                    <option value="Main Ground">Main Ground</option>
                    <option value="Court A">Court A</option>
                </select>
            </div>
        </div>
    `).join('');

    document.getElementById('btn-confirm-schedule').onclick = () => confirmSchedule(sportId);
    document.getElementById('modal-schedule-preview').classList.remove('hidden');
}

window.updateTempSchedule = function(idx, field, value) {
    tempSchedule[idx][field] = value;
}

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
        status: 'Scheduled'
    }));

    const { error } = await supabaseClient.from('matches').insert(inserts);

    if(error) {
        showToast(error.message, "error");
        btn.innerText = "Confirm & Publish";
        btn.disabled = false;
    } else {
        showToast("Schedule Published!", "success");
        closeModal('modal-schedule-preview');
        switchView('matches');
    }
}

// --- 6. MATCH MANAGEMENT (View) ---

window.loadMatches = async function(statusFilter = 'Scheduled') {
    const container = document.getElementById('matches-grid');
    container.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading matches...</p>';

    const { data: matches } = await supabaseClient
        .from('matches')
        .select('*, sports(name, is_performance)')
        .eq('status', statusFilter)
        .order('start_time', { ascending: true });

    if (!matches || matches.length === 0) {
        container.innerHTML = `<p class="col-span-3 text-center text-gray-400 py-10">No ${statusFilter} matches found.</p>`;
        return;
    }

    container.innerHTML = matches.map(m => {
        const isPerf = m.sports.is_performance;
        return `
        <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
            <div class="absolute top-0 left-0 w-1 h-full ${m.status === 'Live' ? 'bg-green-500' : 'bg-brand-primary'}"></div>
            
            <div class="flex justify-between items-start mb-4 pl-3">
                <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400">${m.sports.name} • ${isPerf ? 'Event' : 'Round ' + m.round_number}</span>
                <span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${m.status === 'Live' ? 'bg-green-100 text-green-700 animate-pulse' : 'bg-gray-100 text-gray-500'}">${m.status}</span>
            </div>

            <div class="text-center mb-4 pl-3">
                <h4 class="font-black text-gray-900 text-lg leading-tight">${m.team1_name}</h4>
                ${!isPerf ? `<div class="text-xs font-bold text-gray-400 my-1">VS</div><h4 class="font-black text-gray-900 text-lg leading-tight">${m.team2_name}</h4>` : ''}
            </div>

            <div class="flex justify-between items-center border-t border-gray-50 pt-3 pl-3">
                ${isPerf && m.status === 'Live' ? 
                    `<button onclick="endPerformanceEvent('${m.id}')" class="w-full px-3 py-2 bg-red-500 text-white text-xs font-bold rounded-lg hover:bg-red-600 shadow-sm">Calculate Winners & End Event</button>`
                : 
                    m.status === 'Scheduled' ? 
                        `<button onclick="startMatch('${m.id}')" class="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 shadow-sm">Start Now</button>` 
                        : `<span class="text-xs font-bold text-gray-400">${m.winner_text || 'Completed'}</span>`
                }
            </div>
        </div>
    `}).join('');
    lucide.createIcons();
}

window.startMatch = async function(matchId) {
    if(!confirm("Start this match now? It will appear as LIVE.")) return;
    await supabaseClient.from('matches').update({ status: 'Live', is_live: true }).eq('id', matchId);
    loadMatches('Live');
    showToast("Match is now LIVE!", "success");
}

// --- 7. TEAMS MANAGEMENT (FIXED) ---
async function loadTeamsList() {
    const grid = document.getElementById('teams-grid');
    grid.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading teams...</p>';

    const { data: teams } = await supabaseClient
        .from('teams')
        .select('*, sports(name), captain:users!captain_id(first_name, last_name)');

    if (!teams || teams.length === 0) {
        grid.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">No teams created yet.</p>';
        return;
    }

    grid.innerHTML = teams.map(t => `
        <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
            <div class="flex justify-between items-start mb-3">
                <span class="text-[10px] font-bold uppercase bg-gray-100 px-2 py-1 rounded text-gray-500">${t.sports.name}</span>
                <span class="text-[10px] font-bold uppercase ${t.status === 'Locked' ? 'text-red-500' : 'text-green-500'}">${t.status}</span>
            </div>
            <h4 class="font-bold text-lg text-gray-900">${t.name}</h4>
            <p class="text-xs text-gray-500 mb-4">Capt: ${t.captain?.first_name || 'Unknown'}</p>
            <button onclick="viewTeamSquad('${t.id}', '${t.name}')" class="w-full py-2 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-lg hover:bg-indigo-100 transition-colors">
                View Squad
            </button>
        </div>
    `).join('');
}

window.viewTeamSquad = async function(teamId, teamName) {
    const { data: members } = await supabaseClient
        .from('team_members')
        .select('users(first_name, last_name, student_id, class_name)')
        .eq('team_id', teamId)
        .eq('status', 'Accepted');

    let msg = `Squad for ${teamName}:\n\n`;
    if(members) {
        members.forEach((m, i) => {
            msg += `${i+1}. ${m.users.first_name} ${m.users.last_name} (${m.users.class_name})\n`;
        });
    }
    alert(msg); // Using alert for simplicity, could be a modal
}

// --- 8. USER MANAGEMENT & ASSIGNMENT ---
async function loadUsersList() {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-400">Loading users...</td></tr>';
    
    // Fetch users with their assigned sport name
    const { data: users } = await supabaseClient
        .from('users')
        .select('*, assigned_sport:sports!assigned_sport_id(name)')
        .order('created_at', { ascending: false })
        .limit(50);
    
    const { data: sports } = await supabaseClient.from('sports').select('id, name');

    tbody.innerHTML = users.map(u => {
        // Create sport options for the dropdown
        const sportOptions = sports.map(s => 
            `<option value="${s.id}" ${u.assigned_sport_id === s.id ? 'selected' : ''}>${s.name}</option>`
        ).join('');

        return `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="p-4 font-bold text-gray-800 flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-gray-200 overflow-hidden"><img src="${u.avatar_url || 'https://via.placeholder.com/32'}" class="w-full h-full object-cover"></div>
                ${u.first_name} ${u.last_name}
            </td>
            <td class="p-4 text-sm text-gray-600">${u.class_name || '-'}</td>
            <td class="p-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-600">${u.role}</span></td>
            <td class="p-4">
                ${u.role === 'volunteer' ? 
                    `<select class="p-1 bg-white border rounded text-xs" onchange="assignVolunteerSport('${u.id}', this.value)">
                        <option value="">-- Assign Sport --</option>
                        ${sportOptions}
                    </select>` 
                : '-'}
            </td>
            <td class="p-4 text-right">
                ${u.role !== 'admin' ? 
                    `<button onclick="promoteUser('${u.id}')" class="text-xs font-bold text-brand-primary hover:underline">Make Volunteer</button>` 
                    : '<span class="text-gray-300 text-xs">Admin</span>'
                }
            </td>
        </tr>
    `}).join('');
}

window.assignVolunteerSport = async function(userId, sportId) {
    const val = sportId === "" ? null : sportId;
    const { error } = await supabaseClient.from('users').update({ assigned_sport_id: val }).eq('id', userId);
    if(error) showToast("Assignment Failed", "error");
    else showToast("Volunteer Assigned!", "success");
}

window.promoteUser = async function(userId) {
    if(!confirm("Promote this user to Volunteer?")) return;
    const { error } = await supabaseClient.from('users').update({ role: 'volunteer' }).eq('id', userId);
    if(error) showToast("Error promoting user", "error");
    else {
        showToast("User Promoted!", "success");
        loadUsersList();
    }
}

// --- UTILS ---
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

function showToast(msg, type) {
    const t = document.getElementById('toast-container');
    const c = document.getElementById('toast-content');
    const txt = document.getElementById('toast-text');
    const icon = document.getElementById('toast-icon');

    c.className = `px-6 py-4 rounded-xl shadow-2xl font-bold text-sm flex items-center gap-3 ${type === 'error' ? 'bg-red-500 text-white' : 'bg-gray-900 text-white'}`;
    txt.innerText = msg;
    icon.innerHTML = type === 'error' ? '<i data-lucide="alert-circle" class="w-5 h-5"></i>' : '<i data-lucide="check-circle" class="w-5 h-5"></i>';
    lucide.createIcons();

    t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
    setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10'), 3000);
}
