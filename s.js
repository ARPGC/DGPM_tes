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

// --- 3. INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    if(window.lucide) lucide.createIcons();
    injectToastContainer();
    injectScheduleModal();
    injectWinnerModal(); 

    await checkAdminAuth();
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

// --- 5. REALTIME SYNC ---
async function syncToRealtime(matchId) {
    const { data: match } = await supabaseClient.from('matches').select('*, sports(name)').eq('id', matchId).single();
    if (!match) return;

    let s1 = match.score1, s2 = match.score2;
    if (match.score_details) {
        s1 = match.score_details.team1_display || s1;
        s2 = match.score_details.team2_display || s2;
    }

    const payload = {
        id: match.id,
        sport_name: match.sports?.name || 'Unknown',
        team1_name: match.team1_name,
        team2_name: match.team2_name,
        score1: s1,
        score2: s2,
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
    if(titleEl) {
        if(viewId === 'manual-schedule') titleEl.innerText = 'Manual Scheduling';
        else titleEl.innerText = viewId.charAt(0).toUpperCase() + viewId.slice(1);
    }

    if(viewId === 'sports') window.loadSportsList();
    if(viewId === 'matches') { setupMatchFilters(); window.loadMatches('Scheduled'); }
    if(viewId === 'manual-schedule') window.loadManualScheduleView();
}

// --- 7. DASHBOARD STATS ---
async function loadDashboardStats() {
    const { count: userCount } = await supabaseClient.from('users').select('*', { count: 'exact', head: true });
    const { count: regCount } = await supabaseClient.from('registrations').select('*', { count: 'exact', head: true });
    const { count: teamCount } = await supabaseClient.from('teams').select('*', { count: 'exact', head: true });
    
    document.getElementById('dash-total-users').innerText = userCount || 0;
    document.getElementById('dash-total-regs').innerText = regCount || 0;
    document.getElementById('dash-total-teams').innerText = teamCount || 0;
}

// --- 8. SPORTS MANAGEMENT ---
window.loadSportsList = async function() {
    const tablePerf = document.getElementById('sports-table-performance');
    const tableTourn = document.getElementById('sports-table-tournament');
    
    if(tablePerf) tablePerf.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400">Loading...</td></tr>';
    if(tableTourn) tableTourn.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400">Loading...</td></tr>';

    const { data: sports } = await supabaseClient.from('sports').select('*').order('name');
    const { data: activeMatches } = await supabaseClient.from('matches').select('sport_id, match_type, status').neq('status', 'Completed');

    const isActive = (id, cat) => activeMatches?.some(m => m.sport_id === id && m.match_type?.includes(cat));

    if(!sports || sports.length === 0) return;

    let perfHtml = '';
    let tourHtml = '';

    sports.forEach(s => {
        let actionBtn = '';
        const isESport = s.name.toLowerCase().includes('bgmi') || s.name.toLowerCase().includes('free fire') || s.name.toLowerCase().includes('valorant');

        const generateBtn = (catLabel, catKey) => {
            if(isActive(s.id, catKey)) {
                return `<span class="text-[9px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded whitespace-nowrap">${catLabel} Live</span>`;
            } else {
                const btnColor = catLabel.includes('Boys') ? 'bg-blue-600' : 'bg-pink-600';
                return `<button onclick="window.handleScheduleClick('${s.id}', '${s.name}', ${s.is_performance}, '${s.type}', '${catKey}')" 
                        class="px-2 py-1.5 ${btnColor} text-white rounded text-[9px] font-bold shadow-sm hover:opacity-90 whitespace-nowrap">
                        Start ${catLabel}
                        </button>`;
            }
        };

        if (isESport) {
            const globalActive = isActive(s.id, 'Global');
            actionBtn = `
                <div class="flex items-center gap-2 justify-end">
                    ${globalActive 
                        ? '<span class="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded">Active</span>' 
                        : `<button onclick="window.handleScheduleClick('${s.id}', '${s.name}', false, '${s.type}', 'Global')" class="px-3 py-1.5 bg-indigo-600 text-white rounded text-[10px] font-bold shadow-sm">Start Event</button>`}
                    <button onclick="window.openForceWinnerModal('${s.id}', '${s.name}', true)" class="p-1.5 bg-yellow-50 text-yellow-600 rounded border border-yellow-200" title="Declare Winner"><i data-lucide="crown" class="w-3.5 h-3.5"></i></button>
                </div>`;
        } else {
            actionBtn = `
                <div class="flex flex-col gap-1 items-end">
                    <div class="flex gap-1">
                        ${generateBtn('Jr Boys', 'Junior Boys')}
                        ${generateBtn('Jr Girls', 'Junior Girls')}
                    </div>
                    <div class="flex gap-1">
                        ${generateBtn('Sr Boys', 'Senior Boys')}
                        ${generateBtn('Sr Girls', 'Senior Girls')}
                    </div>
                </div>
                <div class="ml-2 pl-2 border-l border-gray-100 flex items-center">
                     <button onclick="window.openForceWinnerModal('${s.id}', '${s.name}', false)" class="p-1.5 bg-yellow-50 text-yellow-600 rounded border border-yellow-200" title="Declare Winner"><i data-lucide="crown" class="w-3.5 h-3.5"></i></button>
                </div>
            `;
            actionBtn = `<div class="flex items-center justify-end">${actionBtn}</div>`;
        }

        const rowHtml = `
        <tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
            <td class="p-4 font-bold text-gray-800">${s.name}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold ${s.status === 'Open' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}">${s.status}</span></td>
            <td class="p-4 text-right">${actionBtn}</td>
        </tr>`;

        if (s.is_performance) perfHtml += rowHtml;
        else tourHtml += rowHtml;
    });

    if(tablePerf) tablePerf.innerHTML = perfHtml;
    if(tableTourn) tableTourn.innerHTML = tourHtml;
    lucide.createIcons();
}

// --- 9. SCHEDULER & MANUAL SCHEDULE ---

// NEW: Load Manual Schedule View
window.loadManualScheduleView = async function() {
    const sportSelect = document.getElementById('manual-sport');
    sportSelect.innerHTML = '<option value="">Loading...</option>';
    
    // Fetch Sports
    const { data: sports } = await supabaseClient.from('sports').select('id, name').order('name');
    
    sportSelect.innerHTML = '<option value="">-- Choose Sport --</option>';
    if(sports) {
        sports.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.innerText = s.name;
            sportSelect.appendChild(opt);
        });
    }
}

