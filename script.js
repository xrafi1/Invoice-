// 1. FIREBASE CONFIG (Use your existing config)
const firebaseConfig = {
    apiKey: "AIzaSyBdxnr5PCjDg7dSLaCt1mqf3rdJxtIMmCU",
    authDomain: "call-fd856.firebaseapp.com",
    projectId: "call-fd856",
    storageBucket: "call-fd856.firebasestorage.app",
    messagingSenderId: "494981504142",
    appId: "1:494981504142:web:f6cbd4ebfd47c2125bbddf",
    measurementId: "G-KJWMBPKKYJ"
  };

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const firestore = firebase.firestore();

// 2. WEBRTC CONFIG
const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

// Global State
let pc = null;
let localStream = null;
let remoteStream = null;
let roomId = null;
let unsubscribe = null;

// DOM Elements
const lobbyScreen = document.getElementById('lobby-screen');
const callScreen = document.getElementById('call-screen');
const roomIdInput = document.getElementById('roomId');
const statusText = document.getElementById('statusText');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

// Buttons
document.getElementById('generateBtn').onclick = () => {
    roomIdInput.value = Math.random().toString(36).substring(2, 8);
};
document.getElementById('startCallBtn').onclick = startCall;
document.getElementById('hangupBtn').onclick = hangUp;

// Media Toggles
document.getElementById('toggleMicBtn').onclick = (e) => toggleTrack('audio', e.currentTarget);
document.getElementById('toggleCamBtn').onclick = (e) => toggleTrack('video', e.currentTarget);

// --- MAIN LOGIC ---

async function startCall() {
    roomId = roomIdInput.value.trim();
    if (!roomId) return alert("Please enter a Room ID");

    statusText.innerText = "Accessing camera...";
    
    // 1. Get Video & Audio
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error(err);
        return alert("Camera/Mic access denied!");
    }

    // Switch Screens
    lobbyScreen.classList.add('hidden');
    callScreen.classList.remove('hidden');

    // 2. Setup Peer Connection
    pc = new RTCPeerConnection(servers);

    // Push local tracks
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // Handle Remote Stream
    pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => {
            remoteStream = event.streams[0];
            remoteVideo.srcObject = remoteStream;
        });
    };

    // 3. Firestore Logic (Same as before, simplified)
    const callDoc = firestore.collection('calls').doc(roomId);
    const offerCandidates = callDoc.collection('offerCandidates');
    const answerCandidates = callDoc.collection('answerCandidates');

    const docSnapshot = await callDoc.get();

    if (docSnapshot.exists) {
        // JOINING
        pc.onicecandidate = (event) => {
            if(event.candidate) answerCandidates.add(event.candidate.toJSON());
        };

        await pc.setRemoteDescription(new RTCSessionDescription(docSnapshot.data().offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        await callDoc.update({ answer: { sdp: answer.sdp, type: answer.type } });

        offerCandidates.onSnapshot(snap => {
            snap.docChanges().forEach(change => {
                if(change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            });
        });

    } else {
        // HOSTING
        pc.onicecandidate = (event) => {
            if(event.candidate) offerCandidates.add(event.candidate.toJSON());
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await callDoc.set({ offer: { sdp: offer.sdp, type: offer.type } });

        callDoc.onSnapshot(snap => {
            const data = snap.data();
            if(!pc.currentRemoteDescription && data?.answer) {
                pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        });

        answerCandidates.onSnapshot(snap => {
            snap.docChanges().forEach(change => {
                if(change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            });
        });
    }

    // Safety cleanup on disconnect
    pc.onconnectionstatechange = () => {
        if(pc.connectionState === 'disconnected') hangUp();
    };
}

function hangUp() {
    if(localStream) localStream.getTracks().forEach(track => track.stop());
    if(pc) pc.close();
    
    // Simple UI Reset
    window.location.reload();
}

function toggleTrack(kind, btnElement) {
    const track = localStream.getTracks().find(t => t.kind === kind);
    if(track) {
        track.enabled = !track.enabled;
        // Update Button UI
        if(track.enabled) {
            btnElement.classList.remove('inactive');
            btnElement.classList.add('active');
        } else {
            btnElement.classList.remove('active');
            btnElement.classList.add('inactive');
        }
    }
}
