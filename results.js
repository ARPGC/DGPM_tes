// ==========================================
// URJA 2026 - PUBLIC RESULTS ENGINE
// ==========================================

const publicClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

let allResults = [];
let teamMembersMap = {}; // Cache for team members

document.addEventListener('DOMContentLoaded', () => {
    if(window.lucide) lucide.createIcons();
    fetchAndRenderResults();
});

// --- 1. FETCH DATA (Results + Full Squads) ---
async function fetchAndRenderResults() {
    const grid = document.getElementById('results-grid');
    
    // 1. Fetch Results
    const { data: results, error } = await publicClient
        .from('results')
        .select(`
            *,
            teams (id, name, sport_id),
            teams_sport:teams(sports(name))
        `)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching results:", error);
        grid.innerHTML = `<div class="col-span-full text-center py-10 text-red-400 font-bold bg-red-900/20 rounded-xl border border-red-900/50">Unable to load results. Please check your connection.</div>`;
        return;
    }

    allResults = results || [];

    // 2. Identify Team Results to fetch squads
    const teamIds = allResults
        .filter(r => r.team_id) // Only results with a team
        .map(r => r.team_id);

    // 3. Fetch Squad Members if needed
    if (teamIds.length > 0) {
        const { data: members, error: memError } = await publicClient
            .from('team_members')
            .select(`
                team_id,
                users (first_name, last_name, class_name)
            `)
            .in('team_id', teamIds)
            .eq('status', 'Accepted');

        if (!memError && members) {
            // Group members by team_id
            members.forEach(m => {
                if (!teamMembersMap[m.team_id]) {
                    teamMembersMap[m.team_id] = [];
                }
                teamMembersMap[m.team_id].push(m.users);
            });
        }
    }
    
    // 4. Setup UI
    populateSportFilter();
    updateStats();
    renderCards(allResults);
}

// --- 2. RENDER CARDS ---
function renderCards(data) {
    const grid = document.getElementById('results-grid');
    
    if (data.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-20 text-gray-600">
                <i data-lucide="search-x" class="w-16 h-16 mb-4 opacity-50"></i>
                <p class="font-bold text-lg">No champions found for these filters.</p>
            </div>`;
        if(window.lucide) lucide.createIcons();
        return;
    }

    // Sort: Gold -> Silver -> Bronze
    const sortedData = [...data].sort((a, b) => {
        const medals = { 'gold': 1, 'silver': 2, 'bronze': 3 };
        return (medals[a.medal] || 4) - (medals[b.medal] || 4);
    });

    grid.innerHTML = sortedData.map((r, index) => {
        const isTeam = !!r.team_id;
        const winnerName = isTeam ? (r.teams?.name || 'Unknown Team') : r.student_name;
        const sportName = r.event_name || (r.teams_sport?.[0]?.sports?.name) || 'Unknown Sport';
        
        // Dynamic Styles
        let borderClass, textClass, bgGradient, icon;
        
        if (r.medal === 'gold') {
            borderClass = 'border-yellow-500';
            textClass = 'text-yellow-400';
            bgGradient = 'from-yellow-500/10 to-transparent';
            icon = 'crown';
        } else if (r.medal === 'silver') {
            borderClass = 'border-gray-400';
            textClass = 'text-gray-300';
            bgGradient = 'from-gray-500/10 to-transparent';
            icon = 'medal';
        } else {
            borderClass = 'border-orange-700';
            textClass = 'text-orange-500';
            bgGradient = 'from-orange-700/10 to-transparent';
            icon = 'shield';
        }

        // Squad List HTML
        let squadHtml = '';
        if (isTeam && r.team_id && teamMembersMap[r.team_id]) {
            const players = teamMembersMap[r.team_id];
            squadHtml = `
                <div class="mt-4 pt-4 border-t border-gray-700/50">
                    <p class="text-[10px] uppercase font-bold text-gray-500 mb-2">Championship Squad</p>
                    <div class="squad-list max-h-32 overflow-y-auto space-y-1 pr-2">
                        ${players.map(p => `
                            <div class="flex justify-between text-xs text-gray-300 bg-gray-800/50 px-2 py-1.5 rounded">
                                <span>${p.first_name} ${p.last_name}</span>
                                <span class="text-gray-500 font-mono">${p.class_name || ''}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (!isTeam) {
             squadHtml = `
                <div class="mt-4 pt-4 border-t border-gray-700/50 flex justify-between items-center">
                    <span class="text-xs text-gray-500 font-bold uppercase">Class / Dept</span>
                    <span class="text-sm font-mono text-gray-300 bg-gray-800 px-2 py-1 rounded">${r.class || 'N/A'}</span>
                </div>
            `;
        }

        return `
        <div class="glass rounded-2xl p-0 overflow-hidden relative group hover:scale-[1.02] transition-transform duration-300 animate-slide-up" style="animation-delay: ${Math.min(index * 100, 1000)}ms">
            <div class="h-2 w-full bg-${r.medal === 'gold' ? 'yellow-500' : r.medal === 'silver' ? 'gray-400' : 'orange-700'}"></div>
            
            <div class="p-6 bg-gradient-to-b ${bgGradient}">
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            ${sportName}
                        </span>
                        <div class="mt-2 text-xs font-bold text-gray-500 uppercase tracking-widest">${r.category || '-'} • ${r.gender || '-'}</div>
                    </div>
                    <div class="${textClass} transform group-hover:rotate-12 transition-transform duration-500">
                        <i data-lucide="${icon}" class="w-8 h-8"></i>
                    </div>
                </div>

                <h3 class="text-2xl font-black text-white leading-tight mb-1 truncate" title="${winnerName}">${winnerName}</h3>
                <p class="text-sm font-medium ${textClass} opacity-80 uppercase tracking-wide mb-2">
                    ${r.medal} Medalist
                </p>

                ${squadHtml}
            </div>
            
            <i data-lucide="trophy" class="absolute -bottom-6 -right-6 w-32 h-32 text-white opacity-[0.03] group-hover:scale-110 transition-transform"></i>
        </div>
        `;
    }).join('');

    if(window.lucide) lucide.createIcons();
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
        
        if (search && !name.toLowerCase().includes(search)) return false;
        
        // Normalize Sport Name Check
        const rSport = r.event_name || (r.teams_sport?.[0]?.sports?.name) || '';
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
    allResults.forEach(r => {
        if(counts[r.medal] !== undefined) counts[r.medal]++;
    });

    animateValue("count-gold", counts.gold);
    animateValue("count-silver", counts.silver);
    animateValue("count-bronze", counts.bronze);
}

function animateValue(id, end) {
    const obj = document.getElementById(id);
    if(!obj) return;
    const duration = 1500;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * end);
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}
