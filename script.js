/**
 * Train IVR System - Frontend JavaScript
 * Handles voice control, keypad input, and API integration
 */

const API_BASE_URL = "http://localhost:8000";

// Global state
let currentSessionId = null;
let callStartTime = null;
let callTimerInterval = null;
let recognition = null;
let isListening = false;
let callHistory = [];

// DOM elements
const startCallBtn = document.getElementById("startCall");
const endCallBtn = document.getElementById("endCall");
const micButton = document.getElementById("micButton");
const callTimer = document.getElementById("callTimer");
const callStatus = document.getElementById("callStatus");
const micStatus = document.getElementById("micStatus");
const ivrOutput = document.getElementById("ivrOutput");
const callHistoryDiv = document.getElementById("callHistory");
const clearHistoryBtn = document.getElementById("clearHistory");
const downloadTranscriptBtn = document.getElementById("downloadTranscript");
const keypadKeys = document.querySelectorAll(".key");

// Microphone permission state
let micPermissionGranted = false;
let micPermissionRequested = false;

// Initialize Web Speech API with persistent permission handling
function initSpeechRecognition() {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
        console.warn("Speech recognition not supported");
        return null;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;  // Set to false - user controls when to listen
    recognition.interimResults = false;  // Only final results
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        isListening = true;
        micStatus.textContent = "🎤 Listening...";
        micButton.classList.add("listening");
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        console.log("Speech recognized:", transcript);
        
        // IMMEDIATELY stop speech when user speaks (interrupt welcome/messages)
        if ("speechSynthesis" in window && (isSpeaking || speechQueue.length > 0)) {
            window.speechSynthesis.cancel();
            isSpeaking = false;
            speechQueue = [];
            console.log("Speech interrupted by user input");
        }
        
        addToOutput(`You said: "${transcript}"`, "user");
        processInput(transcript);
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        
        if (event.error === "not-allowed" || event.error === "denied") {
            micPermissionGranted = false;
            micStatus.textContent = "❌ Mic Permission Required";
            addToOutput("Microphone access is required for voice features. Please allow microphone access in your browser settings.", "system");
        } else if (event.error !== "no-speech") {
            micStatus.textContent = "";
            micButton.classList.remove("listening");
            isListening = false;
            addToOutput("Sorry, I couldn't understand that. Please try speaking again.", "system");
        }
        
        // Stop recognition on errors (except no-speech)
        if (event.error !== "no-speech") {
            recognition.stop();
        }
    };

    recognition.onend = () => {
        isListening = false;
        micStatus.textContent = "";
        micButton.classList.remove("listening");
        // Note: Continuous mode auto-restarts, but we'll let user control it
    };

    return recognition;
}

// Request microphone permission once
async function requestMicrophonePermission() {
    if (micPermissionRequested) {
        return micPermissionGranted;
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Permission granted
        stream.getTracks().forEach(track => track.stop()); // Stop the stream
        micPermissionGranted = true;
        micPermissionRequested = true;
        localStorage.setItem("micPermissionGranted", "true");
        console.log("Microphone permission granted");
        return true;
    } catch (error) {
        console.error("Microphone permission denied:", error);
        micPermissionGranted = false;
        micPermissionRequested = true;
        localStorage.setItem("micPermissionGranted", "false");
        return false;
    }
}

// Check stored permission
function checkStoredPermission() {
    const stored = localStorage.getItem("micPermissionGranted");
    if (stored === "true") {
        micPermissionGranted = true;
        micPermissionRequested = true;
    }
}

// Initialize speech recognition
checkStoredPermission();
initSpeechRecognition();

// Text-to-Speech function with better voice selection and queue management
let isSpeaking = false;
let speechQueue = [];

