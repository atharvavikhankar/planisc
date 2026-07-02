import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const configRes = await fetch('/api/firebase-config');
const firebaseConfig = await configRes.json();

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
let currentUserUid = null;

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserUid = user.uid;
    }
});

function initPlanner() {
    // --- Form Submission / AI Streaming to JSON ---
    const form = document.getElementById('tripPlannerForm');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    
    const wizardQuestion = document.getElementById('wizardQuestion');
    const wizardSubtitle = document.getElementById('wizardSubtitle');
    const wizardOptions = document.getElementById('wizardOptions');
    const wizardBackBtn = document.getElementById('wizardBackBtn');
    const suggestedPrompts = document.getElementById('suggestedPrompts');

    const emptyState = document.getElementById('emptyState');
    const itineraryContent = document.getElementById('itineraryContent');
    const itineraryHeader = document.getElementById('itineraryHeader');
    const dayPillsContainer = document.getElementById('dayPillsContainer');

    let tripParams = {
        destination: null,
        specificCity: null,
        duration: null,
        budget: null,
        people: null,
        groupType: null
    };

    let currentQuestion = 'initial';
    let questionHistory = [];

    // --- Load Existing Trip Logic ---
    const urlParams = new URLSearchParams(window.location.search);
    const viewId = urlParams.get('id');
    const viewLocalId = urlParams.get('localId');

    if (viewId || viewLocalId) {
        document.getElementById('inputBoxContainer').style.display = 'none';
        wizardOptions.style.display = 'none';
        wizardQuestion.textContent = "Loading your itinerary...";
        wizardSubtitle.textContent = "Please wait.";
        
        async function loadTrip() {
            let loadedTrip = null;
            
            // Try Local Storage First
            try {
                const localTrips = JSON.parse(localStorage.getItem('planisc_trips') || '[]');
                if (viewId) {
                    // It might not have ID in localstorage if it was generated offline, but we check anyway
                    loadedTrip = localTrips.find(t => t.id === viewId || (t.id === undefined && viewLocalId)); 
                } 
                if (!loadedTrip && viewLocalId) {
                    const [dest, date] = viewLocalId.split('|');
                    loadedTrip = localTrips.find(t => t.destinations === dest && t.date === date);
                }
            } catch(e) {}

            // Try Firebase if not found or if we want the latest
            if (!loadedTrip && viewId) {
                try {
                    const docRef = doc(db, "trips", viewId);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        loadedTrip = docSnap.data();
                    }
                } catch(e) {
                    console.error("Failed to load from Firebase", e);
                }
            }

            if (loadedTrip) {
                emptyState.style.display = 'none';
                wizardQuestion.style.display = 'none';
                wizardSubtitle.style.display = 'none';
                if (suggestedPrompts) suggestedPrompts.style.display = 'none';
                renderItinerary(loadedTrip.itinerary, loadedTrip.destinations);
            } else {
                wizardQuestion.textContent = "Itinerary not found.";
                wizardSubtitle.textContent = "Please return to the dashboard.";
            }
        }
        
        loadTrip();
        return; // Stop initialization of the wizard
    }

    const statuses = [
        "PLANISC is planning your trip…",
        "Finding the best boutique hotels…",
        "Adding hidden culinary gems…",
        "Calculating costs for your budget…",
        "Designing the timeline…",
        "Adding the finishing touches…"
    ];

    // Suggested Pills Logic
    const suggestPills = document.querySelectorAll('.suggest-pill');
    suggestPills.forEach(pill => {
        pill.addEventListener('click', () => {
            chatInput.value = pill.textContent.trim();
        });
    });

    // Enter key to submit
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.dispatchEvent(new Event('submit'));
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inputVal = chatInput.value.trim();
        if (!inputVal) return;

        chatInput.value = '';
        chatInput.disabled = true;
        
        // Show small loading state in button
        const originalBtnContent = sendBtn.innerHTML;
        sendBtn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px;border-top-color:#fff;border-color:rgba(255,255,255,0.3);margin:auto;"></div>';
        
        try {
            if (currentQuestion === 'initial') {
                await extractInitialParams(inputVal);
            } else {
                handleAnswer(inputVal);
            }
            evaluateNextStep();
        } catch (err) {
            console.error(err);
            wizardSubtitle.textContent = "Something went wrong. Please try again.";
        } finally {
            chatInput.disabled = false;
            sendBtn.innerHTML = originalBtnContent;
            chatInput.focus();
        }
    });

    async function extractInitialParams(prompt) {
        const sys = `Extract travel parameters from the user's request. Output ONLY valid JSON, no markdown. If a parameter is not mentioned, set it to null.
{
  "destination": "Country or main region (string or null)",
  "specificCity": "Specific city if mentioned (string or null)",
  "duration": "Number of days (number or null)",
  "budget": "Budget amount (string or null)",
  "people": "Number of people (number or null)",
  "groupType": "solo, partner, friends, family, backpacker (string or null)"
}`;
        try {
            const res = await fetch('/api/generate-trip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    prompt: prompt, 
                    systemPrompt: sys, 
                    max_tokens: 250, 
                    model: "llama-3.1-8b-instant" 
                })
            });
            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let fullText = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                for (let line of lines) {
                    if (line.trim().startsWith('data: ') && line.trim() !== 'data: [DONE]') {
                        try {
                            const data = JSON.parse(line.slice(5).trim());
                            if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
                                fullText += data.choices[0].delta.content;
                            }
                        } catch(e) {}
                    }
                }
            }
            
            let jsonStr = fullText.replace(/```json/g, '').replace(/```/g, '').trim();
            const start = jsonStr.indexOf('{');
            const end = jsonStr.lastIndexOf('}');
            const extracted = JSON.parse(jsonStr.substring(start, end + 1));
            
            if (extracted.destination) tripParams.destination = extracted.destination;
            if (extracted.specificCity) tripParams.specificCity = extracted.specificCity;
            if (extracted.duration) tripParams.duration = extracted.duration;
            if (extracted.budget) tripParams.budget = extracted.budget;
            if (extracted.people) tripParams.people = extracted.people;
            if (extracted.groupType) tripParams.groupType = extracted.groupType;
        } catch(e) {
            console.error("Extraction failed, falling back.", e);
            tripParams.destination = prompt;
        }
    }

    // Back Button Logic
    wizardBackBtn.addEventListener('click', () => {
        if (questionHistory.length === 0) return;
        const prevState = questionHistory.pop();
        tripParams = prevState.params;
        currentQuestion = prevState.question;
        evaluateNextStep(true); // pass true to indicate it's a back navigation
    });

    function evaluateNextStep(isBack = false) {
        if (suggestedPrompts) suggestedPrompts.style.display = 'none';
        wizardOptions.style.display = 'flex';
        wizardOptions.innerHTML = '';
        wizardQuestion.style.display = 'block';
        wizardSubtitle.style.display = 'block';
        chatInput.placeholder = "Type your answer...";
        
        wizardBackBtn.style.display = questionHistory.length > 0 ? 'inline-flex' : 'none';
        
        if (!isBack && currentQuestion !== 'generating' && currentQuestion !== 'initial') {
            questionHistory.push({
                question: currentQuestion,
                params: JSON.parse(JSON.stringify(tripParams)) // Deep clone state
            });
        }
        
        if (!tripParams.destination) {
            currentQuestion = 'destination';
            wizardQuestion.textContent = "Where do you want to go?";
            wizardSubtitle.textContent = "Enter a country or region.";
            return;
        }
        if (!tripParams.specificCity) {
            currentQuestion = 'city';
            wizardQuestion.textContent = `Any specific city in ${tripParams.destination}?`;
            wizardSubtitle.textContent = "Or would you like to explore anywhere?";
            addOption("Explore Anywhere", () => { tripParams.specificCity = "Anywhere"; evaluateNextStep(); }, true);
            return;
        }
        if (!tripParams.duration) {
            currentQuestion = 'duration';
            wizardQuestion.textContent = "How many days?";
            wizardSubtitle.textContent = "Enter the number of days for your trip.";
            addOption("3 days", () => { tripParams.duration = 3; evaluateNextStep(); });
            addOption("5 days", () => { tripParams.duration = 5; evaluateNextStep(); });
            addOption("7 days", () => { tripParams.duration = 7; evaluateNextStep(); });
            return;
        }
        if (!tripParams.people) {
            currentQuestion = 'people';
            wizardQuestion.textContent = "How many people are traveling?";
            wizardSubtitle.textContent = "This helps calculate costs.";
            addOption("1 (Solo)", () => { tripParams.people = 1; tripParams.groupType = "solo"; evaluateNextStep(); });
            addOption("2 People", () => { tripParams.people = 2; evaluateNextStep(); });
            addOption("Family/Group", () => { tripParams.people = 4; evaluateNextStep(); });
            return;
        }
        if (!tripParams.groupType && tripParams.people > 1) {
            currentQuestion = 'group';
            wizardQuestion.textContent = "Who are you traveling with?";
            wizardSubtitle.textContent = "This shapes the itinerary vibe.";
            addOption("Partner", () => { tripParams.groupType = "partner"; evaluateNextStep(); });
            addOption("Friends", () => { tripParams.groupType = "friends"; evaluateNextStep(); });
            addOption("Family", () => { tripParams.groupType = "family"; evaluateNextStep(); });
            return;
        }
        if (!tripParams.budget) {
            currentQuestion = 'budget';
            wizardQuestion.textContent = "What is your budget?";
            wizardSubtitle.textContent = `For ${tripParams.people} people. (e.g. $2000)`;
            wizardBackBtn.style.display = questionHistory.length > 0 ? 'inline-flex' : 'none';
            addOption("Calculate Min Budget", () => { tripParams.budget = "Minimum possible budget"; evaluateNextStep(); }, true);
            addOption("Backpacker (Cheap)", () => { tripParams.budget = "Backpacker / Very Cheap"; tripParams.groupType = "backpacker"; evaluateNextStep(); });
            addOption("Luxury", () => { tripParams.budget = "Luxury / High End"; evaluateNextStep(); });
            return;
        }
        
        // ALL SET!
        currentQuestion = 'generating';
        wizardQuestion.textContent = "Crafting your itinerary...";
        wizardSubtitle.textContent = "";
        wizardOptions.style.display = 'none';
        wizardBackBtn.style.display = 'none';
        document.getElementById('inputBoxContainer').style.display = 'none'; // hide chat input
        
        generateFinalItinerary();
    }

    function handleAnswer(val) {
        if (currentQuestion === 'destination') tripParams.destination = val;
        else if (currentQuestion === 'city') tripParams.specificCity = val;
        else if (currentQuestion === 'duration') tripParams.duration = parseInt(val) || val;
        else if (currentQuestion === 'people') tripParams.people = parseInt(val) || 1;
        else if (currentQuestion === 'group') tripParams.groupType = val;
        else if (currentQuestion === 'budget') tripParams.budget = val;
    }

    function addOption(text, callback, isPrimary = false) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wizard-option-btn ' + (isPrimary ? 'primary' : '');
        btn.textContent = text;
        btn.addEventListener('click', callback);
        wizardOptions.appendChild(btn);
    }

    // --- Core Generation Engine ---
    async function generateFinalItinerary() {
        emptyState.style.display = 'none';
        itineraryContent.innerHTML = `
            <div class="itinerary-loading">
                <div class="spinner"></div>
                <h3 id="loadingTitle">Designing your journey</h3>
                <p id="loadingDesc">Calculating costs for ${tripParams.people} people...</p>
            </div>
        `;
        itineraryHeader.style.display = 'none';
        
        let statusIdx = 0;
        const statusInterval = setInterval(() => {
            statusIdx = (statusIdx + 1) % statuses.length;
            const loadTitle = document.getElementById('loadingTitle');
            if (loadTitle) loadTitle.textContent = statuses[statusIdx];
        }, 3000);

        const sysPrompt = `You are a premium, world-class travel agent API. Do not output any conversational text. You only output a raw JSON array.
Format required:
[
  {
    "day": 1,
    "events": [
      {
        "time": "09:00",
        "title": "Hotel Check-in",
        "location": "Rome City Center",
        "cost": "$150",
        "type": "hotel", 
        "description": "Drop your bags and relax."
      }
    ]
  }
]
Valid types: "hotel", "transport", "meal", "activity". 
CRITICAL INSTRUCTIONS:
1. Each day MUST contain at least 6 distinct events.
2. The VERY FIRST event on Day 1 MUST be "Arrival". DO NOT estimate or include flight ticket prices in the cost, focus strictly on ground costs!
3. The VERY LAST event on the final day MUST be "Departure".
4. Base all costs, activities, and logic strictly on ${tripParams.people} people.
5. You MUST mathematically align costs with the exact budget. If the budget is low, find cheap hostels and street food. Do not suggest $200 hotels if the budget is tight!
6. Target total cost MUST match: ${tripParams.budget}.
7. Do NOT wrap in markdown \`\`\`json.`;

        const preferredCurrency = localStorage.getItem('preferred_currency') || 'USD';
        const fullPrompt = `Destination: ${tripParams.destination} (${tripParams.specificCity})
Duration: ${tripParams.duration} days
People: ${tripParams.people} (${tripParams.groupType})
Budget: ${tripParams.budget}

Create an ultra-premium, deeply detailed itinerary based exactly on these parameters. 
This must be a masterpiece itinerary. Include hidden gems, iconic landmarks, and top-tier dining.
CRITICAL: All prices and costs MUST be strictly formatted in this exact currency: ${preferredCurrency}. Example if INR: ₹1000, if USD: $50.
OUTPUT ONLY A STRICT JSON ARRAY STARTING WITH [ AND ENDING WITH ].`;

        let fullText = '';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000);

        try {
            const response = await fetch('/api/generate-trip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: fullPrompt, systemPrompt: sysPrompt }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error('Failed to generate');

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const decoded = decoder.decode(value, { stream: true });
                buffer += decoded;
                const lines = buffer.split('\n');
                buffer = lines.pop();
                
                for (let line of lines) {
                    line = line.trim();
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const data = JSON.parse(line.slice(5).trim());
                            if (data.choices && data.choices[0] && data.choices[0].delta) {
                                const delta = data.choices[0].delta;
                                if (typeof delta.content === 'string') {
                                    fullText += delta.content;
                                }
                            }
                        } catch(e) {}
                    }
                }
            }
            
            let jsonText = fullText.trim();
            const firstBracket = jsonText.indexOf('[');
            if (firstBracket !== -1) {
                jsonText = jsonText.substring(firstBracket);
            }
            
            const lastBracket = jsonText.lastIndexOf(']');
            if (lastBracket !== -1 && jsonText.length - lastBracket < 50) {
                jsonText = jsonText.substring(0, lastBracket + 1);
            }
            
            let itineraryData;
            try {
                itineraryData = JSON.parse(jsonText);
            } catch (parseError) {
                let repairedText = jsonText;
                const openQuotes = (repairedText.match(/"/g) || []).length;
                if (openQuotes % 2 !== 0) repairedText += '"';
                
                let openBrackets = (repairedText.match(/\[/g) || []).length;
                let closeBrackets = (repairedText.match(/\]/g) || []).length;
                let openBraces = (repairedText.match(/\{/g) || []).length;
                let closeBraces = (repairedText.match(/\}/g) || []).length;
                
                if (openBraces > closeBraces) repairedText += '}'.repeat(openBraces - closeBraces);
                if (openBrackets > closeBrackets) repairedText += ']'.repeat(openBrackets - closeBrackets);
                
                try {
                    itineraryData = JSON.parse(repairedText);
                } catch (secondParseError) {
                    throw new Error('AI produced invalid data format.');
                }
            }
            
            const destFallback = tripParams.specificCity === "Anywhere" ? tripParams.destination : tripParams.specificCity;
            const tripData = {
                destinations: destFallback,
                duration: tripParams.duration,
                date: new Date().toISOString(),
                budget: tripParams.budget,
                image: `https://source.unsplash.com/1600x900/?${encodeURIComponent(destFallback)}`,
                itinerary: itineraryData
            };
            tripData.userId = currentUserUid;
            
            // Always save to localStorage for robust offline/fallback support
            const existingTrips = JSON.parse(localStorage.getItem('planisc_trips') || '[]');
            existingTrips.push({ ...tripData });
            localStorage.setItem('planisc_trips', JSON.stringify(existingTrips));
            
            if (currentUserUid) {
                addDoc(collection(db, "trips"), tripData).then(() => {
                    console.log("Trip saved to Firestore");
                }).catch(e => {
                    console.error("Error saving trip to Firebase: ", e);
                    if (typeof window.showToast === 'function') {
                        window.showToast("Could not save to Cloud. Saved locally.", "warning");
                    }
                });
            } else {
                console.warn("User not logged in, trip saved only to localStorage");
            }

            renderItinerary(itineraryData, destFallback);

        } catch (error) {
            console.error('Generation Error:', error);
            const errorMsg = error.name === 'AbortError' ? 'The request took too long and timed out.' : error.message;
            itineraryContent.innerHTML = `<div style="padding: 40px; color: #334155;">
                <h3 style="color: #ef4444; margin-bottom: 16px;">Generation Failed</h3>
                <p>${errorMsg}</p>
            </div>`;
        } finally {
            clearInterval(statusInterval);
        }
    }

    // --- Render Logic ---
    function renderItinerary(data, dest) {
        itineraryHeader.style.display = 'block';
        document.getElementById('tripTitle').textContent = `Your Trip to ${dest}`;
        
        dayPillsContainer.innerHTML = '';
        data.forEach((dayObj, index) => {
            const btn = document.createElement('button');
            btn.className = `day-pill ${index === 0 ? 'active' : ''}`;
            btn.textContent = `Day ${dayObj.day}`;
            btn.addEventListener('click', () => {
                document.querySelectorAll('.day-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderEvents(dayObj.events);
            });
            dayPillsContainer.appendChild(btn);
        });

        if (data.length > 0) {
            renderEvents(data[0].events);
        }
    }

    function renderEvents(events) {
        itineraryContent.innerHTML = '';
        events.forEach(ev => {
            const el = document.createElement('div');
            el.className = 'timeline-event';
            el.innerHTML = `
                <div class="event-time">${ev.time}</div>
                <div class="event-dot dot-${(ev.type || 'activity').toLowerCase()}"></div>
                <div class="event-card">
                    <div class="event-card-top">
                        <div class="event-title">${ev.title}</div>
                        <div class="event-cost">${ev.cost}</div>
                    </div>
                    <div class="event-location">${ev.location}</div>
                </div>
            `;
            el.addEventListener('click', () => {
                openDrawer(ev.title, ev.type, ev.time, ev.location, ev.cost, ev.description);
            });
            itineraryContent.appendChild(el);
        });
    }

    // --- Drawer Logic ---
    const drawerOverlay = document.getElementById('drawerOverlay');
    const closeDrawerBtn = document.getElementById('closeDrawer');
    
    window.openDrawer = function(title, type, time, loc, cost, desc) {
        document.getElementById('drawerTitle').textContent = title;
        document.getElementById('drawerBadge').textContent = (type || 'ACTIVITY').toUpperCase();
        document.getElementById('drawerTime').textContent = time;
        document.getElementById('drawerLocation').textContent = loc;
        document.getElementById('drawerCost').textContent = cost;
        document.getElementById('drawerDesc').textContent = desc;
        drawerOverlay.classList.add('active');
    }

    closeDrawerBtn.addEventListener('click', () => {
        drawerOverlay.classList.remove('active');
    });

    drawerOverlay.addEventListener('click', (e) => {
        if (e.target === drawerOverlay) drawerOverlay.classList.remove('active');
    });

    // --- Premium Smooth Slow Scroll for Itinerary ---
    const plannerRight = document.querySelector('.planner-right');
    if (plannerRight) {
        let isScrolling = false;
        let currentScrollY = plannerRight.scrollTop;
        let targetScrollY = currentScrollY;
        
        // Keep target in sync if user uses scrollbar natively
        plannerRight.addEventListener('scroll', () => {
            if (!isScrolling) {
                currentScrollY = plannerRight.scrollTop;
                targetScrollY = currentScrollY;
            }
        });

        plannerRight.addEventListener('wheel', (e) => {
            // Only hijack vertical scroll
            if (e.deltaY !== 0) {
                e.preventDefault();
                
                // Slow down the scroll speed by 50%
                targetScrollY += e.deltaY * 0.5; 
                
                // Clamp within bounds
                const maxScroll = plannerRight.scrollHeight - plannerRight.clientHeight;
                targetScrollY = Math.max(0, Math.min(targetScrollY, maxScroll));
                
                if (!isScrolling) {
                    requestAnimationFrame(updateScroll);
                }
            }
        }, { passive: false });

        function updateScroll() {
            isScrolling = true;
            
            // Lerp interpolation (0.08 is extremely smooth and buttery)
            currentScrollY += (targetScrollY - currentScrollY) * 0.08; 
            plannerRight.scrollTop = currentScrollY;
            
            if (Math.abs(targetScrollY - currentScrollY) > 0.5) {
                requestAnimationFrame(updateScroll);
            } else {
                isScrolling = false;
                currentScrollY = targetScrollY;
                plannerRight.scrollTop = currentScrollY;
            }
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlanner);
} else {
    initPlanner();
}
