// --- CONFIGURATION & STATE ---
let currentView = 'dashboard';
let bracketData = []; // Stores the currently loaded bracket matches for export

// Round Order Mapping (Normalizes different naming conventions for sorting)
const ROUND_ORDER = {
    "round of 128": 0,
    "round of 64": 1,
    "round of 32": 2,
    "round of 16": 3, "pre-quarter": 3,
    "quarter-finals": 4, "quarter finals": 4, "quarter final": 4, "qf": 4,
    "semi-finals": 5, "semi finals": 5, "semi final": 5, "sf": 5,
    "finals": 6, "final": 6, "f": 6,
    "champion": 7
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check Auth
    checkAuth();
    
    // 2. Load Initial Data
    loadDashboardStats();
    setupEventListeners();
    
    // 3. Load Sports for the Bracket Dropdown
    await fetchSportsForDropdowns();
});

function checkAuth() {
    const session = localStorage.getItem('admin_session');
    // If you want to force login, uncomment the next line:
    // if (!session) window.location.href = 'index.html';
}

function adminLogout() {
    localStorage.removeItem('admin_session');
    window.location.href = 'index.html';
}

function setupEventListeners() {
    // Redraw bracket lines when window resizes
    window.addEventListener('resize', () => {
        if(currentView === 'brackets') drawConnectors();
    });
}

// --- NAVIGATION ---
function switchView(viewId) {
    // Hide all views and remove active state from nav items
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    // Show selected view
    const viewEl = document.getElementById(`view-${viewId}`);
    if(viewEl) viewEl.classList.remove('hidden');
    
    const navEl = document.getElementById(`nav-${viewId}`);
    if(navEl) navEl.classList.add('active');
    
    // Update Header Title
    const titles = {
        'dashboard': 'Dashboard',
        'sports': 'Manage Sports',
        'matches': 'Schedule & Matches',
        'brackets': 'Tournament Brackets',
        'manual-schedule': 'Manual Schedule'
    };
    document.getElementById('page-title').innerText = titles[viewId] || 'Admin Dashboard';

    // Hide Global Action buttons (Brackets has its own toolbar)
    const globalActions = document.getElementById('global-actions');
    if(globalActions) globalActions.classList.add('hidden');

    currentView = viewId;

    // View specific init
    if (viewId === 'sports') loadSportsTable();
    if (viewId === 'matches') loadMatchesGrid();
    if (viewId === 'brackets') {
        // If bracket is already visible, redraw connectors to be safe
        if(document.getElementById('bracket-root').children.length > 0) {
             setTimeout(drawConnectors, 100);
        }
    }
}

// --- 1. DASHBOARD LOGIC ---
async function loadDashboardStats() {
    try {
        const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: regCount } = await supabase.from('registrations').select('*', { count: 'exact', head: true });
        const { count: teamCount } = await supabase.from('teams').select('*', { count: 'exact', head: true });

        if(document.getElementById('dash-total-users')) document.getElementById('dash-total-users').innerText = userCount || 0;
        if(document.getElementById('dash-total-regs')) document.getElementById('dash-total-regs').innerText = regCount || 0;
        if(document.getElementById('dash-total-teams')) document.getElementById('dash-total-teams').innerText = teamCount || 0;
    } catch (e) {
        console.error("Stats loading error:", e);
    }
}

// --- 2. BRACKET LOGIC (CORE FEATURE) ---

// A. Populate Sport Dropdowns
async function fetchSportsForDropdowns() {
    try {
        // Fetch distinct sport names
        const { data, error } = await supabase.from('matches').select('sport_name');
        
        if (error) throw error;

        // Create unique list
        const sports = [...new Set(data.map(item => item.sport_name))].sort();
        
        const bracketSelect = document.getElementById('bracket-sport');
        const manualSelect = document.getElementById('manual-sport');
        
        if(bracketSelect) {
            bracketSelect.innerHTML = '<option value="">Select Sport</option>';
            sports.forEach(s => bracketSelect.innerHTML += `<option value="${s}">${s}</option>`);
        }
        
        if(manualSelect) {
            manualSelect.innerHTML = '<option value="">-- Choose Sport --</option>';
            sports.forEach(s => manualSelect.innerHTML += `<option value="${s}">${s}</option>`);
        }

    } catch (err) {
        console.error("Error fetching sports:", err);
    }
}

