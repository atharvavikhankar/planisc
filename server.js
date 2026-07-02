require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files from the current directory, auto-resolving .html extensions
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

app.get('/api/firebase-config', (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
    });
});

// Simple in-memory cache to simulate Redis
const weatherCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

app.post('/api/generate-trip', async (req, res) => {
    const { prompt, systemPrompt, max_tokens, model } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    try {
        // Set headers for SSE (Server-Sent Events) to stream the response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const fetch = (await import('node-fetch')).default;

        let response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: model || "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: systemPrompt || "You are a professional travel agent." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.7,
                max_tokens: max_tokens || 8000,
                stream: true
            })
        });

        if (!response.ok && response.status === 429) {
            console.log("Rate limit reached for primary model. Auto-falling back to llama-3.1-8b-instant...");
            response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
                },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [
                        { role: "system", content: systemPrompt || "You are a professional travel agent." },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 3500,
                    stream: true
                })
            });
        }

        if (!response.ok) {
            console.error(`API Error: ${response.status} ${response.statusText}`);
            return res.status(response.status).json({ error: `Groq API Error: ${response.statusText}` });
        }

        // Forward the stream
        response.body.on('data', chunk => {
            res.write(chunk);
        });

        response.body.on('end', () => {
            res.end();
        });

    } catch (error) {
        console.error('Server error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        } else {
            res.end();
        }
    }
});

app.get('/api/weather', async (req, res) => {
    const { city } = req.query;
    if (!city) return res.status(400).json({ error: 'City is required' });

    // Check Cache
    const cacheKey = `weather:${city.toLowerCase()}`;
    const cached = weatherCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return res.json(cached.data);
    }

    try {
        const fetch = (await import('node-fetch')).default;

        // 1. Geocode City to Lat/Lng
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&format=json`);
        const geoData = await geoRes.json();
        
        if (!geoData.results || geoData.results.length === 0) {
            return res.status(404).json({ error: 'City not found' });
        }
        
        const lat = geoData.results[0].latitude;
        const lng = geoData.results[0].longitude;

        // 2. Fetch Weather
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,precipitation,weathercode&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation&forecast_days=2`;
        const weatherRes = await fetch(weatherUrl);
        const weatherData = await weatherRes.json();

        const current = weatherData.current;
        
        // 3. Disruption Logic
        let disruption = null;
        const code = current.weathercode;
        const temp = current.temperature_2m;
        const wind = current.wind_speed_10m;
        const precip = current.precipitation;

        if (code >= 80 && code <= 99) {
            disruption = { type: 'storm', severity: 'high', description: 'Storms expected' };
        } else if ((code >= 51 && code <= 67) || precip > 3) {
            disruption = { type: 'rain', severity: (precip > 10 ? 'high' : 'moderate'), description: 'Heavy rain expected' };
        } else if (temp > 38) {
            disruption = { type: 'extreme_heat', severity: 'high', description: 'Extreme heat expected' };
        } else if (temp < 0) {
            disruption = { type: 'extreme_cold', severity: 'moderate', description: 'Freezing temperatures' };
        } else if (wind > 60) {
            disruption = { type: 'high_wind', severity: 'high', description: 'High winds expected' };
        }

        const result = {
            city: geoData.results[0].name,
            current: current,
            hourly: weatherData.hourly,
            disruption: disruption
        };

        // Save to cache
        weatherCache.set(cacheKey, { data: result, timestamp: Date.now() });

        res.json(result);
    } catch (error) {
        console.error('Weather API Error:', error);
        res.status(500).json({ error: 'Failed to fetch weather data' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