// UPDATE: Handle Sport Change in Manual View (FIXED FOR INDIVIDUAL SPORTS)
window.handleManualSportChange = async function() {
    const sportId = document.getElementById('manual-sport').value;
    const t1Select = document.getElementById('manual-team1');
    const t2Select = document.getElementById('manual-team2');
    const isBye = document.getElementById('manual-is-bye').checked;
    
    t1Select.innerHTML = '<option value="">Loading...</option>';
    
    // Only clear Team 2 if NOT in bye mode (in bye mode it stays fixed)
    if(!isBye) t2Select.innerHTML = '<option value="">Loading...</option>';

    if(!sportId) {
        t1Select.innerHTML = '<option value="">-- Select Sport First --</option>';
        if(!isBye) t2Select.innerHTML = '<option value="">-- Select Sport First --</option>';
        return;
    }

    // 1. Check Sport Type
    const { data: sport } = await supabaseClient.from('sports').select('type').eq('id', sportId).single();

    // 2. If Individual, we MUST ensure the registrations are converted to 'Teams' table entries first
    // This is required because 'matches' table expects team_id (foreign key), not user_id.
    if (sport?.type === 'Individual') {
        showToast("Syncing individual list...", "info");
        await supabaseClient.rpc('prepare_individual_teams', { sport_id_input: parseInt(sportId) });
    }

    // 3. FETCH FROM TEAMS TABLE (Unified Logic for both Team & Individual)
    // Individual "teams" will now exist thanks to the RPC call above.
    let allTeams = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabaseClient
            .from('teams')
            .select('id, name')
            .eq('sport_id', sportId)
            .order('name')
            .range(from, from + step - 1);
        
        if (data && data.length > 0) {
            allTeams = allTeams.concat(data);
            if (data.length < step) hasMore = false; else from += step;
        } else {
            hasMore = false;
        }
    }

    const opts = '<option value="">-- Select Participant --</option>' + 
                 allTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    
    t1Select.innerHTML = opts;
    if(!isBye) t2Select.innerHTML = opts;
}

