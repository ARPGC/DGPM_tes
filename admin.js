// ==========================================
// URJA 2026 - ADMIN CONTROL CENTER
// ==========================================

// --- 1. CONFIGURATION & CLIENTS ---

if (typeof CONFIG === 'undefined' || typeof CONFIG_REALTIME === 'undefined') {
    console.error("CRITICAL ERROR: Config missing.");
    alert("System Error: Config missing. Check console.");
}

const adminClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
const adminRtClient = window.supabase.createClient(CONFIG_REALTIME.url, CONFIG_REALTIME.serviceKey);

// --- 2. STATE MANAGEMENT ---
let currentUser = null;
let currentView = 'dashboard';
let currentMatchViewFilter = 'Scheduled'; 

// Data Caches
let allTeamsCache = []; 
let allMatchesCache = []; 
let dataCache = []; 
let allRegistrationsCache = []; 
let allResultsCache = []; // NEW
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
    if(titleEl) titleEl.innerText = viewId.charAt(0).toUpperCase() + viewId.slice(1).replace('-', ' ');

    const globalActions = document.getElementById('global-actions');
    if(globalActions) {
        if (['users', 'teams', 'matches', 'registrations', 'results'].includes(viewId)) globalActions.classList.remove('hidden');
        else globalActions.classList.add('hidden');
    }

    // Toggle Buttons based on View
    const squadPdfBtn = document.getElementById('btn-squad-pdf');
    const squadExcelBtn = document.getElementById('btn-squad-excel');
    const matchPdfBtn = document.getElementById('btn-match-pdf');
    const matchExcelBtn = document.getElementById('btn-match-excel');
    
    // Results Buttons
    const resSummaryExcel = document.getElementById('btn-results-summary-excel');
    const resFullExcel = document.getElementById('btn-results-full-excel');
    const resFullPdf = document.getElementById('btn-results-full-pdf');

    // Hide all specific buttons first
    [squadPdfBtn, squadExcelBtn, matchPdfBtn, matchExcelBtn, resSummaryExcel, resFullExcel, resFullPdf].forEach(btn => {
        if(btn) btn.classList.add('hidden');
    });

    if (viewId === 'teams') {
        if(squadPdfBtn) squadPdfBtn.classList.remove('hidden');
        if(squadExcelBtn) squadExcelBtn.classList.remove('hidden');
    } 
    else if (viewId === 'matches') {
        if(matchPdfBtn) matchPdfBtn.classList.remove('hidden');
        if(matchExcelBtn) matchExcelBtn.classList.remove('hidden');
    }
    else if (viewId === 'results') {
        if(resSummaryExcel) resSummaryExcel.classList.remove('hidden');
        if(resFullExcel) resFullExcel.classList.remove('hidden');
        if(resFullPdf) resFullPdf.classList.remove('hidden');
    }

    dataCache = [];
    if(viewId === 'users') loadUsersList();
    if(viewId === 'matches') loadMatches(); 
    if(viewId === 'teams') loadTeamsList();
    if(viewId === 'registrations') loadRegistrationsList();
    if(viewId === 'results') loadResults(); // NEW
}

// --- 7. EXPORT GENERIC ---
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

// --- NEW HELPER: FETCH ALL RECORDS (Bypasses 1000 limit) ---
async function fetchAllRecords(table, select, orderCol, ascending = false) {
    let allRecords = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await adminClient
            .from(table)
            .select(select)
            .order(orderCol, { ascending })
            .range(from, from + step - 1);

        if (error) {
            console.error(`Error fetching ${table}:`, error);
            showToast(`Error fetching ${table}`, "error");
            return null;
        }

        if (data && data.length > 0) {
            allRecords = allRecords.concat(data);
            if (data.length < step) hasMore = false;
            else from += step;
        } else {
            hasMore = false;
        }
    }
    return allRecords;
}

// ==========================================
// NEW FEATURE: RESULTS & TEAM DECLARATION
// ==========================================