// B. Load Bracket Data
async function loadBracket() {
    const sport = document.getElementById('bracket-sport').value;
    const category = document.getElementById('bracket-category').value; // Junior / Degree
    const gender = document.getElementById('bracket-gender').value;     // Male / Female

    if (!sport) {
        showToast('error', 'Please select a sport');
        return;
    }

    const root = document.getElementById('bracket-root');
    root.innerHTML = '<div class="flex items-center justify-center w-full h-64"><p class="animate-pulse font-bold text-indigo-600">Loading Tournament Data...</p></div>';

    try {
        // define gender keywords
        let genderTerm = gender === 'Male' ? ['Boys', 'Men', 'Male'] : ['Girls', 'Women', 'Female', 'Ladies'];

        // 1. Fetch from Supabase (Filter by Sport & Category string)
        let query = supabase
            .from('matches')
            .select('*')
            .eq('sport_name', sport)
            .ilike('match_type', `%${category}%`); // e.g. "Junior"

        const { data, error } = await query;
        if (error) throw error;

        // 2. Client-side Filter for Gender (matches "Boys" OR "Men" etc.)
        let filteredData = data.filter(m => {
             const type = (m.match_type || "").toLowerCase();
             return genderTerm.some(term => type.includes(term.toLowerCase()));
        });

        // 3. Handle Empty Results
        if (filteredData.length === 0) {
            root.innerHTML = `
                <div class="flex flex-col items-center justify-center w-full h-64 text-gray-400 gap-2">
                    <span class="font-bold">No matches found.</span>
                    <span class="text-xs">Ensure match types in DB contain "${category}" and "${gender === 'Male' ? 'Boys' : 'Girls'}".</span>
                </div>`;
            updateBracketTable([]);
            bracketData = [];
            return;
        }

        // 4. Render
        bracketData = filteredData; 
        renderBracketTree(filteredData);
        updateBracketTable(filteredData);
        showToast('success', `Loaded ${filteredData.length} matches`);

    } catch (err) {
        console.error(err);
        showToast('error', 'Failed to load data: ' + err.message);
    }
}

// C. Render Visual Tree
function renderBracketTree(matches) {
    const root = document.getElementById('bracket-root');
    root.innerHTML = '';

    // Group by Round Name
    const roundsMap = {};
    matches.forEach(m => {
        let rName = (m.round_name || "Unknown").trim();
        if (!roundsMap[rName]) roundsMap[rName] = [];
        roundsMap[rName].push(m);
    });

    // Sort Rounds
    const sortedRoundNames = Object.keys(roundsMap).sort((a, b) => {
        const valA = ROUND_ORDER[a.toLowerCase()] || 99;
        const valB = ROUND_ORDER[b.toLowerCase()] || 99;
        return valA - valB;
    });

    // Create Columns
    sortedRoundNames.forEach((roundName, rIndex) => {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'round';
        
        const title = document.createElement('div');
        title.className = 'round-title';
        title.innerText = roundName;
        roundDiv.appendChild(title);

        // Sort matches inside the round by ID to keep pairing logic consistent
        const roundMatches = roundsMap[roundName].sort((a,b) => a.id - b.id);

        roundMatches.forEach((m, mIndex) => {
            roundDiv.appendChild(createMatchCard(m, rIndex, mIndex));
        });

        root.appendChild(roundDiv);
    });

    addChampionBox(roundsMap, sortedRoundNames, root);
    
    // Draw lines after DOM update
    setTimeout(drawConnectors, 100);
}

function createMatchCard(match, roundIndex, matchIndex) {
    const wrap = document.createElement('div');
    wrap.className = 'match-wrapper';
    wrap.id = `R${roundIndex}-M${matchIndex}`; 
    
    // Tag start of pairs (0, 2, 4...) for connector lines
    if (matchIndex % 2 === 0) wrap.setAttribute('data-pair-start', 'true');

    // Winner Logic
    const w = match.winner;
    const t1 = match.team1 || 'TBD';
    const t2 = match.team2 || 'TBD';
    
    const isT1Winner = w && w === t1 && t1 !== 'TBD';
    const isT2Winner = w && w === t2 && t2 !== 'TBD';

    wrap.innerHTML = `
        <div class="match-card">
            <div class="${isT1Winner ? 'team winner' : 'team'}">
                <span class="truncate w-32 font-medium" title="${t1}">${t1}</span>
                ${isT1Winner ? '<span class="team-score">W</span>' : ''}
            </div>
            <div class="${isT2Winner ? 'team winner' : 'team'}">
                <span class="truncate w-32 font-medium" title="${t2}">${t2}</span>
                ${isT2Winner ? '<span class="team-score">W</span>' : ''}
            </div>
        </div>
    `;
    return wrap;
}

