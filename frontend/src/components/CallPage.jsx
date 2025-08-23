import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import API from '../api';
import { authHeader } from '../utils/auth';

const SOCKET_URL = process.env.REACT_APP_SOCKET || 'http://localhost:5000';
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function CallPage(){
  const { peerId } = useParams();
  const loc = useLocation();
  const nav = useNavigate();

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const [status, setStatus] = useState('starting');
  const [peerUser, setPeerUser] = useState(loc.state?.peerUser || null);
  const [myUser, setMyUser] = useState(null);

  // buffer ICE candidates until we know remote socket id
  const iceQueueRef = useRef([]);
  const setRemoteSocket = (sockId) => {
    socketRef.current._remoteSocket = sockId;
    // flush queued candidates
    if (iceQueueRef.current.length) {
      iceQueueRef.current.forEach(c =>
        socketRef.current.emit('ice-candidate', { toSocket: sockId, candidate: c })
      );
      iceQueueRef.current = [];
    }
  };

  useEffect(() => {
    API('/api/users/me', { headers: authHeader() }).then(setMyUser).catch(()=>{});
    if (!peerUser) {
      // you may fetch peer details by id here if needed
    }
  }, []);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current.on('connect', () => {
      API('/api/users/me', { headers: authHeader() }).then(user => {
        if (user && user._id) socketRef.current.emit('registerSocket', user._id);
      });
    });

    socketRef.current.on('incoming-call', async ({ offer, fromUser, fromName, fromSocket }) => {
      console.log('[Signaling] Incoming call from', fromUser, fromName, 'socket:', fromSocket);
      setStatus('incoming');
      socketRef.current._lastIncoming = { fromSocket, fromUser, fromName, offer };
    });

    socketRef.current.on('call-accepted', async ({ answer, fromSocket }) => {
      try {
        console.log('[Signaling] Call accepted by socket:', fromSocket);
        // store remote socket so our ICE can be delivered
        setRemoteSocket(fromSocket);
        await pcRef.current.setRemoteDescription(answer);
        setStatus('in-call');
      } catch (e) {
        console.error('Error applying remote answer', e);
      }
    });

    socketRef.current.on('ice-candidate', async ({ candidate, fromSocket }) => {
      try {
        if (candidate && pcRef.current) {
          await pcRef.current.addIceCandidate(candidate);
          // set remote socket opportunistically if we didn't have it (rare)
          if (!socketRef.current._remoteSocket && fromSocket) setRemoteSocket(fromSocket);
        }
      } catch (e) {
        console.warn('Error adding remote ICE', e);
      }
    });

    socketRef.current.on('call-ended', () => {
      endCall();
      alert('Call ended by other user');
    });

    return () => socketRef.current.disconnect();
    // eslint-disable-next-line
  }, []);

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection(ICE_CONFIG);

    pc.onicecandidate = e => {
      if (e.candidate) {
        const remoteSock = socketRef.current._remoteSocket;
        if (remoteSock) {
          socketRef.current.emit('ice-candidate', { toSocket: remoteSock, candidate: e.candidate });
        } else {
          // buffer until we learn remote socket id
          iceQueueRef.current.push(e.candidate);
        }
      }
    };

    pc.ontrack = e => {
      console.log('[PC] Remote track received', e.streams);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0];
        // ensure autoplay
        const p = remoteAudioRef.current.play();
        if (p?.catch) p.catch(err => console.warn('Autoplay blocked:', err));
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[PC] ICE state:', pc.iceConnectionState);
      if (['failed', 'disconnected'].includes(pc.iceConnectionState)) {
        // Often indicates TURN is needed or network hiccup
      }
    };

    pcRef.current = pc;
  };

  const startLocalStream = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;
    stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));
  };

  // Caller flow
  const callUser = async () => {
    try {
      setStatus('calling');
      createPeerConnection();
      await startLocalStream();

      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);

      socketRef.current.emit('call-user', {
        toUserId: peerId,
        offer: pcRef.current.localDescription,
        fromUser: myUser ? myUser._id : null,
        fromName: myUser ? myUser.username : 'Unknown'
      });
    } catch (err) {
      console.error(err); setStatus('error'); alert('Call failed');
    }
  };

  // Callee flow
  const acceptCall = async () => {
    try {
      setStatus('connecting');
      const incoming = socketRef.current._lastIncoming;
      if (!incoming) { alert('No incoming call'); return; }

      createPeerConnection();
      await startLocalStream();

      await pcRef.current.setRemoteDescription(incoming.offer);
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);

      // store caller's socket to allow sending ICE immediately
      setRemoteSocket(incoming.fromSocket);

      socketRef.current.emit('answer-call', {
        toSocket: incoming.fromSocket,
        answer: pcRef.current.localDescription
      });

      setStatus('in-call');
    } catch (err) {
      console.error(err); setStatus('error');
    }
  };

  const endCall = () => {
    try {
      if (pcRef.current) {
        pcRef.current.getSenders().forEach(s => { try { s.track.stop(); } catch {} });
        pcRef.current.close();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
    } catch (e) {}
    pcRef.current = null;
    localStreamRef.current = null;
    setStatus('ended');

    if (socketRef.current && socketRef.current._remoteSocket) {
      socketRef.current.emit('end-call', { toSocket: socketRef.current._remoteSocket });
    }
    setTimeout(() => nav('/'), 800);
  };

  return (
    <div className="call-page">
      <h3>Call with {peerUser ? peerUser.username : (peerId || '')}</h3>
      <p>Status: {status}</p>

      {/* remote audio element */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="call-controls">
        {status === 'starting' && <button onClick={callUser}>Call</button>}
        {status === 'incoming' && <button onClick={acceptCall}>Accept</button>}
        {(status === 'in-call' || status === 'calling' || status === 'connecting') &&
          <button onClick={endCall}>End Call</button>}
      </div>
    </div>
  );
}
