// --- CONFIGURATION & STATE ---
let currentView = 'dashboard';
let bracketData = []; // Store currently loaded bracket matches for export

// Round Order Mapping (Normalizes different naming conventions)
const ROUND_ORDER = {
    "round of 128": 0,
    "round of 64": 1,
    "round of 32": 2,
    "round of 16": 3,
    "pre-quarter": 3,
    "quarter-finals": 4, "quarter finals": 4, "quarter final": 4, "qf": 4,
    "semi-finals": 5, "semi finals": 5, "semi final": 5, "sf": 5,
    "finals": 6, "final": 6, "f": 6,
    "champion": 7
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    
    // Initial Loads
    loadDashboardStats();
    setupEventListeners();
    
    // Load dropdown options for the Bracket View immediately
    await fetchSportsForDropdowns();
});

function checkAuth() {
    const session = localStorage.getItem('admin_session');
    if (!session) {
        // Redirect to login if not authenticated (Uncomment in production)
        // window.location.href = 'index.html';
        console.warn("No session found. Redirecting to login in production.");
    }
}

function adminLogout() {
    localStorage.removeItem('admin_session');
    window.location.href = 'index.html';
}

function setupEventListeners() {
    // Re-draw connectors on window resize to keep lines aligned
    window.addEventListener('resize', () => {
        if(currentView === 'brackets') drawConnectors();
    });
}

// --- NAVIGATION ---
function switchView(viewId) {
    // 1. Hide all views
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    // 2. Show selected view
    const viewEl = document.getElementById(`view-${viewId}`);
    if(viewEl) viewEl.classList.remove('hidden');
    
    const navEl = document.getElementById(`nav-${viewId}`);
    if(navEl) navEl.classList.add('active');
    
    // 3. Update Page Title
    const titles = {
        'dashboard': 'Dashboard',
        'sports': 'Manage Sports',
        'matches': 'Schedule & Matches',
        'brackets': 'Tournament Brackets',
        'manual-schedule': 'Manual Schedule'
    };
    document.getElementById('page-title').innerText = titles[viewId] || 'Admin';

    // 4. View Specific Logic
    currentView = viewId;
    
    // Hide Global Export buttons by default (Brackets has its own)
    const globalActions = document.getElementById('global-actions');
    if(globalActions) globalActions.classList.add('hidden');

    if (viewId === 'sports') loadSportsTable();
    if (viewId === 'matches') loadMatchesGrid();
    if (viewId === 'brackets') {
        // Redraw connectors if we switch back to an already loaded bracket
        if(document.getElementById('bracket-root').children.length > 1) {
             setTimeout(drawConnectors, 100);
        }
    }
}

// --- 1. DASHBOARD LOGIC ---
async function loadDashboardStats() {
    try {
        // Fetch counts from Supabase
        const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: regCount } = await supabase.from('registrations').select('*', { count: 'exact', head: true });
        const { count: teamCount } = await supabase.from('teams').select('*', { count: 'exact', head: true });

        // Update DOM
        if(document.getElementById('dash-total-users')) document.getElementById('dash-total-users').innerText = userCount || 0;
        if(document.getElementById('dash-total-regs')) document.getElementById('dash-total-regs').innerText = regCount || 0;
        if(document.getElementById('dash-total-teams')) document.getElementById('dash-total-teams').innerText = teamCount || 0;
    } catch (e) {
        console.error("Stats loading error:", e);
    }
}

// --- 2. BRACKET LOGIC (NEW CORE FEATURE) ---