// NEW: Toggle Bye Mode
window.toggleManualBye = function() {
    const isBye = document.getElementById('manual-is-bye').checked;
    const t2Select = document.getElementById('manual-team2');

    if(isBye) {
        t2Select.value = "";
        t2Select.disabled = true;
        t2Select.innerHTML = '<option value="">(BYE - No Opponent)</option>';
        t2Select.classList.add('bg-gray-100');
    } else {
        t2Select.disabled = false;
        t2Select.classList.remove('bg-gray-100');
        // Reload teams for Team 2
        handleManualSportChange();
    }
}

// NEW: Submit Manual Schedule
window.submitManualSchedule = async function(e) {
    e.preventDefault();
    
    const sportId = document.getElementById('manual-sport').value;
    const matchType = document.getElementById('manual-type').value;
    const round = document.getElementById('manual-round').value;
    const t1Id = document.getElementById('manual-team1').value;
    const isBye = document.getElementById('manual-is-bye').checked;
    
    let t2Id = document.getElementById('manual-team2').value;
    const time = document.getElementById('manual-time').value;
    const location = document.getElementById('manual-location').value;

    if(!sportId || !t1Id) return showToast("Please select Sport and Team 1", "error");
    
    if(!isBye && !t2Id) return showToast("Please select Team 2", "error");
    if(!isBye && t1Id === t2Id) return showToast("Team 1 and Team 2 cannot be the same.", "error");

    const t1Name = document.getElementById('manual-team1').options[document.getElementById('manual-team1').selectedIndex].text;
    
    let t2Name = "BYE";
    let status = "Completed";
    let winnerId = t1Id;
    let winnerText = `${t1Name} (Bye)`;

    if (!isBye) {
        t2Name = document.getElementById('manual-team2').options[document.getElementById('manual-team2').selectedIndex].text;
        status = "Scheduled";
        winnerId = null;
        winnerText = null;
    } else {
        t2Id = null;
    }

    const payload = {
        sport_id: parseInt(sportId),
        match_type: matchType,
        round_number: parseInt(round),
        team1_id: t1Id,
        team2_id: t2Id,
        team1_name: t1Name,
        team2_name: t2Name,
        start_time: new Date(time).toISOString(),
        location: location,
        status: status,
        winner_id: winnerId,
        winner_text: winnerText,
        is_live: false
    };

    const { error } = await supabaseClient.from('matches').insert(payload);

    if(error) {
        showToast("Failed to schedule: " + error.message, "error");
    } else {
        showToast("Match Published Successfully!", "success");
        window.switchView('matches'); 
    }
}

// --- EXISTING SCHEDULER LOGIC ---

window.handleScheduleClick = async function(sportId, sportName, isPerformance, sportType, category) {
    if (isPerformance) {
        if (confirm(`Start ${sportName} (${category})?`)) await initPerformanceEvent(sportId, sportName, category);
    } else {
        await initTournamentRound(sportId, sportName, sportType, category);
    }
}

// Helper: Fetch all registrations with pagination (>1000 rows)
async function fetchAllRegistrations(sportId) {
    let allRegs = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabaseClient
            .from('registrations')
            .select('user_id, users(first_name, last_name, student_id, class_name, gender)')
            .eq('sport_id', sportId)
            .range(from, from + step - 1);

        if (error) {
            showToast("Error fetching regs: " + error.message, "error");
            return [];
        }

        if (data && data.length > 0) {
            allRegs = allRegs.concat(data);
            if (data.length < step) hasMore = false;
            else from += step;
        } else {
            hasMore = false;
        }
    }
    return allRegs;
}

// Helper: Fetch all team members with pagination (>1000 rows)
async function fetchAllTeamMembers(teamIds) {
    let allMembers = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabaseClient
            .from('team_members')
            .select('team_id, users(gender)')
            .in('team_id', teamIds)
            .range(from, from + step - 1);

        if (error) {
            console.error("Error fetching members:", error);
            return [];
        }

        if (data && data.length > 0) {
            allMembers = allMembers.concat(data);
            if (data.length < step) hasMore = false;
            else from += step;
        } else {
            hasMore = false;
        }
    }
    return allMembers;
}

