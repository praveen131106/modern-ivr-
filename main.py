"""
FastAPI Backend for Conversational IVR Train Enquiry System

This module implements a complete IVR system backend with:
- RESTful API for IVR operations
- Session management
- Flow-based navigation system
- Natural language processing integration
- Dynamic response generation

Author: Praveen
Project: Conversational IVR Modernization
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any
import uuid
import json
from datetime import datetime
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from utils.flow_manager import FlowManager

app = FastAPI(title="Train IVR System", version="1.0.0")

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session storage
sessions: Dict[str, Dict[str, Any]] = {}
# Initialize flow manager - will auto-load all flows
flow_manager = FlowManager()

# Force reload flows on startup to ensure latest changes
def reload_flows():
    """Force reload flows from disk"""
    flow_manager.reload_flows()


# Pydantic models for request/response
class IVRStartRequest(BaseModel):
    pass


class IVRInputRequest(BaseModel):
    session_id: str
    input: str  # Can be keypad key (0-9, *, #) or speech text


class IVREndRequest(BaseModel):
    session_id: str


class IVRResponse(BaseModel):
    session_id: str
    message: str
    state: str
    options: Optional[Dict[str, str]] = None
    is_end: bool = False


def get_greeting() -> str:
    """Return time-based greeting"""
    hour = datetime.now().hour
    if 5 <= hour < 12:
        return "Good morning"
    elif 12 <= hour < 17:
        return "Good afternoon"
    elif 17 <= hour < 21:
        return "Good evening"
    else:
        return "Good night"


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Train IVR System API",
        "version": "1.0.0",
        "endpoints": {
            "/api/ivr/start": "Start new IVR session",
            "/api/ivr/input": "Process user input (keypad or voice)",
            "/api/ivr/end": "End IVR session",
            "/api/flows": "Get available flows"
        }
    }


@app.post("/api/ivr/start", response_model=IVRResponse)
async def start_ivr(request: IVRStartRequest = None):
    """Initialize a new IVR session and return welcome message + main menu"""
    session_id = str(uuid.uuid4())
    greeting = get_greeting()
    
    # Initialize session
    sessions[session_id] = {
        "session_id": session_id,
        "started_at": datetime.now().isoformat(),
        "current_flow": "train_main",
        "current_state": "main_menu",
        "history": [],
        "data": {}  # Store user inputs like train number, PNR, etc.
    }
    
    # Reload flows to ensure latest changes are loaded
    flow_manager.reload_flows()
    
    # Get main menu flow
    main_flow = flow_manager.get_flow("train_main")
    main_menu = main_flow.get("states", {}).get("main_menu", {})
    
    # More conversational welcome message with complete information
    welcome_message = f"{greeting}! Thank you for calling the Train Enquiry System. My name is your virtual assistant, and I'm here to help you with all your train-related queries today. "
    menu_message = main_menu.get("message", "")
    
    # Use the message from flow file, or construct complete one
    if menu_message:
        full_message = welcome_message + menu_message
    else:
        full_message = welcome_message + "Press 1 for Booking, Press 2 for Train Status, Press 3 for Schedule, Press 4 for Cancellation, Press 5 for PNR Status, Press 6 for Seat Availability, Press 7 for Fare Enquiry, Press 8 for Trains Between Stations, Press 0 to Repeat Menu, Press Star for Main Menu, or Press 9 for Customer Support. You can also speak your request anytime. How can I help you today?"
    
    # Log to session
    sessions[session_id]["history"].append({
        "type": "system",
        "message": full_message,
        "timestamp": datetime.now().isoformat()
    })
    
    # Ensure all options are included
    menu_options = main_menu.get("options", {})
    if not menu_options or len(menu_options) < 10:
        # Fallback options if not loaded correctly
        menu_options = {
            "1": "Book Train Ticket",
            "2": "Check Train Status",
            "3": "Train Schedule",
            "4": "Ticket Cancellation",
            "5": "PNR Status Check",
            "6": "Seat Availability",
            "7": "Fare Enquiry",
            "8": "Trains Between Stations",
            "0": "Repeat Menu",
            "*": "Return to Main Menu",
            "#": "Confirm/Submit",
            "9": "Talk to Customer Support Agent"
        }
    
    return IVRResponse(
        session_id=session_id,
        message=full_message,
        state="main_menu",
        options=menu_options,
        is_end=False
    )


@app.post("/api/ivr/input", response_model=IVRResponse)
async def process_input(request: IVRInputRequest):
    """Process user input (keypad key or speech) and return IVR response"""
    
    if request.session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = sessions[request.session_id]
    user_input = request.input.strip().lower()
    
    # Log user input
    session["history"].append({
        "type": "user",
        "message": user_input,
        "timestamp": datetime.now().isoformat()
    })
    
    current_flow_name = session["current_flow"]
    current_state = session["current_state"]
    current_flow = flow_manager.get_flow(current_flow_name)
    
    # Determine if input is keypad (single digit/key) or speech
    is_keypad = len(user_input) == 1 and user_input in "0123456789*#"
    
    # Process input with error handling
    try:
        next_state, response_message, options, is_end = flow_manager.process_input(
            current_flow, 
            current_state, 
            user_input,
            is_keypad,
            session
        )
    except Exception as e:
        # Graceful error handling - never get stuck
        print(f"Error processing input: {e}")
        response_message = "I apologize, but I encountered an issue processing your request. Let's try again! You can say your request again or use the keypad. How can I help you?"
        next_state = current_state if current_state else "main_menu"
        options = {}
        is_end = False
    
    # Update session
    session["current_state"] = next_state
    
    # Check if we need to switch flows
    if next_state.startswith("flow:"):
        # Extract flow name from state (e.g., "flow:booking" -> "booking")
        new_flow_name = next_state.split(":")[1]
        session["current_flow"] = new_flow_name
        new_flow = flow_manager.get_flow(new_flow_name)
        initial_state_name = new_flow.get("initial_state", "main_menu")
        session["current_state"] = initial_state_name
        
        # Get the new state's message immediately - show the first question
        new_state_data = new_flow.get("states", {}).get(initial_state_name, {})
        response_message = new_state_data.get("message", "How can I help you?")
        options = new_state_data.get("options", {})
        next_state = initial_state_name
        
        # If the state has collect_data, ask the question immediately
        if "actions" in new_state_data and "collect_data" in new_state_data["actions"]:
            # Message already set above, just ensure it's displayed
            pass
    
    # Log system response
    session["history"].append({
        "type": "system",
        "message": response_message,
        "timestamp": datetime.now().isoformat()
    })
    
    return IVRResponse(
        session_id=request.session_id,
        message=response_message,
        state=next_state,
        options=options,
        is_end=is_end
    )


@app.post("/api/ivr/end")
async def end_ivr(request: IVREndRequest):
    """End IVR session and return call summary"""
    
    if request.session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = sessions[request.session_id]
    session["ended_at"] = datetime.now().isoformat()
    
    # Calculate call duration
    started = datetime.fromisoformat(session["started_at"])
    ended = datetime.fromisoformat(session["ended_at"])
    duration = (ended - started).total_seconds()
    
    # Create summary
    summary = {
        "session_id": request.session_id,
        "duration_seconds": round(duration, 2),
        "started_at": session["started_at"],
        "ended_at": session["ended_at"],
        "total_exchanges": len([h for h in session["history"] if h["type"] == "user"]),
        "transcript": session["history"],
        "collected_data": session["data"]
    }
    
    # Optionally save to file (for production, use database)
    try:
        with open(f"backend/logs/call_{request.session_id}.json", "w") as f:
            json.dump(summary, f, indent=2)
    except:
        pass  # Logs directory might not exist
    
    # Keep session for a while (optional cleanup later)
    # del sessions[request.session_id]  # Uncomment to remove immediately
    
    return {
        "message": "Call ended successfully",
        "summary": summary
    }


@app.get("/api/flows")
async def get_flows():
    """Return list of available flows and their structure"""
    flows_info = {}
    flow_names = ["train_main", "booking", "status", "schedule", "cancellation"]
    
    for flow_name in flow_names:
        flow = flow_manager.get_flow(flow_name)
        flows_info[flow_name] = {
            "name": flow.get("name", flow_name),
            "description": flow.get("description", ""),
            "initial_state": flow.get("initial_state", ""),
            "states": list(flow.get("states", {}).keys())
        }
    
    return {
        "available_flows": flow_names,
        "flows_detail": flows_info
    }


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Get session details (for debugging)"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return sessions[session_id]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