async function loadResults() {
    const tbody = document.getElementById('results-table-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-400">Loading results...</td></tr>';

    // Fetch Results linking BOTH teams and student info
    const { data: results, error } = await adminClient
        .from('results')
        .select(`
            *,
            teams (name, sport_id),
            teams_sport:teams(sports(name))
        `)
        .order('created_at', { ascending: false });

    if(error) { showToast("Error loading results", "error"); return; }
    
    // We also need sport names for individual results (stored as text 'event_name' usually, but good to have)
    
    allResultsCache = results || [];

    // Populate Filter
    const sports = [...new Set(allResultsCache.map(r => r.event_name || r.teams_sport?.sports?.name).filter(Boolean))].sort();
    const sportSelect = document.getElementById('filter-results-sport');
    if(sportSelect && sportSelect.children.length <= 1) {
        sportSelect.innerHTML = `<option value="">All Sports</option>` + sports.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    renderResults(allResultsCache);
}

function renderResults(results) {
    const tbody = document.getElementById('results-table-body');
    if(!tbody) return;
    
    if(results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-400">No results declared yet.</td></tr>';
        return;
    }

    // Prepare Cache for Generic Export (Flat structure)
    dataCache = results.map(r => {
        const isTeam = !!r.team_id;
        const name = isTeam ? (r.teams?.name || 'Unknown Team') : r.student_name;
        const sport = r.event_name || (r.teams?.sports?.name) || 'Unknown'; // Fallback logic
        
        return {
            "Type": isTeam ? "TEAM" : "INDIVIDUAL",
            "Name": name,
            "Event": sport,
            "Category": r.category || '-',
            "Rank": r.rank,
            "Medal": r.medal,
            "Declared At": new Date(r.created_at).toLocaleDateString()
        };
    });

    tbody.innerHTML = results.map(r => {
        const isTeam = !!r.team_id;
        const name = isTeam ? r.teams?.name : r.student_name;
        const sport = r.event_name || (r.teams_sport?.[0]?.sports?.name) || r.event_name;
        
        const medalColor = r.medal === 'gold' ? 'text-yellow-600 bg-yellow-50' : 
                           r.medal === 'silver' ? 'text-gray-600 bg-gray-100' : 
                           r.medal === 'bronze' ? 'text-orange-700 bg-orange-50' : 'text-gray-500';

        return `
        <tr class="border-b border-gray-50 hover:bg-gray-50 group transition-colors">
            <td class="p-4">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 text-gray-500">
                        ${isTeam ? '<i data-lucide="shield" class="w-4 h-4"></i>' : '<i data-lucide="user" class="w-4 h-4"></i>'}
                    </div>
                    <div>
                        <div class="font-bold text-gray-900">${name}</div>
                        <div class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">${isTeam ? 'Team' : 'Individual'}</div>
                    </div>
                </div>
            </td>
            <td class="p-4 font-bold text-gray-700">${sport}</td>
            <td class="p-4 text-sm text-gray-500">${r.category || '-'}</td>
            <td class="p-4 text-center font-mono font-bold text-gray-900">#${r.rank}</td>
            <td class="p-4 text-center">
                <span class="px-2 py-1 rounded-lg text-xs font-bold uppercase ${medalColor}">${r.medal}</span>
            </td>
            <td class="p-4 text-right">
                <button onclick="deleteResult('${r.id}')" class="p-2 bg-red-50 text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-red-100">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
    
    if(window.lucide) lucide.createIcons();
}

window.filterResultsList = function() {
    const search = document.getElementById('results-search').value.toLowerCase();
    const sportFilter = document.getElementById('filter-results-sport').value;
    const medalFilter = document.getElementById('filter-results-medal').value;

    const filtered = allResultsCache.filter(r => {
        const isTeam = !!r.team_id;
        const name = (isTeam ? r.teams?.name : r.student_name)?.toLowerCase() || '';
        const sport = (r.event_name || r.teams_sport?.[0]?.sports?.name || '').toLowerCase(); // Fix sport checking
        
        const matchesSearch = name.includes(search);
        const matchesSport = sportFilter === '' || sport.includes(sportFilter.toLowerCase()); // Loose match for reliability
        const matchesMedal = medalFilter === '' || r.medal === medalFilter;

        return matchesSearch && matchesSport && matchesMedal;
    });

    renderResults(filtered);
}

window.deleteResult = async function(id) {
    if(!confirm("Are you sure you want to delete this result?")) return;
    const { error } = await adminClient.from('results').delete().eq('id', id);
    if(error) showToast("Error deleting result", "error");
    else {
        showToast("Result Deleted", "success");
        loadResults();
    }
}

// --- DECLARE RESULT MODAL LOGIC ---

window.openDeclareResultModal = async function() {
    const modal = document.getElementById('declare-result-modal');
    if(!modal) return;
    
    // Reset inputs
    document.getElementById('declare-team').innerHTML = '<option value="">-- Choose Team --</option>';
    document.getElementById('declare-sport').innerHTML = '<option value="">Loading...</option>';
    
    modal.classList.remove('hidden');

    // Load Sports with Teams
    const { data: sports } = await adminClient.from('sports').select('id, name').eq('team_size', 'gt.1'); // Only fetch team sports or all sports? Assuming team sports mostly.
    
    // Better: Fetch all sports to be safe
    const { data: allSports } = await adminClient.from('sports').select('id, name').order('name');
    
    const sportSelect = document.getElementById('declare-sport');
    sportSelect.innerHTML = '<option value="">-- Choose Sport --</option>' + 
        (allSports || []).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

window.loadTeamsForDeclaration = async function() {
    const sportId = document.getElementById('declare-sport').value;
    const teamSelect = document.getElementById('declare-team');
    
    if(!sportId) {
        teamSelect.innerHTML = '<option value="">-- Choose Team --</option>';
        return;
    }
    
    teamSelect.innerHTML = '<option value="">Loading...</option>';
    
    // Fetch Teams for this sport
    const { data: teams } = await adminClient.from('teams').select('id, name').eq('sport_id', sportId).order('name');
    
    teamSelect.innerHTML = '<option value="">-- Choose Team --</option>' + 
        (teams || []).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
}

window.submitTeamResult = async function() {
    const sportSelect = document.getElementById('declare-sport');
    const teamId = document.getElementById('declare-team').value;
    const medal = document.getElementById('declare-medal').value;
    const rank = document.getElementById('declare-rank').value;
    
    if(!teamId || !rank) return showToast("Please select Team and Rank", "error");
    
    const sportName = sportSelect.options[sportSelect.selectedIndex].text;

    // Insert Result
    const { error } = await adminClient.from('results').insert({
        team_id: teamId,
        event_name: sportName,
        medal: medal,
        rank: parseInt(rank),
        category: 'Team Event', // Generic placeholder
        student_name: '-', // Placeholders for constraint if needed, otherwise null
        student_id: '-',
        mobile: '-',
        class: '-'
    });

    if(error) {
        showToast(error.message, "error");
    } else {
        showToast("Team Result Declared!", "success");
        closeModal('declare-result-modal');
        loadResults();
    }
}

// ==========================================
// ADVANCED RESULTS EXPORTS
// ==========================================

// 1. SUMMARY EXCEL (Just what is on screen)
window.downloadResultsSummaryExcel = function() {
    if (!dataCache || dataCache.length === 0) return showToast("No results to export", "error");
    const ws = XLSX.utils.json_to_sheet(dataCache);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Winners_Summary");
    XLSX.writeFile(wb, `Urja_Winners_Summary_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// 2. FULL SQUAD EXCEL (Iterate teams and get members)
window.downloadResultsFullExcel = async function() {
    showToast("Generating Full Report... Please Wait.", "success");
    
    let exportData = [];

    // Filter only results currently in view (cache) that are TEAMS
    // But we also want individual results included in the full report
    const individualResults = allResultsCache.filter(r => !r.team_id);
    const teamResults = allResultsCache.filter(r => r.team_id);

    // 1. Process Individual Results
    individualResults.forEach(r => {
        exportData.push({
            "Event": r.event_name,
            "Type": "Individual",
            "Team Name": "-",
            "Rank": r.rank,
            "Medal": r.medal,
            "Student Name": r.student_name,
            "Class": r.class || '-',
            "ID": r.student_id || '-',
            "Mobile": r.mobile || '-'
        });
    });

    // 2. Process Team Results (Fetch Members)
    if (teamResults.length > 0) {
        // Fetch all members for these winning teams in one go if possible, or loop
        // Loop is safer for logic
        for (const res of teamResults) {
            const { data: members } = await adminClient
                .from('team_members')
                .select('users(first_name, last_name, class_name, student_id, mobile)')
                .eq('team_id', res.team_id)
                .eq('status', 'Accepted');

            if (members && members.length > 0) {
                members.forEach(m => {
                    exportData.push({
                        "Event": res.event_name,
                        "Type": "Team",
                        "Team Name": res.teams?.name,
                        "Rank": res.rank,
                        "Medal": res.medal,
                        "Student Name": `${m.users.first_name} ${m.users.last_name}`,
                        "Class": m.users.class_name || '-',
                        "ID": m.users.student_id || '-',
                        "Mobile": m.users.mobile || '-'
                    });
                });
            } else {
                // Empty team?
                exportData.push({
                    "Event": res.event_name,
                    "Type": "Team",
                    "Team Name": res.teams?.name,
                    "Rank": res.rank,
                    "Medal": res.medal,
                    "Student Name": "NO MEMBERS FOUND",
                    "Class": "-", "ID": "-", "Mobile": "-"
                });
            }
        }
    }

    // Sort by Event
    exportData.sort((a, b) => a.Event.localeCompare(b.Event));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Full_Winners_List");
    XLSX.writeFile(wb, `Urja_Detailed_Winners_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast("Download Started!", "success");
}

// 3. FULL SQUAD PDF
window.downloadResultsFullPDF = async function() {
    showToast("Generating PDF... This may take a moment.", "success");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Re-use logic to get data (copy-paste logic for safety or refactor if strict)
    // For specific PDF formatting, we will iterate differently.
    
    doc.setFontSize(20);
    doc.setTextColor(79, 70, 229); // Brand color
    doc.text("URJA 2026 - OFFICIAL WINNERS REPORT", 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
    
    let yPos = 40;

    // Group by Event
    const groupedData = {};
    
    // 1. Individuals
    const individualResults = allResultsCache.filter(r => !r.team_id);
    individualResults.forEach(r => {
        if(!groupedData[r.event_name]) groupedData[r.event_name] = [];
        groupedData[r.event_name].push({
            rank: r.rank,
            medal: r.medal,
            team: '-',
            name: r.student_name,
            class: r.class,
            id: r.student_id
        });
    });

    // 2. Teams (Async loop)
    const teamResults = allResultsCache.filter(r => r.team_id);
    for (const res of teamResults) {
        const eventName = res.event_name || 'Unknown Event';
        if(!groupedData[eventName]) groupedData[eventName] = [];

        const { data: members } = await adminClient
            .from('team_members')
            .select('users(first_name, last_name, class_name, student_id)')
            .eq('team_id', res.team_id)
            .eq('status', 'Accepted');
            
        if(members && members.length > 0) {
             members.forEach(m => {
                 groupedData[eventName].push({
                    rank: res.rank,
                    medal: res.medal,
                    team: res.teams?.name,
                    name: `${m.users.first_name} ${m.users.last_name}`,
                    class: m.users.class_name,
                    id: m.users.student_id
                 });
             });
        }
    }

    // Render PDF
    const sortedEvents = Object.keys(groupedData).sort();
    
    for(const event of sortedEvents) {
        const entries = groupedData[event];
        entries.sort((a,b) => a.rank - b.rank); // Sort by Rank 1, 2, 3

        if (yPos > 250) { doc.addPage(); yPos = 20; }
        
        // Event Header
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text(event, 14, yPos);
        yPos += 5;

        // Table
        const rows = entries.map(e => [
            `#${e.rank} - ${e.medal.toUpperCase()}`,
            e.team !== '-' ? `${e.team} (Team)` : 'Individual',
            e.name,
            e.class || '-',
            e.id || '-'
        ]);

        doc.autoTable({
            startY: yPos,
            head: [['Rank/Medal', 'Team/Type', 'Student Name', 'Class', 'ID']],
            body: rows,
            theme: 'grid',
            headStyles: { fillColor: [66, 66, 66], fontSize: 8 },
            styles: { fontSize: 8 },
            margin: { left: 14 }
        });

        yPos = doc.lastAutoTable.finalY + 15;
    }

    doc.save(`Urja_Winners_Detailed_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast("PDF Downloaded!", "success");
}

// ... (Rest of existing admin.js functions: filterUsers, loadTeamsList, etc. maintained) ...

// --- 7b. SQUADS EXPORT (PDF & EXCEL) - EXISTING CODE RE-INSERTED FOR COMPLETENESS ---

async function fetchSquadsData() {
    let allMembers = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await adminClient
            .from('team_members')
            .select(`
                status,
                users (first_name, last_name, class_name, gender, mobile, student_id),
                teams (
                    id, name, status, 
                    sports(name), 
                    captain:users!captain_id(first_name, last_name, class_name, gender)
                )
            `)
            .eq('status', 'Accepted')
            .range(from, from + step - 1);

        if (error) { showToast("Error fetching squad data", "error"); return null; }
        
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

function getFilteredSquads(members) {
    const sportFilter = document.getElementById('filter-team-sport')?.value || '';
    const statusFilter = document.getElementById('filter-team-status')?.value || '';
    const genderFilter = document.getElementById('filter-team-gender')?.value || '';
    const classFilter = document.getElementById('filter-team-class')?.value || '';

    return members.filter(m => {
        const t = m.teams;
        if (!t) return false;
        
        if (sportFilter && t.sports?.name !== sportFilter) return false;
        if (statusFilter && t.status !== statusFilter) return false;
        if (genderFilter && t.captain?.gender !== genderFilter) return false;
        
        if (classFilter) {
            const isJunior = ['FYJC', 'SYJC'].includes(t.captain?.class_name);
            if (classFilter === 'Junior' && !isJunior) return false;
            if (classFilter === 'Senior' && isJunior) return false;
        }
        return true;
    });
}

window.downloadSquadsExcel = async function() {
    showToast("Generating Squads Excel...", "success");
    const members = await fetchSquadsData();
    if(!members) return;

    const filtered = getFilteredSquads(members);
    if(filtered.length === 0) return showToast("No squads found with current filters", "error");

    const excelData = filtered.map(m => ({
        "Team Name": m.teams.name,
        "Sport": m.teams.sports?.name || 'Unknown',
        "Category": ['FYJC', 'SYJC'].includes(m.teams.captain?.class_name) ? 'Junior' : 'Senior',
        "Team Captain": `${m.teams.captain?.first_name || ''} ${m.teams.captain?.last_name || ''}`,
        "Player Name": `${m.users.first_name} ${m.users.last_name}`,
        "Player Gender": m.users.gender || '-',
        "Player Class": m.users.class_name || '-',
        "Player Mobile": m.users.mobile || '-',
        "Player ID": m.users.student_id || '-'
    }));

    excelData.sort((a, b) => {
        if(a.Sport !== b.Sport) return a.Sport.localeCompare(b.Sport);
        return a["Team Name"].localeCompare(b["Team Name"]);
    });

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Squads_List");

    const filename = `Urja_Full_Squads_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast("Excel Downloaded!", "success");
}

window.downloadSquadsPDF = async function() {
    showToast("Generating Full Squads PDF...", "success");
    const members = await fetchSquadsData();
    if(!members) return;

    const filtered = getFilteredSquads(members);
    if(filtered.length === 0) return showToast("No squads found with current filters", "error");

    const grouped = {};
    filtered.forEach(m => {
        const teamName = m.teams.name;
        if (!grouped[teamName]) {
            grouped[teamName] = {
                sport: m.teams.sports?.name || 'Unknown',
                captain: m.teams.captain ? `${m.teams.captain.first_name} ${m.teams.captain.last_name}` : 'N/A',
                players: []
            };
        }
        grouped[teamName].players.push(m.users);
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(22);
    doc.text("URJA 2026 - OFFICIAL SQUADS LIST", 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 26);
    
    let yPos = 40;

    Object.keys(grouped).sort().forEach(teamName => {
        const team = grouped[teamName];
        if (yPos > 250) { doc.addPage(); yPos = 20; }

        doc.setFontSize(14);
        doc.setTextColor(79, 70, 229);
        doc.text(`${teamName} (${team.sport})`, 14, yPos);
        
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Captain: ${team.captain}`, 14, yPos + 6);

        const rows = team.players.map((p, i) => [
            i + 1, `${p.first_name} ${p.last_name}`, p.class_name || '-', p.gender || '-', p.mobile || '-'
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

// --- 9. MATCH ACTIONS (UPDATED) ---

// 1. Fetch & Filter
window.loadMatches = async function() {
    const container = document.getElementById('matches-grid');
    if(!container) return;
    container.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading schedule...</p>';

    // FIX: Use fetchAllRecords to get >1000 matches
    const matches = await fetchAllRecords(
        'matches',
        '*, sports(name, is_performance, unit)',
        'start_time',
        true // ascending
    );

    allMatchesCache = matches || [];

    // Populate Sport Dropdown for Matches
    const sports = [...new Set(allMatchesCache.map(m => m.sports?.name).filter(Boolean))].sort();
    const sportSelect = document.getElementById('filter-match-sport');
    if(sportSelect && sportSelect.children.length <= 1) {
        sportSelect.innerHTML = `<option value="">All Sports</option>` + sports.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    const statusSelect = document.getElementById('filter-match-status');
    if(statusSelect && statusSelect.value === "") statusSelect.value = "Scheduled";

    filterMatches();
}

// 2. Filter Logic
window.filterMatches = function() {
    const search = document.getElementById('match-search-input')?.value.toLowerCase() || '';
    const sportFilter = document.getElementById('filter-match-sport')?.value || '';
    const genderFilter = document.getElementById('filter-match-gender')?.value || '';
    const classFilter = document.getElementById('filter-match-class')?.value || '';
    const statusFilter = document.getElementById('filter-match-status')?.value || '';
    const sortOrder = document.getElementById('sort-match-order')?.value || 'time_asc';

    let filtered = allMatchesCache.filter(m => {
        // Search
        const searchTarget = `${m.team1_name} ${m.team2_name} ${m.location || ''}`.toLowerCase();
        if(search && !searchTarget.includes(search)) return false;

        // Sport & Status
        if(sportFilter && m.sports?.name !== sportFilter) return false;
        if(statusFilter && m.status !== statusFilter) return false;

        // Gender & Class Logic (Using match_type or sport name)
        const tags = (m.match_type + ' ' + (m.sports?.name || '')).toLowerCase();
        
        // Gender
        if(genderFilter === 'Male') {
            if(!tags.includes('boys') && !tags.includes('male') && !tags.includes('men')) return false;
        }
        if(genderFilter === 'Female') {
             if(!tags.includes('girls') && !tags.includes('female') && !tags.includes('women') && !tags.includes('ladies')) return false;
        }

        // Category (Class)
        if(classFilter === 'Junior') {
            if(!tags.includes('junior') && !tags.includes('jr') && !tags.includes('fy') && !tags.includes('sy')) return false;
        }
        if(classFilter === 'Senior') {
            if(tags.includes('junior') || tags.includes('jr') || tags.includes('fy') || tags.includes('sy')) return false;
        }

        return true;
    });

    // Sort
    filtered.sort((a, b) => {
        if(sortOrder === 'time_asc') return new Date(a.start_time) - new Date(b.start_time);
        if(sortOrder === 'time_desc') return new Date(b.start_time) - new Date(a.start_time);
        if(sortOrder === 'sport') return (a.sports?.name || '').localeCompare(b.sports?.name || '');
        return 0;
    });

    // Prepare Cache for Export - UPDATED TO SHOW UTC TIME
    dataCache = filtered.map(m => {
        const d = new Date(m.start_time);
        return {
            "Sport": m.sports?.name || 'Unknown',
            "Type": m.match_type,
            "Team 1": m.team1_name,
            "Team 2": m.team2_name || '-',
            "Status": m.status,
            // FORCE UTC DISPLAY
            "Date": d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }),
            "Time": d.toLocaleTimeString('en-US', { hour: '2-digit', minute:'2-digit', timeZone: 'UTC' }),
            "Location": m.location || 'N/A'
        };
    });

    renderMatches(filtered);
}

// 3. Render - UPDATED TO SHOW UTC TIME
function renderMatches(matches) {
    const container = document.getElementById('matches-grid');
    if(!container) return;

    if(matches.length === 0) {
        container.innerHTML = `<p class="col-span-3 text-center text-gray-400 py-8">No matches found matching filters.</p>`;
        return;
    }

    container.innerHTML = matches.map(m => {
        // FORCE UTC DISPLAY on cards
        const d = new Date(m.start_time);
        const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute:'2-digit', timeZone: 'UTC' });
        const fullDateTime = `${dateStr}, ${timeStr}`;

        return `
        <div class="bg-white p-5 rounded-3xl border border-gray-200 shadow-sm relative group hover:border-brand-primary/30 transition-all">
            <div class="flex justify-between items-center mb-3">
                 <span class="text-[10px] font-bold uppercase px-2 py-1 rounded ${m.status==='Live' ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-gray-100 text-gray-500'}">${m.status}</span>
                 <span class="text-[10px] font-bold uppercase text-gray-400">${m.sports.name}</span>
            </div>

            ${m.sports.is_performance ? 
                `<div class="text-center py-2"><h4 class="font-black text-xl text-gray-900 truncate">${m.team1_name}</h4><p class="text-xs text-gray-400 mt-1">${m.match_type}</p></div>`
            : 
                `<div class="flex justify-between items-center font-bold text-lg text-gray-900 px-1 gap-2">
                    <span class="truncate w-1/2 text-right">${m.team1_name}</span>
                    <span class="text-xs text-gray-300">VS</span>
                    <span class="truncate w-1/2 text-left">${m.team2_name}</span>
                </div>`
            }

            <div class="mt-4 pt-3 border-t border-gray-100 flex flex-col gap-1">
                 <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-gray-600 flex items-center gap-1">
                        <i data-lucide="clock" class="w-3 h-3 text-gray-400"></i> ${fullDateTime}
                    </span>
                    <span class="text-xs text-gray-400 truncate max-w-[100px]">${m.location || 'N/A'}</span>
                 </div>

                 <div class="flex justify-end mt-2 gap-2">
                     ${m.status === 'Scheduled' ? `<button onclick="startMatch('${m.id}')" class="text-[10px] font-bold bg-green-50 text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-100">Start Match</button>` : ''}
                     ${m.status === 'Live' && m.sports.is_performance ? `<button onclick="endPerformanceEvent('${m.id}')" class="text-[10px] font-bold bg-red-50 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-100">End Event</button>` : ''}
                 </div>
            </div>
        </div>
    `}).join('');
    
    if(window.lucide) lucide.createIcons();
}

window.resetMatchFilters = function() {
    document.getElementById('match-search-input').value = '';
    document.getElementById('filter-match-sport').value = '';
    document.getElementById('filter-match-gender').value = '';
    document.getElementById('filter-match-class').value = '';
    document.getElementById('filter-match-status').value = 'Scheduled'; // Reset to Default
    document.getElementById('sort-match-order').value = 'time_asc';
    filterMatches();
}

// 4. Exports for Matches
window.downloadMatchesExcel = function() {
    if (!dataCache || dataCache.length === 0) return showToast("No matches to export", "error");
    const ws = XLSX.utils.json_to_sheet(dataCache);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Matches");
    XLSX.writeFile(wb, `Urja_Schedule_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast("Matches Excel Downloaded", "success");
}

window.downloadMatchesPDF = function() {
    if (!dataCache || dataCache.length === 0) return showToast("No matches to export", "error");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l'); // Landscape
    
    doc.setFontSize(18);
    doc.text("URJA 2026 - MATCH SCHEDULE", 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 26);

    const headers = ["Date", "Time", "Sport", "Type", "Team 1", "Team 2", "Status", "Location"];
    const rows = dataCache.map(m => [m.Date, m.Time, m.Sport, m.Type, m["Team 1"], m["Team 2"], m.Status, m.Location]);

    doc.autoTable({
        head: [headers],
        body: rows,
        startY: 35,
        theme: 'grid',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [79, 70, 229] }
    });
    doc.save(`Urja_Schedule_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast("Matches PDF Downloaded", "success");
}


// --- 9b. EXISTING MATCH FUNCTIONS ---
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
    loadMatches(); // REFRESH LIST
}

window.startMatch = async function(matchId) {
    if(!confirm("Start this match now?")) return;
    await adminClient.from('matches').update({ status: 'Live', is_live: true }).eq('id', matchId);
    showToast("Match is LIVE!", "success");
    syncToRealtime(matchId);
    loadMatches(); // REFRESH LIST
}

// --- 10. TEAMS (UPDATED) ---
async function loadTeamsList() {
    const grid = document.getElementById('teams-grid');
    if(!grid) return;
    grid.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading teams...</p>';

    // FIX: Use fetchAllRecords to get >1000 teams
    const teams = await fetchAllRecords(
        'teams', 
        '*, sports(name, team_size), captain:users!captain_id(first_name, last_name, class_name, gender), team_members(status)',
        'created_at',
        false // descending
    );

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
    
    // NEW FILTERS
    const genderFilter = document.getElementById('filter-team-gender')?.value || '';
    const classFilter = document.getElementById('filter-team-class')?.value || '';

    const sortOrder = document.getElementById('sort-team-order')?.value || 'newest';

    // 1. Filter
    let filtered = allTeamsCache.filter(t => {
        const matchesSearch = t.name.toLowerCase().includes(search);
        const matchesSport = sportFilter === '' || t.sports?.name === sportFilter;
        const matchesStatus = statusFilter === '' || t.status === statusFilter;

        // Gender Check (Based on Captain)
        const matchesGender = genderFilter === '' || t.captain?.gender === genderFilter;

        // Class Category Check (Based on Captain)
        let matchesClass = true;
        if(classFilter !== '') {
            const isJunior = ['FYJC', 'SYJC'].includes(t.captain?.class_name);
            if(classFilter === 'Junior') matchesClass = isJunior;
            else if(classFilter === 'Senior') matchesClass = !isJunior;
        }

        return matchesSearch && matchesSport && matchesStatus && matchesGender && matchesClass;
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
        Capt_Class: t.captain?.class_name || '-',
        Capt_Gender: t.captain?.gender || '-',
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
        const isJunior = ['FYJC', 'SYJC'].includes(t.captain?.class_name);
        
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
                 <span class="text-[10px] bg-gray-100 text-gray-500 px-1.5 rounded">${isJunior ? 'JR' : 'SR'}</span>
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
    
    // RESET NEW FILTERS
    if(document.getElementById('filter-team-gender')) document.getElementById('filter-team-gender').value = '';
    if(document.getElementById('filter-team-class')) document.getElementById('filter-team-class').value = '';

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

    // FIX: Use fetchAllRecords to get >1000 registrations
    const regs = await fetchAllRecords(
        'registrations',
        `id, created_at, users (first_name, last_name, student_id, class_name, gender, mobile, email), sports (name)`,
        'created_at',
        false // descending
    );

    allRegistrationsCache = (regs || []).map(r => ({
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
    
    // FIX: Use fetchAllRecords to get >1000 users
    const users = await fetchAllRecords('users', '*', 'created_at', false);
        
    const { data: sports } = await adminClient.from('sports').select('id, name');
    dataCache = users || [];
    
    tbody.innerHTML = dataCache.map(u => {
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

window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

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