function speakText(text) {
    if (!text || text.trim() === "") return;
    
    if ("speechSynthesis" in window) {
        // Add to queue if already speaking
        if (isSpeaking) {
            speechQueue.push(text);
            return;
        }
        
        isSpeaking = true;
        
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Function to select best voice
        const selectBestVoice = (utterance, voices) => {
            // Try to find the best voice in order of preference
            const voicePreferences = [
                voice => voice.lang.startsWith('en') && (voice.name.includes('Natural') || voice.name.includes('Neural')),
                voice => voice.lang.startsWith('en') && voice.name.includes('Female'),
                voice => voice.lang.startsWith('en-US') && voice.name.includes('Zira'),
                voice => voice.lang.startsWith('en-US'),
                voice => voice.lang.startsWith('en')
            ];
            
            for (const preference of voicePreferences) {
                const selectedVoice = voices.find(preference);
                if (selectedVoice) {
                    utterance.voice = selectedVoice;
                    console.log("Selected voice:", selectedVoice.name);
                    return;
                }
            }
            
            // If still no voice selected, use first English voice
            const englishVoices = voices.filter(v => v.lang.startsWith('en'));
            if (englishVoices.length > 0) {
                utterance.voice = englishVoices[0];
                console.log("Using fallback voice:", englishVoices[0].name);
            }
        };
        
        // Get available voices (force reload)
        let voices = window.speechSynthesis.getVoices();
        
        // If no voices, wait a bit and try again
        if (voices.length === 0) {
            setTimeout(() => {
                voices = window.speechSynthesis.getVoices();
                if (voices.length > 0) {
                    selectBestVoice(utterance, voices);
                    utterance.rate = 0.92;
                    utterance.pitch = 1.0;
                    utterance.volume = 1;
                    window.speechSynthesis.speak(utterance);
                }
            }, 100);
            return; // Don't speak yet, will speak after voices load
        } else {
            selectBestVoice(utterance, voices);
            utterance.rate = 0.92;  // Slightly slower for clarity
            utterance.pitch = 1.0;
            utterance.volume = 1;
        }
        
        utterance.onend = () => {
            console.log("Speech synthesis completed:", text.substring(0, 50));
            isSpeaking = false;
            
            // Process next in queue
            if (speechQueue.length > 0) {
                const nextText = speechQueue.shift();
                setTimeout(() => speakText(nextText), 200);
            }
        };
        
        utterance.onerror = (event) => {
            console.error("Speech synthesis error:", event.error);
            isSpeaking = false;
            
            // Process next in queue even on error
            if (speechQueue.length > 0) {
                const nextText = speechQueue.shift();
                setTimeout(() => speakText(nextText), 200);
            }
        };
        
        window.speechSynthesis.speak(utterance);
    } else {
        console.warn("Speech synthesis not supported");
    }
}

// Load voices when available and ensure they're ready
if ("speechSynthesis" in window) {
    // Load voices immediately
    const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        console.log(`Loaded ${voices.length} voices`);
    };
    
    // Try loading voices immediately
    loadVoices();
    
    // Also listen for voice changes
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
    }
    
    // Fallback: load voices after a delay
    setTimeout(loadVoices, 1000);
}

// Start IVR call
startCallBtn.addEventListener("click", async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/api/ivr/start`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error("Failed to start call");
        }

        const data = await response.json();
        currentSessionId = data.session_id;
        callStartTime = new Date();

        // Update UI
        startCallBtn.disabled = true;
        endCallBtn.disabled = false;
        micButton.disabled = false;
        callStatus.textContent = "In Call";
        ivrOutput.innerHTML = "";

        // Start timer
        startTimer();

        // Add welcome message
        addToOutput(data.message, "system");
        
        // Speak the welcome message automatically
        // Use setTimeout to ensure text-to-speech works after page interaction
        setTimeout(() => {
            speakText(data.message);
        }, 100);

        // Log to history
        callHistory.push({
            type: "system",
            message: data.message,
            timestamp: new Date().toISOString()
        });

        updateHistoryDisplay();
    } catch (error) {
        console.error("Error starting call:", error);
        alert("Failed to start call. Make sure the backend server is running on http://localhost:8000");
    }
});

// End IVR call
endCallBtn.addEventListener("click", async () => {
    if (!currentSessionId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/ivr/end`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                session_id: currentSessionId
            })
        });

        if (response.ok) {
            const data = await response.json();
            addToOutput("Call ended. Thank you for using Train Enquiry System!", "system");
            
            // Save to localStorage
            saveCallToHistory(data.summary);
            
            downloadTranscriptBtn.disabled = false;
        }
    } catch (error) {
        console.error("Error ending call:", error);
    } finally {
        // Stop speech recognition
        if (recognition && isListening) {
            recognition.stop();
        }
        
        // Stop speech synthesis
        if ("speechSynthesis" in window) {
            window.speechSynthesis.cancel();
        }

        // Reset UI
        currentSessionId = null;
        callStartTime = null;
        stopTimer();
        startCallBtn.disabled = false;
        endCallBtn.disabled = true;
        micButton.disabled = true;
        callStatus.textContent = "Ready";
        micStatus.textContent = "";
    }
});

// Microphone button with permission handling
micButton.addEventListener("click", async () => {
    if (!currentSessionId || !recognition) {
        addToOutput("Please start a call first.", "system");
        return;
    }

    // Request permission if not already granted
    if (!micPermissionGranted) {
        const granted = await requestMicrophonePermission();
        if (!granted) {
            addToOutput("Microphone permission is required for voice features. Please allow access and try again.", "system");
            return;
        }
    }

    if (isListening) {
        recognition.stop();
        micStatus.textContent = "🎤 Tap to Speak";
    } else {
        try {
            recognition.start();
        } catch (error) {
            console.error("Error starting recognition:", error);
            if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
                micPermissionGranted = false;
                localStorage.setItem("micPermissionGranted", "false");
                addToOutput("Microphone permission denied. Please allow microphone access in your browser settings.", "system");
            }
        }
    }
});

