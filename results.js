// ==========================================
// URJA 2026 - CLEAN RESULTS ENGINE
// ==========================================

const publicClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

let allResults = [];
let teamMembersMap = {};

document.addEventListener('DOMContentLoaded', () => {
    if(window.lucide) lucide.createIcons();
    fetchAndRenderResults();
});

// --- 1. FETCH DATA ---
async function fetchAndRenderResults() {
    const grid = document.getElementById('results-grid');
    
    // Fetch Results
    const { data: results, error } = await publicClient
        .from('results')
        .select(`
            *,
            teams (id, name, sport_id),
            teams_sport:teams(sports(name))
        `)
        .order('created_at', { ascending: false });

    if (error) {
        grid.innerHTML = `<div class="col-span-full text-center py-10 text-gray-500">Unable to load data.</div>`;
        return;
    }

    allResults = results || [];

    // Fetch Team Squads
    const teamIds = allResults.filter(r => r.team_id).map(r => r.team_id);
    if (teamIds.length > 0) {
        const { data: members } = await publicClient
            .from('team_members')
            .select(`team_id, users (first_name, last_name, class_name)`)
            .in('team_id', teamIds)
            .eq('status', 'Accepted');

        if (members) {
            members.forEach(m => {
                if (!teamMembersMap[m.team_id]) teamMembersMap[m.team_id] = [];
                teamMembersMap[m.team_id].push(m.users);
            });
        }
    }
    
    populateSportFilter();
    updateStats();
    renderCards(allResults);
}

// --- 2. RENDER CARDS (CLEAN DESIGN) ---
function renderCards(data) {
    const grid = document.getElementById('results-grid');
    
    if (data.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-16 text-gray-400">
                <p>No results found.</p>
            </div>`;
        return;
    }

    // Sort priority: Gold > Silver > Bronze
    const sortedData = [...data].sort((a, b) => {
        const medals = { 'gold': 1, 'silver': 2, 'bronze': 3 };
        return (medals[a.medal] || 4) - (medals[b.medal] || 4);
    });

    grid.innerHTML = sortedData.map(r => {
        const isTeam = !!r.team_id;
        const winnerName = isTeam ? (r.teams?.name || 'Unknown Team') : r.student_name;
        const sportName = r.event_name || (r.teams_sport?.[0]?.sports?.name) || 'Unknown Sport';
        
        // Visual Config based on Medal
        let badgeClass = '';
        let borderClass = '';
        
        if (r.medal === 'gold') {
            badgeClass = 'bg-yellow-100 text-yellow-800 border-yellow-200';
            borderClass = 'border-l-4 border-l-yellow-400';
        } else if (r.medal === 'silver') {
            badgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
            borderClass = 'border-l-4 border-l-slate-400';
        } else {
            badgeClass = 'bg-orange-50 text-orange-800 border-orange-200';
            borderClass = 'border-l-4 border-l-orange-600';
        }

        // Squad Logic
        let squadHtml = '';
        if (isTeam && r.team_id && teamMembersMap[r.team_id]) {
            const players = teamMembersMap[r.team_id];
            squadHtml = `
                <div class="mt-4 pt-3 border-t border-gray-100">
                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Squad Members</p>
                    <div class="flex flex-wrap gap-2 max-h-32 overflow-y-auto custom-scrollbar">
                        ${players.map(p => `
                            <span class="inline-flex items-center px-2 py-1 rounded bg-gray-50 border border-gray-200 text-xs text-gray-600">
                                ${p.first_name} ${p.last_name} <span class="ml-1 text-gray-400 text-[10px]">(${p.class_name || ''})</span>
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (!isTeam) {
             squadHtml = `
                <div class="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
                    <span class="text-gray-400 font-bold uppercase">Class / Dept</span>
                    <span class="font-semibold text-gray-700">${r.class || 'N/A'}</span>
                </div>
            `;
        }

        return `
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 p-5 ${borderClass}">
            <div class="flex justify-between items-start mb-2">
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">${sportName}</span>
                    <h3 class="text-lg font-bold text-gray-900 leading-tight">${winnerName}</h3>
                </div>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${badgeClass}">
                    ${r.medal}
                </span>
            </div>
            
            <div class="flex items-center gap-3 text-xs text-gray-500 mb-2">
                <span class="bg-gray-100 px-2 py-1 rounded">${r.category || '-'}</span>
                <span class="bg-gray-100 px-2 py-1 rounded">${r.gender || '-'}</span>
            </div>

            ${squadHtml}
        </div>
        `;
    }).join('');
}

// --- 3. FILTER LOGIC ---
window.filterPublicResults = function() {
    const search = document.getElementById('public-search').value.toLowerCase();
    const sport = document.getElementById('filter-sport').value;
    const category = document.getElementById('filter-category').value;
    const gender = document.getElementById('filter-gender').value;
    const medal = document.getElementById('filter-medal').value;

    const filtered = allResults.filter(r => {
        const isTeam = !!r.team_id;
        const name = isTeam ? (r.teams?.name || '') : (r.student_name || '');
        const rSport = r.event_name || (r.teams_sport?.[0]?.sports?.name) || '';

        if (search && !name.toLowerCase().includes(search)) return false;
        if (sport && rSport !== sport) return false;
        if (category && r.category !== category) return false;
        if (gender && r.gender !== gender) return false;
        if (medal && r.medal !== medal) return false;

        return true;
    });

    renderCards(filtered);
}

// --- 4. UTILITIES ---
function populateSportFilter() {
    const sports = new Set();
    allResults.forEach(r => {
        const s = r.event_name || (r.teams_sport?.[0]?.sports?.name);
        if(s) sports.add(s);
    });
    const select = document.getElementById('filter-sport');
    select.innerHTML = '<option value="">All Sports</option>';
    Array.from(sports).sort().forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.innerText = s;
        select.appendChild(opt);
    });
}

function updateStats() {
    let counts = { gold: 0, silver: 0, bronze: 0 };
    allResults.forEach(r => { if(counts[r.medal] !== undefined) counts[r.medal]++; });
    
    // Simple update, no animations needed for professional view
    document.getElementById('count-gold').innerText = counts.gold;
    document.getElementById('count-silver').innerText = counts.silver;
    document.getElementById('count-bronze').innerText = counts.bronze;
}