async function initPerformanceEvent(sportId, sportName, category) {
    showToast("Fetching participants... please wait", "info");
    const regs = await fetchAllRegistrations(sportId);

    if (!regs || regs.length === 0) return showToast("No registrations found.", "error");

    const isJunior = category.includes('Junior');
    const isBoys = category.includes('Boys'); 
    
    let participants = regs.filter(r => {
        const className = r.users.class_name;
        const gender = r.users.gender || ''; 

        const classMatch = isJunior ? ['FYJC', 'SYJC'].includes(className) : !['FYJC', 'SYJC'].includes(className);
        
        let genderMatch = true;
        if (category !== 'Global') {
             if (isBoys) genderMatch = (gender.toLowerCase() === 'male' || gender.toLowerCase() === 'boy');
             else genderMatch = (gender.toLowerCase() === 'female' || gender.toLowerCase() === 'girl');
        }

        return classMatch && genderMatch;
    });

    if (participants.length === 0) return showToast(`No ${category} participants found.`, "error");

    const pData = participants.map(r => ({
        id: r.user_id,
        name: `${r.users.first_name} ${r.users.last_name} (${r.users.student_id})`,
        result: '',
        rank: 0
    }));

    const { data: newMatch, error } = await supabaseClient.from('matches').insert({
        sport_id: sportId,
        team1_name: `${sportName} (${category})`,
        team2_name: 'Participants',
        status: 'Live',
        is_live: true,
        performance_data: pData,
        match_type: `Performance (${category})`
    }).select().single();

    if (error) showToast(error.message, "error");
    else { showToast(`${category} Event Started!`, "success"); syncToRealtime(newMatch.id); window.loadSportsList(); }
}

async function initTournamentRound(sportId, sportName, sportType, category) {
    const intSportId = parseInt(sportId); 
    const isESport = category === 'Global';

    const { data: catMatches } = await supabaseClient.from('matches')
        .select('round_number, status, match_type')
        .eq('sport_id', intSportId)
        .ilike('match_type', `%${category}%`)
        .order('round_number', { ascending: false });

    if (catMatches?.some(m => m.status !== 'Completed')) return showToast(`Finish active ${category} matches first!`, "error");

    let nextRound = 1, candidates = [];

    if (!catMatches || catMatches.length === 0) {
        if (sportType === 'Individual') await supabaseClient.rpc('prepare_individual_teams', { sport_id_input: intSportId });
        await supabaseClient.rpc('auto_lock_tournament_teams', { sport_id_input: intSportId });
        
        const { data: allTeams, error: rpcError } = await supabaseClient.rpc('get_tournament_teams', { sport_id_input: intSportId });

        if (rpcError) { console.error(rpcError); return showToast("DB Error", "error"); }
        
        if (allTeams) {
            if (isESport) {
                candidates = allTeams.map(t => ({ id: t.team_id, name: t.team_name }));
            } else {
                const requiredAge = category.toLowerCase().includes('junior') ? 'junior' : 'senior';
                const requiredGender = category.toLowerCase().includes('boys') ? 'male' : 'female';

                const ageFilteredTeams = allTeams.filter(t => (t.category || '').toLowerCase().trim() === requiredAge);
                const teamIds = ageFilteredTeams.map(t => t.team_id);
                
                if (teamIds.length > 0) {
                    const members = await fetchAllTeamMembers(teamIds);
                    const teamGenderMap = {};
                    if(members) {
                        members.forEach(m => {
                            if(!m.users) return;
                            const g = (m.users.gender || '').toLowerCase();
                            const stdG = (g === 'male' || g === 'boy' || g === 'm') ? 'male' : 'female';
                            if (!teamGenderMap[m.team_id]) teamGenderMap[m.team_id] = stdG;
                        });
                    }

                    candidates = ageFilteredTeams.filter(t => {
                        const detectedGender = teamGenderMap[t.team_id];
                        return detectedGender === requiredGender;
                    }).map(t => ({ id: t.team_id, name: t.team_name }));
                }
            }
        }
    } else {
        const lastRound = catMatches[0].round_number;
        nextRound = lastRound + 1;
        const { data: winners } = await supabaseClient.from('matches')
            .select('winner_id')
            .eq('sport_id', intSportId)
            .eq('round_number', lastRound)
            .ilike('match_type', `%${category}%`)
            .not('winner_id', 'is', null);
        
        const { data: alreadyScheduled } = await supabaseClient.from('matches')
            .select('team1_id, team2_id')
            .eq('sport_id', intSportId)
            .eq('round_number', nextRound)
            .ilike('match_type', `%${category}%`);

        const scheduledIds = (alreadyScheduled || []).flatMap(m => [m.team1_id, m.team2_id]);
        
        const validWinnerIds = winners.map(w => w.winner_id).filter(id => !scheduledIds.includes(id));
        const { data: teamDetails } = await supabaseClient.from('teams').select('id, name').in('id', validWinnerIds);
        candidates = (teamDetails || []).map(t => ({ id: t.id, name: t.name }));
    }

    if (candidates.length < 2) return showToast(`No candidates for ${category} next round.`, "info");

    tempSchedule = [];
    let matchType = candidates.length === 2 ? 'Final' : candidates.length <= 4 ? 'Semi-Final' : 'Regular';
    matchType += ` (${category})`;
    candidates.sort(() => Math.random() - 0.5);

    if (candidates.length % 2 !== 0) {
        const lucky = candidates.pop();
        tempSchedule.push({ t1: lucky, t2: { id: null, name: "BYE" }, time: "10:00", location: "N/A", round: nextRound, type: 'Bye' });
    }
    for (let i = 0; i < candidates.length; i += 2) {
        tempSchedule.push({ t1: candidates[i], t2: candidates[i+1], time: "10:00", location: "College Ground", round: nextRound, type: matchType });
    }
    openSchedulePreviewModal(sportName, `${nextRound} (${category})`, tempSchedule, intSportId);
}

