// ==========================================
// URJA 2026 - ADMIN CONTROL CENTER
// ==========================================

// --- 1. CONFIGURATION & CLIENTS ---

if (typeof CONFIG === 'undefined' || typeof CONFIG_REALTIME === 'undefined') {
    console.error("CRITICAL ERROR: Config missing.");
    alert("System Error: Config missing. Check console.");
}

// FIX: Use a unique variable name 'adminClient' to avoid conflicts with superviser.js
const adminClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// Realtime Client
const adminRtClient = window.supabase.createClient(CONFIG_REALTIME.url, CONFIG_REALTIME.serviceKey);

// --- 2. STATE MANAGEMENT ---
let currentUser = null;
let currentView = 'dashboard';
let currentMatchViewFilter = 'Scheduled'; 

// Data Caches
let allTeamsCache = []; 
let dataCache = []; 
let allRegistrationsCache = []; 
let currentEditingTeamId = null;

// Sorting
let currentSort = { key: 'created_at', asc: false };

const DEFAULT_AVATAR = "https://t4.ftcdn.net/jpg/05/89/93/27/360_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.jpg";

// --- 3. INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    if(window.lucide) lucide.createIcons();
    injectToastContainer();
    await checkAdminAuth();
    switchView('dashboard');
});

// --- 4. AUTHENTICATION ---
async function checkAdminAuth() {
    const { data: { session } } = await adminClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    const { data: user } = await adminClient
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

window.adminLogout = async function() {
    await adminClient.auth.signOut();
    window.location.href = 'login.html';
}

async function logAdminAction(action, details) {
    console.log(`[ADMIN LOG] ${action}: ${details}`);
    try {
        await adminClient.from('admin_logs').insert({
            admin_email: currentUser?.email || 'unknown',
            action: action,
            details: details
        });
    } catch (err) { console.error(err); }
}

// --- 5. REALTIME SYNC ---
async function syncToRealtime(matchId) {
    console.log(`[SYNC] Syncing Match ${matchId}...`);
    const { data: match } = await adminClient.from('matches').select('*, sports(name)').eq('id', matchId).single();
    
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

    await adminRtClient.from('live_matches').upsert(payload);
}

// --- 6. NAVIGATION ---
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
        if (['users', 'teams', 'matches', 'registrations'].includes(viewId)) globalActions.classList.remove('hidden');
        else globalActions.classList.add('hidden');
    }

    // Toggle Squad PDF Button (Only for Teams view)
    const squadPdfBtn = document.getElementById('btn-squad-pdf');
    if(squadPdfBtn) {
        if (viewId === 'teams') squadPdfBtn.classList.remove('hidden');
        else squadPdfBtn.classList.add('hidden');
    }

    dataCache = [];
    if(viewId === 'users') loadUsersList();
    if(viewId === 'matches') { setupMatchFilters(); loadMatches('Scheduled'); }
    if(viewId === 'teams') loadTeamsList();
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
    } else if (type === 'pdf') {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l');
        const headers = Object.keys(dataCache[0]).map(k => k.toUpperCase());
        const rows = dataCache.map(obj => Object.values(obj).map(v => String(v)));
        doc.setFontSize(18);
        doc.text(`URJA 2026 - ${currentView.toUpperCase()}`, 14, 22);
        doc.autoTable({ head: [headers], body: rows, startY: 30, theme: 'grid', styles: { fontSize: 8 } });
        doc.save(`${filename}.pdf`);
    }
}

