// ==========================================
// URJA 2026 - PUBLIC RESULTS ENGINE
// ==========================================

// Initialize Client (Using Config from header)
const publicClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

let allResults = [];

document.addEventListener('DOMContentLoaded', () => {
    if(window.lucide) lucide.createIcons();
    fetchAndRenderResults();
});

// --- 1. FETCH DATA ---
async function fetchAndRenderResults() {
    const grid = document.getElementById('results-grid');
    
    // Fetch Results joined with Teams to get Team Name if applicable
    const { data: results, error } = await publicClient
        .from('results')
        .select(`
            *,
            teams (name, sport_id),
            teams_sport:teams(sports(name))
        `)
        .order('rank', { ascending: true }) // Rank 1 first
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching results:", error);
        grid.innerHTML = `<div class="col-span-full text-center py-10 text-red-400 font-bold">Failed to load results. Please try again later.</div>`;
        return;
    }

    allResults = results || [];
    
    // Populate Sport Filter
    populateSportFilter();
    
    // Calculate Stats
    updateStats();

    // Initial Render
    renderCards(allResults);
}

// --- 2. RENDER LOGIC ---
function renderCards(data) {
    const grid = document.getElementById('results-grid');
    
    if (data.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-16 text-gray-400">
                <i data-lucide="clipboard-x" class="w-12 h-12 mb-4 opacity-50"></i>
                <p class="font-bold">No results found matching your filters.</p>
            </div>`;
        if(window.lucide) lucide.createIcons();
        return;
    }

    grid.innerHTML = data.map((r, index) => {
        // Determine Display Data
        const isTeam = !!r.team_id;
        const winnerName = isTeam ? (r.teams?.name || 'Unknown Team') : r.student_name;
        
        // Fallback logic for Sport Name
        const sportName = r.event_name || (r.teams_sport?.[0]?.sports?.name) || 'Unknown Sport';
        
        // Styles based on Medal
        let medalGradient = '';
        let medalIcon = '';
        let glowClass = '';

        if (r.medal === 'gold') {
            medalGradient = 'bg-gradient-to-br from-yellow-300 to-yellow-600 text-white';
            medalIcon = 'award';
            glowClass = 'shadow-yellow-200';
        } else if (r.medal === 'silver') {
            medalGradient = 'bg-gradient-to-br from-gray-300 to-gray-500 text-white';
            medalIcon = 'medal';
            glowClass = 'shadow-gray-200';
        } else if (r.medal === 'bronze') {
            medalGradient = 'bg-gradient-to-br from-orange-300 to-orange-600 text-white';
            medalIcon = 'shield';
            glowClass = 'shadow-orange-200';
        } else {
            medalGradient = 'bg-gray-100 text-gray-500';
            medalIcon = 'trophy';
        }

        // Animation delay for staggered load
        const delay = Math.min(index * 100, 1000); 

        return `
        <div class="bg-white rounded-3xl p-6 shadow-xl ${glowClass} border border-gray-100 relative overflow-hidden group hover:-translate-y-1 transition-transform duration-300 animate-fade-in-up" style="animation-delay: ${delay}ms">
            
            <div class="absolute -right-6 -top-6 w-24 h-24 bg-gray-50 rounded-full group-hover:bg-gray-100 transition-colors"></div>
            
            <div class="relative z-10">
                <div class="flex justify-between items-start mb-4">
                    <div class="${medalGradient} shadow-lg w-12 h-12 rounded-2xl flex items-center justify-center transform rotate-3 group-hover:rotate-6 transition-transform">
                        <i data-lucide="${medalIcon}" class="w-6 h-6"></i>
                    </div>
                    
                    <div class="text-right">
                        <span class="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1">Rank</span>
                        <span class="text-2xl font-black text-gray-900 leading-none">#${r.rank}</span>
                    </div>
                </div>

                <h3 class="text-xl font-black text-gray-900 mb-1 truncate" title="${winnerName}">${winnerName}</h3>
                <p class="text-sm font-bold text-brand-primary mb-4 flex items-center gap-2">
                    <i data-lucide="${isTeam ? 'users' : 'user'}" class="w-3 h-3"></i>
                    ${isTeam ? 'Winning Team' : 'Individual Winner'}
                </p>

                <div class="grid grid-cols-2 gap-2 text-xs">
                    <div class="bg-gray-50 rounded-xl p-2 border border-gray-100">
                        <p class="text-[10px] uppercase font-bold text-gray-400">Sport</p>
                        <p class="font-bold text-gray-700 truncate">${sportName}</p>
                    </div>
                    <div class="bg-gray-50 rounded-xl p-2 border border-gray-100">
                        <p class="text-[10px] uppercase font-bold text-gray-400">Category</p>
                        <p class="font-bold text-gray-700">${r.category || '-'}</p>
                    </div>
                    <div class="bg-gray-50 rounded-xl p-2 border border-gray-100">
                        <p class="text-[10px] uppercase font-bold text-gray-400">Gender</p>
                        <p class="font-bold text-gray-700">${r.gender || '-'}</p>
                    </div>
                    <div class="bg-gray-50 rounded-xl p-2 border border-gray-100">
                         <p class="text-[10px] uppercase font-bold text-gray-400">Class/Dept</p>
                        <p class="font-bold text-gray-700">${r.class || '-'}</p>
                    </div>
                </div>
            </div>
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
        // Name Search
        const isTeam = !!r.team_id;
        const name = isTeam ? (r.teams?.name || '') : (r.student_name || '');
        if (search && !name.toLowerCase().includes(search)) return false;

        // Sport Filter
        const rSport = r.event_name || (r.teams_sport?.[0]?.sports?.name) || '';
        if (sport && rSport !== sport) return false;

        // Other Filters
        if (category && r.category !== category) return false;
        if (gender && r.gender !== gender) return false;
        if (medal && r.medal !== medal) return false;

        return true;
    });

    renderCards(filtered);
}

// --- 4. UTILITIES ---
function populateSportFilter() {
    // Extract unique sport names
    const sports = new Set();
    allResults.forEach(r => {
        const s = r.event_name || (r.teams_sport?.[0]?.sports?.name);
        if(s) sports.add(s);
    });

    const select = document.getElementById('filter-sport');
    // Keep first option (All Sports)
    select.innerHTML = '<option value="">All Sports</option>';
    
    Array.from(sports).sort().forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.innerText = s;
        select.appendChild(opt);
    });
}

function updateStats() {
    let gold = 0, silver = 0, bronze = 0;
    
    allResults.forEach(r => {
        if(r.medal === 'gold') gold++;
        if(r.medal === 'silver') silver++;
        if(r.medal === 'bronze') bronze++;
    });

    // Animate Numbers
    animateValue("count-gold", 0, gold, 1000);
    animateValue("count-silver", 0, silver, 1000);
    animateValue("count-bronze", 0, bronze, 1000);
    animateValue("count-total", 0, allResults.length, 1000);
}

function animateValue(id, start, end, duration) {
    const obj = document.getElementById(id);
    if(!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}