function openSchedulePreviewModal(sportName, roundLabel, schedule, sportId) {
    const titleEl = document.getElementById('preview-subtitle');
    const container = document.getElementById('schedule-preview-list');
    
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
            </div>` : `<span class="text-xs font-bold text-green-500 bg-green-50 px-2 py-1 rounded">Auto-Advance</span>`}
        </div>`).join('');

    document.getElementById('btn-confirm-schedule').onclick = () => confirmSchedule(sportId);
    document.getElementById('modal-schedule-preview').classList.remove('hidden');
}

window.updateTempSchedule = (idx, field, value) => tempSchedule[idx][field] = value;

async function confirmSchedule(sportId) {
    const inserts = tempSchedule.map(m => ({
        sport_id: sportId, team1_id: m.t1.id, team2_id: m.t2.id, team1_name: m.t1.name, team2_name: m.t2.name,
        start_time: new Date().toISOString().split('T')[0] + 'T' + m.time, location: m.location, round_number: m.round,
        status: m.t2.id ? 'Scheduled' : 'Completed', winner_id: m.t2.id ? null : m.t1.id, winner_text: m.t2.id ? null : `${m.t1.name} (Bye)`, match_type: m.type
    }));
    const { error } = await supabaseClient.from('matches').insert(inserts);
    if(error) showToast(error.message, "error");
    else { showToast("Published!", "success"); window.closeModal('modal-schedule-preview'); window.loadMatches('Scheduled'); }
}

// --- 10. WINNER DECLARATION ---
window.openForceWinnerModal = async function(sportId, sportName, isESport) {
    const { data: teams } = await supabaseClient.from('teams').select('id, name').eq('sport_id', sportId);
    const opts = `<option value="">-- Select Winner --</option>` + (teams||[]).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    
    ['fw-gold','fw-silver','fw-bronze'].forEach(id => document.getElementById(id).innerHTML = opts);
    
    const catContainer = document.getElementById('fw-category-container');
    if (catContainer) {
        catContainer.style.display = isESport ? 'none' : 'block';
        if (!isESport) {
            const container = catContainer.querySelector('.cat-options');
            if(container) {
                 container.innerHTML = `
                    <div class="grid grid-cols-2 gap-2">
                        <label class="flex items-center gap-2 text-xs font-bold"><input type="radio" name="fw-cat" value="Junior Boys" checked class="accent-indigo-600"> Junior Boys</label>
                        <label class="flex items-center gap-2 text-xs font-bold"><input type="radio" name="fw-cat" value="Junior Girls" class="accent-indigo-600"> Junior Girls</label>
                        <label class="flex items-center gap-2 text-xs font-bold"><input type="radio" name="fw-cat" value="Senior Boys" class="accent-indigo-600"> Senior Boys</label>
                        <label class="flex items-center gap-2 text-xs font-bold"><input type="radio" name="fw-cat" value="Senior Girls" class="accent-indigo-600"> Senior Girls</label>
                    </div>`;
            }
        }
    }
    
    document.getElementById('btn-confirm-winner').onclick = () => confirmForceWinner(sportId, sportName, isESport);
    document.getElementById('modal-force-winner').classList.remove('hidden');
}

