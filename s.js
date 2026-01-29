// --- CONFIGURATION ---
const ROUND_ORDER = {
    "round of 128": 0, "round of 64": 1, "round of 32": 2, "round of 16": 3,
    "quarter-finals": 4, "quarter finals": 4, "qf": 4,
    "semi-finals": 5, "semi finals": 5, "sf": 5,
    "finals": 6, "final": 6, "champion": 7
};

// --- INIT ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Initializing Bracket View...");

    // 1. Critical Check: Is Supabase loaded?
    if (typeof supabase === 'undefined') {
        alert("CRITICAL ERROR: Supabase not found. \n\nMake sure 'config.js' is loaded BEFORE 's.js' and contains the correct URL/Key.");
        return;
    }

    lucide.createIcons();
    window.addEventListener('resize', drawConnectors);

    // 2. Try to load sports
    await fetchSportsForDropdowns();
});

// --- CORE FUNCTIONS ---

async function fetchSportsForDropdowns() {
    const select = document.getElementById('bracket-sport');
    
    try {
        // Query specific columns to ensure they exist
        const { data, error } = await supabase.from('matches').select('sport_name');
        
        if (error) {
            console.error("Supabase Error:", error);
            alert(`Database Error: ${error.message}\n\nHint: Check if your table is named 'matches' and has a column 'sport_name'.`);
            select.innerHTML = '<option>Error loading sports</option>';
            return;
        }

        if (!data || data.length === 0) {
            select.innerHTML = '<option>No matches found in DB</option>';
            return;
        }

        // Get unique sports
        const sports = [...new Set(data.map(item => item.sport_name))].sort();
        
        select.innerHTML = '<option value="">Select Sport</option>';
        sports.forEach(s => select.innerHTML += `<option value="${s}">${s}</option>`);

    } catch (err) {
        alert("Unexpected Error: " + err.message);
    }
}

async function loadBracket() {
    const sport = document.getElementById('bracket-sport').value;
    const category = document.getElementById('bracket-category').value;
    const gender = document.getElementById('bracket-gender').value;

    if (!sport) return alert("Please select a sport first.");

    const root = document.getElementById('bracket-root');
    root.innerHTML = '<div class="p-10 font-bold text-gray-400">Loading Matches...</div>';

    try {
        // Prepare gender keywords
        const genderTerms = gender === 'Male' ? ['Boys', 'Men', 'Male'] : ['Girls', 'Women', 'Female'];

        // 1. Fetch Data
        let query = supabase
            .from('matches')
            .select('*')
            .eq('sport_name', sport)
            .ilike('match_type', `%${category}%`);

        const { data, error } = await query;
        
        if (error) throw error;

        // 2. Filter Gender (Client-side)
        let filteredData = data.filter(m => {
            const type = (m.match_type || "").toLowerCase();
            return genderTerms.some(t => type.includes(t.toLowerCase()));
        });

        // 3. Check Results
        if (filteredData.length === 0) {
            root.innerHTML = `<div class="p-10 text-center text-red-500 font-bold">
                No matches found.<br>
                <span class="text-xs text-gray-500 font-normal">
                    Looking for Sport: "${sport}" <br>
                    Category containing: "${category}" <br>
                    And Gender keywords like: "${genderTerms.join(', ')}"
                </span>
            </div>`;
            updateTable([]);
            return;
        }

        // 4. Render
        renderTree(filteredData);
        updateTable(filteredData);

    } catch (err) {
        console.error(err);
        root.innerHTML = `<div class="p-10 text-red-600 font-bold">Error: ${err.message}</div>`;
    }
}

function renderTree(matches) {
    const root = document.getElementById('bracket-root');
    root.innerHTML = '';

    // Group by Round
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

    // Build DOM
    sortedRoundNames.forEach((roundName, rIndex) => {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'round';
        
        const title = document.createElement('div');
        title.className = 'round-title';
        title.innerText = roundName;
        roundDiv.appendChild(title);

        const roundMatches = roundsMap[roundName].sort((a,b) => a.id - b.id);

        roundMatches.forEach((m, mIndex) => {
            roundDiv.appendChild(createCard(m, rIndex, mIndex));
        });

        root.appendChild(roundDiv);
    });

    // Add Champion
    addChampion(roundsMap, sortedRoundNames, root);
    
    // Lines
    setTimeout(drawConnectors, 100);
}

function createCard(match, rIndex, mIndex) {
    const wrap = document.createElement('div');
    wrap.className = 'match-wrapper';
    if (mIndex % 2 === 0) wrap.setAttribute('data-pair-start', 'true');

    const w = match.winner;
    const t1 = match.team1 || 'TBD';
    const t2 = match.team2 || 'TBD';
    const isT1 = w && w === t1 && t1 !== 'TBD';
    const isT2 = w && w === t2 && t2 !== 'TBD';

    wrap.innerHTML = `
        <div class="match-card">
            <div class="${isT1 ? 'team winner' : 'team'}">
                <span class="truncate w-32 font-medium">${t1}</span>
                ${isT1 ? '<span>W</span>' : ''}
            </div>
            <div class="${isT2 ? 'team winner' : 'team'}">
                <span class="truncate w-32 font-medium">${t2}</span>
                ${isT2 ? '<span>W</span>' : ''}
            </div>
        </div>`;
    return wrap;
}

function addChampion(roundsMap, sortedRoundNames, root) {
    const lastRound = sortedRoundNames[sortedRoundNames.length - 1];
    if (lastRound && lastRound.toLowerCase().includes('final')) {
        const match = roundsMap[lastRound][0];
        if (match && match.winner && match.winner !== 'TBD') {
            const div = document.createElement('div');
            div.className = 'round';
            div.innerHTML = `
                <div class="round-title text-yellow-600">CHAMPION</div>
                <div class="match-wrapper">
                    <div class="match-card" style="border: 2px solid #b8860b;">
                        <div class="team winner" style="justify-content:center; height:50px;">
                            🏆 <span class="font-black text-[#b8860b] ml-2">${match.winner}</span>
                        </div>
                    </div>
                </div>`;
            root.appendChild(div);
        }
    }
}

function drawConnectors() {
    document.querySelectorAll('.connector-vertical').forEach(e => e.remove());
    const pairs = document.querySelectorAll('[data-pair-start="true"]');
    const container = document.getElementById('bracket-root').getBoundingClientRect();

    pairs.forEach(start => {
        let end = start.nextElementSibling;
        if (!end || !end.classList.contains('match-wrapper')) return;

        const r1 = start.getBoundingClientRect();
        const r2 = end.getBoundingClientRect();
        const height = (r2.top + r2.height / 2) - (r1.top + r1.height / 2);

        if (height > 0) {
            const line = document.createElement('div');
            line.className = 'connector-vertical';
            line.style.height = height + 'px';
            line.style.top = '50%';
            start.appendChild(line);
        }
    });
}

function toggleView() {
    const tree = document.getElementById('bracket-container');
    const table = document.getElementById('bracket-table-view');
    if (tree.style.display === 'none') {
        tree.style.display = 'block'; table.classList.add('hidden');
    } else {
        tree.style.display = 'none'; table.classList.remove('hidden');
    }
}

function updateTable(data) {
    const tbody = document.getElementById('bracket-table-body');
    tbody.innerHTML = '';
    data.forEach(m => {
        tbody.innerHTML += `<tr class="bg-white"><td class="p-3">${m.round_name}</td><td class="p-3">${m.team1}</td><td class="p-3">${m.team2}</td><td class="p-3 font-bold text-green-600">${m.winner || '-'}</td></tr>`;
    });
}