// --- 7b. NEW SQUADS PDF EXPORT ---
window.downloadSquadsPDF = async function() {
    showToast("Generating Full Squads PDF...", "success");

    // 1. Fetch Deep Data (Teams -> Members -> Users)
    const { data: members, error } = await adminClient
        .from('team_members')
        .select(`
            status,
            users (first_name, last_name, class_name, gender, mobile, student_id),
            teams (id, name, status, sports(name), captain:users!captain_id(first_name, last_name))
        `)
        .eq('status', 'Accepted');

    if(error || !members) return showToast("Error fetching squad data", "error");

    // 2. Get Active Filters from DOM to respect current view
    const sportFilter = document.getElementById('filter-team-sport')?.value || '';
    const statusFilter = document.getElementById('filter-team-status')?.value || '';

    // 3. Group by Team
    const grouped = {};
    members.forEach(m => {
        const t = m.teams;
        if (!t) return;
        
        // Apply Filters
        if (sportFilter && t.sports?.name !== sportFilter) return;
        if (statusFilter && t.status !== statusFilter) return;

        const teamName = t.name;
        if (!grouped[teamName]) {
            grouped[teamName] = {
                sport: t.sports?.name || 'Unknown',
                captain: t.captain ? `${t.captain.first_name} ${t.captain.last_name}` : 'N/A',
                players: []
            };
        }
        grouped[teamName].players.push(m.users);
    });

    if (Object.keys(grouped).length === 0) return showToast("No teams found with current filters.", "error");

    // 4. Generate PDF
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(22);
    doc.text("URJA 2026 - OFFICIAL SQUADS LIST", 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 26);

    let yPos = 35;

    Object.keys(grouped).sort().forEach(teamName => {
        const team = grouped[teamName];
        
        // Check for page break
        if (yPos > 250) { doc.addPage(); yPos = 20; }

        // Team Header
        doc.setFontSize(14);
        doc.setTextColor(79, 70, 229); // Indigo
        doc.text(`${teamName} (${team.sport})`, 14, yPos);
        
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Captain: ${team.captain}`, 14, yPos + 6);

        // Table Body
        const rows = team.players.map((p, i) => [
            i + 1,
            `${p.first_name} ${p.last_name}`,
            p.class_name || '-',
            p.gender || '-',
            p.mobile || '-'
        ]);

        doc.autoTable({
            startY: yPos + 10,
            head: [['#', 'Player Name', 'Class', 'Gender', 'Mobile']],
            body: rows,
            theme: 'grid',
            headStyles: { fillColor: [66, 66, 66] },
            styles: { fontSize: 9 },
            margin: { left: 14 }
        });

        yPos = doc.lastAutoTable.finalY + 15;
    });

    doc.save(`Urja_Squads_MasterList_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast("PDF Downloaded!", "success");
}

// --- 8. DASHBOARD STATS ---
async function loadDashboardStats() {
    const { count: userCount } = await adminClient.from('users').select('*', { count: 'exact', head: true });
    const { count: regCount } = await adminClient.from('registrations').select('*', { count: 'exact', head: true });
    const { count: teamCount } = await adminClient.from('teams').select('*', { count: 'exact', head: true });
    
    document.getElementById('dash-total-users').innerText = userCount || 0;
    document.getElementById('dash-total-regs').innerText = regCount || 0;
    document.getElementById('dash-total-teams').innerText = teamCount || 0;
}

// --- 9. MATCH ACTIONS ---
window.endPerformanceEvent = async function(matchId) {
    if (!confirm("End event and calculate winners?")) return;

    const { data: match } = await adminClient.from('matches').select('performance_data, sports(unit)').eq('id', matchId).single();
    let arr = match.performance_data || [];
    const unit = match.sports.unit;

    let validEntries = arr.filter(p => p.result && p.result.trim() !== '');
    const isDistance = unit === 'Meters' || unit === 'Points';
    validEntries.sort((a, b) => isDistance ? (parseFloat(b.result) - parseFloat(a.result)) : (parseFloat(a.result) - parseFloat(b.result)));

    let winners = { gold: null, silver: null, bronze: null };
    validEntries.forEach((p, i) => {
        p.rank = i + 1;
        if(i === 0) winners.gold = p.name;
        if(i === 1) winners.silver = p.name;
        if(i === 2) winners.bronze = p.name;
    });

    const winnerText = `Gold: ${winners.gold || '-'}, Silver: ${winners.silver || '-'}, Bronze: ${winners.bronze || '-'}`;
    await adminClient.from('matches').update({ 
        performance_data: [...validEntries, ...arr.filter(p => !p.result)],
        status: 'Completed',
        winner_text: winnerText,
        winners_data: winners,
        is_live: false 
    }).eq('id', matchId);

    showToast("Event Ended!", "success");
    syncToRealtime(matchId);
    loadMatches(currentMatchViewFilter); 
}

window.startMatch = async function(matchId) {
    if(!confirm("Start this match now?")) return;
    await adminClient.from('matches').update({ status: 'Live', is_live: true }).eq('id', matchId);
    showToast("Match is LIVE!", "success");
    syncToRealtime(matchId);
    loadMatches('Live');
}

// --- 10. TEAMS (UPDATED) ---
async function loadTeamsList() {
    const grid = document.getElementById('teams-grid');
    if(!grid) return;
    grid.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading teams...</p>';

    // Note: Search/Filter UI is now in HTML, handled by filterTeamsList
    
    // UPDATED QUERY: Fetch team_size from sports and all team members to count them
    const { data: teams } = await adminClient.from('teams')
        .select('*, sports(name, team_size), captain:users!captain_id(first_name, last_name), team_members(status)')
        .order('created_at', { ascending: false });

    allTeamsCache = teams || [];

    // Populate Sport Dropdown for Teams
    const sports = [...new Set(allTeamsCache.map(t => t.sports?.name).filter(Boolean))].sort();
    const sportSelect = document.getElementById('filter-team-sport');
    if(sportSelect && sportSelect.children.length <= 1) {
        sportSelect.innerHTML = `<option value="">All Sports</option>` + sports.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    // Initial Render via Filter
    filterTeamsList();
}

window.filterTeamsList = function() {
    const search = document.getElementById('team-search-input')?.value.toLowerCase() || '';
    const sportFilter = document.getElementById('filter-team-sport')?.value || '';
    const statusFilter = document.getElementById('filter-team-status')?.value || '';
    const sortOrder = document.getElementById('sort-team-order')?.value || 'newest';

    // 1. Filter
    let filtered = allTeamsCache.filter(t => {
        const matchesSearch = t.name.toLowerCase().includes(search);
        const matchesSport = sportFilter === '' || t.sports?.name === sportFilter;
        const matchesStatus = statusFilter === '' || t.status === statusFilter;
        return matchesSearch && matchesSport && matchesStatus;
    });

    // 2. Sort
    filtered.sort((a, b) => {
        if (sortOrder === 'newest') return new Date(b.created_at) - new Date(a.created_at);
        if (sortOrder === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
        if (sortOrder === 'name_asc') return a.name.localeCompare(b.name);
        return 0;
    });

    // 3. Prepare Data for Export (Flatten Objects)
    dataCache = filtered.map(t => ({
        Team_Name: t.name,
        Sport: t.sports?.name || 'Unknown',
        Members: t.team_members?.filter(m => m.status === 'Accepted').length || 0,
        Max_Size: t.sports?.team_size || 'N/A',
        Captain: `${t.captain?.first_name || 'Unknown'} ${t.captain?.last_name || ''}`,
        Status: t.status,
        Created_At: new Date(t.created_at).toLocaleDateString()
    }));

    // 4. Render
    renderTeams(filtered);
}

function renderTeams(teams) {
    const grid = document.getElementById('teams-grid');
    if(!grid) return;

    if(teams.length === 0) { grid.innerHTML = '<p class="col-span-3 text-center text-gray-400">No teams found matching filters.</p>'; return; }
    
    grid.innerHTML = teams.map(t => {
        const currentCount = t.team_members ? t.team_members.filter(m => m.status === 'Accepted').length : 0;
        const maxCount = t.sports?.team_size || '-';
        
        return `
        <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden group">
            <div class="flex justify-between items-start mb-3">
                <span class="text-[10px] font-bold uppercase bg-gray-100 px-2 py-1 rounded text-gray-500">${t.sports?.name || 'Sport'}</span>
                <span class="text-[10px] font-bold uppercase ${t.status === 'Locked' ? 'text-red-500' : 'text-green-500'}">${t.status}</span>
            </div>
            
            <h4 class="font-bold text-lg text-gray-900 truncate mb-1" title="${t.name}">${t.name}</h4>
            
            <div class="flex items-center gap-2 mb-4">
                 <div class="flex items-center gap-1 bg-indigo-50 px-2 py-0.5 rounded text-indigo-600 text-xs font-bold">
                    <i data-lucide="users" class="w-3 h-3"></i>
                    <span>${currentCount} / ${maxCount}</span>
                 </div>
                 <span class="text-xs text-gray-400">Capt: ${t.captain?.first_name || 'Unknown'}</span>
            </div>

            <button onclick="openTeamModal('${t.id}', '${t.name.replace(/'/g, "\\'")}')" class="w-full py-2 bg-gray-900 text-white text-xs font-bold rounded-xl hover:bg-gray-800 transition-colors">
                Manage Team
            </button>
        </div>`;
    }).join('');
    
    if(window.lucide) lucide.createIcons();
}

window.resetTeamFilters = function() {
    if(document.getElementById('team-search-input')) document.getElementById('team-search-input').value = '';
    if(document.getElementById('filter-team-sport')) document.getElementById('filter-team-sport').value = '';
    if(document.getElementById('filter-team-status')) document.getElementById('filter-team-status').value = '';
    if(document.getElementById('sort-team-order')) document.getElementById('sort-team-order').value = 'newest';
    
    filterTeamsList();
}

// --- NEW MODAL FUNCTIONS ---

window.openTeamModal = async function(teamId, teamName) {
    currentEditingTeamId = teamId;
    const modal = document.getElementById('team-modal');
    const nameInput = document.getElementById('modal-team-name-input');
    const tbody = document.getElementById('modal-squad-body');
    const idDisplay = document.getElementById('modal-team-id-display');

    if(!modal) { alert("Error: Modal HTML not found in admin.html"); return; }

    nameInput.value = teamName;
    idDisplay.innerText = `Team ID: ${teamId}`;
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-400">Loading squad details...</td></tr>';
    
    modal.classList.remove('hidden');

    const { data: members, error } = await adminClient
        .from('team_members')
        .select(`status, user_id, users (first_name, last_name, class_name, mobile)`)
        .eq('team_id', teamId)
        .eq('status', 'Accepted');

    if (error || !members || members.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-400 font-bold">No members found.</td></tr>';
        return;
    }

    tbody.innerHTML = members.map((m, i) => `
        <tr class="hover:bg-gray-50 transition-colors border-b border-gray-50">
            <td class="p-4 text-gray-400 font-mono text-xs">${i + 1}</td>
            <td class="p-4 font-bold text-gray-900">${m.users.first_name} ${m.users.last_name}</td>
            <td class="p-4 text-xs font-bold text-gray-500 uppercase">${m.users.class_name || '-'}</td>
            <td class="p-4 text-right font-mono text-gray-600 text-xs">${m.users.mobile || '-'}</td>
            <td class="p-4 text-right">
                <button onclick="removeTeamMember('${m.user_id}')" class="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-1.5 rounded-lg transition-colors">
                   <i data-lucide="trash" class="w-4 h-4"></i>
                </button>
            </td>
        </tr>
    `).join('');
    if(window.lucide) lucide.createIcons();
}

window.removeTeamMember = async function(userId) {
    if(!confirm("Remove this member from the team?")) return;
    const { error } = await adminClient.from('team_members').delete().eq('team_id', currentEditingTeamId).eq('user_id', userId);
    if(error) showToast("Error: " + error.message, "error");
    else {
        showToast("Member removed", "success");
        const nameInput = document.getElementById('modal-team-name-input');
        openTeamModal(currentEditingTeamId, nameInput.value);
    }
}

window.saveTeamNameUpdate = async function() {
    const newName = document.getElementById('modal-team-name-input').value.trim();
    if(!currentEditingTeamId || !newName) return;

    const { error } = await adminClient.from('teams').update({ name: newName }).eq('id', currentEditingTeamId);
    if(error) showToast("Failed: " + error.message, "error");
    else {
        showToast("Team Name Updated!", "success");
        loadTeamsList(); 
    }
}

window.deleteTeam = async function() {
    if(!currentEditingTeamId) return;
    if(!confirm("DANGER: Delete this ENTIRE TEAM? This cannot be undone.")) return;

    const { error } = await adminClient.from('teams').delete().eq('id', currentEditingTeamId);
    if(error) showToast("Failed: " + error.message, "error");
    else {
        showToast("Team Deleted", "success");
        closeModal('team-modal');
        loadTeamsList();
    }
}

// --- 11. REGISTRATIONS & USERS ---
async function loadRegistrationsList() {
    const tbody = document.getElementById('registrations-table-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center">Loading...</td></tr>';

    const { data: regs } = await adminClient.from('registrations')
        .select(`id, created_at, users (first_name, last_name, student_id, class_name, gender, mobile, email), sports (name)`)
        .order('created_at', { ascending: false });

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

    // Setup Filters
    const sports = [...new Set(allRegistrationsCache.map(r => r.sport))].sort();
    const sportSelect = document.getElementById('filter-reg-sport');
    if(sportSelect && sportSelect.children.length <= 1) {
        sportSelect.innerHTML = `<option value="">All Sports</option>` + sports.map(s => `<option value="${s}">${s}</option>`).join('');
    }
    renderRegistrations(allRegistrationsCache);
}

function renderRegistrations(data) {
    const tbody = document.getElementById('registrations-table-body');
    if(!tbody) return;
    document.getElementById('reg-count').innerText = data.length;
    dataCache = data;

    tbody.innerHTML = data.map(r => `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="p-4">
                <div class="font-bold text-gray-900">${r.name}</div>
                <div class="text-xs text-gray-500">${r.email}</div>
            </td>
            <td class="p-4"><span class="bg-gray-100 px-2 py-1 rounded text-xs font-bold">${r.sport}</span></td>
            <td class="p-4 text-sm">${r.class} <span class="text-xs text-gray-400">(${r.student_id})</span></td>
            <td class="p-4 text-sm">${r.gender}</td>
            <td class="p-4 text-sm font-mono">${r.mobile}</td>
            <td class="p-4 text-right text-xs text-gray-400">${r.date}</td>
        </tr>`).join('');
}

window.filterRegistrations = function() {
    const search = document.getElementById('reg-search').value.toLowerCase();
    const sport = document.getElementById('filter-reg-sport').value;
    const gender = document.getElementById('filter-reg-gender').value;
    const cls = document.getElementById('filter-reg-class').value;

    const filtered = allRegistrationsCache.filter(r => {
        return (r.name.toLowerCase().includes(search) || r.student_id.toLowerCase().includes(search)) &&
               (sport === "" || r.sport === sport) &&
               (gender === "" || r.gender === gender) &&
               (cls === "" || r.category === cls);
    });
    renderRegistrations(filtered);
}

window.resetRegFilters = function() {
    document.getElementById('reg-search').value = '';
    document.getElementById('filter-reg-sport').value = '';
    document.getElementById('filter-reg-gender').value = '';
    document.getElementById('filter-reg-class').value = '';
    renderRegistrations(allRegistrationsCache);
}

// --- USERS ---
async function loadUsersList() {
    const tbody = document.getElementById('users-table-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center">Loading...</td></tr>';
    
    const { data: users } = await adminClient.from('users').select('*').order('created_at', { ascending: false });
    const { data: sports } = await adminClient.from('sports').select('id, name');
    dataCache = users;
    
    tbody.innerHTML = users.map(u => {
        const sportOptions = sports.map(s => `<option value="${s.id}" ${u.assigned_sport_id === s.id ? 'selected' : ''}>${s.name}</option>`).join('');
        return `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="p-4 flex items-center gap-3">
                <img src="${u.avatar_url || DEFAULT_AVATAR}" class="w-8 h-8 rounded-full bg-gray-200">
                <div><div class="font-bold text-gray-900">${u.first_name} ${u.last_name}</div><div class="text-xs text-gray-500">${u.email}</div></div>
            </td>
            <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold uppercase ${u.role==='admin'?'bg-purple-100 text-purple-600': u.role==='volunteer'?'bg-indigo-100 text-indigo-600':'bg-gray-100'}">${u.role}</span></td>
            <td class="p-4">${u.class_name || '-'}</td>
            <td class="p-4">${u.role === 'volunteer' ? `<select onchange="assignVolunteerSport('${u.id}', this.value)" class="p-1 text-xs border rounded w-full"><option value="">-- Assign --</option>${sportOptions}</select>` : '-'}</td>
            <td class="p-4 text-right flex justify-end gap-2">
                ${u.role !== 'admin' && u.role !== 'volunteer' ? `<button onclick="promoteUser('${u.id}')" class="text-xs bg-indigo-50 text-indigo-600 px-3 py-1 rounded hover:bg-indigo-100">Make Vol</button>` : ''}
                <button onclick="resetUserPassword('${u.id}', '${u.first_name}')" class="text-xs bg-red-50 text-red-600 px-3 py-1 rounded hover:bg-red-100">Reset</button>
            </td>
        </tr>`;
    }).join('');
}

window.promoteUser = async function(userId) {
    if(!confirm("Promote to Volunteer?")) return;
    await adminClient.from('users').update({ role: 'volunteer' }).eq('id', userId);
    loadUsersList();
}

window.assignVolunteerSport = async function(userId, sportId) {
    await adminClient.from('users').update({ assigned_sport_id: sportId || null }).eq('id', userId);
    showToast("Assigned!", "success");
}

window.resetUserPassword = async function(userId, name) {
    if(!confirm(`Reset ${name}'s password to 'student'?`)) return;
    const { error } = await adminClient.rpc('admin_reset_password', { target_user_id: userId });
    showToast(error ? "Error" : "Password Reset", error ? "error" : "success");
}

window.filterUsers = function() {
    const q = document.getElementById('user-search').value.toLowerCase();
    document.querySelectorAll('#users-table-body tr').forEach(r => r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none');
}

// --- UTILS ---
window.loadMatches = async function(statusFilter) {
    currentMatchViewFilter = statusFilter;
    const container = document.getElementById('matches-grid');
    if(!container) return;
    
    // Setup Tabs
    const tabs = document.getElementById('match-filter-tabs');
    if(!tabs) {
        const div = document.createElement('div');
        div.id = 'match-filter-tabs';
        div.className = "flex gap-2 mb-6 border-b border-gray-200 pb-2";
        div.innerHTML = `
            <button onclick="loadMatches('Scheduled')" class="px-4 py-2 text-sm font-bold">Scheduled</button>
            <button onclick="loadMatches('Live')" class="px-4 py-2 text-sm font-bold">Live</button>
            <button onclick="loadMatches('Completed')" class="px-4 py-2 text-sm font-bold">Completed</button>
        `;
        container.parentElement.insertBefore(div, container);
    }
    
    container.innerHTML = 'Loading...';
    const { data: matches } = await adminClient.from('matches').select('*, sports(name, is_performance, unit)').eq('status', statusFilter).order('start_time', { ascending: true });
    
    if(!matches || !matches.length) { container.innerHTML = `<p class="col-span-3 text-center text-gray-400">No ${statusFilter} matches.</p>`; return; }

    container.innerHTML = matches.map(m => `
        <div class="bg-white p-5 rounded-3xl border border-gray-200 shadow-sm relative">
            <div class="flex justify-between items-center mb-4">
                 <span class="text-xs font-bold text-gray-500">${m.status}</span>
                 <span class="text-xs text-gray-500 uppercase font-bold">${m.sports.name}</span>
            </div>
            ${m.sports.is_performance ? 
                `<div class="text-center py-2"><h4 class="font-black text-xl text-gray-900">${m.team1_name}</h4></div>`
            : 
                `<div class="flex justify-between font-bold text-lg text-gray-900 px-2"><span>${m.team1_name}</span><span>VS</span><span>${m.team2_name}</span></div>`
            }
            <div class="mt-4 pt-4 border-t border-gray-100 flex justify-between">
                 <span class="text-xs text-gray-400">${m.location || 'N/A'}</span>
                 ${m.status === 'Scheduled' ? `<button onclick="startMatch('${m.id}')" class="text-xs bg-green-500 text-white px-3 py-1 rounded">Start</button>` : ''}
                 ${m.status === 'Live' && m.sports.is_performance ? `<button onclick="endPerformanceEvent('${m.id}')" class="text-xs bg-red-500 text-white px-3 py-1 rounded">End Event</button>` : ''}
            </div>
        </div>
    `).join('');
}

window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

function setupMatchFilters() { /* handled in loadMatches */ }

function injectToastContainer() {
    if(document.getElementById('toast-container')) return;
    const div = document.createElement('div');
    div.id = 'toast-container';
    div.className = 'fixed bottom-10 left-1/2 transform -translate-x-1/2 z-[70] transition-all duration-300 opacity-0 pointer-events-none translate-y-10';
    div.innerHTML = `<div id="toast-content" class="bg-gray-900 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3"><div id="toast-icon"></div><p id="toast-msg" class="text-sm font-bold"></p></div>`;
    document.body.appendChild(div);
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