// A. Populate Sport Dropdown
async function fetchSportsForDropdowns() {
    try {
        // Fetch distinct sport names from matches table
        const { data, error } = await supabase
            .from('matches')
            .select('sport_name');
        
        if (error) throw error;

        // Get unique values
        const sports = [...new Set(data.map(item => item.sport_name))].sort();
        
        const bracketSelect = document.getElementById('bracket-sport');
        const manualSelect = document.getElementById('manual-sport'); // Also update manual schedule dropdown
        
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

// B. Main Load Function
async function loadBracket() {
    const sport = document.getElementById('bracket-sport').value;
    const category = document.getElementById('bracket-category').value; // Junior / Degree
    const gender = document.getElementById('bracket-gender').value;     // Male / Female

    if (!sport) {
        showToast('error', 'Please select a sport first');
        return;
    }

    const root = document.getElementById('bracket-root');
    root.innerHTML = '<div class="flex items-center justify-center w-full h-64"><p class="animate-pulse font-bold text-indigo-600">Loading Tournament Data...</p></div>';

    try {
        // 1. Build Query
        // We filter by Sport, and then loosely filter match_type for Category and Gender
        // Example match_type in DB: "Cricket (Junior Boys)"
        
        let genderTerm = gender === 'Male' ? 'Boys' : 'Girls'; // Map selection to DB convention
        if (gender === 'Male') genderTerm = ['Boys', 'Men', 'Male']; // Handle variations
        else genderTerm = ['Girls', 'Women', 'Female', 'Ladies'];

        let query = supabase
            .from('matches')
            .select('*')
            .eq('sport_name', sport)
            .ilike('match_type', `%${category}%`); // Filter Category (Junior/Degree)

        const { data, error } = await query;
        if (error) throw error;

        // 2. Client-Side Gender Filter (Supabase simple filtering limitation)
        let filteredData = data.filter(m => {
             const type = (m.match_type || "").toLowerCase();
             // Check if any of the gender terms exist in the match_type string
             const isCorrectGender = Array.isArray(genderTerm) 
                ? genderTerm.some(t => type.includes(t.toLowerCase()))
                : type.includes(genderTerm.toLowerCase());
             return isCorrectGender;
        });

        // 3. Handle Empty State
        if (filteredData.length === 0) {
            root.innerHTML = `
                <div class="flex flex-col items-center justify-center w-full h-64 text-gray-400 gap-2">
                    <i data-lucide="alert-circle" class="w-8 h-8 opacity-50"></i>
                    <span class="font-bold">No matches found for this filter.</span>
                    <span class="text-xs">Try changing Category or Gender.</span>
                </div>`;
            lucide.createIcons();
            updateBracketTable([]);
            bracketData = [];
            return;
        }

        // 4. Success - Render
        bracketData = filteredData; // Store for export
        renderBracketTree(filteredData);
        updateBracketTable(filteredData);
        showToast('success', `Loaded ${filteredData.length} matches`);

    } catch (err) {
        console.error(err);
        showToast('error', 'Failed to load bracket data');
    }
}

// C. Render the Visual Tree
function renderBracketTree(matches) {
    const root = document.getElementById('bracket-root');
    root.innerHTML = '';

    // 1. Group matches by Round Name
    const roundsMap = {};
    matches.forEach(m => {
        // Standardize key (remove extra spaces, lowercase for sorting)
        let rName = (m.round_name || "Unknown").trim();
        if (!roundsMap[rName]) roundsMap[rName] = [];
        roundsMap[rName].push(m);
    });

    // 2. Sort Rounds logically (Round 1 -> Final)
    const sortedRoundNames = Object.keys(roundsMap).sort((a, b) => {
        const valA = ROUND_ORDER[a.toLowerCase()] || 99;
        const valB = ROUND_ORDER[b.toLowerCase()] || 99;
        return valA - valB;
    });

    // 3. Render Columns
    sortedRoundNames.forEach((roundName, rIndex) => {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'round';
        
        // Round Title
        const title = document.createElement('div');
        title.className = 'round-title';
        title.innerText = roundName;
        roundDiv.appendChild(title);

        // Sort matches within round by ID to ensure pairing consistency (optional but good)
        const roundMatches = roundsMap[roundName].sort((a,b) => a.id - b.id);

        // Render Cards
        roundMatches.forEach((m, mIndex) => {
            const el = createMatchCard(m, rIndex, mIndex);
            roundDiv.appendChild(el);
        });

        root.appendChild(roundDiv);
    });

    // 4. Add "Champion" Box if the Final is played
    addChampionBox(roundsMap, sortedRoundNames, root);

    // 5. Draw Connectors (Lines)
    // Delay slightly to ensure DOM is fully calculated
    setTimeout(drawConnectors, 100);
}

function createMatchCard(match, roundIndex, matchIndex) {
    const wrap = document.createElement('div');
    wrap.className = 'match-wrapper';
    wrap.id = `R${roundIndex}-M${matchIndex}`; // ID used for debug/tracking
    
    // Data attribute to identify the "Top" card of a pair (Matches 0, 2, 4...)
    if (matchIndex % 2 === 0) wrap.setAttribute('data-pair-start', 'true');

    // Winner Highlighting Logic
    const w = match.winner;
    const t1 = match.team1 || 'TBD';
    const t2 = match.team2 || 'TBD';
    
    // Check if team is winner (safe check against TBD)
    const isT1Winner = w && w === t1 && t1 !== 'TBD';
    const isT2Winner = w && w === t2 && t2 !== 'TBD';

    const t1Class = isT1Winner ? "team winner" : "team";
    const t2Class = isT2Winner ? "team winner" : "team";
    
    // Small 'W' badge
    const t1Badge = isT1Winner ? '<span class="team-score">W</span>' : '';
    const t2Badge = isT2Winner ? '<span class="team-score">W</span>' : '';

    wrap.innerHTML = `
        <div class="match-card">
            <div class="${t1Class}">
                <span class="truncate w-32 font-medium" title="${t1}">${t1}</span>
                ${t1Badge}
            </div>
            <div class="${t2Class}">
                <span class="truncate w-32 font-medium" title="${t2}">${t2}</span>
                ${t2Badge}
            </div>
        </div>
    `;
    return wrap;
}

function addChampionBox(roundsMap, sortedRoundNames, root) {
    // Get the very last round name
    const lastRoundName = sortedRoundNames[sortedRoundNames.length - 1];
    if(!lastRoundName) return;

    const lastRoundMatches = roundsMap[lastRoundName];
    
    // Only show champion if it's the "Finals" and there is 1 match with a winner
    const isFinal = lastRoundName.toLowerCase().includes('final');
    
    if (isFinal && lastRoundMatches.length === 1) {
        const finalMatch = lastRoundMatches[0];
        if (finalMatch.winner && finalMatch.winner !== 'TBD') {
            const champDiv = document.createElement('div');
            champDiv.className = 'round';
            champDiv.innerHTML = `
                <div class="round-title text-yellow-600">CHAMPION</div>
                <div class="match-wrapper">
                    <div class="match-card" style="border: 2px solid #b8860b; box-shadow: 0 4px 20px rgba(184,134,11,0.15);">
                        <div class="team winner" style="justify-content:center; height:50px; font-size:1.1rem; background: #fffbeb;">
                            🏆 <span class="font-black text-[#b8860b] ml-2">${finalMatch.winner}</span>
                        </div>
                    </div>
                </div>`;
            root.appendChild(champDiv);
        }
    }
}

// D. Connector Drawing (The "Fork" Lines)
function drawConnectors() {
    // 1. Clean up old lines
    document.querySelectorAll('.connector-vertical').forEach(e => e.remove());

    const pairs = document.querySelectorAll('[data-pair-start="true"]');
    const containerRect = document.getElementById('bracket-root').getBoundingClientRect();

    pairs.forEach(startEl => {
        // Find the partner match (Next sibling)
        let endEl = startEl.nextElementSibling;
        
        // Validation: Must have a partner, partner must be a match-wrapper
        if (!endEl || !endEl.classList.contains('match-wrapper')) return;

        // Get Coordinates
        const rect1 = startEl.getBoundingClientRect();
        const rect2 = endEl.getBoundingClientRect();

        // Calculate vertical centers relative to container
        const y1 = (rect1.top + rect1.height / 2) - containerRect.top;
        const y2 = (rect2.top + rect2.height / 2) - containerRect.top;
        
        // Height of the connector line
        const height = y2 - y1;

        if (height > 0) {
            const line = document.createElement('div');
            line.className = 'connector-vertical';
            line.style.height = height + 'px';
            line.style.top = '50%'; // Start from middle of top card
            
            // Append line to the top card wrapper
            startEl.appendChild(line);
        }
    });
}

// E. Table View Logic
function updateBracketTable(data) {
    const tbody = document.getElementById('bracket-table-body');
    if(!tbody) return;
    
    tbody.innerHTML = '';
    data.forEach(m => {
        const tr = `
            <tr class="bg-white hover:bg-gray-50 transition-colors">
                <td class="p-3 border-b border-gray-100 font-bold text-xs text-gray-500 uppercase">${m.round_name}</td>
                <td class="p-3 border-b border-gray-100 text-xs font-mono text-indigo-600">#${m.id}</td>
                <td class="p-3 border-b border-gray-100 font-bold text-gray-800">${m.team1 || 'TBD'}</td>
                <td class="p-3 border-b border-gray-100 font-bold text-gray-800">${m.team2 || 'TBD'}</td>
                <td class="p-3 border-b border-gray-100 font-bold text-green-600">${m.winner || '-'}</td>
            </tr>
        `;
        tbody.innerHTML += tr;
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

// --- 3. EXPORT FUNCTIONS ---

function exportBracketExcel() {
    if (!bracketData || bracketData.length === 0) {
        showToast('error', 'No bracket data loaded to export.');
        return;
    }
    
    // Prepare Data for Excel
    const cleanData = bracketData.map(m => ({
        "Match ID": m.id,
        "Round": m.round_name,
        "Category": m.match_type,
        "Team 1": m.team1,
        "Team 2": m.team2,
        "Winner": m.winner || "Pending",
        "Score": m.score || "-",
        "Status": m.status,
        "Time": m.schedule_time
    }));

    const ws = XLSX.utils.json_to_sheet(cleanData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tournament_Results");
    
    const fileName = `Bracket_${document.getElementById('bracket-sport').value}_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
}

function printBracketPDF() {
    // The CSS @media print in s.html handles the layout.
    // We just need to ensure the Bracket View is active and Table is hidden.
    const tree = document.getElementById('bracket-container');
    const table = document.getElementById('bracket-table-view');
    
    if(tree.style.display === 'none') {
        // Temporarily switch to tree for print
        tree.style.display = 'block';
        table.classList.add('hidden');
        window.print();
        // Revert (Optional, but usually fine to leave as tree)
    } else {
        window.print();
    }
}

function exportCurrentPage(type) {
    // Global export handler for other pages (if re-enabled)
    if(currentView === 'brackets') {
        if(type === 'excel') exportBracketExcel();
        if(type === 'pdf') printBracketPDF();
    } else {
        showToast('info', 'Export available in Brackets view');
    }
}

// --- 4. MANUAL SCHEDULE LOGIC ---

async function handleManualSportChange() {
    const sportName = document.getElementById('manual-sport').value;
    const t1Select = document.getElementById('manual-team1');
    const t2Select = document.getElementById('manual-team2');
    
    if (!sportName) return;

    t1Select.innerHTML = '<option>Loading...</option>';
    
    // Fetch Teams for this sport
    const { data: teams, error } = await supabase
        .from('teams')
        .select('team_name')
        .eq('sport_name', sportName);

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
        match_type: document.getElementById('manual-type').value, // e.g., "Regular (Junior Boys)"
        round_name: "Round " + document.getElementById('manual-round').value,
        team1: document.getElementById('manual-team1').value,
        team2: document.getElementById('manual-is-bye').checked ? 'BYE' : document.getElementById('manual-team2').value,
        schedule_time: document.getElementById('manual-time').value,
        location: document.getElementById('manual-location').value,
        status: 'Scheduled'
    };
    
    // Auto-Win Logic for BYE
    if (formData.team2 === 'BYE') {
        formData.winner = formData.team1;
        formData.status = 'Completed';
        formData.score = 'Walkover';
    }

    const { error } = await supabase.from('matches').insert([formData]);

    if (error) {
        showToast('error', error.message);
    } else {
        showToast('success', 'Match Scheduled Successfully');
        document.querySelector('form').reset();
    }
}

// --- 5. LEGACY/PLACEHOLDER LOADERS (Keep for older tabs) ---

async function loadSportsTable() {
    const tbody = document.getElementById('sports-table-tournament');
    if(!tbody) return;
    
    tbody.innerHTML = '<tr><td class="p-4 text-center">Loading...</td></tr>';
    
    const { data, error } = await supabase.from('sports').select('*');
    if(data) {
        tbody.innerHTML = '';
        data.forEach(s => {
            tbody.innerHTML += `
                <tr class="border-b border-gray-50 hover:bg-gray-50">
                    <td class="p-4 font-bold">${s.sport_name}</td>
                    <td class="p-4 text-sm">${s.category || 'General'}</td>
                    <td class="p-4"><span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold">${s.type}</span></td>
                </tr>`;
        });
    }
}

async function loadMatchesGrid() {
    const grid = document.getElementById('matches-grid');
    if(!grid) return;
    
    grid.innerHTML = '<p class="text-center w-full col-span-3">Loading Schedule...</p>';
    
    // Get upcoming matches
    const { data, error } = await supabase.from('matches').select('*').order('schedule_time', { ascending: true }).limit(20);
    
    if(data) {
        grid.innerHTML = '';
        data.forEach(m => {
            const date = new Date(m.schedule_time).toLocaleString();
            grid.innerHTML += `
                <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                    <div class="flex justify-between items-start mb-4">
                        <span class="text-[10px] font-black uppercase tracking-widest text-brand-primary bg-indigo-50 px-2 py-1 rounded">${m.sport_name}</span>
                        <span class="text-xs font-bold text-gray-400">${m.status}</span>
                    </div>
                    <div class="flex justify-between items-center mb-4">
                        <div class="text-center w-1/3">
                            <p class="font-black text-gray-900 text-sm truncate">${m.team1}</p>
                        </div>
                        <div class="text-xs font-black text-gray-300">VS</div>
                        <div class="text-center w-1/3">
                            <p class="font-black text-gray-900 text-sm truncate">${m.team2}</p>
                        </div>
                    </div>
                    <div class="text-xs text-gray-400 font-medium flex items-center gap-2">
                        <i data-lucide="clock" class="w-3 h-3"></i> ${date}
                    </div>
                </div>
            `;
        });
        lucide.createIcons();
    }
}

// --- UTILITIES ---

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function openAddSportModal() {
    document.getElementById('modal-add-sport').classList.remove('hidden');
}

async function handleAddSport(event) {
    event.preventDefault();
    // Logic to add sport to DB would go here
    showToast('success', 'Feature coming soon (Mock)');
    closeModal('modal-add-sport');
}

function submitLiveParticipant(e) {
    e.preventDefault();
    // Logic for live participant
    showToast('success', 'Participant Added');
    closeModal('modal-add-live-participant');
}

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
    
    // Auto hide
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-10');
    }, 3000);
}