async function confirmForceWinner(sportId, sportName, isESport) {
    const gId = document.getElementById('fw-gold').value;
    const sId = document.getElementById('fw-silver').value;
    const bId = document.getElementById('fw-bronze').value;
    const cat = isESport ? 'Global' : document.querySelector('input[name="fw-cat"]:checked').value;

    if(!gId) return showToast("Select Gold winner.", "error");

    const getTxt = (id) => { const el = document.getElementById(id); return el.selectedIndex > 0 ? el.options[el.selectedIndex].text : '-'; };
    const winnersData = { gold: getTxt('fw-gold'), silver: getTxt('fw-silver'), bronze: getTxt('fw-bronze') };
    const resultName = isESport ? `E-Sports Result` : `Tournament Result (${cat})`;

    const { data: existing } = await supabaseClient.from('matches').select('id').eq('sport_id', sportId).eq('team1_name', resultName).single();

    const payload = { winner_id: gId, winner_text: `Result: ${winnersData.gold}`, winners_data: winnersData, status: 'Completed', match_type: `Final (${cat})`, is_live: false };

    if (existing) {
        await supabaseClient.from('matches').update(payload).eq('id', existing.id);
        syncToRealtime(existing.id);
    } else {
        const { data: nm } = await supabaseClient.from('matches').insert({
            sport_id: sportId, team1_name: resultName, team2_name: "Official Result",
            start_time: new Date().toISOString(), location: "Admin Panel", round_number: 100, ...payload
        }).select().single();
        syncToRealtime(nm.id);
    }

    showToast(`Result Declared!`, "success");
    window.closeModal('modal-force-winner');
    window.loadSportsList();
}

// --- 11. MATCH LIST ---
window.loadMatches = async function(statusFilter) {
    currentMatchViewFilter = statusFilter;
    const container = document.getElementById('matches-grid');
    if(!container) return;
    container.innerHTML = '<p class="col-span-3 text-center py-10">Loading...</p>';

    // Loop to fetch ALL matches, breaking the 1000 limit
    let allMatches = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabaseClient
            .from('matches')
            .select('*, sports(name, is_performance)')
            .eq('status', statusFilter)
            .order('start_time', { ascending: true })
            .range(from, from + step - 1);

        if (error) {
            console.error("Fetch Matches Error:", error);
            break;
        }

        if (data && data.length > 0) {
            allMatches = allMatches.concat(data);
            if (data.length < step) hasMore = false;
            else from += step;
        } else {
            hasMore = false;
        }
    }

    if (!allMatches || allMatches.length === 0) {
        container.innerHTML = `<p class="col-span-3 text-center py-10 text-gray-400">No matches found.</p>`;
        return;
    }

    container.innerHTML = allMatches.map(m => `
        <div class="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm transition-all hover:shadow-md">
            <span class="text-[10px] font-bold bg-gray-100 px-2 py-1 rounded text-gray-500 uppercase tracking-widest">${m.sports.name}</span>
            <div class="py-4 text-center">
                <h4 class="font-black text-gray-900 leading-tight">${m.team1_name}</h4>
                ${m.team2_name !== 'Participants' ? `<div class="text-[10px] text-gray-300 font-bold my-1 italic">VS</div><h4 class="font-black text-gray-900 leading-tight">${m.team2_name}</h4>` : ''}
            </div>
            <div class="border-t pt-3 flex justify-between items-center text-xs">
                 <span class="text-gray-400 font-bold">${m.match_type || '-'}</span>
                 ${m.status === 'Scheduled' ? `<button onclick="window.startMatch('${m.id}')" class="text-brand-primary font-black px-3 py-1 bg-indigo-50 rounded-lg">START</button>` : ''}
            </div>
        </div>`).join('');
}

window.startMatch = async function(matchId) {
    await supabaseClient.from('matches').update({ status: 'Live', is_live: true }).eq('id', matchId);
    showToast("Live!", "success");
    syncToRealtime(matchId);
    window.loadMatches('Live');
}

