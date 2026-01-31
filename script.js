// ==========================================
// 1. FIREBASE CONFIGURATION
// (Updated with your credentials)
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBdxnr5PCjDg7dSLaCt1mqf3rdJxtIMmCU",
  authDomain: "call-fd856.firebaseapp.com",
  projectId: "call-fd856",
  storageBucket: "call-fd856.firebasestorage.app",
  messagingSenderId: "494981504142",
  appId: "1:494981504142:web:f6cbd4ebfd47c2125bbddf",
  measurementId: "G-KJWMBPKKYJ"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

// ==========================================
// 2. WEBRTC CONFIGURATION
// ==========================================
const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302']
        }
    ]
};

// Global State
let pc = null; // Peer Connection
let localStream = null;
let remoteStream = null;
let roomId = null;
let unsubscribe = null; // Firestore listener unsubscription

// HTML Elements
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('roomId');
const startCallBtn = document.getElementById('startCallBtn');
const hangupBtn = document.getElementById('hangupBtn');
const generateRoomBtn = document.getElementById('generateRoomBtn');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');
const remoteAudio = document.getElementById('remoteAudio');

// ==========================================
// 3. EVENT LISTENERS
// ==========================================

startCallBtn.addEventListener('click', startCall);
hangupBtn.addEventListener('click', hangUp);
generateRoomBtn.addEventListener('click', () => {
    // Generate a random 6-character room ID
    roomIdInput.value = Math.random().toString(36).substring(2, 8);
});

// ==========================================
// 4. CORE FUNCTIONS
// ==========================================

async function startCall() {
    roomId = roomIdInput.value.trim();
    if (!roomId) {
        alert("Please enter a Room ID or generate one.");
        return;
    }

    startCallBtn.disabled = true;
    hangupBtn.disabled = false;
    roomIdInput.disabled = true;
    updateStatus("Initializing media...", "calling");

    // 1. Get Local Media (Microphone)
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
        console.error("Error accessing microphone:", error);
        alert("Microphone access is required.");
        hangUp();
        return;
    }
    
    // 2. Create Peer Connection
    pc = new RTCPeerConnection(servers);

    // 3. Push local tracks to Peer Connection
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    // 4. Handle Remote Stream
    pc.ontrack = (event) => {
        console.log("Remote stream received");
        // Assign remote stream to hidden audio element
        if (remoteAudio.srcObject !== event.streams[0]) {
            remoteAudio.srcObject = event.streams[0];
        }
        updateStatus("Connected", "connected");
    };

    // 5. Handle ICE Candidates
    const callDoc = firestore.collection('calls').doc(roomId);
    const offerCandidates = callDoc.collection('offerCandidates');
    const answerCandidates = callDoc.collection('answerCandidates');

    // 6. Check if room exists to decide: Create Offer vs Answer
    const docSnapshot = await callDoc.get();

    if (docSnapshot.exists) {
        // --- JOINING EXISTING CALL (User B) ---
        console.log("Joining existing room...");
        updateStatus("Joining call...", "calling");

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                answerCandidates.add(event.candidate.toJSON());
            }
        };

        const offerDescription = docSnapshot.data().offer;
        await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

        const answerDescription = await pc.createAnswer();
        await pc.setLocalDescription(answerDescription);

        const answer = {
            type: answerDescription.type,
            sdp: answerDescription.sdp,
        };

        await callDoc.update({ answer });

        // Listen for remote ICE candidates (Caller's candidates)
        offerCandidates.onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const candidate = new RTCIceCandidate(change.doc.data());
                    pc.addIceCandidate(candidate).catch(e => console.error(e));
                }
            });
        });

    } else {
        // --- CREATING NEW CALL (User A) ---
        console.log("Creating new room...");
        updateStatus("Waiting for other user...", "calling");

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                offerCandidates.add(event.candidate.toJSON());
            }
        };

        const offerDescription = await pc.createOffer();
        await pc.setLocalDescription(offerDescription);

        const offer = {
            sdp: offerDescription.sdp,
            type: offerDescription.type,
        };

        await callDoc.set({ offer });

        // Listen for Answer
        unsubscribe = callDoc.onSnapshot(snapshot => {
            const data = snapshot.data();
            if (!pc.currentRemoteDescription && data?.answer) {
                const answerDescription = new RTCSessionDescription(data.answer);
                pc.setRemoteDescription(answerDescription);
            }
        });

        // Listen for remote ICE candidates (Callee's candidates)
        answerCandidates.onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const candidate = new RTCIceCandidate(change.doc.data());
                    pc.addIceCandidate(candidate).catch(e => console.error(e));
                }
            });
        });
    }

    // Handle Connection State Changes
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected') {
            hangUp();
        }
    };
}

function hangUp() {
    // 1. Stop Local Stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    // 2. Close Peer Connection
    if (pc) {
        pc.close();
    }

    // 3. Clean UI
    roomIdInput.value = "";
    roomIdInput.disabled = false;
    startCallBtn.disabled = false;
    hangupBtn.disabled = true;
    updateStatus("Call ended", "ended");

    // 4. Stop Listening to Firestore
    if (unsubscribe) {
        unsubscribe();
    }

    // Refresh to clear old connection data
    setTimeout(() => window.location.reload(), 1000);
}

function updateStatus(text, className) {
    statusText.innerText = text;
    statusIndicator.className = 'indicator ' + className;
}