function addChampionBox(roundsMap, sortedRoundNames, root) {
    const lastRoundName = sortedRoundNames[sortedRoundNames.length - 1];
    if(!lastRoundName) return;

    const lastRoundMatches = roundsMap[lastRoundName];
    // Show champion if it's a Final and has a winner
    if (lastRoundName.toLowerCase().includes('final') && lastRoundMatches.length === 1) {
        const finalMatch = lastRoundMatches[0];
        if (finalMatch.winner && finalMatch.winner !== 'TBD') {
            const champDiv = document.createElement('div');
            champDiv.className = 'round';
            champDiv.innerHTML = `
                <div class="round-title text-yellow-600">CHAMPION</div>
                <div class="match-wrapper">
                    <div class="match-card" style="border: 2px solid #b8860b; box-shadow: 0 4px 15px rgba(184,134,11,0.2);">
                        <div class="team winner" style="justify-content:center; height:50px; font-size:1.1rem; background: #fffbeb;">
                            🏆 <span class="font-black text-[#b8860b] ml-2">${finalMatch.winner}</span>
                        </div>
                    </div>
                </div>`;
            root.appendChild(champDiv);
        }
    }
}

// D. Draw Lines
function drawConnectors() {
    document.querySelectorAll('.connector-vertical').forEach(e => e.remove());

    const pairs = document.querySelectorAll('[data-pair-start="true"]');
    const containerRect = document.getElementById('bracket-root').getBoundingClientRect();

    pairs.forEach(startEl => {
        let endEl = startEl.nextElementSibling;
        
        // Ensure there is a next match in this round to connect to
        if (!endEl || !endEl.classList.contains('match-wrapper')) return;

        const rect1 = startEl.getBoundingClientRect();
        const rect2 = endEl.getBoundingClientRect();

        const y1 = (rect1.top + rect1.height / 2) - containerRect.top;
        const y2 = (rect2.top + rect2.height / 2) - containerRect.top;
        const height = y2 - y1;

        if (height > 0) {
            const line = document.createElement('div');
            line.className = 'connector-vertical';
            line.style.height = height + 'px';
            line.style.top = '50%';
            startEl.appendChild(line);
        }
    });
}

// --- 3. EXPORT & VIEW UTILS ---

function updateBracketTable(data) {
    const tbody = document.getElementById('bracket-table-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    data.forEach(m => {
        tbody.innerHTML += `
            <tr class="bg-white hover:bg-gray-50 transition-colors">
                <td class="p-3 border-b text-xs text-gray-500 uppercase font-bold">${m.round_name}</td>
                <td class="p-3 border-b text-xs text-indigo-600 font-mono">#${m.id}</td>
                <td class="p-3 border-b font-bold text-gray-800">${m.team1 || 'TBD'}</td>
                <td class="p-3 border-b font-bold text-gray-800">${m.team2 || 'TBD'}</td>
                <td class="p-3 border-b font-bold text-green-600">${m.winner || '-'}</td>
            </tr>`;
    });
}

function toggleBracketView() {
    const tree = document.getElementById('bracket-container');
    const table = document.getElementById('bracket-table-view');
    
    if (tree.style.display === 'none') {
        tree.style.display = 'block';
        table.classList.add('hidden');
    } else {
        tree.style.display = 'none';
        table.classList.remove('hidden');
    }
}