// --- 12. UI INJECTION UTILS ---
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

function setupMatchFilters() {
    if(document.getElementById('match-filter-tabs')) return;
    const div = document.createElement('div');
    div.id = 'match-filter-tabs';
    div.className = "flex gap-2 mb-6 border-b border-gray-100 pb-2 col-span-3";
    div.innerHTML = `
        <button onclick="loadMatches('Scheduled')" class="px-4 py-2 font-bold text-sm text-gray-400 hover:text-black transition-colors">Scheduled</button>
        <button onclick="loadMatches('Live')" class="px-4 py-2 font-bold text-sm text-gray-400 hover:text-black transition-colors">Live</button>
        <button onclick="loadMatches('Completed')" class="px-4 py-2 font-bold text-sm text-gray-400 hover:text-black transition-colors">Completed</button>`;
    document.getElementById('view-matches').prepend(div);
}

function injectScheduleModal() {
    if(document.getElementById('modal-schedule-preview')) return;
    const div = document.createElement('div');
    div.id = 'modal-schedule-preview';
    div.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in';
    div.innerHTML = `
        <div class="bg-white p-6 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto m-4 shadow-2xl">
            <div class="flex justify-between items-center mb-6">
                <div><h3 class="font-black text-xl text-gray-900">Schedule Preview</h3><p id="preview-subtitle" class="text-xs text-gray-400 font-bold uppercase"></p></div>
                <button onclick="closeModal('modal-schedule-preview')" class="p-2 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div id="schedule-preview-list" class="space-y-3 mb-6"></div>
            <button id="btn-confirm-schedule" class="w-full py-4 bg-black text-white font-black rounded-xl shadow-lg active:scale-95 transition-all">PUBLISH ROUND</button>
        </div>`;
    document.body.appendChild(div);
}

function injectWinnerModal() {
    if(document.getElementById('modal-force-winner')) return;
    const div = document.createElement('div');
    div.id = 'modal-force-winner';
    div.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in';
    div.innerHTML = `
        <div class="bg-white p-6 rounded-[2rem] w-full max-w-sm shadow-2xl">
            <h3 class="font-black text-xl text-gray-900 mb-6">Declare Podium</h3>
            <div id="fw-category-container" class="mb-6 bg-gray-50 p-4 rounded-2xl">
                <label class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 block">Match Category</label>
                <div class="cat-options">
                    </div>
            </div>
            <div class="space-y-3">
                <select id="fw-gold" class="w-full p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm font-bold outline-none"></select>
                <select id="fw-silver" class="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none"></select>
                <select id="fw-bronze" class="w-full p-3 bg-orange-50 border border-orange-200 rounded-xl text-sm font-bold outline-none"></select>
            </div>
            <div class="flex gap-2 mt-8">
                <button onclick="closeModal('modal-force-winner')" class="flex-1 py-3 bg-gray-100 rounded-xl font-bold text-sm text-gray-500">CANCEL</button>
                <button id="btn-confirm-winner" class="flex-1 py-3 bg-black text-white rounded-xl font-black text-sm shadow-lg">CONFIRM</button>
            </div>
        </div>`;
    document.body.appendChild(div);
}

function injectToastContainer() {
    if(document.getElementById('toast-container')) return;
    const div = document.createElement('div');
    div.id = 'toast-container';
    div.className = 'fixed bottom-10 left-1/2 transform -translate-x-1/2 z-[70] transition-all duration-300 opacity-0 pointer-events-none translate-y-10 w-11/12 max-w-sm';
    div.innerHTML = `<div id="toast-content" class="bg-gray-900 text-white px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-4"><div id="toast-icon"></div><p id="toast-msg" class="text-sm font-bold flex-1 tracking-tight"></p></div>`;
    document.body.appendChild(div);
}

function showToast(msg, type) {
    const t = document.getElementById('toast-container');
    const txt = document.getElementById('toast-msg');
    const icon = document.getElementById('toast-icon');
    if(txt) txt.innerText = msg;
    if(icon) icon.innerHTML = type === 'error' ? '<i data-lucide="alert-circle" class="w-5 h-5 text-red-400"></i>' : '<i data-lucide="check-circle" class="w-5 h-5 text-green-400"></i>';
    if(window.lucide) lucide.createIcons();
    t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
    setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10'), 3000);
}