// Keypad input - also interrupts speech
keypadKeys.forEach(key => {
    key.addEventListener("click", () => {
        if (!currentSessionId) {
            addToOutput("Please start a call first.", "system");
            return;
        }

        // IMMEDIATELY stop speech when keypad is pressed
        if ("speechSynthesis" in window && (isSpeaking || speechQueue.length > 0)) {
            window.speechSynthesis.cancel();
            isSpeaking = false;
            speechQueue = [];
        }

        const keyValue = key.dataset.key;
        addToOutput(`Pressed: ${keyValue}`, "user");
        processInput(keyValue);
    });
});

// Process user input (keypad or speech)
async function processInput(input) {
    if (!currentSessionId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/ivr/input`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                session_id: currentSessionId,
                input: input
            })
        });

        if (!response.ok) {
            throw new Error("Failed to process input");
        }

        const data = await response.json();
        
        // Display system response
        if (data.message) {
            addToOutput(data.message, "system");
            
            // Automatically speak ALL responses
            // Wait a bit for previous speech to finish
            setTimeout(() => {
                speakText(data.message);
            }, 300);
            
            // Log to history
            callHistory.push({
                type: "system",
                message: data.message,
                timestamp: new Date().toISOString()
            });
        }

        // Check if call ended
        if (data.is_end) {
            setTimeout(() => {
                endCallBtn.click();
            }, 2000);
        }

        updateHistoryDisplay();
    } catch (error) {
        console.error("Error processing input:", error);
        addToOutput("Error processing your input. Please try again.", "system");
    }
}

// Add message to output display
function addToOutput(message, type) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    const prefix = type === "user" ? "👤 You:" : "🤖 System:";
    
    messageDiv.innerHTML = `
        <span class="message-prefix">${prefix}</span>
        <span class="message-text">${message}</span>
        <span class="message-time">${timestamp}</span>
    `;
    
    ivrOutput.appendChild(messageDiv);
    ivrOutput.scrollTop = ivrOutput.scrollHeight;
}

// Timer functions
function startTimer() {
    callTimerInterval = setInterval(() => {
        if (callStartTime) {
            const elapsed = Math.floor((new Date() - callStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60).toString().padStart(2, "0");
            const seconds = (elapsed % 60).toString().padStart(2, "0");
            callTimer.textContent = `${minutes}:${seconds}`;
        }
    }, 1000);
}

function stopTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    callTimer.textContent = "00:00";
}

// History management
function updateHistoryDisplay() {
    callHistoryDiv.innerHTML = "";
    
    if (callHistory.length === 0) {
        callHistoryDiv.innerHTML = "<p class='no-history'>No call history yet.</p>";
        return;
    }

    callHistory.forEach((entry, index) => {
        const historyItem = document.createElement("div");
        historyItem.className = `history-item ${entry.type}`;
        
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const prefix = entry.type === "user" ? "👤" : "🤖";
        
        historyItem.innerHTML = `
            <span class="history-prefix">${prefix}</span>
            <span class="history-message">${entry.message}</span>
            <span class="history-time">${time}</span>
        `;
        
        callHistoryDiv.appendChild(historyItem);
    });

    callHistoryDiv.scrollTop = callHistoryDiv.scrollHeight;
}

function saveCallToHistory(summary) {
    try {
        const savedCalls = JSON.parse(localStorage.getItem("ivr_call_history") || "[]");
        savedCalls.push(summary);
        localStorage.setItem("ivr_call_history", JSON.stringify(savedCalls));
    } catch (error) {
        console.error("Error saving call history:", error);
    }
}

clearHistoryBtn.addEventListener("click", () => {
    if (confirm("Clear all call history?")) {
        callHistory = [];
        localStorage.removeItem("ivr_call_history");
        updateHistoryDisplay();
    }
});

downloadTranscriptBtn.addEventListener("click", () => {
    if (callHistory.length === 0) return;

    const transcript = callHistory.map(entry => {
        const time = new Date(entry.timestamp).toLocaleString();
        const role = entry.type === "user" ? "User" : "System";
        return `[${time}] ${role}: ${entry.message}`;
    }).join("\n\n");

    const blob = new Blob([transcript], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ivr_transcript_${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// Keyboard support for keypad
document.addEventListener("keydown", (e) => {
    if (!currentSessionId) return;

    const keyMap = {
        "1": "1", "2": "2", "3": "3", "4": "4", "5": "5",
        "6": "6", "7": "7", "8": "8", "9": "9", "0": "0",
        "*": "*", "#": "#"
    };

    if (keyMap[e.key]) {
        const keyButton = document.querySelector(`.key[data-key="${keyMap[e.key]}"]`);
        if (keyButton) {
            keyButton.click();
        }
    }
});

// Initialize on page load
window.addEventListener("load", () => {
    console.log("Train IVR System initialized");
    console.log(`Backend API: ${API_BASE_URL}`);
    
    // Check if backend is accessible
    fetch(`${API_BASE_URL}/`)
        .then(response => response.json())
        .then(data => {
            console.log("Backend connected:", data);
            callStatus.textContent = "Ready (Connected)";
        })
        .catch(error => {
            console.error("Backend not accessible:", error);
            callStatus.textContent = "Ready (Backend Offline)";
            callStatus.style.color = "#ff4444";
        });
});