function exportBracketExcel() {
    if (!bracketData || bracketData.length === 0) {
        showToast('error', 'No data to export.');
        return;
    }
    
    // Format data for Excel
    const cleanData = bracketData.map(m => ({
        "ID": m.id,
        "Round": m.round_name,
        "Type": m.match_type,
        "Team 1": m.team1,
        "Team 2": m.team2,
        "Winner": m.winner || "Pending",
        "Time": m.schedule_time
    }));

    const ws = XLSX.utils.json_to_sheet(cleanData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    
    const fileName = `Bracket_${document.getElementById('bracket-sport').value}.xlsx`;
    XLSX.writeFile(wb, fileName);
}

function printBracketPDF() {
    const tree = document.getElementById('bracket-container');
    const table = document.getElementById('bracket-table-view');
    
    // Ensure visual bracket is shown for print
    if(tree.style.display === 'none') {
        tree.style.display = 'block';
        table.classList.add('hidden');
        window.print();
    } else {
        window.print();
    }
}

// --- 4. MANUAL SCHEDULE ---

async function handleManualSportChange() {
    const sportName = document.getElementById('manual-sport').value;
    const t1Select = document.getElementById('manual-team1');
    const t2Select = document.getElementById('manual-team2');
    
    if (!sportName) return;

    t1Select.innerHTML = '<option>Loading...</option>';
    
    // Fetch Teams
    const { data: teams } = await supabase.from('teams').select('team_name').eq('sport_name', sportName);

    t1Select.innerHTML = '<option value="">Select Team</option>';
    t2Select.innerHTML = '<option value="">Select Team</option>';

    if (teams) {
        teams.forEach(t => {
            const opt = `<option value="${t.team_name}">${t.team_name}</option>`;
            t1Select.innerHTML += opt;
            t2Select.innerHTML += opt;
        });
    }
}

function toggleManualBye() {
    const isBye = document.getElementById('manual-is-bye').checked;
    const t2 = document.getElementById('manual-team2');
    if (isBye) {
        t2.value = "BYE";
        t2.disabled = true;
    } else {
        t2.value = "";
        t2.disabled = false;
    }
}

async function submitManualSchedule(e) {
    e.preventDefault();
    
    const formData = {
        sport_name: document.getElementById('manual-sport').value,
        match_type: document.getElementById('manual-type').value,
        round_name: "Round " + document.getElementById('manual-round').value,
        team1: document.getElementById('manual-team1').value,
        team2: document.getElementById('manual-is-bye').checked ? 'BYE' : document.getElementById('manual-team2').value,
        schedule_time: document.getElementById('manual-time').value,
        location: document.getElementById('manual-location').value,
        status: 'Scheduled'
    };
    
    // Auto-Win for Bye
    if (formData.team2 === 'BYE') {
        formData.winner = formData.team1;
        formData.status = 'Completed';
    }

    const { error } = await supabase.from('matches').insert([formData]);

    if (error) {
        showToast('error', error.message);
    } else {
        showToast('success', 'Match Scheduled Successfully');
        document.querySelector('form').reset();
    }
}

// --- UTILITIES ---

function showToast(type, msg) {
    const toast = document.getElementById('toast-container');
    const msgEl = document.getElementById('toast-msg');
    const iconEl = document.getElementById('toast-icon');
    
    if(!toast) return;

    toast.classList.remove('opacity-0', 'translate-y-10');
    msgEl.innerText = msg;
    
    if(type === 'success') {
        iconEl.innerHTML = '<i data-lucide="check-circle" class="text-green-400 w-5 h-5"></i>';
    } else if (type === 'error') {
        iconEl.innerHTML = '<i data-lucide="x-circle" class="text-red-400 w-5 h-5"></i>';
    } else {
        iconEl.innerHTML = '<i data-lucide="info" class="text-blue-400 w-5 h-5"></i>';
    }
    
    lucide.createIcons();
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-10');
    }, 3000);
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function openAddSportModal() { document.getElementById('modal-add-sport').classList.remove('hidden'); }
function handleAddSport(e) { e.preventDefault(); showToast('success', 'Sport Added (Mock)'); closeModal('modal-add-sport'); }
function submitLiveParticipant(e) { e.preventDefault(); showToast('success', 'Added (Mock)'); closeModal('modal-add-live-participant'); }

// Placeholders for older views
async function loadSportsTable() {
    const tbody = document.getElementById('sports-table-tournament');
    if(!tbody) return;
    const { data } = await supabase.from('sports').select('*');
    if(data) {
        tbody.innerHTML = '';
        data.forEach(s => tbody.innerHTML += `<tr class="border-b"><td class="p-3">${s.sport_name}</td></tr>`);
    }
}

async function loadMatchesGrid() {
    const grid = document.getElementById('matches-grid');
    if(!grid) return;
    const { data } = await supabase.from('matches').select('*').limit(10);
    if(data) {
        grid.innerHTML = '';
        data.forEach(m => grid.innerHTML += `<div class="bg-white p-4 shadow rounded">${m.team1} vs ${m.team2}</div>`);
    }
}
